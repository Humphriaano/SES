import { FormEvent, useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../../api/client';
import { apiError, plain, zmw } from '../../lib/money';
import { Modal } from './ui';

export interface Session {
  id: string; openedAt: string; openingFloat: number; receipts: number; voided: number;
  byMethod: Record<string, number>; collected: number; expectedCash: number;
}

// The signed-in cashier's open session (null = none). Payments need one.
export function useCashierSession() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);   // undefined = loading
  const [failed, setFailed] = useState(false);
  const refresh = useCallback(async () => {
    try { const { data } = await api.get('/cashier/session'); setSession(data); setFailed(false); }
    catch { setFailed(true); setSession((s) => (s === undefined ? null : s)); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  return { session, refresh, failed };
}

export default function SessionBar({ session, onChange }: { session: Session | null | undefined; onChange: () => void }) {
  const [dialog, setDialog] = useState<'open' | 'close' | null>(null);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ expectedCash: number; countedCash: number; variance: number } | null>(null);

  const close = useCallback(() => { setDialog(null); setAmount(''); setNote(''); setError(''); }, []);

  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      if (dialog === 'open') {
        await api.post('/cashier/session/open', { openingFloat: amount.trim() === '' ? 0 : amount });
        toast.success('Session opened. You can take payments now.');
        close(); onChange();
      } else {
        const { data } = await api.post('/cashier/session/close', { countedCash: amount, note });
        close(); setResult(data); onChange();
      }
    } catch (err) { setError(apiError(err)); } finally { setBusy(false); }
  }

  if (session === undefined) return <div className="bl-card" style={{ padding: 14, height: 56 }} aria-busy="true" />;

  return (
    <>
      <div className="bl-card" style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        {session ? (
          <>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontWeight: 500, color: 'var(--text-heading)', fontSize: 14 }}>Your session is open</div>
              <div className="bl-muted" style={{ fontSize: 12.5 }}>
                Since {new Date(session.openedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} · {session.receipts} receipt{session.receipts === 1 ? '' : 's'} · collected {zmw(session.collected)}
              </div>
            </div>
            <button type="button" className="bl-btn" onClick={() => setDialog('close')}>Close session</button>
          </>
        ) : (
          <>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontWeight: 500, color: 'var(--text-heading)', fontSize: 14 }}>No cashier session open</div>
              <div className="bl-muted" style={{ fontSize: 12.5 }}>Open one with the cash in your drawer before taking payments.</div>
            </div>
            <button type="button" className="bl-btn primary" onClick={() => setDialog('open')}>Open session</button>
          </>
        )}
      </div>

      {dialog && (
        <Modal title={dialog === 'open' ? 'Open cashier session' : 'Close cashier session'} onClose={close} busy={busy}>
          <form onSubmit={submit}>
            <div className="bl-mb">
              {dialog === 'close' && session && (
                <div className="bl-card" style={{ padding: 12, background: 'var(--bg-surface)', fontSize: 13 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="bl-muted">Opening float</span><b>{zmw(session.openingFloat)}</b></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="bl-muted">Cash received</span><b>{zmw(session.byMethod['CASH'] ?? 0)}</b></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border)', marginTop: 6, paddingTop: 6 }}><span>Cash that should be in the drawer</span><b>{zmw(session.expectedCash)}</b></div>
                  {(session.collected - (session.byMethod['CASH'] ?? 0)) > 0 && <div className="bl-faint" style={{ marginTop: 6, fontSize: 12 }}>Mobile money, card and credit ({zmw(session.collected - (session.byMethod['CASH'] ?? 0))}) are not counted in the drawer.</div>}
                </div>
              )}
              <div>
                <label className="bl-k" htmlFor="s-amt">{dialog === 'open' ? 'Cash in the drawer now (ZMW)' : 'Cash you counted (ZMW)'}</label>
                <input id="s-amt" className="bl-in" autoFocus inputMode="decimal" value={amount} placeholder={dialog === 'open' ? '0.00' : ''} onChange={(e) => { setAmount(e.target.value.replace(/[^\d.,]/g, '')); setError(''); }} />
              </div>
              {dialog === 'close' && (
                <div>
                  <label className="bl-k" htmlFor="s-note">Note <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>· needed only if the count doesn’t match</span></label>
                  <textarea id="s-note" className="bl-in" rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
                </div>
              )}
              {error && <p role="alert" className="bl-err">{error}</p>}
            </div>
            <div className="bl-mf">
              <button type="button" className="bl-btn" onClick={close} disabled={busy}>Cancel</button>
              <button type="submit" className="bl-btn primary" disabled={busy || (dialog === 'close' && amount.trim() === '')}>{busy ? 'Saving…' : dialog === 'open' ? 'Open session' : 'Close session'}</button>
            </div>
          </form>
        </Modal>
      )}

      {result && (
        <Modal title="Session closed" onClose={() => setResult(null)}>
          <div className="bl-mb">
            <div style={{ fontSize: 14 }}>Expected <b>{zmw(result.expectedCash)}</b> · counted <b>{zmw(result.countedCash)}</b></div>
            <div style={{ fontWeight: 500, color: result.variance === 0 ? 'var(--badge-green-text)' : 'var(--badge-red-text)' }}>
              {result.variance === 0 ? 'The drawer balances.' : `${result.variance < 0 ? 'Short' : 'Over'} by ZMW ${plain(Math.abs(result.variance))}. This has been recorded.`}
            </div>
          </div>
          <div className="bl-mf"><button type="button" className="bl-btn primary" autoFocus onClick={() => setResult(null)}>Done</button></div>
        </Modal>
      )}
    </>
  );
}
