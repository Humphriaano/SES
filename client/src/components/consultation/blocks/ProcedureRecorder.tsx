import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../../api/client';
import { apiError } from '../../../lib/money';
import { priceText, usePrices } from '../../../lib/prices';
import { flushPriceEdits } from '../../../lib/priceEditing';
import InlinePrice from '../../billing/InlinePrice';
import catalogueJson from '../../../data/proceduresCatalogue.json';
import { mergeProcedures, ProcedureOption, QUICK_PICKS, searchProcedures } from '../../../lib/procedureSearch';
import type { HistoryBlockData, ProcedureItem } from '../../../types/consultation';

const BUILTIN = (catalogueJson as { procedures: ProcedureOption[] }).procedures;
const OTHER = 'other';
const input = { boxSizing: 'border-box' as const, minHeight: 34, padding: '6px 10px', border: '1px solid var(--border-input)', borderRadius: 12, background: 'var(--bg-card)', color: 'var(--text-heading)', font: 'inherit', fontSize: 13 };

interface Props { data: HistoryBlockData; onChange: (data: HistoryBlockData) => void; patientId?: string; encounterId?: string }

// Search the procedure list, say where it was done, and record it. Recording adds the procedure to the note and
// creates its charge in one step; the price comes from the price list, so a missing one can be set right here.
export default function ProcedureRecorder({ data, onChange, patientId, encounterId }: Props) {
  const items = data.procedures ?? [];
  // The latest note, for answers that arrive after the doctor has kept typing: they add to it, never replace it.
  const dataRef = useRef(data);
  useEffect(() => { dataRef.current = data; });
  const [custom, setCustom] = useState<ProcedureOption[]>([]);
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<{ code: string; name: string; entryId: string } | null>(null);
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

  const entryId = () => `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  function choose(code: string, name: string) { setChosen({ code, name, entryId: entryId() }); setQuery(''); setSite(''); setNote(''); setError(''); }
  function cancel() { setChosen(null); setSite(''); setNote(''); setError(''); }

  async function record() {
    if (!chosen || busy) return;
    if (!encounterId || !patientId) { setError('Start an encounter before recording a procedure.'); return; }
    setBusy(true); setError('');
    try {
      if (chosen.code !== OTHER && !(await flushPriceEdits([chosen.code]))) { setError('The price has not saved yet. Check the price field and try again.'); return; }
      // The same entry id is reused on a retry, so a slow network can never record or charge it twice.
      const { data: saved } = await api.post(`/encounters/${encounterId}/procedures`, {
        clientId: chosen.entryId, name: chosen.name, site: site.trim() || undefined, note: note.trim() || undefined, ...(chosen.code !== OTHER ? { catalogueRef: chosen.code } : {}),
      });
      const item: ProcedureItem = { id: chosen.entryId, recordId: saved.id, name: saved.name, catalogueRef: saved.catalogueRef ?? undefined, site: saved.site ?? undefined, note: saved.note ?? undefined, performedAt: saved.performedAt };
      const current = dataRef.current.procedures ?? [];
      if (!current.some(i => i.id === item.id)) onChange({ ...dataRef.current, procedures: [...current, item] });
      toast.success(saved.charged ? `${saved.name} recorded and charged` : `${saved.name} recorded`);
      cancel();
    } catch (e) {
      setError(apiError(e, 'Could not record the procedure. Check your connection and try again; nothing is charged twice.'));
    } finally { setBusy(false); }
  }

  async function remove(item: ProcedureItem) {
    setRemoving(item.id);
    try {
      if (item.recordId && encounterId) await api.delete(`/encounters/${encounterId}/procedures/${item.recordId}`, { data: { reason: 'Removed from the note' } });
      onChange({ ...dataRef.current, procedures: (dataRef.current.procedures ?? []).filter(i => i.id !== item.id) });
    } catch (e) { toast.error(apiError(e, 'Could not remove the procedure.')); } finally { setRemoving(''); }
  }

  return (
    <div style={{ marginBottom: 10 }}>
      {items.map(item => (
        <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', border: '1px solid var(--border)', borderRadius: 10, padding: '6px 10px', marginBottom: 5, background: 'var(--bg-surface)' }}>
          <div style={{ flex: 1, minWidth: 160 }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-heading)' }}>{item.name}</div>
            {(item.site || item.note) && <div style={{ fontSize: 12, color: 'var(--text-muted)', overflowWrap: 'anywhere' }}>{[item.site, item.note].filter(Boolean).join(' · ')}</div>}
          </div>
          <span style={{ fontSize: 12, color: 'var(--text-body2)' }}>
            {item.catalogueRef ? <InlinePrice catalogueRef={item.catalogueRef} itemType="PROCEDURE" name={item.name} value={prices[item.catalogueRef]} patientId={patientId} unpricedLabel="Add price" /> : 'Not charged'}
          </span>
          <button type="button" onClick={() => void remove(item)} disabled={removing === item.id} aria-label={`Remove ${item.name}`} title="Remove this procedure"
            style={{ display: 'flex', background: 'none', border: 'none', padding: 4, cursor: removing === item.id ? 'wait' : 'pointer', color: 'var(--text-muted)' }}><X size={13} /></button>
        </div>
      ))}

      {chosen ? (
        <div style={{ border: '1px solid var(--border-input)', borderRadius: 12, padding: '10px 12px', background: 'var(--bg-card)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <b style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--text-heading)', flex: 1 }}>{chosen.name}</b>
            <span style={{ fontSize: 12, color: 'var(--text-body2)' }}>
              {chosen.code === OTHER ? 'Not charged' : <InlinePrice catalogueRef={chosen.code} itemType="PROCEDURE" name={chosen.name} value={prices[chosen.code]} patientId={patientId} unpricedLabel="Add price" />}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input aria-label="Site or side (optional)" placeholder="Site or side, e.g. left forearm" value={site} maxLength={120} onChange={e => setSite(e.target.value)} style={{ ...input, flex: '1 1 200px' }} />
            <input aria-label="Notes (optional)" placeholder="Notes, e.g. first attempt" value={note} maxLength={300} onChange={e => setNote(e.target.value)} style={{ ...input, flex: '2 1 240px' }}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void record(); } }} />
          </div>
          {error && <div role="alert" style={{ fontSize: 12, color: 'var(--badge-red-text)' }}>{error}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={() => void record()} disabled={busy} style={{ background: busy ? 'var(--text-subtle)' : 'var(--ses-red)', color: '#fff', border: 'none', borderRadius: 999, padding: '7px 16px', fontSize: 13, fontWeight: 500, cursor: busy ? 'not-allowed' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Plus size={13} />{busy ? 'Recording…' : 'Record procedure'}
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
