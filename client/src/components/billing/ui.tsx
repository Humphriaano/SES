import { ReactNode, useEffect, useRef } from 'react';
import { X } from 'lucide-react';

// Small dialog used across the billing screens. Esc closes it; it won't close while something is saving.
export function Modal({ title, onClose, busy = false, width = 480, children }: { title: string; onClose: () => void; busy?: boolean; width?: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); prev?.focus?.(); };
  }, [busy, onClose]);
  return (
    <div className="bl-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className="bl-modal" style={{ maxWidth: width }}>
        <div className="bl-mh">
          <h3>{title}</h3>
          <button type="button" className="bl-x" aria-label="Close" onClick={onClose} disabled={busy}><X size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Pill({ tone, children }: { tone: 'ok' | 'warn' | 'bad' | 'muted' | 'blue'; children: ReactNode }) {
  return <span className={`bl-pill bl-${tone}`}>{children}</span>;
}

export const BILLING_CSS = `
.bl-card { background: var(--bg-card); border: 1px solid var(--border); border-radius: 12px; }
.bl-h { margin: 0; font-size: 15px; font-weight:500; color: var(--text-heading); }
.bl-muted { color: var(--text-muted); } .bl-faint { color: var(--text-subtle); }
.bl-num { text-align: right; font-variant-numeric: tabular-nums; }
.bl-tbl { width: 100%; border-collapse: collapse; font-size: 13px; }
.bl-tbl th { text-align: left; padding: 9px 14px; font-size: 11px; font-weight:500; letter-spacing: .05em; text-transform: uppercase; color: var(--text-subtle); background: var(--bg-surface); }
.bl-tbl th.bl-num, .bl-tbl td.bl-num { text-align: right; }
.bl-tbl td { padding: 10px 14px; border-top: 1px solid var(--border-light); color: var(--text-body); vertical-align: middle; }
.bl-tbl tr.void td { opacity: .5; text-decoration: line-through; }
.bl-pill { display: inline-flex; align-items: center; height: 22px; padding: 0 9px; border-radius: 11px; font-size: 11.5px; font-weight:500; white-space: nowrap; }
.bl-ok { background: var(--badge-green-bg); color: var(--badge-green-text); }
.bl-warn { background: var(--badge-amber-bg); color: var(--badge-amber-text); }
.bl-bad { background: var(--badge-red-bg); color: var(--badge-red-text); }
.bl-muted.bl-pill { background: var(--badge-gray-bg); color: var(--badge-gray-text); }
.bl-blue { background: var(--ws-chip); color: var(--ws-link); }
.bl-btn { height: 34px; padding: 0 13px; border-radius: 8px; border: 1px solid var(--btn2-line); background: var(--btn2); color: var(--text-heading); font: inherit; font-size: 13px; font-weight:500; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
.bl-btn:hover:not(:disabled) { background: var(--ws-chip); }
.bl-btn:disabled { opacity: .5; cursor: not-allowed; }
.bl-btn.primary { background: var(--ses-red); border-color: var(--ses-red); color: #fff; }
.bl-btn.primary:hover:not(:disabled) { background: var(--ses-red-dark); }
.bl-btn.sm { height: 28px; padding: 0 10px; font-size: 12px; }
.bl-btn.danger { color: var(--badge-red-text); }
.bl-scrim { position: fixed; inset: 0; z-index: 400; background: rgba(15,18,22,.55); display: flex; align-items: center; justify-content: center; padding: 16px; }
.bl-modal { width: 100%; max-height: calc(100vh - 32px); overflow-y: auto; background: var(--bg-card); border: 1px solid var(--border); border-radius: 14px; box-shadow: 0 24px 60px rgba(0,0,0,.35); }
.bl-mh { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px 0; }
.bl-mh h3 { margin: 0; font-size: 16px; font-weight:500; color: var(--text-heading); }
.bl-x { width: 28px; height: 28px; border: 0; border-radius: 6px; background: transparent; color: var(--text-subtle); cursor: pointer; display: flex; align-items: center; justify-content: center; }
.bl-x:hover { background: var(--ws-chip); color: var(--text-heading); }
.bl-mb { padding: 14px 20px 6px; display: flex; flex-direction: column; gap: 14px; }
.bl-mf { padding: 14px 20px 18px; display: flex; justify-content: flex-end; gap: 8px; }
.bl-k { display: block; margin-bottom: 6px; font-size: 11px; font-weight:500; letter-spacing: .06em; text-transform: uppercase; color: var(--text-subtle); }
.bl-in { width: 100%; height: 38px; padding: 0 12px; border: 1px solid var(--btn2-line); border-radius: 8px; background: var(--btn2); color: var(--text-heading); font: inherit; font-size: 14px; outline: 0; box-sizing: border-box; }
textarea.bl-in { height: auto; padding: 10px 12px; resize: vertical; }
.bl-in:focus { border-color: var(--ring); box-shadow: 0 0 0 3px var(--ring-glow); }
.bl-in.err { border-color: var(--st-bad); }
.bl-err { margin: 0; font-size: 13px; color: var(--badge-red-text); }
.bl-row { display: flex; gap: 12px; flex-wrap: wrap; } .bl-row > * { flex: 1 1 160px; min-width: 0; }
.bl-seg { display: flex; gap: 6px; flex-wrap: wrap; }
.bl-seg button { height: 34px; padding: 0 12px; border-radius: 8px; border: 1px solid var(--btn2-line); background: var(--btn2); color: var(--text-body); font: inherit; font-size: 13px; font-weight:500; cursor: pointer; }
.bl-seg button[aria-checked="true"] { background: var(--ws-chip-on); color: var(--ws-chip-on-text); border-color: transparent; }
@media (max-width: 700px) { .bl-hide-sm { display: none; } }
`;
