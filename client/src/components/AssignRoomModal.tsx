import { useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { X, Search, Loader2 } from 'lucide-react';
import api from '../api/client';
import { useServicePoint } from '../context/ServicePointContext';
import { PRIORITIES, Priority, notifyQueueChanged, ordinal, queueNo } from '../lib/queue';

interface Room { id: string; name: string; tag: string; waitingCount: number }
export interface QueueEntryInfo {
  id: string; queueNumber: number; roomId: string; priority: string; status: string;
  checkedInAt: string; startedAt?: string | null; startedBy?: { id: string; name: string } | null;
  room: { id: string; name: string; tag: string };
  position: number | null; ahead: number;
}

const SHORTLIST_AFTER = 8;   // with this many rooms or fewer, just list them all

// Assign the open patient to a room's queue — or move/re-prioritise them if they're already queued.
// Clicking a room is the whole job: it assigns straight away (Standard unless another urgency was chosen).
export default function AssignRoomModal({ patientId, patientName, patientMeta, current, onClose, onDone, onRemoved }: {
  patientId: string;
  patientName: string;
  patientMeta?: string;   // e.g. "Female · 46 yrs"
  current: QueueEntryInfo | null;
  onClose: () => void;
  onDone: (entry: QueueEntryInfo) => void;
  onRemoved?: () => void;
}) {
  const sp = useServicePoint();
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [frequent, setFrequent] = useState<string[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  // New assignments always start at Standard; re-assigning keeps the urgency they already have.
  const [priority, setPriority] = useState<Priority>((current?.priority as Priority) ?? 'Normal');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const busy = busyId !== null;

  useEffect(() => {
    api.get('/queue/rooms').then((r) => setRooms(r.data)).catch(() => setLoadError(true));
    api.get('/queue/user-room-preferences', { params: { limit: 5 } }).then((r) => setFrequent((r.data as Room[]).map((x) => x.id))).catch(() => {});
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  // What is shown, in order: [{ title, rooms }]. Searching gives one flat, best-match-first list.
  const sections = useMemo(() => {
    const all = rooms ?? [];
    const term = q.trim().toLowerCase();
    if (term) {
      const words = term.split(/\s+/);
      const hit = (r: Room) => words.every((w) => `${r.name} ${r.tag}`.toLowerCase().includes(w));
      const rank = (r: Room) => (r.name.toLowerCase().startsWith(term) ? 0 : r.tag.toLowerCase().startsWith(term) ? 1 : 2);
      const found = all.filter(hit).sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
      return [{ title: `${found.length} match${found.length === 1 ? '' : 'es'}`, rooms: found }];
    }
    const out: { title: string; rooms: Room[] }[] = [];
    const used = new Set<string>();
    const take = (list: Room[]) => list.filter((r) => !used.has(r.id) && (used.add(r.id), true));
    if (all.length > SHORTLIST_AFTER) {
      const mine = sp.room ? all.filter((r) => r.id === sp.room!.id) : [];
      if (mine.length) out.push({ title: 'Your room', rooms: take(mine) });
      const freq = frequent.map((id) => all.find((r) => r.id === id)).filter(Boolean) as Room[];
      const f = take(freq);
      if (f.length) out.push({ title: 'Frequently used', rooms: f });
    }
    const byTag = new Map<string, Room[]>();
    all.filter((r) => !used.has(r.id)).forEach((r) => byTag.set(r.tag, [...(byTag.get(r.tag) ?? []), r]));
    [...byTag.entries()].sort(([a], [b]) => a.localeCompare(b)).forEach(([tag, list]) => out.push({ title: tag, rooms: list }));
    return out.filter((s) => s.rooms.length > 0);
  }, [rooms, q, frequent, sp.room]);

  const options = useMemo(() => sections.flatMap((s) => s.rooms), [sections]);
  useEffect(() => { setActive(0); }, [q]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const isCurrent = (r: Room) => !!current && current.roomId === r.id && current.priority === priority;

  async function assign(room: Room) {
    if (busy || isCurrent(room)) return;
    setBusyId(room.id);
    setError('');
    const previous = current;
    try {
      const { data } = current
        ? await api.patch(`/queue/${current.id}/reroute`, { roomId: room.id, priority })
        : await api.post('/queue/checkin', { patientId, roomId: room.id, priority });
      notifyQueueChanged();
      const where = data.position && priority !== 'Emergency' ? `${ordinal(data.position)} in ${data.room.name}` : `first in line in ${data.room.name}`;

      // A one-click action needs an easy way back.
      toast((t) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 12 }}>
          <span><b>{patientName}</b> is {where}</span>
          <button type="button" style={{ border: 0, background: 'none', color: '#1F5F96', fontWeight: 500, cursor: 'pointer', font: 'inherit', padding: 0 }}
            onClick={async () => {
              toast.dismiss(t.id);
              try {
                if (previous) await api.patch(`/queue/${previous.id}/reroute`, { roomId: previous.roomId, priority: previous.priority });
                else await api.patch(`/queue/${data.id}/status`, { status: 'Removed' });
                notifyQueueChanged();
                toast.success('Undone');
              } catch { /* the API client already explained */ }
            }}>Undo</button>
        </span>
      ), { duration: 7000, icon: priority === 'Emergency' ? '🚨' : '✅' });

      onDone(data);
    } catch (err: any) {
      if (err?.response) setError(err.response.data?.error ?? 'Could not assign the patient. Try again.');
    } finally {
      setBusyId(null);
    }
  }

  async function remove() {
    if (!current || busy) return;
    setBusyId('remove');
    setError('');
    try {
      await api.patch(`/queue/${current.id}/status`, { status: 'Removed' });
      notifyQueueChanged();
      toast.success(`${patientName} removed from the queue`);
      onRemoved?.();
      onClose();
    } catch (err: any) {
      if (err?.response) setError(err.response.data?.error ?? 'Could not remove the patient. Try again.');
    } finally {
      setBusyId(null);
      setConfirmRemove(false);
    }
  }

  function onSearchKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, options.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (options[active]) assign(options[active]); }
  }

  const chosen = PRIORITIES.find((p) => p.value === priority)!;
  const DOT: Record<Priority, string> = { Normal: 'var(--st-ok)', Urgent: 'var(--st-warn)', Emergency: 'var(--st-bad)' };
  let rowIndex = -1;

  return (
    <div className="ar-scrim">
      <div role="dialog" aria-modal="true" aria-labelledby="ar-title" className="ar-card">
        <div className="ar-head">
          <div style={{ minWidth: 0 }}>
            <h2 id="ar-title" className="ar-title">{current ? 'Change room or priority' : 'Assign to room'}</h2>
            <p className="ar-sub">
              {patientName}{patientMeta ? ` · ${patientMeta}` : ''}
              {current && <> · now {queueNo(current.queueNumber)} in {current.room.name}{current.position ? `, ${ordinal(current.position)} in line` : ` (${current.status.toLowerCase()})`}</>}
            </p>
          </div>
          <button type="button" className="ar-x" aria-label="Close" onClick={onClose} disabled={busy}><X size={18} /></button>
        </div>

        <div className="ar-tools">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span id="ar-p" style={{ flex: 'none', fontSize: 13, fontWeight: 500, color: 'var(--text-muted)' }}>Priority</span>
            <div className="ar-seg" role="group" aria-labelledby="ar-p">
              {PRIORITIES.map((p) => (
                <button key={p.value} type="button" aria-pressed={priority === p.value} onClick={() => setPriority(p.value)} disabled={busy}>
                  <i style={{ background: DOT[p.value] }} />{p.label}
                </button>
              ))}
            </div>
          </div>
          <label className="ar-search">
            <Search size={16} aria-hidden="true" />
            <span className="sr-only">Search rooms</span>
            <input autoFocus type="search" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onSearchKey} disabled={busy}
              placeholder="Search rooms or departments" role="combobox" aria-expanded="true" aria-controls="ar-list" autoComplete="off" />
          </label>
        </div>

        <div ref={listRef} id="ar-list" role="listbox" aria-label="Rooms" className="ar-list">
          {loadError ? (
            <p className="ar-err" style={{ padding: '0 20px' }}>Couldn’t load the rooms. Check your connection and reopen this.</p>
          ) : rooms === null ? (
            <div style={{ padding: '4px 20px' }}><div className="ar-skel" /></div>
          ) : rooms.length === 0 ? (
            <p className="ar-muted" style={{ padding: '0 20px' }}>No rooms are set up yet. An admin can add them under Administration → Rooms.</p>
          ) : options.length === 0 ? (
            <div style={{ padding: '18px 20px', textAlign: 'center' }}>
              <p style={{ margin: '0 0 4px', fontWeight: 500, color: 'var(--text-heading)' }}>No room matches “{q}”</p>
              <button type="button" className="ar-link" onClick={() => setQ('')}>Clear search</button>
            </div>
          ) : sections.map((sec) => (
            <div key={sec.title}>
              <div className="ar-g">{sec.title}</div>
              {sec.rooms.map((r) => {
                rowIndex += 1;
                const i = rowIndex;
                const cur = !!current && current.roomId === r.id;
                const disabled = busy || isCurrent(r);
                return (
                  <button key={r.id} type="button" role="option" aria-selected={i === active} data-i={i} disabled={disabled}
                    className={`ar-r${i === active ? ' on' : ''}${cur ? ' cur' : ''}`}
                    onMouseEnter={() => setActive(i)} onClick={() => assign(r)}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                      <span className="ar-name">{r.name}</span>
                      {q.trim() && <span className="ar-chip">{r.tag}</span>}
                    </span>
                    {busyId === r.id
                      ? <Loader2 size={15} className="ar-spin" aria-label="Assigning" />
                      : cur ? <span className="ar-cur">Current</span>
                        : <span className="ar-w">{r.waitingCount} waiting</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {error && <p role="alert" className="ar-err" style={{ padding: '0 20px', margin: '6px 0 0' }}>{error}</p>}

        <div className="ar-foot">
          <span>
            Click a room to assign as <strong style={{ color: priority === 'Normal' ? 'var(--text-heading)' : DOT[priority] }}>{chosen.label}</strong>
          </span>
          <span className="ar-keys"><kbd>↑</kbd><kbd>↓</kbd> move <kbd>Enter</kbd> assign <kbd>Esc</kbd> close</span>
        </div>

        {current && (
          <div className="ar-rmrow">
            {confirmRemove ? (
              <>
                <span style={{ color: 'var(--text-muted)' }}>Take {patientName} off the queue?</span>
                <button type="button" className="ar-rm ar-rm-on" onClick={remove} disabled={busy}>Yes, remove</button>
                <button type="button" className="ar-link" onClick={() => setConfirmRemove(false)} disabled={busy}>Keep</button>
              </>
            ) : (
              <button type="button" className="ar-rm" onClick={() => setConfirmRemove(true)} disabled={busy}>Remove from queue</button>
            )}
          </div>
        )}
      </div>

      <style>{CSS}</style>
    </div>
  );
}

const CSS = `
.ar-scrim { position: fixed; inset: 0; z-index: 80; background: rgba(10,12,14,.45); display: flex; align-items: flex-start; justify-content: center; padding: 72px 16px 24px; overflow-y: auto; }
.ar-card { width: 100%; max-width: 560px; background: var(--bg-card); border: 1px solid var(--border); border-radius: 16px; box-shadow: 0 24px 64px rgba(0,0,0,.35); overflow: hidden; color: var(--text-body); font-size: 14px; display: flex; flex-direction: column; max-height: calc(100vh - 96px); }
.ar-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 18px 16px 14px 20px; border-bottom: 1px solid var(--border-light); }
.ar-title { margin: 0 0 2px; font-family: var(--font-heading); font-size: 17px; font-weight:500; color: var(--text-heading); }
.ar-sub { margin: 0; font-size: 13px; color: var(--text-muted); }
.ar-x { width: 32px; height: 32px; border: 0; border-radius: 8px; background: transparent; color: var(--text-muted); display: flex; align-items: center; justify-content: center; cursor: pointer; flex: none; }
.ar-x:hover { background: var(--ws-chip); color: var(--text-heading); }
.ar-tools { padding: 14px 20px 6px; display: flex; flex-direction: column; gap: 10px; }
.ar-seg { flex: 1; display: flex; padding: 3px; gap: 3px; border-radius: 10px; background: var(--ws-chip); }
.ar-seg button { flex: 1; height: 32px; border: 0; border-radius: 8px; background: transparent; color: var(--text-muted); font: inherit; font-size: 13px; font-weight:500; cursor: pointer;
  display: flex; align-items: center; justify-content: center; gap: 7px; }
.ar-seg button i { width: 7px; height: 7px; border-radius: 50%; display: inline-block; }
.ar-seg button[aria-pressed="true"] { background: var(--bg-card); color: var(--text-heading); box-shadow: 0 1px 2px rgba(0,0,0,.12), 0 0 0 1px var(--border); }
.ar-seg button:disabled { cursor: default; }
.ar-search { display: flex; align-items: center; gap: 10px; height: 40px; padding: 0 12px; border: 1px solid var(--btn2-line); border-radius: 10px; background: var(--btn2); color: var(--text-subtle); }
.ar-search:focus-within { border-color: var(--ring); box-shadow: 0 0 0 4px var(--ring-glow); }
.ar-search input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; font: inherit; font-size: 14px; color: var(--text-heading); }
.ar-search input::placeholder { color: var(--text-subtle); }
.ar-search input::-webkit-search-cancel-button { display: none; }
.ar-list { flex: 1; min-height: 60px; overflow-y: auto; padding-bottom: 8px; }
.ar-g { padding: 12px 20px 4px; font-size: 11px; font-weight:500; letter-spacing: 1px; text-transform: uppercase; color: var(--text-subtle); }
.ar-r { display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%; height: 40px; padding: 0 20px; border: 0; background: transparent; color: var(--text-heading);
  font: inherit; font-size: 14px; cursor: pointer; text-align: left; }
.ar-r.on { background: var(--ws-chip); box-shadow: inset 3px 0 0 var(--ws-link); }
.ar-r:disabled { cursor: default; }
.ar-r.cur { opacity: .8; }
.ar-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ar-chip { padding: 1px 9px; border: 1px solid var(--border); border-radius: 999px; font-size: 12px; font-weight:500; color: var(--text-muted); white-space: nowrap; }
.ar-w { font-size: 12px; color: var(--text-subtle); font-variant-numeric: tabular-nums; white-space: nowrap; }
.ar-cur { font-size: 12px; font-weight:500; color: var(--ws-link); }
.ar-spin { animation: ar-rot 1s linear infinite; }
@keyframes ar-rot { to { transform: rotate(360deg); } }
.ar-muted { margin: 0; color: var(--text-muted); }
.ar-err { margin: 12px 0 0; font-size: 13px; font-weight:500; color: var(--st-bad); }
.ar-skel { height: 92px; border-radius: 10px; background: var(--ws-chip); animation: ar-pulse 1.2s ease-in-out infinite; }
@keyframes ar-pulse { 50% { opacity: .5; } }
.ar-foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; padding: 10px 20px; border-top: 1px solid var(--border-light); background: var(--ws-head); font-size: 12px; color: var(--text-muted); }
.ar-keys { display: flex; align-items: center; gap: 6px; }
.ar-keys kbd { font-family: inherit; font-size: 11px; color: var(--text-subtle); border: 1px solid var(--border); border-radius: 5px; padding: 0 5px; background: var(--ws-head); }
.ar-rmrow { display: flex; align-items: center; gap: 10px; padding: 8px 20px 12px; background: var(--ws-head); font-size: 13px; }
.ar-rm { height: 30px; padding: 0 2px; border: 0; background: none; color: var(--st-bad); font: inherit; font-size: 13px; font-weight:500; cursor: pointer; }
.ar-rm:hover:not(:disabled) { text-decoration: underline; }
.ar-rm-on { padding: 0 12px; border: 1px solid var(--st-bad); border-radius: 8px; }
.ar-rm-on:hover:not(:disabled) { background: var(--st-bad-bg); text-decoration: none; }
.ar-link { border: 0; background: none; color: var(--ws-link); font: inherit; font-size: 13px; font-weight:500; cursor: pointer; }
.ar-link:hover { text-decoration: underline; }
@media (max-width: 560px) { .ar-scrim { padding-top: 24px; } .ar-keys { display: none; } .ar-head, .ar-tools, .ar-foot, .ar-rmrow { padding-left: 16px; padding-right: 16px; } .ar-r, .ar-g { padding-left: 16px; padding-right: 16px; } }
`;
