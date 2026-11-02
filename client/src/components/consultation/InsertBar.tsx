import { BlockType } from '../../types/consultation';

const TOOLS: { type: BlockType; tag: string; label: string; title: string }[] = [
  { type: 'diagnosis',     tag: 'Dx',  label: 'Diagnosis',       title: 'Add a diagnosis (ICD-11)' },
  { type: 'investigation', tag: 'Inv', label: 'Investigation',   title: 'Order investigations' },
  { type: 'prescription',  tag: 'Rx',  label: 'Prescription',    title: 'Prescribe medication' },
  { type: 'pmh',           tag: 'PMH', label: 'Medical history', title: 'Add to past medical history' },
];

// "Insert  [Dx Diagnosis] [Inv Investigation] [Rx Prescription] [PMH Medical history]" — the row above the note.
export default function InsertBar({ onInsert }: { onInsert: (type: BlockType) => void }) {
  return (
    <div className="ib" role="toolbar" aria-label="Insert into note">
      <span className="ib-l">Insert</span>
      {TOOLS.map((t) => (
        <button key={t.type} type="button" className="ib-b" title={t.title} onClick={() => onInsert(t.type)}>
          <span className="ib-t">{t.tag}</span>{t.label}
        </button>
      ))}
      <style>{`
        /* Stays pinned to the top of the screen while the note scrolls underneath it. */
        .ib { position: sticky; top: 0; z-index: 10; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 12px 20px;
          background: var(--bg-card); border-bottom: 1px solid var(--border-light); border-radius: 14px 14px 0 0;
          box-shadow: 0 6px 12px -8px rgba(0,0,0,.2); }
        .ib-l { font-size: 11px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: var(--text-subtle); margin-right: 4px; }
        .ib-b { height: 32px; padding: 0 10px 0 6px; border: 1px solid var(--btn2-line); border-radius: 8px; background: var(--btn2); color: var(--text-heading);
          font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 7px; transition: background .15s; }
        .ib-b:hover { background: var(--ws-chip); }
        .ib-t { display: inline-flex; align-items: center; justify-content: center; min-width: 28px; height: 20px; padding: 0 5px; border-radius: 5px; background: var(--ws-chip);
          color: var(--text-muted); font-size: 10px; font-weight: 800; letter-spacing: .3px; box-sizing: border-box; }
        .ib-b:hover .ib-t { background: var(--bg-card); }
      `}</style>
    </div>
  );
}
