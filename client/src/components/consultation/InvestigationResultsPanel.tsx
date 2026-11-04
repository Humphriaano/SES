import { useState, useEffect } from 'react';
import { X, ChevronDown, ChevronRight } from 'lucide-react';
import api from '../../api/client';

// ── helpers ───────────────────────────────────────────────────────────────────
function statusColor(status: string): string {
  if (status === 'High' || status === 'Abnormal') return 'var(--badge-amber-text)';
  if (status === 'Low') return 'var(--badge-blue-text)';
  if (status === 'Critical' || status === 'Positive') return 'var(--clinical-critical)';
  if (status === 'Normal' || status === 'Negative') return 'var(--badge-green-text)';
  return '#475569';
}

function statusBg(status: string): string {
  if (status === 'High' || status === 'Abnormal') return 'var(--badge-amber-bg)';
  if (status === 'Low') return 'var(--badge-blue-bg)';
  if (status === 'Critical' || status === 'Positive') return 'var(--badge-red-bg)';
  if (status === 'Normal' || status === 'Negative') return 'var(--badge-green-bg)';
  return 'var(--badge-gray-bg)';
}

function parseRows(result: any): any[] {
  if (!result?.resultsJson) return [];
  try { return JSON.parse(result.resultsJson); } catch { return []; }
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// ── Status badge ──────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  return (
    <span style={{
      fontSize: 10, fontWeight: 500, padding: '2px 7px', borderRadius: 10,
      background: statusBg(status), color: statusColor(status),
      whiteSpace: 'nowrap',
    }}>
      {status}
    </span>
  );
}

// ── Single-test result row ────────────────────────────────────────────────────
function SingleResultTable({ rows }: { rows: any[] }) {
  if (!rows.length) return null;
  const r = rows[0];
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
      <thead>
        <tr style={{ borderBottom: '1px solid var(--border)' }}>
          {['Test', 'Result', 'Units', 'Ref Range', 'Status'].map(h => (
            <th key={h} style={{ textAlign: 'left', padding: '5px 10px', fontSize: 10, fontWeight: 500, color: 'var(--text-body2)', textTransform: 'uppercase' }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        <tr>
          <td style={{ padding: '9px 10px', color: 'var(--text-heading)', fontWeight: 500 }}>{r.componentName}</td>
          <td style={{ padding: '9px 10px', fontWeight: 500, color: statusColor(r.status) }}>{r.value || '—'}</td>
          <td style={{ padding: '9px 10px', color: 'var(--text-body2)' }}>{r.units ?? '—'}</td>
          <td style={{ padding: '9px 10px', color: 'var(--text-body2)', fontSize: 12 }}>{r.referenceRange ?? '—'}</td>
          <td style={{ padding: '9px 10px' }}><StatusBadge status={r.status} /></td>
        </tr>
      </tbody>
    </table>
  );
}

// ── Panel-test result table ───────────────────────────────────────────────────
function PanelResultTable({ rows }: { rows: any[] }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
      <thead>
        <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)' }}>
          {['Component', 'Abbr', 'Result', 'Units', 'Status'].map(h => (
            <th key={h} style={{ textAlign: 'left', padding: '6px 10px', fontSize: 10, fontWeight: 500, color: 'var(--text-body2)', textTransform: 'uppercase' }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r: any, i: number) => (
          <tr key={i} style={{ borderBottom: '1px solid var(--border-light)' }}>
            <td style={{ padding: '7px 10px', color: 'var(--text-heading)', fontWeight: 500 }}>{r.componentName}</td>
            <td style={{ padding: '7px 10px', color: 'var(--text-body2)' }}>{r.abbr || '—'}</td>
            <td style={{ padding: '7px 10px', fontWeight: 500, color: statusColor(r.status) }}>{r.value || '—'}</td>
            <td style={{ padding: '7px 10px', color: 'var(--text-body2)' }}>{r.units ?? '—'}</td>
            <td style={{ padding: '7px 10px' }}><StatusBadge status={r.status} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── Amended side-by-side comparison ──────────────────────────────────────────
function AmendedComparison({ amendedRows, originalRows, amendedAt }: {
  amendedRows: any[];
  originalRows: any[];
  amendedAt: string;
}) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--badge-amber-text)', background: 'var(--badge-amber-bg)', padding: '2px 8px', borderRadius: 4 }}>
          Amended {fmtDate(amendedAt)}
        </span>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)' }}>
            <th style={{ textAlign: 'left', padding: '6px 10px', fontSize: 10, fontWeight: 500, color: 'var(--text-body2)', textTransform: 'uppercase' }}>Component</th>
            <th style={{ textAlign: 'left', padding: '6px 10px', fontSize: 10, fontWeight: 500, color: 'var(--text-body2)', textTransform: 'uppercase' }}>Original</th>
            <th style={{ textAlign: 'left', padding: '6px 10px', fontSize: 10, fontWeight: 500, color: 'var(--text-body2)', textTransform: 'uppercase' }}>Amended</th>
          </tr>
        </thead>
        <tbody>
          {amendedRows.map((aRow: any, i: number) => {
            const oRow = originalRows.find(o => o.componentName === aRow.componentName) ?? {};
            const changed = aRow.value !== oRow.value || aRow.status !== oRow.status;
            return (
              <tr key={i} style={{ borderBottom: '1px solid var(--border-light)', background: changed ? 'var(--badge-amber-bg)' : 'transparent' }}>
                <td style={{ padding: '7px 10px', color: 'var(--text-heading)', fontWeight: 500 }}>{aRow.componentName}</td>
                <td style={{ padding: '7px 10px' }}>
                  <span style={{ color: statusColor(oRow.status ?? ''), fontWeight: 500 }}>{oRow.value ?? '—'}</span>
                  {oRow.units && <span style={{ color: 'var(--text-muted)', fontSize: 11, marginLeft: 4 }}>{oRow.units}</span>}
                </td>
                <td style={{ padding: '7px 10px' }}>
                  <span style={{ color: statusColor(aRow.status), fontWeight: 500 }}>{aRow.value || '—'}</span>
                  {aRow.units && <span style={{ color: 'var(--text-muted)', fontSize: 11, marginLeft: 4 }}>{aRow.units}</span>}
                  <span style={{ marginLeft: 6 }}><StatusBadge status={aRow.status} /></span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────
interface Props {
  item: any;
  patientId: string;
  onClose: () => void;
}

export default function InvestigationResultsPanel({ item, patientId, onClose }: Props) {
  const open = !!item;
  const [history, setHistory] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null);

  useEffect(() => {
    if (!item) { setHistory([]); return; }
    setExpandedHistoryId(null);
    setHistoryLoading(true);
    api.get(`/investigations/results?patientId=${patientId}&testName=${encodeURIComponent(item.name)}`)
      .then(r => setHistory(r.data))
      .catch(() => setHistory([]))
      .finally(() => setHistoryLoading(false));
  }, [item?.id, patientId]);

  const sortedResults = [...(item?.results ?? [])].sort((a: any, b: any) => {
    if (a.amendedAt && !b.amendedAt) return -1;
    if (!a.amendedAt && b.amendedAt) return 1;
    return new Date(b.resultedAt).getTime() - new Date(a.resultedAt).getTime();
  });

  const latestResult = sortedResults[0] ?? null;
  const isAmended = item?.status === 'Amended';
  const originalResult = isAmended ? sortedResults.find((r: any) => !r.amendedAt) : null;
  const isPanel = item?.type === 'panel';

  const currentRows = parseRows(latestResult);
  const originalRows = parseRows(originalResult);

  const pastHistory = history.filter(h => h.id !== item?.id);

  return (
    <div
      style={{
        position: 'fixed',
        top: 96,
        right: 0,
        width: 520,
        height: 'calc(100vh - 96px)',
        background: 'var(--bg-card)',
        borderLeft: '1px solid var(--border)',
        boxShadow: '-6px 0 32px rgba(0,0,0,0.12)',
        zIndex: 42,
        display: 'flex',
        flexDirection: 'column',
        transform: open ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 0.25s ease',
      }}
    >
      {/* Header */}
      <div style={{
        padding: '16px 20px 14px',
        borderBottom: '1px solid var(--border-light)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-heading)', marginBottom: 2 }}>
            {item?.name ?? ''}
          </div>
          {item?.specimen && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{item.specimen}</div>
          )}
          {latestResult && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
              {isAmended
                ? `Amended ${fmtDate(latestResult.amendedAt)}`
                : `Resulted ${fmtDate(latestResult.resultedAt)}`
              }
            </div>
          )}
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--text-muted)', padding: 6, borderRadius: 999,
            display: 'flex', alignItems: 'center', transition: 'background 0.15s',
            flexShrink: 0,
          }}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-surface)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'none')}
        >
          <X size={16} />
        </button>
      </div>

      {/* Scrollable body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px 24px' }}>

        {/* ── Current result ─────────────────────────────────────────────── */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
            {isAmended ? 'Result (Amended)' : 'Result'}
          </div>

          {currentRows.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 13, fontStyle: 'italic' }}>No result data recorded.</div>
          ) : isAmended && originalResult ? (
            <AmendedComparison
              amendedRows={currentRows}
              originalRows={originalRows}
              amendedAt={latestResult?.amendedAt}
            />
          ) : isPanel ? (
            <PanelResultTable rows={currentRows} />
          ) : (
            <SingleResultTable rows={currentRows} />
          )}
        </div>

        {/* ── Result history ─────────────────────────────────────────────── */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
            Result History
          </div>

          {historyLoading ? (
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Loading history…</div>
          ) : pastHistory.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>No previous results for this test.</div>
          ) : (
            pastHistory.map(histItem => {
              const hSorted = [...(histItem.results ?? [])].sort((a: any, b: any) => {
                if (a.amendedAt && !b.amendedAt) return -1;
                if (!a.amendedAt && b.amendedAt) return 1;
                return 0;
              });
              const hResult = hSorted[0];
              const hRows = parseRows(hResult);
              const hIsExpanded = expandedHistoryId === histItem.id;
              const hIsPanel = histItem.type === 'panel';

              return (
                <div
                  key={histItem.id}
                  style={{ marginBottom: 6, border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}
                >
                  {/* Collapsed row */}
                  <button
                    onClick={() => setExpandedHistoryId(hIsExpanded ? null : histItem.id)}
                    style={{
                      width: '100%', textAlign: 'left',
                      background: hIsExpanded ? 'var(--bg-surface)' : 'var(--bg-card)',
                      border: 'none', cursor: 'pointer', padding: '9px 12px',
                      display: 'flex', alignItems: 'center', gap: 8,
                    }}
                    onMouseEnter={e => { if (!hIsExpanded) e.currentTarget.style.background = 'var(--bg-surface)'; }}
                    onMouseLeave={e => { if (!hIsExpanded) e.currentTarget.style.background = 'var(--bg-card)'; }}
                  >
                    {hIsExpanded
                      ? <ChevronDown size={12} color="var(--text-muted)" style={{ flexShrink: 0 }} />
                      : <ChevronRight size={12} color="var(--text-muted)" style={{ flexShrink: 0 }} />
                    }
                    <span style={{ fontSize: 12, color: 'var(--text-body)', fontWeight: 500, flex: 1 }}>
                      {hResult ? fmtDate(hResult.resultedAt) : fmtDate(histItem.order?.orderedAt)}
                    </span>
                    {histItem.status === 'Amended' && (
                      <span style={{ fontSize: 10, fontWeight: 500, color: 'var(--badge-amber-text)', background: 'var(--badge-amber-bg)', padding: '1px 6px', borderRadius: 4 }}>
                        Amended
                      </span>
                    )}
                    {/* Quick summary for single tests */}
                    {!hIsPanel && hRows[0] && (
                      <span style={{ fontSize: 12, fontWeight: 500, color: statusColor(hRows[0].status) }}>
                        {hRows[0].value} {hRows[0].units ?? ''}
                      </span>
                    )}
                    {hIsPanel && hRows.length > 0 && (
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{hRows.length} components</span>
                    )}
                  </button>

                  {/* Expanded values */}
                  {hIsExpanded && (
                    <div style={{ borderTop: '1px solid var(--border)', padding: '10px 12px' }}>
                      {hIsPanel
                        ? <PanelResultTable rows={hRows} />
                        : <SingleResultTable rows={hRows} />
                      }
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
