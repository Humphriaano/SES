import { useState, useEffect, useRef, useCallback } from 'react';
import { useVisiblePolling } from '../hooks/useVisiblePolling';
import { sortQueue, queueNo, priorityLabel, priorityStyle, useQueueChanged, notifyQueueChanged, arrivedAt, waitMinutes, formatWait, useNow } from '../lib/queue';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useServicePoint } from '../context/ServicePointContext';
import ServicePointPicker from './ServicePointPicker';
import AssignRoomModal, { QueueEntryInfo } from './AssignRoomModal';
import {
  X, RefreshCw, Play, Check, CornerDownRight, Search,
} from 'lucide-react';
import { useWindowSize } from '../hooks/useWindowSize';
import api from '../api/client';
import { usePatient } from '../context/PatientContext';
import { Patient } from '../types';

// ── Types ─────────────────────────────────────────────────────────────────────

interface FacilityRoom { id: string; name: string; tag: string; active: boolean; waitingCount: number; }
interface QueueEntry {
  id: string; queueNumber: number; patientId: string; patientName: string;
  roomId: string; room: FacilityRoom;
  priority: string; status: string; checkedInAt: string; startedAt?: string | null; updatedAt: string;
  startedBy?: { id: string; name: string } | null;
  patient?: Patient;
}
interface PatientResult { id: string; firstName: string; lastName: string; nationalId: string | null; }

// ── Helpers ───────────────────────────────────────────────────────────────────

const queueNum = queueNo;

function getUserRole(): string {
  try { return JSON.parse(localStorage.getItem('user') || '{}').role ?? ''; } catch { return ''; }
}
function getUserId(): string {
  try { return JSON.parse(localStorage.getItem('user') || '{}').id ?? ''; } catch { return ''; }
}
function canModify(): boolean {
  return getUserRole().split(',').some(r => ['admin', 'clinician', 'nurse', 'receptionist'].includes(r.trim()));
}

// ── Badge configs ──────────────────────────────────────────────────────────────

const PRIORITY_CFG: Record<string, { bg: string; color: string }> = {
  Normal:    { bg: 'var(--st-ok-bg)',       color: 'var(--st-ok)' },
  Urgent:    { bg: 'var(--badge-amber-bg)', color: 'var(--badge-amber-text)' },
  Emergency: { bg: 'var(--badge-red-bg)',   color: 'var(--badge-red-text)' },
};
const STATUS_CFG: Record<string, { bg: string; color: string }> = {
  Waiting:       { bg: 'var(--badge-gray-bg)',  color: 'var(--badge-gray-text)' },
  'In Progress': { bg: 'var(--badge-blue-bg)',  color: 'var(--badge-blue-text)' },
  Done:          { bg: 'var(--badge-green-bg)', color: 'var(--badge-green-text)' },
};
const sortEntries = sortQueue;

// ── Count badge ───────────────────────────────────────────────────────────────

function CountBadge({ count, style }: { count: number; style?: React.CSSProperties }) {
  return (
    <span style={{
      minWidth: 18, height: 18, borderRadius: 9, padding: '0 4px',
      fontSize: 10, fontWeight: 800, lineHeight: '18px', textAlign: 'center',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      background: count > 0 ? 'var(--ses-red)' : 'var(--bg-surface-2)',
      color: count > 0 ? '#fff' : 'var(--text-subtle)',
      flexShrink: 0,
      ...style,
    }}>
      {count}
    </span>
  );
}

// ── Which room's queue to look at ─────────────────────────────────────────────
// The panel shows YOUR service point. This one-line control lets you glance at another room (or all
// rooms) on demand — e.g. to pull in a patient who walked into your room — and brings you straight back.

function RoomViewSwitch({
  rooms, selectedRoom, myRoomId, onSelect,
}: {
  rooms: FacilityRoom[];
  selectedRoom: string | null;
  myRoomId?: string;
  onSelect: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const click = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', click);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', click); document.removeEventListener('keydown', key); };
  }, [open]);

  const current = selectedRoom ? rooms.find(r => r.id === selectedRoom) : null;
  const mine = myRoomId ? rooms.find(r => r.id === myRoomId) : null;
  const viewingMine = !!mine && selectedRoom === mine.id;
  const term = q.trim().toLowerCase();
  const matches = rooms
    .filter(r => r.id !== selectedRoom && (!term || `${r.name} ${r.tag}`.toLowerCase().includes(term)))
    .sort((a, b) => (a.id === myRoomId ? -1 : b.id === myRoomId ? 1 : a.name.localeCompare(b.name)));

  function pick(id: string | null) { onSelect(id); setOpen(false); setQ(''); }

  return (
    <div ref={ref} style={{ position: 'relative', padding: '8px 14px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--text-muted)' }}>
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {viewingMine ? 'Showing your room' : 'Showing'}{' '}
          <b style={{ color: 'var(--text-heading)' }}>{current ? current.name : 'all rooms'}</b>
        </span>
        {mine && !viewingMine && (
          <button onClick={() => pick(mine.id)} style={linkBtn}>Back to {mine.name}</button>
        )}
        <button onClick={() => setOpen(o => !o)} aria-expanded={open} style={linkBtn}>
          {open ? 'Close' : 'Other room'}
        </button>
      </div>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% - 2px)', left: 14, right: 14, zIndex: 20,
          background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10,
          boxShadow: '0 8px 28px rgba(0,0,0,0.18)', overflow: 'hidden',
        }}>
          <div style={{ position: 'relative', padding: 8, borderBottom: '1px solid var(--border-light)' }}>
            <Search size={12} style={{ position: 'absolute', left: 18, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-subtle)', pointerEvents: 'none' }} />
            <input
              autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search rooms…"
              style={{ width: '100%', boxSizing: 'border-box', padding: '7px 10px 7px 28px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, outline: 'none', background: 'var(--bg-surface)', color: 'var(--text-heading)' }}
            />
          </div>
          <div style={{ maxHeight: 240, overflowY: 'auto' }}>
            {!term && selectedRoom && (
              <button onClick={() => pick(null)} style={rowBtn}>
                <span style={{ flex: 1, fontWeight: 600 }}>All rooms</span>
              </button>
            )}
            {matches.length === 0 ? (
              <div style={{ padding: '14px 12px', fontSize: 12.5, color: 'var(--text-muted)', textAlign: 'center' }}>No room matches “{q}”.</div>
            ) : matches.map(r => (
              <button key={r.id} onClick={() => pick(r.id)} style={rowBtn}>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }}>
                  {r.name}{r.id === myRoomId && <span style={{ color: 'var(--ws-link)', fontWeight: 600 }}> · yours</span>}
                </span>
                <span style={{ fontSize: 11.5, color: 'var(--text-subtle)', whiteSpace: 'nowrap' }}>{r.tag} · {r.waitingCount} waiting</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const linkBtn: React.CSSProperties = {
  background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 12.5, fontWeight: 600, color: 'var(--ws-link)', whiteSpace: 'nowrap',
};
const rowBtn: React.CSSProperties = {
  width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', background: 'none', border: 'none',
  borderBottom: '1px solid var(--border-light)', cursor: 'pointer', fontSize: 13, color: 'var(--text-heading)', textAlign: 'left',
};

// ── Entry card ────────────────────────────────────────────────────────────────

function EntryCard({
  entry, rooms, onAdvance, onReroute, onStart, onRemove, myRoomId,
}: {
  entry: QueueEntry;
  myRoomId?: string;
  rooms: FacilityRoom[];
  onAdvance: (id: string, status: string) => void;
  onReroute: (id: string, roomId: string) => void;
  onStart: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const [showReroute, setShowReroute] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const now = useNow();
  const isDone = entry.status === 'Done';
  const isWaiting = entry.status === 'Waiting';
  const canAct = canModify();
  const elsewhere = !!myRoomId && entry.roomId !== myRoomId;
  const wait = waitMinutes(entry, now);
  const long = isWaiting && (wait ?? 0) >= 30;
  const pr = priorityStyle(entry.priority);
  const statusDot = isDone ? 'var(--text-subtle)' : isWaiting ? 'var(--ws-link)' : 'var(--st-ok)';
  const statusText = entry.status === 'In Progress'
    ? (entry.startedBy ? `With ${entry.startedBy.name}` : 'With clinician')
    : isDone ? 'Seen' : 'Waiting';

  return (
    <div className="qd-item" style={{ opacity: isDone ? 0.65 : 1 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span className="qd-no">{queueNum(entry.queueNumber)}</span>
          <span style={{ fontWeight: 600, color: 'var(--text-heading)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{entry.patientName}</span>
        </div>
        <div className="qd-sub" style={{ marginTop: 3 }}>{entry.room.name}</div>
        <div className="qd-sub" style={{ marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
          Arrived {arrivedAt(entry.checkedInAt)} · {isWaiting ? 'waiting' : 'waited'}{' '}
          <span style={{ fontWeight: long ? 700 : 400, color: long ? 'var(--st-warn)' : undefined }}>
            {wait === null ? '—' : wait < 1 ? '<1 min' : formatWait(wait)}
          </span>
        </div>
        <div style={{ marginTop: 8, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <span className="pr"><i style={{ background: pr.color }} />{priorityLabel(entry.priority)}</span>
          <span className="pr"><i style={{ background: statusDot }} />{statusText}</span>
        </div>

        {showReroute && (
          <div style={{ marginTop: 8 }}>
            <select
              autoFocus
              defaultValue=""
              onChange={e => {
                if (e.target.value) { onReroute(entry.id, e.target.value); setShowReroute(false); }
              }}
              className="qd-select"
            >
              <option value="" disabled>Move to room…</option>
              {rooms.filter(r => r.id !== entry.roomId).map(r => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {canAct && !isDone && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
          {isWaiting ? (
            <button
              className="qd-sec"
              onClick={() => onStart(entry.id)}
              title={elsewhere ? 'Take this patient into your room and start their visit' : 'Start the visit and open the patient'}
            >
              {elsewhere ? 'Attend here' : 'Start'}
            </button>
          ) : (
            <button className="qd-sec" onClick={() => onAdvance(entry.id, 'Done')} title="Mark as seen — takes them off the queue">
              <Check size={13} style={{ marginRight: 4, verticalAlign: -2 }} />Seen
            </button>
          )}
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              className="qd-x qd-bordered"
              type="button"
              onClick={() => setShowReroute(v => !v)}
              aria-label={`Transfer ${entry.patientName} to another room`}
              title="Transfer to another room"
              style={showReroute ? { background: 'var(--ws-chip)' } : undefined}
            >
              <CornerDownRight size={14} />
            </button>
            {confirmRemove ? (
              <button
                className="qd-x qd-bordered"
                onClick={() => { setConfirmRemove(false); onRemove(entry.id); }}
                onBlur={() => setConfirmRemove(false)}
                autoFocus
                title="Click again to remove from the queue"
                style={{ width: 'auto', padding: '0 8px', fontSize: 12, fontWeight: 700, color: 'var(--st-bad)', borderColor: 'var(--st-bad)' }}
              >
                Remove?
              </button>
            ) : (
              <button
                className="qd-x qd-bordered"
                onClick={() => setConfirmRemove(true)}
                aria-label={`Remove ${entry.patientName} from the queue`}
                title="Remove from the queue"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Check-in bar ──────────────────────────────────────────────────────────────

function CheckinBar({ onCheckedIn }: { onCheckedIn: () => void }) {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<PatientResult[]>([]);
  const [selected, setSelected] = useState<PatientResult | null>(null);
  const [existing, setExisting] = useState<QueueEntryInfo | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleSearch(q: string) {
    setSearch(q); setResults([]);
    if (timerRef.current) clearTimeout(timerRef.current);
    if (q.trim().length < 2) return;
    timerRef.current = setTimeout(async () => {
      try {
        const { data } = await api.get('/patients', { params: { search: q.trim() } });
        setResults(data.slice(0, 6));
      } catch { /* ignore */ }
    }, 250);
  }

  // Picking a patient opens the same quick "assign to a room" dialog used everywhere else.
  async function pickPatient(p: PatientResult) {
    setResults([]);
    try {
      const { data } = await api.get(`/queue/patient/${p.id}`);
      setExisting(data);
    } catch { setExisting(null); }
    setSelected(p);
  }

  function dismiss() { setSelected(null); setExisting(null); setSearch(''); setResults([]); }

  const fld: React.CSSProperties = {
    width: '100%', padding: '6px 10px', border: '1px solid var(--border)',
    borderRadius: 6, fontSize: 12.5, outline: 'none',
    background: 'var(--bg-input)', color: 'var(--text-heading)',
  };

  return (
    <div style={{ borderTop: '1px solid var(--border-light)', padding: '12px 20px 16px', background: 'var(--bg-card)', flexShrink: 0 }}>
      <div style={{ position: 'relative' }}>
        <label className="qd-find">
          <Search size={16} aria-hidden="true" />
          <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Find a patient to add to the queue</span>
          <input type="search" value={search} onChange={e => handleSearch(e.target.value)} placeholder="Find a patient to add" />
        </label>
        {results.length > 0 && (
          <div style={{ position: 'absolute', bottom: '100%', left: 0, right: 0, marginBottom: 4, background: 'var(--bg-card)', border: '1px solid var(--border-input)', borderRadius: 8, boxShadow: '0 -4px 16px rgba(0,0,0,0.12)', zIndex: 10, maxHeight: 180, overflowY: 'auto' }}>
            {results.map(p => (
              <button key={p.id} onClick={() => pickPatient(p)} style={{ width: '100%', textAlign: 'left', padding: '8px 12px', background: 'none', border: 'none', borderBottom: '1px solid var(--border-light)', cursor: 'pointer', fontSize: 12.5 }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-surface)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
                <span style={{ fontWeight: 600, color: 'var(--text-heading)' }}>{p.firstName} {p.lastName}</span>
                {p.nationalId && <span style={{ color: 'var(--text-muted)', marginLeft: 8, fontSize: 11 }}>{p.nationalId}</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {selected && (
        <AssignRoomModal
          patientId={selected.id}
          patientName={`${selected.firstName} ${selected.lastName}`}
          current={existing}
          onClose={dismiss}
          onDone={() => { dismiss(); onCheckedIn(); }}
          onRemoved={() => { dismiss(); onCheckedIn(); }}
        />
      )}
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

interface Props { open: boolean; onClose: () => void; }

export default function QueuePanel({ open, onClose }: Props) {
  const { isMobile } = useWindowSize();
  const { setActivePatient } = usePatient();
  const navigate = useNavigate();
  const sp = useServicePoint();
  const [calling, setCalling] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [doneEntries, setDoneEntries] = useState<QueueEntry[]>([]);
  const [doneCount, setDoneCount] = useState(0);
  const [rooms, setRooms] = useState<FacilityRoom[]>([]);
  const [entries, setEntries] = useState<QueueEntry[]>([]);
  const [selectedRoom, setSelectedRoom] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [tick, setTick] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Only people still waiting or being seen are loaded; the seen list is fetched on request.
  const fetchEntries = useCallback(async (roomId?: string | null) => {
    setLoading(true);
    try {
      const params = { status: 'active', limit: 300, ...(roomId ? { roomId } : {}) };
      const [list, sum] = await Promise.all([
        api.get('/queue', { params }),
        api.get('/queue/summary', { params: roomId ? { roomId } : {} }),
      ]);
      setEntries(list.data);
      setDoneCount(sum.data.done);
      if (showDone) {
        const done = await api.get('/queue', { params: { status: 'done', limit: 100, ...(roomId ? { roomId } : {}) } });
        setDoneEntries(done.data);
      }
      setLastUpdated(new Date());
    } catch { /* ignore */ } finally { setLoading(false); }
  }, [showDone]);

  const fetchRooms = useCallback(async () => {
    try {
      const { data } = await api.get('/queue/rooms');
      setRooms(data);
    } catch { /* ignore */ }
  }, []);

  // The panel opens on your own service point, and follows you if you switch rooms.
  useEffect(() => { setSelectedRoom(sp.room?.id ?? null); }, [sp.room?.id]);

  // Refresh everything when panel opens
  useEffect(() => {
    if (!open) return;
    fetchRooms();
    fetchEntries(selectedRoom);
  }, [open, selectedRoom, fetchEntries, fetchRooms]);

  // Poll every 30s while open and the tab is visible
  useVisiblePolling(() => {
    fetchRooms();
    fetchEntries(selectedRoom);
    setTick(t => t + 1);
  }, 30000, open);

  // A patient assigned from anywhere else in the app shows up straight away.
  useQueueChanged(() => { if (open) { fetchRooms(); fetchEntries(selectedRoom); } });

  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 10000);
    return () => clearInterval(t);
  }, []);

  function secsAgo(): string {
    if (!lastUpdated) return '';
    const s = Math.floor((Date.now() - lastUpdated.getTime()) / 1000);
    if (s < 10) return 'just now';
    if (s < 60) return `${s}s ago`;
    return `${Math.floor(s / 60)}m ago`;
  }

  async function handleAdvance(id: string, status: string) {
    try {
      await api.patch(`/queue/${id}/status`, { status });
      fetchEntries(selectedRoom);
      fetchRooms();
    } catch { /* ignore */ }
  }

  async function handleReroute(id: string, roomId: string) {
    try {
      await api.patch(`/queue/${id}/reroute`, { roomId });
      notifyQueueChanged();
      fetchEntries(selectedRoom);
      fetchRooms();
    } catch { /* ignore */ }
  }

  async function handleRemove(id: string) {
    try {
      await api.patch(`/queue/${id}/status`, { status: 'Removed' });
      notifyQueueChanged();
    } catch { /* the API client already explained what went wrong */ }
  }

  // Take whoever is first in line in your room (emergencies first), and open them.
  async function callNext() {
    if (!sp.room || calling) return;
    setCalling(true);
    try {
      const { data } = await api.post(`/queue/rooms/${sp.room.id}/next`);
      setActivePatient(data.patient as Patient);
      toast.success(`Now seeing ${data.patientName}`);
      notifyQueueChanged();
      onClose();
      navigate(`/patient/${data.patient.id}/vitals`);
    } catch (err: any) {
      if (err?.response) toast.error(err.response.data?.error ?? 'Could not call the next patient');
    } finally { setCalling(false); }
  }

  async function handleStart(id: string) {
    const entry = entries.find(e => e.id === id);
    const elsewhere = !!sp.room && !!entry && entry.roomId !== sp.room.id;
    try {
      const { data } = await api.patch(`/queue/${id}/start`, elsewhere ? { roomId: sp.room!.id } : {});
      if (elsewhere) toast.success(`${entry!.patientName} moved from ${entry!.room.name} to ${sp.room!.name}`);
      if (data.patient) { setActivePatient(data.patient as Patient); onClose(); navigate(`/patient/${data.patient.id}/vitals`); }
      // Record preference for this user+room pair
      if (entry?.roomId) {
        api.post('/queue/user-room-preference', { roomId: entry.roomId }).catch(() => {});
      }
      notifyQueueChanged();
      fetchEntries(selectedRoom);
      fetchRooms();
    } catch (err: any) {
      // e.g. "Dr Banda is already seeing this patient" — someone else got there first
      if (err?.response) toast.error(err.response.data?.error ?? 'Could not start this patient');
      fetchEntries(selectedRoom);
    }
  }

  const visible = sortEntries(entries);
  const activeCount = entries.length;
  const waitingList = visible.filter(e => e.status === 'Waiting');
  const withList = visible.filter(e => e.status === 'In Progress');
  const myRoom = sp.room;
  const showingMine = !!myRoom && selectedRoom === myRoom.id;

  return (
    <>
      {open && <div className="qd-scrim" onClick={onClose} aria-hidden="true" />}

      <aside
        className="qd"
        role="dialog"
        aria-modal="true"
        aria-labelledby="qd-t"
        aria-hidden={!open}
        style={{ width: isMobile ? '100vw' : 380, transform: open ? 'translateX(0)' : 'translateX(-105%)', visibility: open ? 'visible' : 'hidden' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 16px 12px 20px', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <h2 id="qd-t" style={{ margin: 0, fontFamily: 'var(--font-heading)', fontSize: 17, fontWeight: 700, color: 'var(--text-heading)' }}>Queue</h2>
            <span style={{ minWidth: 20, height: 20, padding: '0 6px', borderRadius: 10, background: '#C41E25', color: '#fff', fontSize: 12, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box' }}>
              {activeCount}
            </span>
            {lastUpdated && <span style={{ fontSize: 12, color: 'var(--text-subtle)' }}>Updated {secsAgo()}</span>}
          </div>
          <div style={{ display: 'flex', gap: 2 }}>
            <button className="qd-x" type="button" aria-label="Refresh queue" onClick={() => { fetchRooms(); fetchEntries(selectedRoom); }} disabled={loading}>
              <RefreshCw size={16} style={{ animation: loading ? 'qd-spin 1s linear infinite' : 'none' }} />
            </button>
            <button className="qd-x" type="button" aria-label="Close queue" onClick={onClose}><X size={18} /></button>
          </div>
        </div>

        <div style={{ padding: '0 20px 14px', display: 'flex', flexDirection: 'column', gap: 10, borderBottom: '1px solid var(--border-light)', flexShrink: 0 }}>
          <ServicePointPicker variant="panel" />
          {myRoom && canModify() ? (
            <button className="qd-call" onClick={callNext} disabled={calling}
              title="Takes the patient who is first in line in your room (emergencies first)">
              {calling ? 'Calling…' : 'Call next patient'} <span style={{ fontWeight: 500, opacity: 0.85 }}>· {myRoom.waitingCount} waiting</span>
            </button>
          ) : !myRoom ? (
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
              Choose your service point to see only your room’s patients and call the next one.
            </div>
          ) : null}
        </div>

        {/* Which room's queue to look at (defaults to your service point) */}
        <RoomViewSwitch rooms={rooms} selectedRoom={selectedRoom} myRoomId={myRoom?.id} onSelect={setSelectedRoom} />

        <div style={{ flex: 1, overflow: 'auto', padding: '14px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {loading && entries.length === 0 ? (
            <div style={{ textAlign: 'center', paddingTop: 40, color: 'var(--text-muted)', fontSize: 13 }}>Loading…</div>
          ) : visible.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '36px 0 8px' }}>
              <div style={{ fontSize: 14, color: 'var(--text-heading)', fontWeight: 600 }}>
                {showingMine ? `No one is waiting in ${myRoom!.name}` : 'The queue is empty'}
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>Use “Find a patient to add” below, or assign from a patient’s page.</div>
            </div>
          ) : (
            <>
              {waitingList.length > 0 && <div className="qd-h">Waiting · {waitingList.length}</div>}
              {waitingList.map(e => (
                <EntryCard key={e.id} entry={e} rooms={rooms} onAdvance={handleAdvance} onReroute={handleReroute} onStart={handleStart} onRemove={handleRemove} myRoomId={myRoom?.id} />
              ))}
              {withList.length > 0 && <div className="qd-h" style={{ marginTop: waitingList.length ? 6 : 0 }}>With clinician · {withList.length}</div>}
              {withList.map(e => (
                <EntryCard key={e.id} entry={e} rooms={rooms} onAdvance={handleAdvance} onReroute={handleReroute} onStart={handleStart} onRemove={handleRemove} myRoomId={myRoom?.id} />
              ))}
            </>
          )}

          {doneCount > 0 && (
            <div style={{ marginTop: 4 }}>
              <button
                className="qd-link"
                onClick={() => { const next = !showDone; setShowDone(next); if (next) { api.get('/queue', { params: { status: 'done', limit: 100, ...(selectedRoom ? { roomId: selectedRoom } : {}) } }).then(r => setDoneEntries(r.data)).catch(() => {}); } }}
              >
                {showDone ? 'Hide' : 'Show'} seen today ({doneCount})
              </button>
              {showDone && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
                  {doneEntries.map(e => (
                    <EntryCard key={e.id} entry={e} rooms={rooms} onAdvance={handleAdvance} onReroute={handleReroute} onStart={handleStart} onRemove={handleRemove} myRoomId={myRoom?.id} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {canModify() && (
          <CheckinBar onCheckedIn={() => { fetchEntries(selectedRoom); fetchRooms(); }} />
        )}
      </aside>

      <style>{DRAWER_CSS}</style>
    </>
  );
}

// Drawer styles — everything uses the theme tokens, so it follows light / charcoal / SES blue.
const DRAWER_CSS = `
.qd-scrim { position: fixed; inset: 0; z-index: 59; background: rgba(10,12,14,.45); }
.qd { position: fixed; left: 0; top: 0; height: 100vh; z-index: 60; background: var(--bg-card); color: var(--text-body); font-size: 14px;
  border-right: 1px solid var(--border); box-shadow: 16px 0 40px rgba(0,0,0,.25); display: flex; flex-direction: column; transition: transform .25s ease; }
.qd-h { font-size: 11px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: var(--text-subtle); }
.qd-x { width: 32px; height: 32px; border: 0; border-radius: 8px; background: transparent; color: var(--text-muted); display: inline-flex; align-items: center; justify-content: center; cursor: pointer; flex: none; }
.qd-x:hover:not(:disabled) { background: var(--ws-chip); color: var(--text-heading); }
.qd-bordered { border: 1px solid var(--btn2-line); }
.qd-call { height: 42px; border: 0; border-radius: 10px; background: #C41E25; color: #fff; font: inherit; font-size: 14px; font-weight: 700; cursor: pointer; transition: filter .15s; }
.qd-call:hover:not(:disabled) { filter: brightness(1.06); }
.qd-call:disabled { opacity: .7; cursor: wait; }
.qd-item { display: flex; gap: 12px; align-items: flex-start; padding: 12px 14px; border: 1px solid var(--border); border-radius: 12px; background: var(--bg-card); }
.qd-no { font-size: 12px; font-weight: 700; color: var(--text-muted); font-variant-numeric: tabular-nums; letter-spacing: .3px; }
.qd-sub { font-size: 12px; color: var(--text-muted); }
.qd-sec { height: 32px; padding: 0 12px; border: 1px solid var(--btn2-line); border-radius: 8px; background: var(--btn2); color: var(--text-heading); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; white-space: nowrap; }
.qd-sec:hover { background: var(--ws-chip); }
.pr { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; color: var(--text-muted); }
.pr i { width: 7px; height: 7px; border-radius: 50%; display: inline-block; }
.qd-link { width: 100%; padding: 8px 0; background: none; border: none; border-top: 1px solid var(--border-light); cursor: pointer; font: inherit; font-size: 12.5px; font-weight: 600; color: var(--text-muted); text-align: left; }
.qd-link:hover { color: var(--text-heading); }
.qd-select { width: 100%; height: 34px; padding: 0 8px; font-size: 13px; border: 1px solid var(--btn2-line); border-radius: 8px; background: var(--btn2); color: var(--text-heading); outline: none; }
.qd-find { display: flex; align-items: center; gap: 10px; height: 40px; padding: 0 12px; border: 1px solid var(--btn2-line); border-radius: 10px; background: var(--btn2); color: var(--text-subtle); }
.qd-find:focus-within { border-color: var(--ring); box-shadow: 0 0 0 4px var(--ring-glow); }
.qd-find input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; font: inherit; font-size: 14px; color: var(--text-heading); }
.qd-find input::placeholder { color: var(--text-subtle); }
@keyframes qd-spin { to { transform: rotate(360deg); } }
`;
