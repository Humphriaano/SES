import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { BarChart3 } from 'lucide-react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { usePatient } from '../context/PatientContext';
import { apiError, hasRole, METHOD_LABEL, zmw } from '../lib/money';
import { BILLING_CSS, Pill } from '../components/billing/ui';
import SessionBar, { useCashierSession } from '../components/billing/SessionBar';

interface Desk {
  today: { byMethod: Record<string, number>; total: number; receipts: number };
  owing: { patientId: string; name: string; phone: string | null; balance: number; overdue: boolean; since: string; invoices: number; emergency: boolean }[];
  owingTotal: number; owingCount: number;
}
interface SessionRow { id: string; cashier: string; openedAt: string; closedAt: string | null; expectedCash: number; countedCash: number | null; variance: number | null; note: string | null }

// The cashier's starting point: open a session, see today's takings and who still owes.
export default function BillingDeskPage() {
  const { user } = useAuth();
  const { setActivePatient } = usePatient();
  const navigate = useNavigate();
  const canReport = hasRole(user?.role, 'admin', 'billing');
  const { session, refresh } = useCashierSession();
  const [desk, setDesk] = useState<Desk | null>(null);
  const [failed, setFailed] = useState(false);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [opening, setOpening] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { const { data } = await api.get('/billing/desk'); setDesk(data); setFailed(false); } catch { setFailed(true); }
    if (canReport) api.get('/cashier/sessions', { params: { days: 14 } }).then((r) => setSessions(r.data)).catch(() => setSessions([]));
  }, [canReport]);
  useEffect(() => { load(); }, [load]);

  async function openPatient(id: string) {
    setOpening(id);
    try {
      const { data } = await api.get(`/patients/${id}`);
      setActivePatient(data);
      navigate(`/patient/${id}/billing`);
    } catch (e) { toast.error(apiError(e, 'Couldn’t open that patient.')); } finally { setOpening(null); }
  }

  const short = sessions.filter((s) => s.variance !== null && s.variance !== 0);

  return (
    <div className="page-container" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <style>{BILLING_CSS}</style>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: 18, fontWeight: 500, color: 'var(--text-heading)', margin: 0 }}>Billing</h2>
        {canReport && <Link to="/billing/reports" className="bl-btn" style={{ textDecoration: 'none' }}><BarChart3 size={15} /> Billing reports</Link>}
      </div>

      <SessionBar session={session} onChange={() => { refresh(); load(); }} />

      {failed && !desk ? (
        <div className="bl-card" style={{ padding: '40px 20px', textAlign: 'center' }}>
          <p style={{ margin: '0 0 12px', fontWeight: 500, color: 'var(--text-heading)' }}>Couldn’t load billing</p>
          <button type="button" className="bl-btn" onClick={load}>Try again</button>
        </div>
      ) : !desk ? (
        <div className="bl-card" style={{ padding: 20 }} aria-busy="true"><div style={{ height: 18, width: '40%', borderRadius: 6, background: 'var(--bg-surface-2)' }} /></div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
            <Stat label="Collected today" value={zmw(desk.today.total)} sub={`${desk.today.receipts} receipt${desk.today.receipts === 1 ? '' : 's'}`} />
            {Object.entries(desk.today.byMethod).map(([m, v]) => <Stat key={m} label={METHOD_LABEL[m] ?? m} value={zmw(v)} />)}
            <Stat label="Still owing" value={zmw(desk.owingTotal)} sub={`${desk.owingCount} patient${desk.owingCount === 1 ? '' : 's'}`} bad={desk.owingTotal > 0} />
          </div>

          <section className="bl-card" style={{ overflow: 'hidden' }}>
            <div style={{ padding: '14px 16px' }}><h3 className="bl-h">Patients with a balance</h3></div>
            {desk.owing.length === 0 ? (
              <p className="bl-muted" style={{ margin: 0, padding: '8px 16px 28px', textAlign: 'center' }}>Nobody owes anything right now.</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="bl-tbl" style={{ minWidth: 560 }}>
                  <thead><tr><th>Patient</th><th className="bl-hide-sm">Phone</th><th>Since</th><th className="bl-num">Balance</th><th /></tr></thead>
                  <tbody>
                    {desk.owing.map((o) => (
                      <tr key={o.patientId}>
                        <td style={{ fontWeight: 500, color: 'var(--text-heading)' }}>{o.name} {o.overdue && <Pill tone="bad">Overdue</Pill>} {o.emergency && <Pill tone="warn">Emergency</Pill>}</td>
                        <td className="bl-hide-sm">{o.phone ?? '—'}</td>
                        <td>{new Date(o.since).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</td>
                        <td className="bl-num" style={{ fontWeight: 500, color: 'var(--badge-red-text)' }}>{zmw(o.balance)}</td>
                        <td style={{ textAlign: 'right' }}><button type="button" className="bl-btn sm" disabled={opening === o.patientId} onClick={() => openPatient(o.patientId)}>{opening === o.patientId ? 'Opening…' : 'Open billing'}</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {canReport && sessions.length > 0 && (
            <section className="bl-card" style={{ overflow: 'hidden' }}>
              <div style={{ padding: '14px 16px' }}>
                <h3 className="bl-h">Cashier sessions · last 14 days</h3>
                {short.length > 0 && <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--badge-red-text)', fontWeight: 500 }}>{short.length} session{short.length === 1 ? '' : 's'} did not balance.</p>}
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table className="bl-tbl" style={{ minWidth: 600 }}>
                  <thead><tr><th>Cashier</th><th>Opened</th><th className="bl-num">Expected cash</th><th className="bl-num">Counted</th><th className="bl-num">Difference</th></tr></thead>
                  <tbody>
                    {sessions.map((s) => (
                      <tr key={s.id}>
                        <td style={{ fontWeight: 500, color: 'var(--text-heading)' }}>{s.cashier}</td>
                        <td>{new Date(s.openedAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}{!s.closedAt && <> <Pill tone="blue">Open</Pill></>}</td>
                        <td className="bl-num">{zmw(s.expectedCash)}</td>
                        <td className="bl-num">{s.countedCash === null ? '—' : zmw(s.countedCash)}</td>
                        <td className="bl-num" title={s.note ?? undefined} style={{ fontWeight: 500, color: s.variance === null ? undefined : s.variance === 0 ? 'var(--badge-green-text)' : 'var(--badge-red-text)' }}>
                          {s.variance === null ? '—' : s.variance === 0 ? 'Balanced' : `${s.variance > 0 ? '+' : '−'}${zmw(Math.abs(s.variance))}`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value, sub, bad }: { label: string; value: string; sub?: string; bad?: boolean }) {
  return (
    <div className="bl-card" style={{ padding: '12px 16px' }}>
      <div className="bl-faint" style={{ fontSize: 11, fontWeight: 500, letterSpacing: '.06em', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 500, marginTop: 2, color: bad ? 'var(--badge-red-text)' : 'var(--text-heading)' }}>{value}</div>
      {sub && <div className="bl-muted" style={{ fontSize: 12 }}>{sub}</div>}
    </div>
  );
}
