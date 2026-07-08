import { useState, useEffect } from 'react';
import { RefreshCw, Sparkles } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts';
import { CHART_PALETTE } from '../../lib/chartPalette';

const CDS_BASE = 'http://localhost:8000';

interface TableData { headers: string[]; rows: Record<string, string | number>[]; }
interface ChartData { chartType?: string; xKey: string; yKey?: string; rows: Record<string, any>[]; }

type RenderAs = 'bar' | 'table' | 'pie';

function Skeleton() {
  return (
    <>
      <style>{`@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}`}</style>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {[70, 55, 85, 40].map((w, i) => (
          <div key={i} style={{
            height: 14, width: `${w}%`, borderRadius: 6,
            background: 'linear-gradient(90deg,var(--bg-surface-2) 25%,var(--border) 50%,var(--bg-surface-2) 75%)',
            backgroundSize: '200% 100%',
            animation: 'shimmer 1.5s infinite',
          }} />
        ))}
        <div style={{
          height: 160, borderRadius: 8, marginTop: 8,
          background: 'linear-gradient(90deg,var(--bg-surface-2) 25%,var(--border) 50%,var(--bg-surface-2) 75%)',
          backgroundSize: '200% 100%',
          animation: 'shimmer 1.5s infinite',
        }} />
      </div>
    </>
  );
}

function toBarData(data: any): { xKey: string; yKey: string; rows: any[] } | null {
  if (!data) return null;
  if (data.rows && data.xKey) return { xKey: data.xKey, yKey: data.yKey ?? 'value', rows: data.rows };
  if (data.headers && data.rows && data.rows.length > 0) {
    const xKey = data.headers[0];
    const yKey = data.headers[data.headers.length - 1];
    return { xKey, yKey, rows: data.rows };
  }
  return null;
}

function toPieData(data: any): { name: string; value: number }[] | null {
  if (!data) return null;
  if (Array.isArray(data) && data[0]?.name != null) return data;
  if (data.headers && data.rows) {
    const nk = data.headers[0];
    const vk = data.headers[data.headers.length - 1];
    return data.rows.map((r: any) => ({ name: String(r[nk] ?? ''), value: Number(r[vk]) || 0 }));
  }
  return null;
}

interface Props {
  title: string;
  question: string;
  renderAs: RenderAs;
}

export default function InsightPanel({ title, question, renderAs }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [answer, setAnswer] = useState('');
  const [data, setData] = useState<any>(null);

  async function load() {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch(`${CDS_BASE}/cds/reports-chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, history: [] }),
      });
      if (!res.ok) throw new Error();
      const json = await res.json();
      setAnswer(json.answer ?? '');
      setData(json.data ?? null);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  return (
    <div style={{
      background: 'var(--bg-card)', borderRadius: 10, border: '1px solid var(--border)',
      padding: '16px 18px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
      display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h3 style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-heading)', margin: 0 }}>{title}</h3>
        {!loading && !error && (
          <button onClick={load} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-subtle)', padding: 2, display: 'flex' }}>
            <RefreshCw size={13} />
          </button>
        )}
      </div>

      {loading && <Skeleton />}

      {error && (
        <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-subtle)' }}>
          <div style={{ fontSize: 13, marginBottom: 10 }}>Failed to load insight</div>
          <button onClick={load} style={{
            background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 7,
            padding: '6px 16px', fontSize: 12, color: 'var(--text-body)', cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', gap: 6,
          }}>
            <RefreshCw size={12} /> Retry
          </button>
        </div>
      )}

      {!loading && !error && (
        <>
          {answer && (
            <p style={{ fontSize: 12, color: 'var(--text-body2)', margin: 0, lineHeight: 1.5 }}>{answer}</p>
          )}

          {renderAs === 'bar' && (() => {
            const bd = toBarData(data);
            if (!bd || bd.rows.length === 0) return <p style={{ fontSize: 12, color: 'var(--text-subtle)', margin: 0 }}>No data available yet.</p>;
            return (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={bd.rows} margin={{ left: -10, right: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-light)" />
                  <XAxis dataKey={bd.xKey} tick={{ fontSize: 10 }} angle={-30} textAnchor="end" height={48} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Bar dataKey={bd.yKey} fill={CHART_PALETTE[0]} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            );
          })()}

          {renderAs === 'table' && (() => {
            if (!data?.headers || !data?.rows?.length) return <p style={{ fontSize: 12, color: 'var(--text-subtle)', margin: 0 }}>No data available yet.</p>;
            const td = data as TableData;
            return (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr>
                      {td.headers.map((h) => (
                        <th key={h} style={{
                          background: 'var(--bg-surface)', border: '1px solid var(--border)',
                          padding: '6px 10px', textAlign: 'left', textTransform: 'uppercase',
                          letterSpacing: '0.05em', fontWeight: 600, color: 'var(--text-body2)', fontSize: 11,
                        }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {td.rows.map((row, i) => (
                      <tr key={i} style={{ background: i % 2 === 0 ? 'var(--bg-card)' : 'var(--bg-surface)' }}>
                        {td.headers.map((h) => (
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
          })()}

          {renderAs === 'pie' && (() => {
            const pd = toPieData(data);
            if (!pd || pd.length === 0) return <p style={{ fontSize: 12, color: 'var(--text-subtle)', margin: 0 }}>No data available yet.</p>;
            return (
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={pd} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" label={({ name, value }) => `${name}: ${value}`} labelLine={false}>
                    {pd.map((_, i) => <Cell key={i} fill={CHART_PALETTE[i % CHART_PALETTE.length]} />)}
                  </Pie>
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            );
          })()}

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 2 }}>
            <span style={{ fontSize: 10, color: 'var(--text-faint)', display: 'flex', alignItems: 'center', gap: 3 }}>
              <Sparkles size={9} /> Generated by AI
            </span>
          </div>
        </>
      )}
    </div>
  );
}
