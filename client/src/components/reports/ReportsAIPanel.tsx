import { useState, useRef, useEffect, FormEvent } from 'react';
import { Send, Trash2, Bot, Download, Printer } from 'lucide-react';
import {
  BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { CHART_PALETTE } from '../../lib/chartPalette';

const CDS_BASE = 'http://localhost:8000';

const STARTERS = [
  'Which patients have uncontrolled hypertension?',
  'What is the most common diagnosis this month?',
  'Show pending investigations by test type',
  'Which medications are most frequently prescribed?',
  'How many patients were seen this week?',
];

interface TableData { headers: string[]; rows: Record<string, string | number>[]; }
interface ChartData {
  chartType: 'bar' | 'line';
  xKey: string;
  yKey?: string;
  yKeys?: string[];
  rows: Record<string, string | number | null>[];
}
interface Message {
  role: 'user' | 'assistant';
  content: string;
  responseType?: 'text' | 'table' | 'chart';
  data?: TableData | ChartData | null;
}


// ── PDF helpers ─────────────────────────────────────────────────────────────

function buildPdf(messages: Message[], exportTitle = 'SES EHR — AI Analytics Report'): jsPDF {
  const doc = new jsPDF();
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 14;
  const contentW = pageW - margin * 2;

  // Charcoal header band with a thin brand-red accent line beneath it
  doc.setFillColor(37, 43, 45); // --ses-charcoal
  doc.rect(0, 0, pageW, 13, 'F');
  doc.setFillColor(215, 29, 36); // --ses-red
  doc.rect(0, 13, pageW, 1.2, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text('SES EHR · Specialty Emergency Services', margin, 9);

  // Title block
  doc.setTextColor(51, 51, 51); // --ses-text
  doc.setFontSize(17);
  doc.setFont('helvetica', 'bold');
  doc.text(exportTitle, margin, 26);

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 116, 139);
  doc.text(`Generated: ${new Date().toLocaleString()}`, margin, 33);

  let y = 42;

  function checkPage(needed = 20) {
    if (y + needed > 275) {
      doc.addPage();
      y = 18;
    }
  }

  for (const msg of messages) {
    checkPage(30);

    if (msg.role === 'user') {
      doc.setFillColor(241, 245, 249);
      doc.roundedRect(margin - 2, y - 3, contentW + 4, 8, 2, 2, 'F');
      doc.setFontSize(8);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(100, 116, 139);
      doc.text('QUESTION', margin, y + 3);
      y += 11;

      doc.setFontSize(11);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(30, 41, 59);
      const qLines = doc.splitTextToSize(msg.content, contentW);
      checkPage(qLines.length * 6 + 6);
      doc.text(qLines, margin, y);
      y += qLines.length * 6 + 8;

    } else {
      doc.setFontSize(8);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(215, 29, 36); // --ses-red accent label
      doc.text('AI RESPONSE', margin, y);
      y += 6;

      doc.setFontSize(11);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(51, 65, 85);
      const aLines = doc.splitTextToSize(msg.content, contentW);
      checkPage(aLines.length * 6 + 4);
      doc.text(aLines, margin, y);
      y += aLines.length * 6 + 4;

      if (msg.responseType === 'table' && msg.data && (msg.data as TableData).headers) {
        checkPage(40);
        const td = msg.data as TableData;
        autoTable(doc, {
          head: [td.headers],
          body: td.rows.map((row) => td.headers.map((h) => String(row[h] ?? ''))),
          startY: y,
          theme: 'grid',
          headStyles: { fillColor: [37, 43, 45], textColor: [255, 255, 255], fontSize: 8, fontStyle: 'bold' },
          bodyStyles: { fontSize: 9 },
          alternateRowStyles: { fillColor: [248, 250, 252] },
          margin: { left: margin, right: margin },
        });
        y = (doc as any).lastAutoTable?.finalY ? (doc as any).lastAutoTable.finalY + 8 : y + 40;
      }

      if (msg.responseType === 'chart' && msg.data && (msg.data as ChartData).rows?.length) {
        const cd = msg.data as ChartData;
        const rows = cd.rows.filter((r) => Object.values(r).some((v) => v !== null));
        if (rows.length > 0) {
          checkPage(40);
          const cols = Object.keys(rows[0]);
          autoTable(doc, {
            head: [cols],
            body: rows.map((r) => cols.map((c) => String(r[c] ?? ''))),
            startY: y,
            theme: 'grid',
            headStyles: { fillColor: [37, 43, 45], textColor: [255, 255, 255], fontSize: 8, fontStyle: 'bold' },
            bodyStyles: { fontSize: 9 },
            margin: { left: margin, right: margin },
          });
          y = (doc as any).lastAutoTable?.finalY ? (doc as any).lastAutoTable.finalY + 8 : y + 40;
        }
      }

      y += 4;
    }
  }

  // Page footer — charcoal band with a red accent line, matching the header
  const pageH = doc.internal.pageSize.getHeight();
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFillColor(215, 29, 36); // --ses-red
    doc.rect(0, pageH - 11, pageW, 0.8, 'F');
    doc.setFillColor(37, 43, 45); // --ses-charcoal
    doc.rect(0, pageH - 10.2, pageW, 10.2, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.text(`SES EHR AI Analytics Report · Page ${i} of ${pages}`, margin, pageH - 4);
  }

  return doc;
}

function exportFullConversation(messages: Message[]) {
  const doc = buildPdf(messages);
  doc.save(`ses-ai-analytics-${new Date().toISOString().split('T')[0]}.pdf`);
}

function exportSingleResponse(msg: Message) {
  const doc = buildPdf([msg], 'SES EHR — AI Response Export');
  doc.save(`ses-ai-response-${Date.now()}.pdf`);
}

// ── Sub-components ───────────────────────────────────────────────────────────

function MsgTable({ data }: { data: TableData }) {
  return (
    <div style={{ overflowX: 'auto', marginTop: 8 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>
            {data.headers.map((h) => (
              <th key={h} style={{
                background: 'var(--bg-surface)', border: '1px solid var(--border)', padding: '6px 10px',
                textAlign: 'left', textTransform: 'uppercase', letterSpacing: '0.05em',
                fontWeight: 600, color: 'var(--text-body2)', fontSize: 11,
              }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row, i) => (
            <tr key={i} style={{ background: i % 2 === 0 ? 'var(--bg-card)' : 'var(--bg-surface)' }}>
              {data.headers.map((h) => (
                <td key={h} style={{ border: '1px solid var(--border)', padding: '5px 10px', color: 'var(--text-body)' }}>
                  {String(row[h] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MsgChart({ data }: { data: ChartData }) {
  if (!data.rows?.length) return null;
  if (data.chartType === 'line') {
    const yKeys = data.yKeys ?? (data.yKey ? [data.yKey] : []);
    return (
      <div style={{ marginTop: 8, height: 200 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data.rows as any[]}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-light)" />
            <XAxis dataKey={data.xKey} tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {yKeys.map((k, i) => (
              <Line key={k} type="monotone" dataKey={k} stroke={CHART_PALETTE[i % CHART_PALETTE.length]} strokeWidth={2} dot={{ r: 2 }} connectNulls />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  }
  return (
    <div style={{ marginTop: 8, height: 200 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data.rows as any[]} layout="vertical" margin={{ left: 8, right: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-light)" horizontal={false} />
          <XAxis type="number" tick={{ fontSize: 10 }} />
          <YAxis dataKey={data.xKey} type="category" tick={{ fontSize: 10 }} width={90} />
          <Tooltip />
          <Bar dataKey={data.yKey ?? 'value'} fill={CHART_PALETTE[0]} radius={[0, 3, 3, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function TypingIndicator() {
  return (
    <>
      <style>{`
        @keyframes ai-dot{0%,60%,100%{opacity:.25;transform:translateY(0)}30%{opacity:1;transform:translateY(-4px)}}
        .ai-dot-1{animation:ai-dot 1.2s infinite 0s}
        .ai-dot-2{animation:ai-dot 1.2s infinite .2s}
        .ai-dot-3{animation:ai-dot 1.2s infinite .4s}
      `}</style>
      <div style={{ display: 'flex', gap: 6, padding: '12px 14px', background: 'var(--bg-surface-2)', borderRadius: '12px 12px 12px 3px', width: 'fit-content', alignItems: 'center' }}>
        {['ai-dot-1', 'ai-dot-2', 'ai-dot-3'].map((cls) => (
          <span key={cls} className={cls} style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--text-subtle)', display: 'block' }} />
        ))}
      </div>
    </>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export default function ReportsAIPanel() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    const userMsg: Message = { role: 'user', content: trimmed };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const history = [...messages, userMsg].map((m) => ({ role: m.role, content: m.content }));
      const res = await fetch(`${CDS_BASE}/cds/reports-chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: trimmed, history }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: data.answer || 'I do not have that information in the current records.',
          responseType: data.responseType ?? 'text',
          data: data.data ?? null,
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: 'I do not have that information in the current records.', responseType: 'text' },
      ]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }

  function handleSubmit(e: FormEvent) { e.preventDefault(); sendMessage(input); }
  function clearChat() { setMessages([]); setInput(''); }
  const isEmpty = messages.length === 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-card)' }}>

      {/* ── Header ── */}
      <div style={{
        padding: '13px 16px', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexShrink: 0, background: 'var(--bg-card)', borderRadius: '10px 10px 0 0',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--badge-red-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Bot size={16} color="var(--ses-red)" />
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-heading)' }}>AI Analytics Assistant</div>
            <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 1 }}>Ask anything about your patient population</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {messages.length > 0 && (
            <button
              onClick={() => exportFullConversation(messages)}
              title="Export conversation as PDF"
              style={{
                background: 'none', border: '1px solid var(--border)', borderRadius: 6,
                cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4,
                fontSize: 11, padding: '4px 9px',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--ses-red)'; e.currentTarget.style.color = 'var(--ses-red)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-muted)'; }}
            >
              <Download size={12} /> Export PDF
            </button>
          )}
          {!isEmpty && (
            <button
              onClick={clearChat}
              title="Clear chat"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-subtle)', display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, padding: '4px 8px', borderRadius: 6 }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-surface)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
            >
              <Trash2 size={13} /> Clear
            </button>
          )}
        </div>
      </div>

      {/* ── Messages ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {isEmpty && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, gap: 8, paddingTop: 24 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
              Suggested questions
            </div>
            {STARTERS.map((s) => (
              <button key={s} onClick={() => sendMessage(s)} style={{
                background: 'var(--badge-red-bg)', border: '1px solid var(--badge-red-bg)', borderRadius: 20,
                padding: '7px 14px', fontSize: 12, color: 'var(--ses-red)', fontWeight: 500,
                cursor: 'pointer', textAlign: 'left', width: '100%', transition: 'all 0.15s',
              }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--ses-red)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--badge-red-bg)'; }}
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            style={{ display: 'flex', flexDirection: 'column', alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start' }}
            onMouseEnter={() => setHoveredIdx(i)}
            onMouseLeave={() => setHoveredIdx(null)}
          >
            <div style={{
              maxWidth: '90%', position: 'relative',
              background: msg.role === 'user' ? 'var(--ses-red)' : 'var(--bg-surface-2)',
              color: msg.role === 'user' ? '#fff' : 'var(--text-heading)',
              borderRadius: msg.role === 'user' ? '12px 12px 3px 12px' : '12px 12px 12px 3px',
              padding: '10px 13px', fontSize: 13, lineHeight: 1.55,
              width: msg.responseType !== 'text' && msg.role === 'assistant' ? '100%' : undefined,
            }}>
              <div>{msg.content}</div>
              {msg.role === 'assistant' && msg.responseType === 'table' && msg.data && (
                <MsgTable data={msg.data as TableData} />
              )}
              {msg.role === 'assistant' && msg.responseType === 'chart' && msg.data && (
                <MsgChart data={msg.data as ChartData} />
              )}

              {/* Print icon — shows on hover for AI responses */}
              {msg.role === 'assistant' && hoveredIdx === i && (
                <button
                  onClick={() => exportSingleResponse(msg)}
                  title="Export this response as PDF"
                  style={{
                    position: 'absolute', top: 6, right: 6,
                    background: 'var(--bg-card)', border: '1px solid var(--border)',
                    borderRadius: 5, padding: '3px 5px', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', color: 'var(--text-muted)',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
                  }}
                >
                  <Printer size={11} />
                </button>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
            <TypingIndicator />
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* ── Input bar ── */}
      <div style={{ borderTop: '1px solid var(--border)', padding: '10px 12px', flexShrink: 0 }}>
        <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask a question about your patients..."
            disabled={loading}
            style={{
              flex: 1, border: '1px solid var(--border-input)', borderRadius: 8,
              padding: '9px 12px', fontSize: 13, outline: 'none',
              background: loading ? 'var(--bg-surface)' : 'var(--bg-input)', color: 'var(--text-heading)',
              transition: 'border-color 0.15s', fontFamily: 'inherit',
            }}
            onFocus={(e) => (e.target.style.borderColor = 'var(--ses-red)')}
            onBlur={(e) => (e.target.style.borderColor = 'var(--border-input)')}
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            style={{
              background: loading || !input.trim() ? 'var(--border-input)' : 'var(--ses-red)',
              border: 'none', borderRadius: 8, padding: '9px 12px',
              cursor: loading || !input.trim() ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'background 0.15s', flexShrink: 0,
            }}
          >
            <Send size={15} color={loading || !input.trim() ? 'var(--text-subtle)' : '#fff'} />
          </button>
        </form>
      </div>
    </div>
  );
}
