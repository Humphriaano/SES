import { useCallback, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Check, CornerUpLeft } from 'lucide-react';
import api from '../api/client';
import { useVisiblePolling } from '../hooks/useVisiblePolling';
import { apiError, zmw } from '../lib/money';
import { agoText, patientLine, TreatmentItem, waitingText } from '../lib/treatmentRoom';
import { BILLING_CSS } from '../components/billing/ui';

interface Counts { waiting: number; urgent: number }
interface Worklist { counts: Counts; items: TreatmentItem[] }
type Open = { id: string; action: 'done' | 'return' } | null;

// Procedures doctors have sent for a nurse to do. Recording one done creates its charge; sending one back tells the doctor why.
export default function TreatmentRoomPage() {
  const [view, setView] = useState<'waiting' | 'done'>('waiting');
  const [counts, setCounts] = useState<Counts | null>(null);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 920, margin: '0 auto', padding: '4px 0 40px' }}>
      <style>{BILLING_CSS}</style>
      <div>
        <h2 style={{ fontSize: 22, fontWeight: 500, color: 'var(--text-heading)', margin: 0, letterSpacing: '-0.3px' }}>Treatment room</h2>
        <p className="bl-muted" style={{ margin: '2px 0 0', fontSize: 13 }}>Procedures doctors have sent for you to do. Recording one done charges the patient.</p>
      </div>
      <div role="tablist" aria-label="Treatment room list" className="bl-seg" style={{ alignSelf: 'flex-start' }}>
        <button type="button" role="tab" aria-selected={view === 'waiting'} onClick={() => setView('waiting')}>
          Waiting{counts ? ` (${counts.waiting})` : ''}{counts && counts.urgent > 0 ? ` · ${counts.urgent} urgent` : ''}
        </button>
        <button type="button" role="tab" aria-selected={view === 'done'} onClick={() => setView('done')}>Done in the last 24 hours</button>
      </div>
      {/* One list per tab: switching tabs starts a fresh load, and each list loads itself when it opens. */}
      <WorkList key={view} view={view} onCounts={setCounts} />
    </div>
  );
}

function WorkList({ view, onCounts }: { view: 'waiting' | 'done'; onCounts: (counts: Counts) => void }) {
  const [data, setData] = useState<Worklist | null>(null);
  const [error, setError] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const [open, setOpen] = useState<Open>(null);
  const [site, setSite] = useState('');
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const request = useRef(0);

  const load = useCallback(async () => {
    const id = ++request.current;
    try {
      const { data: body } = await api.get<Worklist>('/treatment-room/procedures', { params: { view } });
      if (id === request.current) { setData(body); setError(''); setNow(Date.now()); onCounts(body.counts); }
    } catch (e) { if (id === request.current) setError(apiError(e, 'Couldn’t load the treatment room list.')); }
  }, [view, onCounts]);
  // Loads when the list opens, then every 30 seconds while the tab is visible, and again when the connection returns.
  useVisiblePolling(() => { void load(); }, 30000, true);

  function begin(item: TreatmentItem, action: 'done' | 'return') {
    setOpen({ id: item.id, action }); setSite(item.site ?? ''); setNote(''); setReason(''); setFormError('');
  }
  async function submit(item: TreatmentItem) {
    if (!open || busy) return;
    if (open.action === 'return' && reason.trim().length < 3) { setFormError('Say why it is being sent back, so the doctor knows what to do.'); return; }
    setBusy(true); setFormError('');
    try {
      await api.post(`/treatment-room/procedures/${item.id}/${open.action === 'done' ? 'complete' : 'return'}`, open.action === 'done' ? { site: site.trim() || undefined, note: note.trim() || undefined } : { reason: reason.trim() });
      toast.success(open.action === 'done' ? `${item.name} recorded as done` : `${item.name} sent back to the doctor`);
      setOpen(null); await load();
    } catch (e) {
      setFormError(apiError(e, 'Could not save. Check your connection and try again; nothing is charged twice.'));
      if ((e as { response?: { status?: number } })?.response?.status === 409) void load();   // someone else dealt with it: show the current list
    } finally { setBusy(false); }
  }

  const items = data?.items ?? [];
  return (
    <>
      {error && <div className="bl-card" style={{ padding: '14px 18px' }}><p className="bl-err" role="alert" style={{ margin: 0 }}>{error}</p></div>}
      {!data && !error && <div className="bl-card" style={{ padding: 20 }} aria-busy="true"><div style={{ height: 18, width: '40%', borderRadius: 6, background: 'var(--bg-surface-2)' }} /></div>}
      {data && items.length === 0 && (
        <div className="bl-card" style={{ padding: '40px 16px', textAlign: 'center' }}>
          <p className="bl-muted" style={{ margin: 0 }}>{view === 'waiting' ? 'No procedures are waiting. New ones appear here as doctors send them.' : 'Nothing has been recorded done from this list in the last 24 hours.'}</p>
        </div>
      )}

      {items.map(item => {
        const urgent = item.priority === 'URGENT';
        const editing = open?.id === item.id ? open : null;
        return (
          <article key={item.id} className="bl-card" aria-label={`${item.name} for ${item.patient?.name ?? 'patient'}`} style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8, borderLeft: urgent && view === 'waiting' ? '4px solid var(--badge-red-text)' : undefined }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
              <b style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-heading)' }}>{item.patient?.name ?? 'Unknown patient'}</b>
              <span className="bl-muted" style={{ fontSize: 12.5 }}>{patientLine(item.patient)}</span>
              {urgent && view === 'waiting' && <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--badge-red-text)', background: 'var(--badge-red-bg)', border: '1px solid var(--badge-red-text)', borderRadius: 5, padding: '1px 7px' }}>Urgent</span>}
              <span className="bl-muted" style={{ fontSize: 12.5, marginLeft: 'auto' }}>
                {view === 'waiting' ? `Waiting ${waitingText(item.orderedAt, now)}` : `Done ${agoText(item.performedAt, now)}${item.performedBy ? ` by ${item.performedBy}` : ''}`}
              </span>
            </div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 500, color: 'var(--text-heading)' }}>{item.name}</div>
              {item.site && <div style={{ fontSize: 13, color: 'var(--text-body2)' }}>{item.site}</div>}
              {item.instructions && <div style={{ fontSize: 13, color: 'var(--text-heading)', marginTop: 4, padding: '6px 10px', background: 'var(--bg-surface)', borderRadius: 8 }}><span className="bl-muted">Doctor’s instructions: </span>{item.instructions}</div>}
              {view === 'done' && item.note && <div style={{ fontSize: 13, color: 'var(--text-body2)', marginTop: 4 }}>Nurse’s note: {item.note}</div>}
            </div>
            <div className="bl-muted" style={{ fontSize: 12.5 }}>
              {item.orderedBy ? `Sent by ${item.orderedBy} · ` : ''}
              {item.charged ? `Charged ${item.price === null ? '(no price yet)' : zmw(item.price)}` : item.catalogueRef ? (item.expectedPrice === null ? 'No price yet. Billing will confirm it.' : `${zmw(item.expectedPrice)} when recorded done`) : 'Not charged'}
            </div>

            {view === 'waiting' && !editing && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" className="bl-btn primary" onClick={() => begin(item, 'done')}><Check size={15} /> Record done</button>
                <button type="button" className="bl-btn" onClick={() => begin(item, 'return')}><CornerUpLeft size={15} /> Send back to doctor</button>
              </div>
            )}
            {editing && (
              <form onSubmit={e => { e.preventDefault(); void submit(item); }} style={{ display: 'flex', flexDirection: 'column', gap: 8, borderTop: '1px solid var(--border-light)', paddingTop: 10 }}>
                {editing.action === 'done' ? (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <div style={{ flex: '1 1 200px' }}><label className="bl-k" htmlFor={`site-${item.id}`}>Site or side</label><input id={`site-${item.id}`} className="bl-in" value={site} maxLength={120} onChange={e => setSite(e.target.value)} placeholder="e.g. left forearm" /></div>
                    <div style={{ flex: '2 1 260px' }}><label className="bl-k" htmlFor={`note-${item.id}`}>Note (optional)</label><input id={`note-${item.id}`} className="bl-in" value={note} maxLength={300} onChange={e => setNote(e.target.value)} placeholder="e.g. second attempt, flushed well" autoFocus /></div>
                  </div>
                ) : (
                  <div><label className="bl-k" htmlFor={`why-${item.id}`}>Why is it being sent back?</label><input id={`why-${item.id}`} className="bl-in" value={reason} maxLength={300} onChange={e => setReason(e.target.value)} placeholder="e.g. patient refused, needs a doctor to explain" autoFocus /></div>
                )}
                {formError && <p className="bl-err" role="alert" style={{ margin: 0 }}>{formError}</p>}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="submit" className="bl-btn primary" disabled={busy}>{busy ? 'Saving…' : editing.action === 'done' ? 'Confirm done' : 'Send back'}</button>
                  <button type="button" className="bl-btn" disabled={busy} onClick={() => setOpen(null)}>Cancel</button>
                </div>
              </form>
            )}
          </article>
        );
      })}
    </>
  );
}
