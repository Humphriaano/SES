import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../../api/client';
import { useVisiblePolling } from '../../../hooks/useVisiblePolling';
import { apiError } from '../../../lib/money';
import { priceText, usePrices } from '../../../lib/prices';
import { flushPriceEdits } from '../../../lib/priceEditing';
import InlinePrice from '../../billing/InlinePrice';
import catalogueJson from '../../../data/proceduresCatalogue.json';
import { mergeProcedures, ProcedureOption, QUICK_PICKS, searchProcedures } from '../../../lib/procedureSearch';
import type { HistoryBlockData, ProcedureItem } from '../../../types/consultation';

const BUILTIN = (catalogueJson as { procedures: ProcedureOption[] }).procedures;
const OTHER = 'other';
type Mode = 'DONE' | 'ORDER';
const MODE_KEY = 'ses.procedure.mode';
const readMode = (): Mode => { try { return localStorage.getItem(MODE_KEY) === 'ORDER' ? 'ORDER' : 'DONE'; } catch { return 'DONE'; } };
const input = { boxSizing: 'border-box' as const, minHeight: 34, padding: '6px 10px', border: '1px solid var(--border-input)', borderRadius: 12, background: 'var(--bg-card)', color: 'var(--text-heading)', font: 'inherit', fontSize: 13 };
const badge = (tone: 'amber' | 'red' | 'green') => ({ fontSize: 11, fontWeight: 500, background: `var(--badge-${tone}-bg)`, color: `var(--badge-${tone}-text)`, border: `1px solid var(--badge-${tone}-text)`, borderRadius: 5, padding: '1px 7px', whiteSpace: 'nowrap' as const });

interface Props { data: HistoryBlockData; onChange: (data: HistoryBlockData) => void; patientId?: string; encounterId?: string }
interface Row { id: string; status: ProcedureItem['status']; site: string | null; note: string | null; performedAt: string | null; performedBy: string | null; returnReason: string | null }

// Search the procedure list, then either record it as done (charged at once) or send it to the treatment room for a nurse
// (charged when the nurse records it done). Recorded procedures show where they are, and the note keeps in step with the
// treatment room while any are still waiting.
export default function ProcedureRecorder({ data, onChange, patientId, encounterId }: Props) {
  const items = data.procedures ?? [];
  // The latest note, for answers that arrive after the doctor has kept typing: they add to it, never replace it.
  const dataRef = useRef(data), onChangeRef = useRef(onChange);
  useEffect(() => { dataRef.current = data; onChangeRef.current = onChange; });
  const [custom, setCustom] = useState<ProcedureOption[]>([]);
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<{ code: string; name: string; entryId: string } | null>(null);
  const [mode, setMode] = useState<Mode>(readMode);
  const [urgent, setUrgent] = useState(false);
  const [site, setSite] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState('');
  const [error, setError] = useState('');

  // Procedures an admin added to the price list by hand. Quiet if it cannot be loaded: the built-in list still works.
  useEffect(() => {
    let live = true;
    api.get('/price-list', { params: { type: 'PROCEDURE', active: 'yes', take: 200 } })
      .then(r => { if (live) setCustom((r.data.items ?? []).map((i: { catalogueRef: string; name: string; detail: string | null }) => ({ code: i.catalogueRef, name: i.name, category: i.detail ?? 'Other' }))); })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  const options = useMemo(() => mergeProcedures(BUILTIN, custom), [custom]);
  const results = useMemo(() => searchProcedures(options, query), [options, query]);
  const quick = useMemo(() => QUICK_PICKS.map(code => options.find(o => o.code === code)).filter((o): o is ProcedureOption => !!o), [options]);
  const prices = usePrices([...results.map(o => o.code), ...(chosen && chosen.code !== OTHER ? [chosen.code] : []), ...items.map(i => i.catalogueRef ?? '')]);

  // While anything is waiting in the treatment room, ask what has happened to it and bring the note up to date.
  const sync = useCallback(async () => {
    if (!encounterId) return;
    try {
      const { data: rows } = await api.get<Row[]>(`/encounters/${encounterId}/procedures`);
      const current = dataRef.current.procedures ?? [];
      const stamp = (x: { status?: ProcedureItem['status']; site?: string | null; note?: string | null; performedBy?: string | null; returnReason?: string | null }) => [x.status ?? 'ACTIVE', x.site ?? '', x.note ?? '', x.performedBy ?? '', x.returnReason ?? ''].join('|');
      let changed = false;
      const next = current.map(item => {
        const row = item.recordId ? rows.find(r => r.id === item.recordId) : undefined;
        if (!row) return item;
        const merged: ProcedureItem = { ...item, status: row.status, site: row.site ?? undefined, note: row.note ?? undefined, performedAt: row.performedAt ?? item.performedAt, performedBy: row.performedBy ?? undefined, returnReason: row.returnReason ?? undefined };
        if (stamp(merged) === stamp(item)) return item;
        changed = true; return merged;
      });
      if (changed) onChangeRef.current({ ...dataRef.current, procedures: next });
    } catch { /* keep what is shown; the API client already reports connectivity problems */ }
  }, [encounterId]);
  useVisiblePolling(sync, 30000, items.some(i => i.status === 'ORDERED'));

  const entryId = () => `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  function choose(code: string, name: string) { setChosen({ code, name, entryId: entryId() }); setQuery(''); setSite(''); setNote(''); setUrgent(false); setError(''); }
  function cancel() { setChosen(null); setSite(''); setNote(''); setUrgent(false); setError(''); }
  function pickMode(next: Mode) { setMode(next); try { localStorage.setItem(MODE_KEY, next); } catch { /* the choice just is not remembered */ } }

  async function record() {
    if (!chosen || busy) return;
    if (!encounterId || !patientId) { setError('Start an encounter before recording a procedure.'); return; }
    setBusy(true); setError('');
    try {
      if (chosen.code !== OTHER && !(await flushPriceEdits([chosen.code]))) { setError('The price has not saved yet. Check the price field and try again.'); return; }
      const ordering = mode === 'ORDER';
      // The same entry id is reused on a retry, so a slow network can never record or charge it twice.
      const { data: saved } = await api.post(`/encounters/${encounterId}/procedures`, {
        clientId: chosen.entryId, name: chosen.name, site: site.trim() || undefined, ...(chosen.code !== OTHER ? { catalogueRef: chosen.code } : {}),
        ...(ordering ? { mode: 'ORDER', instructions: note.trim() || undefined, priority: urgent ? 'URGENT' : 'ROUTINE' } : { note: note.trim() || undefined }),
      });
      const item: ProcedureItem = {
        id: chosen.entryId, recordId: saved.id, name: saved.name, catalogueRef: saved.catalogueRef ?? undefined, site: saved.site ?? undefined, note: saved.note ?? undefined,
        performedAt: saved.performedAt ?? undefined, status: saved.status, ...(ordering ? { ordered: true, priority: saved.priority, instructions: saved.instructions ?? undefined } : {}),
      };
      const current = dataRef.current.procedures ?? [];
      if (!current.some(i => i.id === item.id)) onChange({ ...dataRef.current, procedures: [...current, item] });
      toast.success(ordering ? `${saved.name} sent to the treatment room` : saved.charged ? `${saved.name} recorded and charged` : `${saved.name} recorded`);
      cancel();
    } catch (e) {
      setError(apiError(e, 'Could not save the procedure. Check your connection and try again; nothing is charged twice.'));
    } finally { setBusy(false); }
  }

  async function remove(item: ProcedureItem) {
    setRemoving(item.id);
    try {
      if (item.recordId && encounterId) await api.delete(`/encounters/${encounterId}/procedures/${item.recordId}`, { data: { reason: item.status === 'ORDERED' ? 'Withdrawn by the doctor' : 'Removed from the note' } });
      onChange({ ...dataRef.current, procedures: (dataRef.current.procedures ?? []).filter(i => i.id !== item.id) });
    } catch (e) { toast.error(apiError(e, 'Could not remove the procedure.')); void sync(); } finally { setRemoving(''); }
  }

  const ordering = mode === 'ORDER';
  return (
    <div style={{ marginBottom: 10 }}>
      {items.map(item => {
        const status = item.status ?? 'ACTIVE';
        const label = status === 'ORDERED' ? `Withdraw ${item.name}` : status === 'RETURNED' ? `Dismiss ${item.name}` : `Remove ${item.name}`;
        return (
          <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', border: '1px solid var(--border)', borderRadius: 10, padding: '6px 10px', marginBottom: 5, background: 'var(--bg-surface)' }}>
            <div style={{ flex: 1, minWidth: 160 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-heading)' }}>{item.name}</div>
              {(item.site || item.note || item.instructions) && <div style={{ fontSize: 12, color: 'var(--text-muted)', overflowWrap: 'anywhere' }}>{[item.site, item.note, status === 'ORDERED' ? item.instructions : null].filter(Boolean).join(' · ')}</div>}
              {status === 'ACTIVE' && item.ordered && item.performedBy && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Done by {item.performedBy}{item.performedAt ? ` · ${new Date(item.performedAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lusaka' })}` : ''}</div>}
              {status === 'RETURNED' && <div role="status" style={{ fontSize: 12, color: 'var(--badge-red-text)' }}>Sent back by the nurse{item.returnReason ? `: ${item.returnReason}` : ''}</div>}
            </div>
            {status === 'ORDERED' && <>{item.priority === 'URGENT' && <span style={badge('red')}>Urgent</span>}<span style={badge('amber')}>Waiting in treatment room</span></>}
            {status === 'ACTIVE' && item.ordered && <span style={badge('green')}>Done</span>}
            <span style={{ fontSize: 12, color: 'var(--text-body2)' }}>
              {item.catalogueRef ? <InlinePrice catalogueRef={item.catalogueRef} itemType="PROCEDURE" name={item.name} value={prices[item.catalogueRef]} patientId={patientId} unpricedLabel="Add price" /> : 'Not charged'}
              {status === 'ORDERED' && item.catalogueRef ? ' · charged when done' : ''}
            </span>
            <button type="button" onClick={() => void remove(item)} disabled={removing === item.id} aria-label={label} title={label.split(' ')[0] + ' this procedure'}
              style={{ display: 'flex', background: 'none', border: 'none', padding: 4, cursor: removing === item.id ? 'wait' : 'pointer', color: 'var(--text-muted)' }}><X size={13} /></button>
          </div>
        );
      })}

      {chosen ? (
        <div style={{ border: '1px solid var(--border-input)', borderRadius: 12, padding: '10px 12px', background: 'var(--bg-card)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <b style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--text-heading)', flex: 1 }}>{chosen.name}</b>
            <span style={{ fontSize: 12, color: 'var(--text-body2)' }}>
              {chosen.code === OTHER ? 'Not charged' : <InlinePrice catalogueRef={chosen.code} itemType="PROCEDURE" name={chosen.name} value={prices[chosen.code]} patientId={patientId} unpricedLabel="Add price" />}
            </span>
          </div>
          <div role="radiogroup" aria-label="Who is doing it" style={{ display: 'inline-flex', alignSelf: 'flex-start', border: '1px solid var(--border-input)', borderRadius: 999, padding: 2, background: 'var(--bg-surface)' }}>
            {([['DONE', 'I did it'], ['ORDER', 'Send to treatment room']] as const).map(([value, text]) => (
              <button key={value} type="button" role="radio" aria-checked={mode === value} onClick={() => pickMode(value)}
                style={{ border: 'none', borderRadius: 999, padding: '5px 13px', fontSize: 12.5, cursor: 'pointer', background: mode === value ? 'var(--bg-card)' : 'transparent', boxShadow: mode === value ? 'var(--premium-selected-shadow)' : 'none', color: mode === value ? 'var(--selection-text)' : 'var(--text-muted)', fontWeight: 500 }}>{text}</button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input aria-label="Site or side (optional)" placeholder="Site or side, e.g. left forearm" value={site} maxLength={120} onChange={e => setSite(e.target.value)} style={{ ...input, flex: '1 1 200px' }} />
            <input aria-label={ordering ? 'Instructions for the nurse (optional)' : 'Notes (optional)'} placeholder={ordering ? 'Instructions for the nurse, e.g. use a small cannula' : 'Notes, e.g. first attempt'} value={note} maxLength={300} onChange={e => setNote(e.target.value)} style={{ ...input, flex: '2 1 240px' }}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void record(); } }} />
          </div>
          {ordering && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', fontSize: 12.5, color: 'var(--text-body2)' }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}><input type="checkbox" checked={urgent} onChange={e => setUrgent(e.target.checked)} style={{ accentColor: 'var(--selection-accent)' }} />Urgent: the nurse sees it first</label>
              {chosen.code !== OTHER && <span>The patient is charged when the nurse records it done.</span>}
            </div>
          )}
          {error && <div role="alert" style={{ fontSize: 12, color: 'var(--badge-red-text)' }}>{error}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={() => void record()} disabled={busy} style={{ background: busy ? 'var(--text-subtle)' : 'var(--ses-red)', color: '#fff', border: 'none', borderRadius: 999, padding: '7px 16px', fontSize: 13, fontWeight: 500, cursor: busy ? 'not-allowed' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Plus size={13} />{busy ? (ordering ? 'Sending…' : 'Recording…') : ordering ? 'Send to treatment room' : 'Record procedure'}
            </button>
            <button type="button" onClick={cancel} disabled={busy} style={{ background: 'none', border: '1px solid var(--border-input)', borderRadius: 999, padding: '7px 14px', fontSize: 13, color: 'var(--text-body2)', cursor: 'pointer' }}>Cancel</button>
          </div>
        </div>
      ) : (
        <div style={{ position: 'relative' }}>
          <input aria-label="Search procedures" placeholder="Search procedures, e.g. cannulation, suturing, catheter…" value={query} onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && results[0]) { e.preventDefault(); choose(results[0].code, results[0].name); } else if (e.key === 'Escape') setQuery(''); }}
            style={{ ...input, width: '100%', borderRadius: 14 }} />
          {query.trim().length >= 2 && (
            <div role="listbox" aria-label="Matching procedures" style={{ position: 'absolute', zIndex: 30, left: 0, right: 0, marginTop: 4, background: 'var(--bg-card)', border: '1px solid var(--border-input)', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', maxHeight: 260, overflowY: 'auto' }}>
              {results.map(o => (
                <button key={o.code} type="button" role="option" aria-selected={false} onMouseDown={e => { e.preventDefault(); choose(o.code, o.name); }}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', padding: '8px 12px', background: 'none', border: 'none', borderBottom: '1px solid var(--border-light)', cursor: 'pointer', fontSize: 13 }}>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', color: 'var(--text-heading)' }}>{o.name}</span>
                    <span style={{ display: 'block', fontSize: 11, color: 'var(--text-body2)' }}>{o.category}</span>
                  </span>
                  {prices[o.code] !== undefined && <span style={{ fontSize: 11.5, fontWeight: 500, whiteSpace: 'nowrap', color: prices[o.code] === null ? 'var(--text-subtle)' : 'var(--text-heading)' }}>{priceText(prices[o.code])}</span>}
                </button>
              ))}
              <button type="button" onMouseDown={e => { e.preventDefault(); choose(OTHER, query.trim().replace(/\s+/g, ' ').slice(0, 120)); }}
                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 12.5, color: 'var(--text-body2)' }}>
                {results.length ? 'Not on the list? ' : 'No match. '}Record “{query.trim()}” as another procedure (no charge)
              </button>
            </div>
          )}
          {query.trim().length < 2 && quick.length > 0 && (
            <div role="group" aria-label="Common procedures" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
              {quick.map(o => (
                <button key={o.code} type="button" onClick={() => choose(o.code, o.name)}
                  style={{ border: '1px solid var(--border-input)', background: 'var(--bg-card)', color: 'var(--text-body2)', borderRadius: 999, padding: '4px 11px', fontSize: 12, cursor: 'pointer' }}>{o.name}</button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
