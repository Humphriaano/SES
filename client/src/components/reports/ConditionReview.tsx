import { useState } from 'react';
import toast from 'react-hot-toast';
import { Check, Plus } from 'lucide-react';
import api from '../../api/client';
import { apiError } from '../../lib/money';
import { useReport } from '../../hooks/useReport';

interface Condition { id: string; key: string; label: string; prefixes: string[]; exclude: string[]; active: boolean; reviewedAt: string | null; reviewedBy: string | null }
const NONE: Record<string, string> = {};   // a stable "no parameters" so the list is fetched once, not on every render
const codes = (text: string) => text.split(/[\s,;]+/).map(s => s.trim()).filter(Boolean);
const when = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

// The list of chronic conditions the reports count. A clinical lead can see it and check it; an admin can change it. Changing a condition
// clears its review, and every change is kept in a history on the server.
export default function ConditionReview({ canEdit, onChanged, onClose }: { canEdit: boolean; onChanged: () => void; onClose: () => void }) {
  const [reload, setReload] = useState(0);
  const { data, error, loading } = useReport<{ conditions: Condition[] }>('/chronic-conditions', NONE, reload);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ label: '', prefixes: '', exclude: '' });
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');

  async function run(action: () => Promise<unknown>, done: string) {
    if (busy) return; setBusy(true); setProblem('');
    try { await action(); toast.success(done); setEditing(null); setAdding(false); setReload(n => n + 1); onChanged(); }
    catch (e) { setProblem(apiError(e, 'Could not save. Check your connection and try again.')); } finally { setBusy(false); }
  }
  const begin = (c: Condition) => { setEditing(c.id); setAdding(false); setProblem(''); setDraft({ label: c.label, prefixes: c.prefixes.join(', '), exclude: c.exclude.join(', ') }); };
  const conditions = data?.conditions ?? [], reviewed = conditions.filter(c => c.active && c.reviewedAt).length, inUse = conditions.filter(c => c.active).length;

  return (
    <section className="rp-card" aria-label="Condition list">
      <div className="rp-card-head">
        <div><h2>Chronic condition list</h2>
          <p className="rp-sub">{inUse ? `${reviewed} of ${inUse} conditions in use have been reviewed. ` : ''}A diagnosis counts when its ICD-11 code starts with one of a condition's codes{canEdit ? '. Changing a condition clears its review; every change is recorded.' : '. Only an admin can change the list.'}</p></div>
        <div className="rp-noprint" style={{ display: 'flex', gap: 8 }}>
          {canEdit && <button type="button" className="bl-btn sm" onClick={() => { setAdding(a => !a); setEditing(null); setProblem(''); setDraft({ label: '', prefixes: '', exclude: '' }); }}><Plus size={14} /> Add a condition</button>}
          <button type="button" className="bl-btn sm" onClick={onClose}>Close</button>
        </div>
      </div>
      {error && <div className="rp-note bad" role="alert"><span>{error}</span><button type="button" className="bl-btn sm" onClick={() => setReload(n => n + 1)}>Try again</button></div>}
      {loading && !data && <div className="rp-skel" style={{ height: 120 }} aria-hidden="true" />}
      {adding && canEdit && (
        <form className="rp-cond-form" onSubmit={e => { e.preventDefault(); void run(() => api.post('/chronic-conditions', { label: draft.label, prefixes: codes(draft.prefixes), exclude: codes(draft.exclude) }), 'Condition added'); }}>
          <div><label htmlFor="cc-label">Name</label><input id="cc-label" className="bl-in" value={draft.label} onChange={e => setDraft({ ...draft, label: e.target.value })} maxLength={80} autoFocus /></div>
          <div><label htmlFor="cc-codes">ICD-11 codes (separate with commas)</label><input id="cc-codes" className="bl-in" value={draft.prefixes} onChange={e => setDraft({ ...draft, prefixes: e.target.value })} placeholder="e.g. BA00, BA01" /></div>
          <div><label htmlFor="cc-skip">Leave out (optional)</label><input id="cc-skip" className="bl-in" value={draft.exclude} onChange={e => setDraft({ ...draft, exclude: e.target.value })} placeholder="e.g. 3A51.0" /></div>
          {problem && <p className="bl-err" role="alert">{problem}</p>}
          <div style={{ display: 'flex', gap: 8 }}><button type="submit" className="bl-btn primary" disabled={busy}>{busy ? 'Saving…' : 'Add condition'}</button><button type="button" className="bl-btn" onClick={() => setAdding(false)}>Cancel</button></div>
        </form>
      )}
      <ul className="rp-conds">
        {conditions.map(c => (
          <li key={c.id} className={c.active ? undefined : 'off'}>
            {editing === c.id ? (
              <form className="rp-cond-form" onSubmit={e => { e.preventDefault(); void run(() => api.patch('/chronic-conditions/' + c.id, { label: draft.label, prefixes: codes(draft.prefixes), exclude: codes(draft.exclude) }), 'Condition saved'); }}>
                <div><label htmlFor={`l-${c.id}`}>Name</label><input id={`l-${c.id}`} className="bl-in" value={draft.label} onChange={e => setDraft({ ...draft, label: e.target.value })} maxLength={80} /></div>
                <div><label htmlFor={`p-${c.id}`}>ICD-11 codes</label><input id={`p-${c.id}`} className="bl-in" value={draft.prefixes} onChange={e => setDraft({ ...draft, prefixes: e.target.value })} /></div>
                <div><label htmlFor={`x-${c.id}`}>Leave out</label><input id={`x-${c.id}`} className="bl-in" value={draft.exclude} onChange={e => setDraft({ ...draft, exclude: e.target.value })} /></div>
                {problem && <p className="bl-err" role="alert">{problem}</p>}
                <div style={{ display: 'flex', gap: 8 }}><button type="submit" className="bl-btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button><button type="button" className="bl-btn" onClick={() => setEditing(null)}>Cancel</button></div>
              </form>
            ) : (<>
              <div style={{ minWidth: 0 }}>
                <b>{c.label}</b>{!c.active && <span className="rp-pill" style={{ marginLeft: 8 }}>Switched off</span>}
                <p className="rp-sub">Codes: {c.prefixes.join(', ')}{c.exclude.length ? ` · leaves out ${c.exclude.join(', ')}` : ''}</p>
                <p className="rp-sub">{c.reviewedAt ? `Reviewed ${when(c.reviewedAt)}${c.reviewedBy ? ` by ${c.reviewedBy}` : ''}` : 'Not reviewed yet'}</p>
              </div>
              {canEdit && (
                <div className="rp-noprint" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  {!c.reviewedAt && c.active && <button type="button" className="bl-btn sm" disabled={busy} onClick={() => void run(() => api.patch('/chronic-conditions/' + c.id, { reviewed: true }), 'Marked as reviewed')}><Check size={13} /> Mark reviewed</button>}
                  <button type="button" className="bl-btn sm" onClick={() => begin(c)}>Edit</button>
                  <button type="button" className="bl-btn sm" disabled={busy} onClick={() => void run(() => api.patch('/chronic-conditions/' + c.id, { active: !c.active }), c.active ? 'Condition switched off' : 'Condition switched on')}>{c.active ? 'Switch off' : 'Switch on'}</button>
                </div>
              )}
            </>)}
          </li>
        ))}
      </ul>
    </section>
  );
}
