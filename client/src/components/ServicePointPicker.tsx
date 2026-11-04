import { useEffect, useMemo, useRef, useState } from 'react';
import { MapPin, ChevronDown, Check } from 'lucide-react';
import { useServicePoint } from '../context/ServicePointContext';

// "Service point: Consultation Room 1 ▾" — the room this staff member is working in.
export default function ServicePointPicker({ variant = 'bar' }: { variant?: 'bar' | 'panel' }) {
  const { rooms, room, setRoomId } = useServicePoint();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const click = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', click);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', click); document.removeEventListener('keydown', key); };
  }, [open]);

  const groups = useMemo(() => {
    const m = new Map<string, typeof rooms>();
    rooms.forEach((r) => m.set(r.tag, [...(m.get(r.tag) ?? []), r]));
    return [...m.entries()];
  }, [rooms]);

  return (
    <div ref={ref} className={`sp sp-${variant}`}>
      <button type="button" className="sp-btn" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        title="The room or department you are working in. Your queue shows only this room.">
        <MapPin size={15} aria-hidden="true" />
        <span className="sp-lbl">Service point:</span>
        <span className="sp-val">{room ? room.name : 'Select…'}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>

      {open && (
        <div className="sp-menu" role="listbox" aria-label="Service point">
          <div className="sp-h">Where are you working?</div>
          {groups.length === 0 && <div className="sp-empty">No rooms are set up yet. An admin can add them under Administration → Rooms.</div>}
          <div style={{ maxHeight: 340, overflowY: 'auto' }}>
            {groups.map(([tag, list]) => (
              <div key={tag}>
                <div className="sp-tag">{tag}</div>
                {list.map((r) => (
                  <button key={r.id} type="button" role="option" aria-selected={room?.id === r.id} className={`sp-opt${room?.id === r.id ? ' on' : ''}`}
                    onClick={() => { setRoomId(r.id); setOpen(false); }}>
                    <span style={{ flex: 1, textAlign: 'left', fontWeight: 500 }}>{r.name}</span>
                    <span className="sp-n">{r.waitingCount} waiting</span>
                    {room?.id === r.id && <Check size={15} aria-hidden="true" />}
                  </button>
                ))}
              </div>
            ))}
          </div>
          {room && <button type="button" className="sp-clear" onClick={() => { setRoomId(null); setOpen(false); }}>Not working in a room (see all)</button>}
        </div>
      )}

      <style>{`
        .sp { position: relative; flex: none; }
        .sp-btn { display: flex; align-items: center; gap: 8px; height: 38px; padding: 0 12px; border-radius: 10px; font: inherit; font-size: 13px; cursor: pointer;
          border: 1px solid var(--bar-line); background: transparent; color: var(--bar-text); transition: background .15s; }
        .sp-btn:hover { background: rgba(255,255,255,.08); }
        .sp-lbl { color: var(--bar-muted); }
        .sp-val { font-weight:500; max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .sp-panel .sp-btn { width: 100%; height: 40px; border-color: var(--border); background: var(--bg-surface); color: var(--text-heading); }
        .sp-panel .sp-btn:hover { background: var(--ws-chip); }
        .sp-panel .sp-lbl { color: var(--text-muted); }
        .sp-panel .sp-val { flex: 1; text-align: left; max-width: none; }
        .sp-menu { position: absolute; top: calc(100% + 8px); right: 0; width: 320px; max-width: 92vw; z-index: 70; background: var(--bg-card); color: var(--text-heading);
          border: 1px solid var(--border); border-radius: 14px; box-shadow: 0 18px 48px rgba(0,0,0,.28); overflow: hidden; }
        .sp-panel .sp-menu { left: 0; right: auto; width: 100%; }
        .sp-h { padding: 12px 16px 8px; font-size: 11px; font-weight:500; letter-spacing: 1px; text-transform: uppercase; color: var(--text-subtle); }
        .sp-tag { padding: 8px 16px 4px; font-size: 12px; font-weight:500; color: var(--text-muted); }
        .sp-opt { width: 100%; display: flex; align-items: center; gap: 10px; padding: 10px 16px; border: 0; background: none; font: inherit; font-size: 14px; color: inherit; cursor: pointer; }
        .sp-opt:hover { background: var(--ws-chip); }
        .sp-opt.on { background: var(--selection-bg); color: var(--selection-text); box-shadow: inset 3px 0 0 var(--selection-accent); }
        .sp-n { font-size: 12px; color: var(--text-subtle); }
        .sp-empty { padding: 8px 16px 16px; font-size: 13px; color: var(--text-muted); }
        .sp-clear { width: 100%; padding: 11px 16px; border: 0; border-top: 1px solid var(--border-light); background: var(--ws-head); color: var(--text-muted); font: inherit; font-size: 13px; font-weight:500; cursor: pointer; text-align: left; }
        .sp-clear:hover { color: var(--text-heading); }
      `}</style>
    </div>
  );
}
