import { useCallback, useEffect, useRef, useState } from 'react';
import { useVisiblePolling } from '../hooks/useVisiblePolling';
import { sortQueue, priorityLabel, priorityStyle, useQueueChanged, notifyQueueChanged, arrivedAt, waitMinutes, formatWait, useNow, queueNo } from '../lib/queue';
import AssignRoomModal, { QueueEntryInfo } from '../components/AssignRoomModal';
import toast from 'react-hot-toast';
import { Link, useNavigate } from 'react-router-dom';
import api from '../api/client';
import { Patient } from '../types';
import { useAuth } from '../context/AuthContext';
import { patientLanding } from '../lib/moduleAccess';
import { usePatient } from '../context/PatientContext';
import { getRecent, RecentPatient } from '../lib/recentPatients';
import { UserPlus, UserCheck, ArrowRightLeft, Check, X, Play } from 'lucide-react';
import { useServicePoint } from '../context/ServicePointContext';
import RegisterModal from '../components/RegisterModal';

interface FacilityRoom { id: string; name: string; tag: string; active: boolean; waitingCount: number; }
interface QueueEntry {
  id: string; queueNumber: number; patientId: string; patientName: string; roomId: string;
  room: FacilityRoom; priority: string; status: string; checkedInAt: string; startedAt?: string | null;
  startedBy?: { id: string; name: string } | null;
  patient?: Patient;
}
interface Summary { waiting: number; inProgress: number; done: number; urgent: number; emergency: number }

type Filter = 'all' | 'Waiting' | 'In Progress' | 'Done';
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'Waiting', label: 'Waiting' },
  { id: 'In Progress', label: 'With clinician' },
  { id: 'Done', label: 'Done' },
];

const STATUS_STYLE: Record<string, { label: string; color: string; bg: string }> = {
  Waiting:       { label: 'Waiting',        color: 'var(--ws-amber)', bg: 'var(--ws-amber-bg)' },
  'In Progress': { label: 'With clinician', color: 'var(--ws-blue)',  bg: 'var(--ws-blue-bg)' },
  Done:          { label: 'Done',           color: 'var(--ws-green)', bg: 'var(--ws-green-bg)' },
};

function age(dob?: string) {
  return dob ? Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * 24 * 3600 * 1000)) : null;
}


export default function DashboardPage() {
  const { user } = useAuth();
  const { setActivePatient, setActiveEncounterId } = usePatient();
  const navigate = useNavigate();
  const sp = useServicePoint();
  const [entries, setEntries] = useState<QueueEntry[]>([]);
  const [summary, setSummary] = useState<Summary>({ waiting: 0, inProgress: 0, done: 0, urgent: 0, emergency: 0 });
  const [filter, setFilter] = useState<Filter>('all');
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const [recent] = useState<RecentPatient[]>(getRecent);
  const [registering, setRegistering] = useState(false);
  const [reassign, setReassign] = useState<QueueEntry | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);   // entry awaiting remove confirmation
  const [busyId, setBusyId] = useState<string | null>(null);
  const [calling, setCalling] = useState(false);
  const now = useNow();
  const isAdmin = !!user?.role?.includes('admin');
  const canAct = (user?.role ?? '').split(',').some((r) => ['admin', 'clinician', 'nurse', 'receptionist'].includes(r.trim()));

  // Your own room by default; "All rooms" for a charge nurse or reception overview.
  const scopeRoom = scope === 'mine' ? sp.room : null;
  const scopeRoomId = scopeRoom?.id;

  // Only the rows on screen are fetched: this room (or all), active (or seen) — never the whole day's register.
  const loadQueue = useCallback(async () => {
    try {
      const roomParams = scopeRoomId ? { roomId: scopeRoomId } : {};
      const [list, sum] = await Promise.all([
        api.get('/queue', { params: { status: filter === 'Done' ? 'done' : 'active', limit: 300, ...roomParams } }),
        api.get('/queue/summary', { params: roomParams }),
      ]);
      setEntries(sortQueue(list.data));
      setSummary(sum.data);
    } catch { /* keep last data; the API client already told the user */ }
  }, [filter, scopeRoomId]);

  const first = useRef(true);
  useEffect(() => { if (first.current) { first.current = false; return; } loadQueue(); }, [loadQueue]);
  useVisiblePolling(loadQueue, 30000);
  useQueueChanged(loadQueue); // a patient assigned from any page appears here immediately

  function openPatient(p: Patient) {
    setActivePatient(p);
    setActiveEncounterId(null);
    navigate(patientLanding(user?.role, p.id));
  }

  async function openPatientById(id: string) {
    try {
      const { data } = await api.get(`/patients/${id}`);
      openPatient(data);
    } catch {
      navigate('/patients');
    }
  }

  // Opening a patient from the queue starts their visit, which stops the waiting clock.
  // `take` = pull a patient queued in another room into mine (they walked into my room instead).
  async function attend(e: QueueEntry, take = false) {
    const elsewhere = !!sp.room && e.roomId !== sp.room.id;
    // Clicking a name in someone else's queue just opens the chart; moving them is the explicit "Attend here".
    if (elsewhere && !take) { if (e.patient) openPatient(e.patient); else openPatientById(e.patientId); return; }
    if (e.status === 'Waiting' && canAct) {
      try {
        await api.patch(`/queue/${e.id}/start`, take && sp.room ? { roomId: sp.room.id } : {});
        if (take && sp.room) toast.success(`${e.patientName} moved from ${e.room.name} to ${sp.room.name}`);
        notifyQueueChanged();
      }
      catch (err: any) {
        // Someone else already took this patient — don't open them for a second person.
        if (err?.response?.status === 409) { toast.error(err.response.data?.error ?? 'This patient was just taken.'); loadQueue(); return; }
      }
    }
    if (e.patient) openPatient(e.patient); else openPatientById(e.patientId);
  }

  async function callNext() {
    if (!sp.room || calling) return;
    setCalling(true);
    try {
      const { data } = await api.post(`/queue/rooms/${sp.room.id}/next`);
      toast.success(`Now seeing ${data.patientName}`);
      notifyQueueChanged();
      openPatient(data.patient);
    } catch (err: any) {
      if (err?.response) toast.error(err.response.data?.error ?? 'Could not call the next patient');
    } finally { setCalling(false); }
  }

  async function setStatus(e: QueueEntry, status: 'Done' | 'Removed') {
    setBusyId(e.id);
    try {
      await api.patch(`/queue/${e.id}/status`, { status });
      toast.success(status === 'Done' ? `${e.patientName} marked as seen` : `${e.patientName} removed from the queue`);
      setRemoving(null);
      notifyQueueChanged();
    } catch { /* the API client already explained what went wrong */ }
    finally { setBusyId(null); }
  }

  // Counts come from the server so they stay right even when the list is capped.
  const count = (f: Filter) => f === 'all' ? summary.waiting + summary.inProgress
    : f === 'Waiting' ? summary.waiting : f === 'In Progress' ? summary.inProgress : summary.done;
  const shown = filter === 'all' ? entries : entries.filter((e) => e.status === filter);
  const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const waiting = summary.waiting;
  const urgent = summary.urgent + summary.emergency;

  return (
    <div className="ws">
      <img src="/ses-mark.svg" alt="" aria-hidden="true" className="ws-tree" />

      <div className="ws-titlerow">
        <div>
          <h1 className="ws-h1">Today</h1>
          <p className="ws-muted" style={{ fontSize: 13 }}>{today} · Chronic Disease Management</p>
        </div>
        <button type="button" className="btn-primary" onClick={() => setRegistering(true)}>
          <UserPlus size={15} /> Register client
        </button>
      </div>

      <div className="ws-grid">
        <section className="ws-card" aria-labelledby="ws-q" style={{ overflow: 'hidden' }}>
          <div className="ws-cardhead">
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              <h2 id="ws-q" className="ws-h2">Queue</h2>
              <div role="tablist" aria-label="Filter queue" style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {FILTERS.map((f) => (
                  <button key={f.id} role="tab" type="button" aria-selected={filter === f.id}
                    className={`ws-tab${filter === f.id ? ' on' : ''}`} onClick={() => setFilter(f.id)}>
                    {f.label} · {count(f.id)}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              {sp.room && (
                <div role="group" aria-label="Which rooms to show" className="ws-seg">
                  <button type="button" aria-pressed={scope === 'mine'} className={scope === 'mine' ? 'on' : ''} onClick={() => setScope('mine')}>
                    {sp.room.name}
                  </button>
                  <button type="button" aria-pressed={scope === 'all'} className={scope === 'all' ? 'on' : ''} onClick={() => setScope('all')}>
                    All rooms
                  </button>
                </div>
              )}
              {sp.room && canAct && scope === 'mine' && (
                <button type="button" className="ws-next" onClick={callNext} disabled={calling}
                  title="Takes the patient who is first in line in your room (emergencies first)">
                  <Play size={13} /> {calling ? 'Calling…' : 'Call next patient'}
                </button>
              )}
            </div>
          </div>

          {!sp.room && (
            <div className="ws-nudge">
              You are viewing every room. Choose your <strong>service point</strong> (top bar) to see only your room’s patients and call the next one.
            </div>
          )}

          <div style={{ overflowX: 'auto' }}>
            <div style={{ minWidth: 760 }}>
              <div className="ws-cols ws-thead">
                <span>No.</span><span>Patient</span><span>Age/Sex</span><span>NRC</span>
                <span>Arrived</span><span>Wait</span><span>Service point</span><span>Status</span><span className="sr-only">Actions</span>
              </div>
              {shown.map((e) => {
                const s = STATUS_STYLE[e.status] ?? STATUS_STYLE.Waiting;
                const a = age(e.patient?.dateOfBirth);
                const wait = waitMinutes(e, now);
                const long = e.status === 'Waiting' && (wait ?? 0) >= 30;
                const done = e.status === 'Done';
                const busy = busyId === e.id;
                return (
                  <div key={e.id} className={`ws-cols ws-row${done ? ' ws-done' : ''}`}>
                    <span style={{ fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>{queueNo(e.queueNumber)}</span>
                    <button type="button" className="ws-open" onClick={() => attend(e)} title={done ? 'Open patient'
                      : sp.room && e.roomId !== sp.room.id ? `Open chart — queued in ${e.room.name}. Use “Attend here” to take them into your room.`
                      : 'Open patient and start the visit'}>
                      {e.patientName}
                      <span className="ws-pill" style={{
                        marginLeft: 8,
                        color: e.priority === 'Emergency' ? '#fff' : priorityStyle(e.priority).color,
                        background: e.priority === 'Emergency' ? 'var(--ses-red)' : priorityStyle(e.priority).bg,
                      }}>{priorityLabel(e.priority)}</span>
                    </button>
                    <span>{a ?? '—'}{e.patient?.gender ? ` / ${e.patient.gender.charAt(0)}` : ''}</span>
                    <span className="ws-muted">{e.patient?.nationalId ?? '—'}</span>
                    <span className="ws-num2">{arrivedAt(e.checkedInAt)}</span>
                    <span className="ws-num2" style={long ? { color: 'var(--ws-amber)', fontWeight: 500 } : undefined} title={long ? 'Waiting over 30 minutes' : undefined}>
                      {formatWait(wait)}
                    </span>
                    <span>{e.room?.name ?? '—'}</span>
                    <span><span className="ws-pill" style={{ color: s.color, background: s.bg }} title={e.startedBy ? `Seen by ${e.startedBy.name}` : undefined}>
                      {e.status === 'In Progress' && e.startedBy ? e.startedBy.name.split(' ')[0] : s.label}
                    </span></span>
                    <span className="ws-acts">
                      {done ? null : removing === e.id ? (
                        <>
                          <button type="button" className="ws-act ws-act-bad" onClick={() => setStatus(e, 'Removed')} disabled={busy}>{busy ? '…' : 'Remove'}</button>
                          <button type="button" className="ws-act" onClick={() => setRemoving(null)} disabled={busy}>Keep</button>
                        </>
                      ) : (
                        <>
                          {sp.room && canAct && e.status === 'Waiting' && e.roomId !== sp.room.id && (
                            <button type="button" className="ws-ic ws-ic-go" title={`Attend here — take into ${sp.room.name}`} aria-label={`Attend ${e.patientName} in ${sp.room.name}`} onClick={() => attend(e, true)} disabled={busy}><Play size={14} /></button>
                          )}
                          <button type="button" className="ws-ic" title="Mark as seen" aria-label={`Mark ${e.patientName} as seen`} onClick={() => setStatus(e, 'Done')} disabled={busy}><Check size={15} /></button>
                          <button type="button" className="ws-ic" title="Re-assign to another room" aria-label={`Re-assign ${e.patientName}`} onClick={() => setReassign(e)} disabled={busy}><ArrowRightLeft size={15} /></button>
                          <button type="button" className="ws-ic ws-ic-bad" title="Remove from queue" aria-label={`Remove ${e.patientName} from the queue`} onClick={() => setRemoving(e.id)} disabled={busy}><X size={15} /></button>
                        </>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <aside style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <section className="ws-card" aria-labelledby="ws-att">
            <h2 id="ws-att" className="ws-h2 ws-cardhead" style={{ fontSize: 15 }}>Needs attention</h2>
            <div className="ws-attn">
              <span>Patients waiting</span>
              <span className="ws-num" style={{ color: waiting ? 'var(--ws-amber)' : undefined }}>{waiting}</span>
            </div>
            <div className="ws-attn">
              <span>Urgent / emergency in queue</span>
              <span className="ws-num" style={{ color: urgent ? '#E5484D' : undefined }}>{urgent}</span>
            </div>
            <div className="ws-attn" style={{ borderBottom: 0 }}>
              <span>Seen today</span>
              <span className="ws-num">{summary.done}</span>
            </div>
          </section>

          <section className="ws-card ws-pad" aria-labelledby="ws-rec">
            <h2 id="ws-rec" className="ws-h2" style={{ fontSize: 15, marginBottom: 8 }}>Recent patients</h2>
            {recent.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', marginBottom: 10 }}>
                {recent.map((r) => (
                  <button key={r.id} type="button" className="ws-recent" onClick={() => openPatientById(r.id)}>
                    <UserCheck size={14} color="var(--text-muted)" />
                    <span style={{ flex: 1, fontWeight: 500 }}>{r.firstName} {r.lastName}</span>
                    {r.nationalId && <span className="ws-muted" style={{ fontSize: 12 }}>{r.nationalId}</span>}
                  </button>
                ))}
              </div>
            )}
            <Link to="/patients" style={{ fontSize: 13 }}>View all patients</Link>
          </section>

          <section className="ws-card ws-pad" aria-labelledby="ws-sp">
            <h2 id="ws-sp" className="ws-h2" style={{ fontSize: 15, marginBottom: 8 }}>Service points</h2>
            {sp.rooms.length === 0 ? (
              <p className="ws-muted" style={{ lineHeight: 1.5, marginBottom: 10 }}>None set up yet. Add rooms so patients can be routed.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 10 }}>
                {sp.rooms.map((r) => {
                  const mine = sp.room?.id === r.id;
                  return (
                    <button key={r.id} type="button" className={`ws-recent${mine ? ' ws-mine' : ''}`}
                      onClick={() => { sp.setRoomId(r.id); setScope('mine'); }}
                      title={mine ? 'Your service point' : 'Work in this room'}>
                      <span style={{ flex: 1, fontWeight: mine ? 700 : 500 }}>{r.name}{mine && <span className="ws-youhere"> · you</span>}</span>
                      <span className="ws-muted" style={{ fontVariantNumeric: 'tabular-nums', fontSize: 13 }}>{r.waitingCount} waiting</span>
                    </button>
                  );
                })}
              </div>
            )}
            {isAdmin && <Link to="/admin/users" style={{ fontSize: 13 }}>Set up in Admin</Link>}
          </section>
        </aside>
      </div>

      {reassign && (
        <AssignRoomModal
          patientId={reassign.patientId}
          patientName={reassign.patientName}
          current={{ ...reassign, position: null, ahead: 0 } as QueueEntryInfo}
          onClose={() => setReassign(null)}
          onDone={() => setReassign(null)}
          onRemoved={() => setReassign(null)}
        />
      )}

      {registering && (
        <RegisterModal
          onClose={() => setRegistering(false)}
          onCreated={(p) => { setRegistering(false); openPatient(p); }}
        />
      )}

      <style>{`
        .ws { position: relative; padding: 24px 24px 40px; max-width: 1600px; margin: 0 auto; font-size: 14px; color: var(--text-body); }
        .ws a { color: var(--ws-link); font-weight:500; text-decoration: none; }
        .ws a:hover { text-decoration: underline; }
        .ws-tree { position: absolute; right: 24px; top: 6px; width: 92px; opacity: var(--ws-tree-op); filter: var(--ws-tree); pointer-events: none; }
        .ws-titlerow { position: relative; display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; margin-bottom: 20px; padding-right: 116px; min-height: 48px; }
        .ws-h1 { margin: 0 0 4px; font-weight:500; font-size: 22px; letter-spacing: -0.2px; color: var(--text-heading); }
        .ws-h2 { margin: 0; font-family: var(--font-heading); font-size: 16px; font-weight:500; color: var(--text-heading); }
        .ws-muted { color: var(--text-muted); }
        .ws-num { font-weight:500; font-variant-numeric: tabular-nums; color: var(--text-muted); }
        .ws-grid { position: relative; display: grid; grid-template-columns: minmax(0,1fr) 340px; gap: 20px; }
        .ws-card { background: var(--bg-card); border: 1px solid var(--border); border-radius: 14px; }
        .ws-pad { padding: 14px 18px 16px; }
        .ws-cardhead { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; padding: 14px 18px; border-bottom: 1px solid var(--border-light); }
        .ws-tab { height: 30px; padding: 0 10px; border: 0; border-radius: 8px; background: transparent; color: var(--text-muted); font: inherit; font-size: 12px; font-weight:500; cursor: pointer; }
        .ws-tab:hover { background: var(--ws-chip); }
        .ws-tab.on { background: var(--ws-chip-on); color: var(--ws-chip-on-text); }
        .ws-cols { display: grid; grid-template-columns: 56px 2fr 80px 1.2fr 70px 70px 1.2fr 1.1fr 146px; gap: 12px; align-items: center; }
        .ws-thead { padding: 10px 18px; background: var(--ws-head); border-bottom: 1px solid var(--border-light);
          font-size: 11px; font-weight:500; letter-spacing: 1px; text-transform: uppercase; color: var(--text-subtle); }
        .ws-num2 { font-variant-numeric: tabular-nums; }
        .ws-seg { display: inline-flex; padding: 3px; gap: 2px; border: 1px solid var(--border); border-radius: 10px; background: var(--ws-head); }
        .ws-seg button { height: 28px; padding: 0 12px; border: 0; border-radius: 7px; background: transparent; color: var(--text-muted); font: inherit; font-size: 12px; font-weight:500; cursor: pointer; white-space: nowrap; }
        .ws-seg button.on { background: var(--ws-chip-on); color: var(--ws-chip-on-text); }
        .ws-next { height: 34px; padding: 0 14px; border: 0; border-radius: 10px; background: var(--btn-accent); color: #fff; font: inherit; font-size: 13px; font-weight:500; cursor: pointer;
          display: inline-flex; align-items: center; gap: 8px; transition: filter .15s; }
        .ws-next:hover:not(:disabled) { filter: brightness(1.06); }
        .ws-next:disabled { opacity: .6; cursor: wait; }
        .ws-nudge { padding: 10px 18px; background: var(--ws-blue-bg); color: var(--text-heading); font-size: 13px; border-bottom: 1px solid var(--border-light); }
        .ws-mine { background: var(--ws-chip); }
        .ws-youhere { color: var(--ws-link); font-weight:500; font-size: 12px; }
        .ws-done { opacity: .6; }
        .ws-open { border: 0; background: none; padding: 0; font: inherit; font-weight:500; color: var(--text-heading); text-align: left; cursor: pointer; min-width: 0; }
        .ws-open:hover { text-decoration: underline; text-decoration-color: var(--ws-link); text-underline-offset: 3px; }
        .ws-acts { display: flex; justify-content: flex-end; gap: 4px; }
        .ws-ic { width: 30px; height: 30px; border: 1px solid transparent; border-radius: 8px; background: transparent; color: var(--text-muted); cursor: pointer;
          display: inline-flex; align-items: center; justify-content: center; transition: background .15s, color .15s, border-color .15s; }
        .ws-ic:hover:not(:disabled) { background: var(--bg-card); border-color: var(--border); color: var(--text-heading); }
        .ws-ic-go { color: #fff; background: var(--btn-accent); border-color: var(--btn-accent); }
        .ws-ic-go:hover:not(:disabled) { background: var(--btn-accent-hover); color: #fff; border-color: var(--btn-accent-hover); filter: brightness(1.08); }
        .ws-ic-bad:hover:not(:disabled) { color: var(--st-bad); border-color: var(--st-bad); }
        .ws-ic:disabled, .ws-act:disabled { opacity: .5; cursor: wait; }
        .ws-act { height: 28px; padding: 0 10px; border: 1px solid var(--btn2-line); border-radius: 8px; background: transparent; color: var(--text-heading); font: inherit; font-size: 12px; font-weight:500; cursor: pointer; }
        .ws-act-bad { color: var(--st-bad); border-color: var(--st-bad); }
        .ws-row { width: 100%; padding: 12px 18px; border: 0; border-bottom: 1px solid var(--border-light); background: none; font: inherit; color: var(--text-body); text-align: left; cursor: pointer; }
        .ws-row:hover { background: var(--ws-chip); }
        .ws-pill { display: inline-flex; align-items: center; height: 22px; padding: 0 8px; border-radius: 11px; font-size: 11.5px; font-weight:500; }
        .ws-attn { display: flex; align-items: center; justify-content: space-between; padding: 12px 18px; color: var(--text-heading); font-weight: 500; border-bottom: 1px solid var(--border-light); }
        .ws-recent { display: flex; align-items: center; gap: 8px; padding: 7px 6px; margin: 0 -6px; border: 0; border-radius: 8px; background: none; font: inherit; color: var(--text-heading); text-align: left; cursor: pointer; }
        .ws-recent:hover { background: var(--ws-chip); }
        @media (max-width: 1100px) { .ws-grid { grid-template-columns: 1fr; } }
        @media (max-width: 700px) {
          .ws { padding: 16px 14px 32px; }
          .ws-titlerow { flex-direction: column; align-items: flex-start; padding-right: 0; }
          .ws-tree { display: none; }
        }
      `}</style>
    </div>
  );
}
