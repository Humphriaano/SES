import { useState, useEffect, useRef } from 'react';
import { Search, X } from 'lucide-react';
import api from '../../../api/client';
import { DiagnosisBlockData, DiagnosisStatus } from '../../../types/consultation';

const STATUS_CFG: Record<DiagnosisStatus, { bg: string; text: string; border: string; label: string }> = {
  SUSPECTED: { bg: 'var(--badge-amber-bg)', text: 'var(--badge-amber-text)', border: 'var(--badge-amber-text)', label: 'Suspected' },
  CONFIRMED: { bg: 'var(--badge-green-bg)', text: 'var(--badge-green-text)', border: 'var(--badge-green-text)', label: 'Confirmed' },
  CHRONIC:   { bg: 'var(--badge-blue-bg)',  text: 'var(--badge-blue-text)',  border: 'var(--badge-blue-text)',  label: 'Chronic'   },
  RESOLVED:  { bg: 'var(--badge-gray-bg)',  text: 'var(--badge-gray-text)',  border: 'var(--badge-gray-text)',  label: 'Resolved'  },
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
  readOnly?: boolean;
}

export default function DiagnosisBlock({ data, onChange, onRemove, onConfirmed, readOnly }: Props) {
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
      borderLeft: '3px solid var(--accent)',
      background: 'var(--bg-card)',
      padding: '10px 14px',
      margin: '4px 0',
      position: 'relative',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent)', background: 'var(--accent-soft)', padding: '2px 7px', fontFamily: 'monospace', flexShrink: 0 }}>Dx</span>
          {data.icd11Code ? (
            <>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)', fontFamily: 'monospace' }}>{data.icd11Code}</span>
              <span style={{ fontSize: 14, color: 'var(--text-heading)', fontWeight: 500 }}>{data.icd11Description}</span>
              {data.icd11Category && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{data.icd11Category}</span>}
              {data.isPrimary && (
                <span style={{ fontSize: 10, fontWeight: 700, background: 'var(--accent)', color: '#fff', padding: '2px 7px', borderRadius: 4 }}>PRIMARY</span>
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
                padding: '3px 9px', cursor: readOnly ? 'default' : 'pointer',
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
                  title="Change diagnosis"
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

      {searching && !readOnly && (
        <div style={{ marginTop: 10, position: 'relative' }}>
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
                border: '1.5px solid var(--accent-border)',
                fontSize: 13, outline: 'none', background: 'var(--bg-input)',
                color: 'var(--text-heading)', boxSizing: 'border-box',
              }}
            />
          </div>
          {results.length > 0 && (
            <div style={{
              position: 'absolute', zIndex: 100, background: 'var(--bg-card)',
              border: '1.5px solid var(--border-input)',
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
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--accent-soft)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                >
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)', background: 'var(--accent-soft)', padding: '2px 7px', fontFamily: 'monospace', flexShrink: 0 }}>{c.code}</span>
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
