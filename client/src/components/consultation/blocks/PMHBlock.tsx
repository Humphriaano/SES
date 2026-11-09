import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle, X, Plus, Search, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../../api/client';
import { PMHBlockData, PMHEntry, DiagnosisStatus } from '../../../types/consultation';

const STATUS_CFG: Record<DiagnosisStatus, { bg: string; color: string; label: string }> = {
  SUSPECTED: { bg: 'var(--badge-amber-bg)',    color: 'var(--badge-amber-text)',    label: 'Suspected' },
  CONFIRMED: { bg: 'var(--badge-blue-bg)',     color: 'var(--badge-blue-text)',     label: 'Confirmed' },
  CHRONIC:   { bg: 'var(--badge-charcoal-bg)', color: 'var(--badge-charcoal-text)', label: 'Chronic'   },
  RESOLVED:  { bg: 'var(--badge-green-bg)',    color: 'var(--badge-green-text)',    label: 'Resolved'  },
};

interface IcdResult { id: string; code: string; description: string; category?: string | null }

interface Props {
  data: PMHBlockData;
  onChange: (data: PMHBlockData) => void;
  onRemove: () => void;
  onResolve?: (diagnosisId: string) => void;
  readOnly?: boolean;
  patientId?: string;
}

const thisYear = new Date().getFullYear();

export default function PMHBlock({ data, onChange, onRemove, onResolve, readOnly, patientId }: Props) {
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<IcdResult[]>([]);
  const [searched, setSearched] = useState('');         // the query the results belong to
  const [searchFailed, setSearchFailed] = useState(false);
  const [active, setActive] = useState(0);
  const [picked, setPicked] = useState<IcdResult | null>(null);
  const [year, setYear] = useState('');
  const [resolved, setResolved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const reqRef = useRef(0);
  const term = q.trim();

  function resolve(id: string) {
    onChange({ entries: data.entries.map(e => e.id === id ? { ...e, status: 'RESOLVED' as DiagnosisStatus } : e) });
    onResolve?.(id);
  }

  // Search the ICD-11 list as you type (same list the Diagnosis block uses).
  useEffect(() => {
    if (!adding || picked) return;
    if (term.length < 2) { reqRef.current++; setResults([]); setSearched(''); setSearchFailed(false); return; }
    const id = ++reqRef.current;
    const t = setTimeout(async () => {
      try {
        const { data: rows } = await api.get('/icd11/search', { params: { q: term } });
        if (id !== reqRef.current) return;
        setResults(rows); setSearched(term); setSearchFailed(false); setActive(0);
      } catch {
        if (id === reqRef.current) { setResults([]); setSearched(term); setSearchFailed(true); }
      }
    }, 250);
    return () => clearTimeout(t);
  }, [term, adding, picked]);

  const listed = useMemo(() => new Set(data.entries.map(e => e.icd11Code)), [data.entries]);

  function reset() {
    setAdding(false); setQ(''); setResults([]); setSearched(''); setPicked(null);
    setYear(''); setResolved(false); setError(''); setSearchFailed(false);
  }

  function choose(r: IcdResult) {
    setPicked(r); setError('');
  }

  function onSearchKey(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { reset(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(i + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter' && results[active]) { e.preventDefault(); choose(results[active]); }
  }

  async function save() {
    if (!picked || !patientId || saving) return;
    const y = year.trim();
    if (y && (!/^\d{4}$/.test(y) || Number(y) < 1900 || Number(y) > thisYear)) {
      setError(`Enter a year between 1900 and ${thisYear}, or leave it blank.`);
      return;
    }
    setSaving(true); setError('');
    try {
      const { data: saved } = await api.post(`/patients/${patientId}/diagnoses`, {
        icd11Id: picked.id, diagnosedYear: y ? Number(y) : undefined, resolved,
      });
      const entry: PMHEntry = {
        id: saved.id,
        icd11Code: saved.icd11.code,
        icd11Description: saved.icd11.description,
        dateFirstConfirmed: saved.diagnosedAt ?? saved.createdAt,
        diagnosedYear: saved.diagnosedAt ? new Date(saved.diagnosedAt).getUTCFullYear() : undefined,
        status: saved.resolvedAt ? 'RESOLVED' : 'CONFIRMED',
      };
      const others = data.entries.filter(e => e.id !== entry.id);
      onChange({ entries: [entry, ...others] });
      toast.success(saved.alreadyExisted ? `${entry.icd11Description} was already on record — updated` : `${entry.icd11Description} added to past medical history`);
      reset();
    } catch (err: any) {
      if (err?.response) setError(err.response.data?.error ?? 'Could not save this condition. Try again.');
    } finally {
      setSaving(false);
    }
  }

  const canAdd = !readOnly && !!patientId;

  return (
    <div className="note-block" style={{
      border: '1px solid var(--border)',
      background: 'var(--bg-surface)',
      borderRadius: 18,
      padding: '10px 14px',
      margin: '16px 0',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 10, color: 'var(--text-muted)', background: 'var(--ws-chip)', padding: '0 6px', minWidth: 28, height: 20, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 5, fontWeight: 500, letterSpacing: '0.3px', boxSizing: 'border-box' }}>PMH</span>
          <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-heading)' }}>Past Medical History</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {canAdd && !adding && (
            <button onClick={() => { setAdding(true); setTimeout(() => inputRef.current?.focus(), 0); }}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 26, padding: '0 10px', borderRadius: 999, border: '1px solid var(--border-input)', background: 'var(--bg-surface)', color: 'var(--text-heading)', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>
              <Plus size={12} /> Add condition
            </button>
          )}
          {!readOnly && (
            <button onClick={onRemove} title="Remove this block" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {adding && (
        <div style={{ marginBottom: 10, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--bg-surface)', overflow: 'hidden' }}>
          {!picked ? (
            <>
              <div style={{ position: 'relative', padding: 8, borderBottom: '1px solid var(--border-light)' }}>
                <Search size={14} style={{ position: 'absolute', left: 20, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-subtle)', pointerEvents: 'none' }} />
                <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)} onKeyDown={onSearchKey} autoFocus
                  placeholder="Search a condition, e.g. hypertension, diabetes, asthma…"
                  aria-label="Search conditions" role="combobox" aria-expanded={results.length > 0} autoComplete="off"
                  style={{ width: '100%', boxSizing: 'border-box', padding: '9px 34px 9px 32px', border: '1px solid var(--border-input)', borderRadius: 8, fontSize: 13.5, outline: 'none', background: 'var(--bg-card)', color: 'var(--text-heading)' }} />
                <button onClick={reset} aria-label="Cancel" title="Cancel"
                  style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}>
                  <X size={14} />
                </button>
              </div>
              <div style={{ maxHeight: 260, overflowY: 'auto' }}>
                {term.length < 2 ? (
                  <p style={{ margin: 0, padding: '12px 14px', fontSize: 12.5, color: 'var(--text-muted)' }}>Type at least 2 letters. You can also search by ICD-11 code.</p>
                ) : searchFailed && searched === term ? (
                  <p style={{ margin: 0, padding: '12px 14px', fontSize: 12.5, color: 'var(--badge-red-text)' }}>Couldn’t search right now. Check your connection and try again.</p>
                ) : searched !== term ? (
                  <p style={{ margin: 0, padding: '12px 14px', fontSize: 12.5, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}><Loader2 size={13} style={{ animation: 'pmh-spin 1s linear infinite' }} /> Searching…</p>
                ) : results.length === 0 ? (
                  <p style={{ margin: 0, padding: '12px 14px', fontSize: 12.5, color: 'var(--text-muted)' }}>No condition matches “{term}”. Try a different word, or the ICD-11 code.</p>
                ) : results.map((r, i) => {
                  const already = listed.has(r.code);
                  return (
                    <button key={r.id} onClick={() => choose(r)} onMouseEnter={() => setActive(i)}
                      style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', border: 'none', borderBottom: '1px solid var(--border-light)', background: i === active ? 'var(--bg-surface-2)' : 'transparent', cursor: 'pointer', textAlign: 'left', color: 'var(--text-heading)' }}>
                      <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--ses-blue-deep)', fontFamily: 'monospace', flexShrink: 0, minWidth: 54 }}>{r.code}</span>
                      <span style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>{r.description}</span>
                      {already
                        ? <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-subtle)', flexShrink: 0 }}>on record</span>
                        : r.category && <span style={{ fontSize: 11, color: 'var(--text-subtle)', flexShrink: 0 }}>{r.category}</span>}
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            <div style={{ padding: 12 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
                <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--ses-blue-deep)', fontFamily: 'monospace' }}>{picked.code}</span>
                <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-heading)', flex: 1 }}>{picked.description}</span>
                <button onClick={() => { setPicked(null); setError(''); }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 500, color: 'var(--ws-link)' }}>Change</button>
              </div>
              <div style={{ display: 'flex', gap: 14, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, fontWeight: 500, color: 'var(--text-muted)' }}>
                  Year diagnosed <span style={{ fontWeight: 400, color: 'var(--text-subtle)' }}>(optional)</span>
                  <input value={year} onChange={e => { setYear(e.target.value.replace(/\D/g, '').slice(0, 4)); setError(''); }}
                    inputMode="numeric" placeholder={String(thisYear)} aria-label="Year diagnosed"
                    style={{ width: 96, height: 36, padding: '0 10px', border: '1px solid var(--border-input)', borderRadius: 8, fontSize: 14, outline: 'none', background: 'var(--bg-card)', color: 'var(--text-heading)' }} />
                </label>
                <div role="radiogroup" aria-label="Current status" style={{ display: 'inline-flex', padding: 3, gap: 2, border: '1px solid var(--border)', borderRadius: 9, background: 'var(--bg-card)' }}>
                  {[{ v: false, l: 'Still active' }, { v: true, l: 'Resolved' }].map(o => (
                    <button key={o.l} role="radio" aria-checked={resolved === o.v} onClick={() => setResolved(o.v)}
                      style={{ height: 28, padding: '0 12px', border: 'none', borderRadius: 999, fontSize: 12.5, fontWeight: 500, cursor: 'pointer', background: resolved === o.v ? 'var(--ses-blue-deep)' : 'transparent', color: resolved === o.v ? '#fff' : 'var(--text-muted)' }}>
                      {o.l}
                    </button>
                  ))}
                </div>
                <div style={{ flex: 1 }} />
                <button onClick={reset} disabled={saving}
                  style={{ height: 36, padding: '0 14px', borderRadius: 999, border: '1px solid var(--border-input)', background: 'var(--bg-card)', color: 'var(--text-heading)', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>Cancel</button>
                <button onClick={save} disabled={saving}
                  style={{ height: 36, padding: '0 16px', borderRadius: 999, border: 'none', background: 'var(--btn-accent)', color: '#fff', fontSize: 13, fontWeight: 500, cursor: saving ? 'wait' : 'pointer', opacity: saving ? 0.7 : 1 }}>
                  {saving ? 'Saving…' : 'Add to history'}
                </button>
              </div>
              {error && <p role="alert" style={{ margin: '8px 0 0', fontSize: 12.5, fontWeight: 500, color: 'var(--badge-red-text)' }}>{error}</p>}
            </div>
          )}
        </div>
      )}

      {data.entries.length === 0 ? (
        !adding && <p style={{ fontSize: 13, color: 'var(--text-muted)', fontStyle: 'italic' }}>
          No previous diagnoses on record.{canAdd && ' Use “Add condition” to record one.'}
        </p>
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
                <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--ses-blue-deep)', fontFamily: 'monospace', flexShrink: 0 }}>{entry.icd11Code}</span>
                <span style={{ flex: 1, fontSize: 13, color: 'var(--text-body)' }}>{entry.icd11Description}</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>
                  {entry.diagnosedYear ?? new Date(entry.dateFirstConfirmed).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}
                </span>
                <span style={{ fontSize: 11, fontWeight: 500, background: sc.bg, color: sc.color, padding: '2px 7px', borderRadius: 4, flexShrink: 0 }}>
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
      <style>{`@keyframes pmh-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
