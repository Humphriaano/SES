import { useState, useEffect, useRef } from 'react';
import { Search, X, Plus } from 'lucide-react';
import api from '../../../api/client';
import { DiagnosisBlockData, DiagnosisStatus } from '../../../types/consultation';

const STATUS_CFG: Record<DiagnosisStatus, { bg: string; text: string; border: string; label: string }> = {
  SUSPECTED: { bg: 'var(--badge-amber-bg)',    text: 'var(--badge-amber-text)',    border: 'var(--badge-amber-text)',    label: 'Suspected' },
  CONFIRMED: { bg: 'var(--badge-blue-bg)',     text: 'var(--badge-blue-text)',     border: 'var(--badge-blue-text)',     label: 'Confirmed' },
  CHRONIC:   { bg: 'var(--badge-charcoal-bg)', text: 'var(--badge-charcoal-text)', border: 'var(--badge-charcoal-text)', label: 'Chronic'   },
  RESOLVED:  { bg: 'var(--badge-green-bg)',    text: 'var(--badge-green-text)',    border: 'var(--badge-green-text)',    label: 'Resolved'  },
};

const NEXT: Record<DiagnosisStatus, DiagnosisStatus> = {
  SUSPECTED: 'CONFIRMED',
  CONFIRMED: 'CHRONIC',
  CHRONIC:   'RESOLVED',
  RESOLVED:  'SUSPECTED',
};

interface Props {
  data: DiagnosisBlockData;
  onChange: (data: DiagnosisBlockData) => void;
  onRemove: () => void;
  onConfirmed?: (icd11Id: string) => void;
  onAddAnother?: () => void;   // adds a new, empty diagnosis block below this one
  readOnly?: boolean;
}

// One block = one diagnosis. To record several conditions, add several blocks.
export default function DiagnosisBlock({ data, onChange, onRemove, onConfirmed, onAddAnother, readOnly }: Props) {
  const [searching, setSearching] = useState(!data.icd11Code);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (searching && inputRef.current) inputRef.current.focus();
  }, [searching]);

  useEffect(() => {
    if (query.length < 2) { setResults([]); return; }
    const t = setTimeout(() =>
      api.get('/icd11/search', { params: { q: query } })
        .then(r => setResults(r.data))
        .catch(() => {}),
      300
    );
    return () => clearTimeout(t);
  }, [query]);

  function selectCode(c: any) {
    onChange({
      ...data,
      icd11Id: c.id,
      icd11Code: c.code,
      icd11Description: c.description,
      icd11Category: c.category ?? '',
      status: 'SUSPECTED',
      dateFirstConfirmed: new Date().toISOString(),
    });
    setSearching(false);
    setQuery('');
    setResults([]);
  }

  function cycleStatus() {
    if (readOnly || !data.icd11Code) return;
    const next = NEXT[data.status];
    onChange({
      ...data,
      status: next,
      isChronic: next === 'CHRONIC',
      dateResolved: next === 'RESOLVED' ? new Date().toISOString() : data.dateResolved,
    });
    if ((next === 'CONFIRMED' || next === 'CHRONIC') && data.icd11Id) {
      onConfirmed?.(data.icd11Id);
    }
  }

  const sc = STATUS_CFG[data.status];

  return (
    <div style={{
      border: '1px solid var(--border)',
      background: 'var(--bg-card)',
      borderRadius: 12,
      padding: '10px 14px',
      margin: '16px 0',
      position: 'relative',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10, color: 'var(--text-muted)', background: 'var(--ws-chip)', padding: '0 6px', minWidth: 28, height: 20, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 5, fontWeight: 800, letterSpacing: '0.3px', boxSizing: 'border-box', flexShrink: 0 }}>Dx</span>
          {data.icd11Code ? (
            <>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ses-blue-deep)', fontFamily: 'monospace' }}>{data.icd11Code}</span>
              <span style={{ fontSize: 14, color: 'var(--text-heading)', fontWeight: 500 }}>{data.icd11Description}</span>
              {data.icd11Category && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{data.icd11Category}</span>}
              {data.isPrimary && (
                <span style={{ fontSize: 10, fontWeight: 700, background: 'var(--ses-blue-deep)', color: '#fff', padding: '2px 7px', borderRadius: 4 }}>PRIMARY</span>
              )}
            </>
          ) : (
            <span style={{ fontSize: 13, color: 'var(--text-muted)', fontStyle: 'italic' }}>Select an ICD-11 code…</span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          {data.icd11Code && (
            <button
              onClick={cycleStatus}
              title="Click to advance status"
              style={{
                fontSize: 11, fontWeight: 600,
                background: sc.bg, color: sc.text, border: `1px solid ${sc.border}`,
                borderRadius: 5, padding: '3px 9px', cursor: readOnly ? 'default' : 'pointer',
              }}
            >
              {sc.label}
            </button>
          )}
          {!readOnly && (
            <>
              {data.icd11Code && (
                <button
                  onClick={() => setSearching(v => !v)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 3 }}
                  title="Replace this diagnosis with a different one"
                  aria-label="Replace this diagnosis"
                >
                  <Search size={12} />
                </button>
              )}
              <button onClick={onRemove} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 3 }}>
                <X size={12} />
              </button>
            </>
          )}
        </div>
      </div>

      {data.icd11Code && !searching && !readOnly && onAddAnother && (
        <button
          onClick={onAddAnother}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 8, padding: '4px 10px',
            border: '1px dashed var(--border-input)', borderRadius: 7, background: 'transparent',
            color: 'var(--ses-blue-deep)', fontSize: 12, fontWeight: 600, cursor: 'pointer',
          }}
        >
          <Plus size={12} /> Add another diagnosis
        </button>
      )}

      {searching && !readOnly && (
        <div style={{ marginTop: 10, position: 'relative' }}>
          {data.icd11Code && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8, padding: '7px 10px',
              borderRadius: 7, background: 'var(--badge-amber-bg)', color: 'var(--badge-amber-text)', fontSize: 12.5,
            }}>
              <span style={{ flex: 1, minWidth: 180 }}>
                Choosing a condition here will <b>replace {data.icd11Description}</b>.
              </span>
              {onAddAnother && (
                <button
                  onClick={() => { setSearching(false); setQuery(''); setResults([]); onAddAnother(); }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 12.5, color: 'inherit', textDecoration: 'underline', padding: 0 }}
                >
                  Keep it and add another instead
                </button>
              )}
              <button
                onClick={() => { setSearching(false); setQuery(''); setResults([]); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 12.5, color: 'inherit', padding: 0 }}
              >
                Cancel
              </button>
            </div>
          )}
          <div style={{ position: 'relative' }}>
            <Search size={12} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
            <input
              ref={inputRef}
              type="text"
              placeholder="Type ICD-11 code or condition name…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Escape') {
                  setSearching(false);
                  if (!data.icd11Code) onRemove();
                }
              }}
              style={{
                width: '100%', padding: '7px 10px 7px 30px',
                border: '1.5px solid #BEDAEA', borderRadius: 7,
                fontSize: 13, outline: 'none', background: 'var(--bg-input)',
                color: 'var(--text-heading)', boxSizing: 'border-box',
              }}
            />
          </div>
          {results.length > 0 && (
            <div style={{
              position: 'absolute', zIndex: 100, background: 'var(--bg-card)',
              border: '1.5px solid var(--border-input)', borderRadius: 10,
              boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
              marginTop: 4, width: '100%', maxHeight: 220, overflowY: 'auto',
            }}>
              {results.map((c: any) => (
                <button
                  key={c.id}
                  onClick={() => selectCode(c)}
                  style={{
                    width: '100%', textAlign: 'left', padding: '9px 14px',
                    display: 'flex', alignItems: 'center', gap: 10,
                    background: 'none', border: 'none', borderBottom: '1px solid var(--border-light)', cursor: 'pointer',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--ses-blue-tint)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                >
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', background: 'var(--ws-chip)', padding: '0 6px', minWidth: 28, height: 20, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 5, fontWeight: 800, letterSpacing: '0.3px', boxSizing: 'border-box', flexShrink: 0 }}>{c.code}</span>
                  <span style={{ fontSize: 13, color: 'var(--text-body)' }}>{c.description}</span>
                  {c.category && <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto', flexShrink: 0 }}>{c.category}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
