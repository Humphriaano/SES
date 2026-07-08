import { CheckCircle, X } from 'lucide-react';
import { PMHBlockData, DiagnosisStatus } from '../../../types/consultation';

const STATUS_CFG: Record<DiagnosisStatus, { bg: string; color: string; label: string }> = {
  SUSPECTED: { bg: 'var(--badge-amber-bg)',    color: 'var(--badge-amber-text)',    label: 'Suspected' },
  CONFIRMED: { bg: 'var(--badge-blue-bg)',     color: 'var(--badge-blue-text)',     label: 'Confirmed' },
  CHRONIC:   { bg: 'var(--badge-charcoal-bg)', color: 'var(--badge-charcoal-text)', label: 'Chronic'   },
  RESOLVED:  { bg: 'var(--badge-green-bg)',    color: 'var(--badge-green-text)',    label: 'Resolved'  },
};

interface Props {
  data: PMHBlockData;
  onChange: (data: PMHBlockData) => void;
  onRemove: () => void;
  onResolve?: (diagnosisId: string) => void;
  readOnly?: boolean;
}

export default function PMHBlock({ data, onChange, onRemove, onResolve, readOnly }: Props) {
  function resolve(id: string) {
    onChange({ entries: data.entries.map(e => e.id === id ? { ...e, status: 'RESOLVED' as DiagnosisStatus } : e) });
    onResolve?.(id);
  }

  return (
    <div style={{
      borderLeft: '3px solid var(--ses-blue-deep)',
      background: 'var(--bg-card)',
      borderRadius: '0 10px 10px 0',
      padding: '10px 14px',
      margin: '4px 0',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--ses-blue-deep)', background: 'var(--ses-blue-tint)', padding: '2px 7px', borderRadius: 4, fontFamily: 'monospace' }}>PMH</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-heading)' }}>Past Medical History</span>
        </div>
        {!readOnly && (
          <button onClick={onRemove} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
            <X size={12} />
          </button>
        )}
      </div>

      {data.entries.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--text-muted)', fontStyle: 'italic' }}>No previous diagnoses on record.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {data.entries.map(entry => {
            const sc = STATUS_CFG[entry.status];
            return (
              <div
                key={entry.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  background: 'var(--bg-surface)', border: '1px solid var(--border-light)',
                  borderRadius: 7, padding: '7px 10px',
                  opacity: entry.status === 'RESOLVED' ? 0.55 : 1,
                }}
              >
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ses-blue-deep)', fontFamily: 'monospace', flexShrink: 0 }}>{entry.icd11Code}</span>
                <span style={{ flex: 1, fontSize: 13, color: 'var(--text-body)' }}>{entry.icd11Description}</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>
                  {new Date(entry.dateFirstConfirmed).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}
                </span>
                <span style={{ fontSize: 11, fontWeight: 600, background: sc.bg, color: sc.color, padding: '2px 7px', borderRadius: 4, flexShrink: 0 }}>
                  {sc.label}
                </span>
                {!readOnly && entry.status !== 'RESOLVED' && (
                  <button
                    onClick={() => resolve(entry.id)}
                    title="Mark as resolved"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--clinical-normal)', flexShrink: 0, padding: 2 }}
                  >
                    <CheckCircle size={14} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
