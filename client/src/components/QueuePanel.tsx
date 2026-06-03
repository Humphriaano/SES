import { useState, useEffect, useRef, useCallback } from 'react';
import {
  X, RefreshCw, Play, Check, CornerDownRight, UserPlus, Search,
  Activity, Stethoscope, Pill, FlaskConical, Receipt, DoorOpen,
} from 'lucide-react';
import { useWindowSize } from '../hooks/useWindowSize';
import api from '../api/client';
import { usePatient } from '../context/PatientContext';
import { Patient } from '../types';

// ── Types ─────────────────────────────────────────────────────────────────────

interface FacilityRoom { id: string; name: string; tag: string; active: boolean; waitingCount: number; }
interface PreferredRoom extends FacilityRoom { pickCount: number; }
interface QueueEntry {
  id: string; queueNumber: number; patientId: string; patientName: string;
  roomId: string; room: FacilityRoom;
  priority: string; status: string; checkedInAt: string; updatedAt: string;
  patient?: Patient;
}
interface PatientResult { id: string; firstName: string; lastName: string; nationalId: string | null; }

// ── Helpers ───────────────────────────────────────────────────────────────────

function queueNum(n: number): string { return `Q${String(n).padStart(3, '0')}`; }

function waitTime(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60), m = mins % 60;
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

function getUserRole(): string {
  try { return JSON.parse(localStorage.getItem('user') || '{}').role ?? ''; } catch { return ''; }
}
function getUserId(): string {
  try { return JSON.parse(localStorage.getItem('user') || '{}').id ?? ''; } catch { return ''; }
}
function canModify(): boolean {
  return getUserRole().split(',').some(r => ['admin', 'clinician', 'nurse', 'receptionist'].includes(r.trim()));
}

// ── Tag → icon mapping ────────────────────────────────────────────────────────

type LucideIcon = React.ComponentType<{ size?: number; color?: string; style?: React.CSSProperties }>;

function tagIcon(tag: string): LucideIcon {
  const t = tag.toLowerCase();
  if (t.includes('triage')) return Activity;
  if (t.includes('opd') || t.includes('consult')) return Stethoscope;
  if (t.includes('pharm')) return Pill;
  if (t.includes('lab')) return FlaskConical;
  if (t.includes('bill') || t.includes('receip') || t.includes('financ')) return Receipt;
  return DoorOpen;
}

// ── Badge configs ──────────────────────────────────────────────────────────────

const PRIORITY_CFG: Record<string, { bg: string; color: string }> = {
  Normal:    { bg: 'var(--badge-gray-bg)',  color: 'var(--badge-gray-text)' },
  Urgent:    { bg: 'var(--badge-amber-bg)', color: 'var(--badge-amber-text)' },
  Emergency: { bg: 'var(--badge-red-bg)',   color: 'var(--badge-red-text)' },
};
const STATUS_CFG: Record<string, { bg: string; color: string }> = {
  Waiting:       { bg: 'var(--badge-gray-bg)',  color: 'var(--badge-gray-text)' },
  'In Progress': { bg: 'var(--badge-blue-bg)',  color: 'var(--badge-blue-text)' },
  Done:          { bg: 'var(--badge-green-bg)', color: 'var(--badge-green-text)' },
};
const PRIORITY_ORDER: Record<string, number> = { Emergency: 0, Urgent: 1, Normal: 2 };
const STATUS_ORDER: Record<string, number>   = { Waiting: 0, 'In Progress': 1, Done: 2 };

function sortEntries(entries: QueueEntry[]): QueueEntry[] {
  return [...entries].sort((a, b) => {
    const sd = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (sd !== 0) return sd;
    const pd = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
    if (pd !== 0) return pd;
    return a.queueNumber - b.queueNumber;
  });
}

// ── Count badge ───────────────────────────────────────────────────────────────

function CountBadge({ count, style }: { count: number; style?: React.CSSProperties }) {
  return (
    <span style={{
      minWidth: 18, height: 18, borderRadius: 9, padding: '0 4px',
      fontSize: 10, fontWeight: 800, lineHeight: '18px', textAlign: 'center',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      background: count > 0 ? '#c8102e' : 'var(--bg-surface-2)',
      color: count > 0 ? '#fff' : 'var(--text-subtle)',
      flexShrink: 0,
      ...style,
    }}>
      {count}
    </span>
  );
}

// ── Room card (preferred + search results) ────────────────────────────────────

function RoomCard({
  room, liveCount, active, size, onClick,
}: {
  room: FacilityRoom | PreferredRoom;
  liveCount: number;
  active: boolean;
  size: 'preferred' | 'search';
  onClick: () => void;
}) {
  const Icon = tagIcon(room.tag);
  const isPreferred = size === 'preferred';
  return (
    <button
      onClick={onClick}
      style={{
        width: '100%', height: isPreferred ? 76 : 64,
        border: `1.5px solid ${active ? '#c8102e' : 'var(--border)'}`,
        borderRadius: 10,
        background: active ? 'var(--chip-red-bg)' : 'var(--bg-card)',
        cursor: 'pointer', textAlign: 'left',
        padding: isPreferred ? '9px 10px' : '7px 9px',
        position: 'relative', transition: 'border-color 0.12s, background 0.12s',
        display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
      }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.borderColor = 'var(--text-muted)'; }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.borderColor = 'var(--border)'; }}
    >
      {/* Count badge — top right */}
      <div style={{ position: 'absolute', top: 6, right: 7 }}>
        <CountBadge count={liveCount} />
      </div>

      {/* Icon row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, paddingRight: 26 }}>
        <Icon size={isPreferred ? 13 : 11} color={active ? '#c8102e' : 'var(--text-muted)'} />
      </div>

      {/* Name + tag */}
      <div>
        <div style={{
          fontSize: isPreferred ? 12 : 11, fontWeight: 700, lineHeight: 1.25,
          color: active ? '#c8102e' : 'var(--text-heading)',
          overflow: 'hidden', display: '-webkit-box',
          WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
          paddingRight: 4,
        }}>
          {room.name}
        </div>
        <div style={{ fontSize: 9.5, color: 'var(--text-subtle)', marginTop: 1 }}>{room.tag}</div>
      </div>
    </button>
  );
}

// ── Room selector ─────────────────────────────────────────────────────────────

function RoomSelector({
  rooms, preferredRooms, entries, selectedRoom, onSelect,
}: {
  rooms: FacilityRoom[];
  preferredRooms: PreferredRoom[];
  entries: QueueEntry[];
  selectedRoom: string | null;
  onSelect: (id: string | null) => void;
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  const totalActiveCount = entries.filter(e => e.status !== 'Done').length;
  const activeRoomData = selectedRoom ? rooms.find(r => r.id === selectedRoom) : null;

  const filteredRooms = searchQuery
    ? rooms.filter(r => r.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : [];

  // Live counts from the rooms array (which refreshes every 30s)
  function liveCount(roomId: string): number {
    return rooms.find(r => r.id === roomId)?.waitingCount ?? 0;
  }

  // Close search dropdown on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowSearch(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  function selectRoom(id: string | null) {
    onSelect(id);
    setSearchQuery('');
    setShowSearch(false);
  }

  return (
    <div style={{ padding: '10px 14px 12px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
      {/* All chip + active room chip */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
        <button
          onClick={() => selectRoom(null)}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            padding: '4px 10px', borderRadius: 20, fontSize: 12, fontWeight: 700,
            border: `1.5px solid ${!selectedRoom ? '#c8102e' : 'var(--border)'}`,
            background: !selectedRoom ? '#c8102e' : 'var(--bg-surface)',
            color: !selectedRoom ? '#fff' : 'var(--text-body)',
            cursor: 'pointer', flexShrink: 0,
          }}
        >
          All
          <span style={{
            fontSize: 10, fontWeight: 800, padding: '1px 5px', borderRadius: 8,
            background: !selectedRoom ? 'rgba(255,255,255,0.25)' : 'var(--bg-surface-2)',
            color: !selectedRoom ? '#fff' : 'var(--text-subtle)',
          }}>
            {totalActiveCount}
          </span>
        </button>

        {/* Active room chip */}
        {selectedRoom && activeRoomData && (
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            padding: '4px 6px 4px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600,
            background: '#c8102e', color: '#fff',
            maxWidth: 180,
          }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
              {activeRoomData.name}
            </span>
            {activeRoomData.waitingCount > 0 && (
              <span style={{ fontSize: 10, fontWeight: 800, background: 'rgba(255,255,255,0.25)', padding: '1px 5px', borderRadius: 8, flexShrink: 0 }}>
                {activeRoomData.waitingCount}
              </span>
            )}
            <button
              onClick={() => selectRoom(null)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#fff', display: 'flex', alignItems: 'center', padding: '0 2px', flexShrink: 0 }}
            >
              <X size={11} />
            </button>
          </div>
        )}
      </div>

      {/* Preferred rooms — shown when no search is active */}
      {preferredRooms.length > 0 && !searchQuery && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 7 }}>
            Your Rooms
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7 }}>
            {preferredRooms.map(pr => (
              <RoomCard
                key={pr.id}
                room={pr}
                liveCount={liveCount(pr.id)}
                active={selectedRoom === pr.id}
                size="preferred"
                onClick={() => selectRoom(pr.id)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Search */}
      <div ref={searchRef} style={{ marginTop: 10, position: 'relative' }}>
        <div style={{ position: 'relative' }}>
          <Search size={12} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-subtle)', pointerEvents: 'none' }} />
          <input
            value={searchQuery}
            onChange={e => { setSearchQuery(e.target.value); setShowSearch(true); }}
            onFocus={() => setShowSearch(true)}
            placeholder="Search all rooms…"
            style={{
              width: '100%', boxSizing: 'border-box',
              padding: '6px 28px 6px 27px',
              border: '1px solid var(--border)',
              borderRadius: 8, fontSize: 12.5, outline: 'none',
              background: 'var(--bg-surface)', color: 'var(--text-heading)',
              transition: 'border-color 0.15s',
            }}
            onFocus={(e) => (e.currentTarget.style.borderColor = '#c8102e')}
            onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
          />
          {searchQuery && (
            <button
              onMouseDown={e => { e.preventDefault(); setSearchQuery(''); setShowSearch(false); }}
              style={{ position: 'absolute', right: 7, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}
            >
              <X size={11} />
            </button>
          )}
        </div>

        {/* Search results dropdown */}
        {showSearch && searchQuery && (
          <div style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
            background: 'var(--bg-card)', border: '1px solid var(--border)',
            borderRadius: 10, boxShadow: '0 6px 24px rgba(0,0,0,0.14)',
            zIndex: 20, padding: 10, maxHeight: 220, overflowY: 'auto',
          }}>
            {filteredRooms.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--text-subtle)', textAlign: 'center', padding: '10px 0' }}>
                No rooms match "{searchQuery}"
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                {filteredRooms.map(room => (
                  <RoomCard
                    key={room.id}
                    room={room}
                    liveCount={liveCount(room.id)}
                    active={selectedRoom === room.id}
                    size="search"
                    onClick={() => selectRoom(room.id)}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Entry card ────────────────────────────────────────────────────────────────

function EntryCard({
  entry, rooms, onAdvance, onReroute, onStart,
}: {
  entry: QueueEntry;
  rooms: FacilityRoom[];
  onAdvance: (id: string, status: string) => void;
  onReroute: (id: string, roomId: string) => void;
  onStart: (id: string) => void;
}) {
  const [showReroute, setShowReroute] = useState(false);
  const pCfg = PRIORITY_CFG[entry.priority] ?? PRIORITY_CFG.Normal;
  const sCfg = STATUS_CFG[entry.status] ?? STATUS_CFG.Waiting;
  const isDone = entry.status === 'Done';
  const isWaiting = entry.status === 'Waiting';
  const canAct = canModify();

  return (
    <div style={{
      background: isDone ? 'var(--bg-surface)' : 'var(--bg-card)',
      border: '1px solid var(--border)', borderRadius: 10,
      padding: '10px 12px', marginBottom: 6,
      opacity: isDone ? 0.65 : 1, transition: 'opacity 0.15s',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 3 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#c8102e', fontFamily: 'monospace' }}>
              {queueNum(entry.queueNumber)}
            </span>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-heading)', flex: 1 }}>
              {entry.patientName}
            </span>
            <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 10, background: pCfg.bg, color: pCfg.color }}>
              {entry.priority}
            </span>
          </div>

          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
            {entry.room.name}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, color: 'var(--text-subtle)' }}>{waitTime(entry.checkedInAt)}</span>
            <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 10, background: sCfg.bg, color: sCfg.color }}>
              {entry.status}
            </span>
          </div>

          {showReroute && (
            <div style={{ marginTop: 8 }}>
              <select
                autoFocus
                defaultValue=""
                onChange={e => {
                  if (e.target.value) { onReroute(entry.id, e.target.value); setShowReroute(false); }
                }}
                style={{
                  width: '100%', padding: '5px 8px', fontSize: 12,
                  border: '1px solid var(--border)', borderRadius: 6,
                  background: 'var(--bg-input)', color: 'var(--text-heading)', outline: 'none',
                }}
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0 }}>
            {isWaiting ? (
              <button
                onClick={() => onStart(entry.id)}
                title="Start — set as active patient"
                style={{
                  height: 28, padding: '0 10px', borderRadius: 7, border: 'none',
                  background: '#c8102e', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 4,
                  color: '#fff', fontSize: 11, fontWeight: 700,
                }}
              >
                <Play size={11} /> Start
              </button>
            ) : (
              <button
                onClick={() => onAdvance(entry.id, 'Done')}
                title="Mark as Done"
                style={{
                  width: 28, height: 28, borderRadius: 7,
                  border: '1px solid var(--border)', background: 'var(--bg-surface)',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: 'var(--badge-green-text)',
                }}
              >
                <Check size={12} />
              </button>
            )}
            <button
              onClick={() => setShowReroute(v => !v)}
              title="Move to another room"
              style={{
                width: 28, height: 28, borderRadius: 7,
                border: '1px solid var(--border)',
                background: showReroute ? 'var(--bg-surface-2)' : 'var(--bg-surface)',
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'var(--text-muted)',
              }}
            >
              <CornerDownRight size={12} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Check-in bar ──────────────────────────────────────────────────────────────

function CheckinBar({ rooms, onCheckedIn }: { rooms: FacilityRoom[]; onCheckedIn: () => void }) {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<PatientResult[]>([]);
  const [selected, setSelected] = useState<PatientResult | null>(null);
  const [roomId, setRoomId] = useState('');
  const [priority, setPriority] = useState<'Normal' | 'Urgent' | 'Emergency'>('Normal');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
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
    }, 300);
  }

  function pickPatient(p: PatientResult) { setSelected(p); setSearch(`${p.firstName} ${p.lastName}`); setResults([]); }
  function dismiss() { setSelected(null); setSearch(''); setResults([]); setRoomId(''); setPriority('Normal'); setError(''); }

  async function checkin() {
    if (!selected || !roomId) { setError('Select a patient and room'); return; }
    setSaving(true); setError('');
    try {
      await api.post('/queue/checkin', { patientId: selected.id, roomId, priority });
      dismiss(); onCheckedIn();
    } catch (err: any) {
      setError(err?.response?.data?.error ?? 'Check-in failed');
    } finally { setSaving(false); }
  }

  const fld: React.CSSProperties = {
    width: '100%', padding: '6px 10px', border: '1px solid var(--border)',
    borderRadius: 6, fontSize: 12.5, outline: 'none',
    background: 'var(--bg-input)', color: 'var(--text-heading)',
  };

  return (
    <div style={{ borderTop: '1px solid var(--border)', padding: '12px 14px', background: 'var(--bg-card)', flexShrink: 0 }}>
      <div style={{ position: 'relative' }}>
        <Search size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-subtle)', pointerEvents: 'none' }} />
        <input value={search} onChange={e => handleSearch(e.target.value)} placeholder="Search patient to check in…" style={{ ...fld, paddingLeft: 32 }} />
        {selected && (
          <button onClick={dismiss} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}>
            <X size={13} />
          </button>
        )}
        {results.length > 0 && !selected && (
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
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <select value={roomId} onChange={e => setRoomId(e.target.value)} style={fld}>
            <option value="">Select room…</option>
            {rooms.map(r => <option key={r.id} value={r.id}>{r.name} ({r.tag})</option>)}
          </select>
          <div style={{ display: 'flex', gap: 6 }}>
            {(['Normal', 'Urgent', 'Emergency'] as const).map(p => {
              const cfg = PRIORITY_CFG[p]; const active = priority === p;
              return (
                <button key={p} onClick={() => setPriority(p)} style={{ flex: 1, padding: '5px 0', fontSize: 12, fontWeight: 600, borderRadius: 6, cursor: 'pointer', border: `1px solid ${active ? cfg.color : 'var(--border)'}`, background: active ? cfg.bg : 'var(--bg-surface)', color: active ? cfg.color : 'var(--text-muted)', transition: 'all 0.12s' }}>
                  {p}
                </button>
              );
            })}
          </div>
          {error && <div style={{ fontSize: 11.5, color: 'var(--badge-red-text)' }}>{error}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={checkin} disabled={saving || !roomId} style={{ flex: 1, padding: '7px 0', borderRadius: 6, fontSize: 13, fontWeight: 700, border: 'none', cursor: saving || !roomId ? 'not-allowed' : 'pointer', background: saving || !roomId ? 'var(--border-input)' : '#c8102e', color: saving || !roomId ? 'var(--text-subtle)' : '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <UserPlus size={13} /> {saving ? 'Checking in…' : 'Check In'}
            </button>
            <button onClick={dismiss} style={{ padding: '7px 12px', borderRadius: 6, fontSize: 12, border: '1px solid var(--border)', background: 'var(--bg-surface)', color: 'var(--text-muted)', cursor: 'pointer' }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

interface Props { open: boolean; onClose: () => void; }

export default function QueuePanel({ open, onClose }: Props) {
  const { isMobile } = useWindowSize();
  const { setActivePatient } = usePatient();
  const [rooms, setRooms] = useState<FacilityRoom[]>([]);
  const [preferredRooms, setPreferredRooms] = useState<PreferredRoom[]>([]);
  const [entries, setEntries] = useState<QueueEntry[]>([]);
  const [selectedRoom, setSelectedRoom] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [tick, setTick] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchEntries = useCallback(async (roomId?: string | null) => {
    setLoading(true);
    try {
      const params = roomId ? { roomId } : {};
      const { data } = await api.get('/queue', { params });
      setEntries(data);
      setLastUpdated(new Date());
    } catch { /* ignore */ } finally { setLoading(false); }
  }, []);

  const fetchRooms = useCallback(async () => {
    try {
      const { data } = await api.get('/queue/rooms');
      setRooms(data);
    } catch { /* ignore */ }
  }, []);

  const fetchPreferences = useCallback(async () => {
    try {
      const { data } = await api.get('/queue/user-room-preferences');
      setPreferredRooms(data);
    } catch { /* ignore */ }
  }, []);

  // Refresh everything when panel opens
  useEffect(() => {
    if (!open) return;
    fetchRooms();
    fetchEntries(selectedRoom);
    fetchPreferences();
  }, [open, selectedRoom, fetchEntries, fetchRooms, fetchPreferences]);

  // Poll every 30s while open
  useEffect(() => {
    if (!open) { if (intervalRef.current) clearInterval(intervalRef.current); return; }
    intervalRef.current = setInterval(() => {
      fetchRooms();
      fetchEntries(selectedRoom);
      setTick(t => t + 1);
    }, 30000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [open, selectedRoom, fetchEntries, fetchRooms]);

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
      fetchEntries(selectedRoom);
      fetchRooms();
    } catch { /* ignore */ }
  }

  async function handleStart(id: string) {
    const entry = entries.find(e => e.id === id);
    try {
      const { data } = await api.patch(`/queue/${id}/start`);
      if (data.patient) setActivePatient(data.patient as Patient);
      // Record preference for this user+room pair
      if (entry?.roomId) {
        api.post('/queue/user-room-preference', { roomId: entry.roomId }).catch(() => {});
      }
      fetchEntries(selectedRoom);
      fetchRooms();
      fetchPreferences();
    } catch { /* ignore */ }
  }

  const visible = sortEntries(entries);
  const activeCount = entries.filter(e => e.status !== 'Done').length;
  const userId = getUserId();

  return (
    <>
      {open && (
        <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 44, background: 'rgba(0,0,0,0.25)', backdropFilter: 'blur(1px)' }} />
      )}

      <div style={{
        position: 'fixed', top: 52, left: 0,
        width: isMobile ? '100vw' : 350,
        height: 'calc(100vh - 52px)',
        background: 'var(--bg-card)', borderRight: '1px solid var(--border)',
        boxShadow: '4px 0 24px rgba(0,0,0,0.12)', zIndex: 45,
        display: 'flex', flexDirection: 'column',
        transform: open ? 'translateX(0)' : 'translateX(-100%)',
        transition: 'transform 0.25s ease',
      }}>
        {/* Header */}
        <div style={{ padding: '12px 14px 10px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-heading)' }}>Patient Queue</span>
              <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 7px', borderRadius: 10, background: '#c8102e', color: '#fff' }}>
                {activeCount}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <button onClick={() => { fetchRooms(); fetchEntries(selectedRoom); }} disabled={loading} style={{ padding: 5, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', borderRadius: 5, display: 'flex' }}>
                <RefreshCw size={13} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
              </button>
              <button onClick={onClose} style={{ padding: 5, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', borderRadius: 5, display: 'flex' }}>
                <X size={15} />
              </button>
            </div>
          </div>
          {lastUpdated && (
            <div style={{ fontSize: 10, color: 'var(--text-faint)' }}>Updated {secsAgo()}</div>
          )}
        </div>

        {/* Room selector */}
        <RoomSelector
          rooms={rooms}
          preferredRooms={userId ? preferredRooms : []}
          entries={entries}
          selectedRoom={selectedRoom}
          onSelect={setSelectedRoom}
        />

        {/* Queue list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '10px 14px' }}>
          {loading && entries.length === 0 ? (
            <div style={{ textAlign: 'center', paddingTop: 40, color: 'var(--text-muted)', fontSize: 13 }}>Loading…</div>
          ) : visible.length === 0 ? (
            <div style={{ textAlign: 'center', paddingTop: 40 }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>🪑</div>
              <div style={{ fontSize: 13, color: 'var(--text-heading)', fontWeight: 600 }}>Queue is empty</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>Check in a patient below to get started.</div>
            </div>
          ) : (
            <>
              {visible.filter(e => e.status !== 'Done').length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                    Active ({visible.filter(e => e.status !== 'Done').length})
                  </div>
                  {visible.filter(e => e.status !== 'Done').map(e => (
                    <EntryCard key={e.id} entry={e} rooms={rooms} onAdvance={handleAdvance} onReroute={handleReroute} onStart={handleStart} />
                  ))}
                </div>
              )}
              {visible.filter(e => e.status === 'Done').length > 0 && (
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                    Done ({visible.filter(e => e.status === 'Done').length})
                  </div>
                  {visible.filter(e => e.status === 'Done').map(e => (
                    <EntryCard key={e.id} entry={e} rooms={rooms} onAdvance={handleAdvance} onReroute={handleReroute} onStart={handleStart} />
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Check-in bar */}
        {canModify() && (
          <CheckinBar rooms={rooms} onCheckedIn={() => { fetchEntries(selectedRoom); fetchRooms(); }} />
        )}
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </>
  );
}
