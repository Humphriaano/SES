import { useEffect, useMemo, useState } from 'react';
import api from '../../api/client';
import { InvestigationItem } from '../../types/consultation';
import { flattenOrders, pairWithOrders, parseRows, flagFor, isDone, ServerOrderItem } from '../../lib/investigations';

function fmt(iso: string) {
  return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// The tests on a finalised note, each with its actual results (values, units, reference ranges, flags) —
// so a printed note carries the findings, not just the word "Resulted".
export default function FinalInvestigationResults({ items, encounterId }: { items: InvestigationItem[]; encounterId: string }) {
  const [server, setServer] = useState<ServerOrderItem[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    api.get('/investigations/orders', { params: { encounterId } })
      .then((r) => { if (live) setServer(flattenOrders(r.data)); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [encounterId]);

  const paired = useMemo(() => (server ? pairWithOrders(items, server) : []), [items, server]);

  if (failed) {
    return <p style={{ margin: 0, fontSize: 13, color: 'var(--badge-red-text)' }}>Couldn’t load the investigation results. Check your connection and reopen this note before printing.</p>;
  }
  if (!server) return <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>Loading results…</p>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {items.map((item, i) => {
        const s = paired[i];
        const latest = s?.results?.[0];
        const rows = parseRows(latest?.resultsJson);
        const done = !!s && isDone(s.status);
        return (
          <div key={item.id} className="print-block-card" style={{ breakInside: 'avoid', pageBreakInside: 'avoid' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
              <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-heading)' }}>{item.name}</span>
              {s?.specimen && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{s.specimen}</span>}
              <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)' }}>
                {done && latest
                  ? `Resulted ${fmt(latest.resultedAt)}${s?.status === 'Amended' ? ' · amended' : ''}`
                  : s?.status === 'In Progress' ? 'In progress — no result yet'
                    : 'Pending — no result yet'}
              </span>
            </div>

            {done && rows.length > 0 ? (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--text-subtle)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    <th style={th}>Parameter</th><th style={th}>Result</th><th style={th}>Units</th><th style={th}>Reference range</th><th style={th}>Flag</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, j) => {
                    const flag = flagFor(r.status);
                    const bold = flag.level === 'abnormal' || flag.level === 'critical';
                    return (
                      <tr key={r.componentId ?? j} style={{ borderTop: '1px solid var(--border-light)' }}>
                        <td style={td}>{r.componentName}</td>
                        <td style={{ ...td, fontWeight: bold ? 800 : 600, color: flag.level === 'critical' ? 'var(--clinical-critical)' : 'var(--text-heading)' }}>{r.value || '—'}</td>
                        <td style={{ ...td, color: 'var(--text-muted)' }}>{r.units || ''}</td>
                        <td style={{ ...td, color: 'var(--text-muted)' }}>{r.referenceRange || ''}</td>
                        <td style={{ ...td, fontWeight: 500, fontSize: 12, color: flag.level === 'critical' ? 'var(--clinical-critical)' : 'var(--badge-amber-text)' }}>{flag.text}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : done ? (
              <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>Marked as resulted, but no values were recorded.</p>
            ) : !s ? (
              <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>No lab order found for this test.</p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

const th: React.CSSProperties = { padding: '4px 8px 4px 0', fontWeight: 500 };
const td: React.CSSProperties = { padding: '6px 8px 6px 0', verticalAlign: 'top', color: 'var(--text-body)' };
