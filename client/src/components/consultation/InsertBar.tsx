import { BlockType, HistoryType } from '../../types/consultation';
import type { Patient } from '../../types';
import { canInsertHistory, HISTORY_SECTIONS } from '../../lib/consultationHistory';

const TOOLS: { type: BlockType; tag: string; label: string; title: string }[] = [
  { type: 'pmh', tag: 'PMH', label: 'Medical history', title: 'Add to past medical history' },
  { type: 'drug-history', tag: 'DH', label: 'Drug History', title: 'Add drug history' },
  { type: 'gynae-history', tag: 'OGH', label: 'Obs & Gynae History', title: 'Add obstetric and gynaecological history' },
  { type: 'immunization-history', tag: 'IH', label: 'Immunization History', title: 'Add immunization history' },
  { type: 'diagnosis', tag: 'Dx', label: 'Diagnosis', title: 'Add a diagnosis (ICD-11)' },
  { type: 'investigation', tag: 'Inv', label: 'Investigation', title: 'Order investigations' },
  { type: 'procedure', tag: 'Proc', label: 'Procedures', title: 'Document procedures' },
  { type: 'prescription', tag: 'Rx', label: 'Prescription', title: 'Prescribe medication' },
];

// A compact row of insert actions above the note.
export default function InsertBar({ onInsert, patient }: { onInsert: (type: BlockType) => void; patient: Patient | null }) {
  return (
    <div className="ib" role="toolbar" aria-label="Insert into note">
      <span className="ib-l">Insert</span>
      {TOOLS.filter(t => !Object.prototype.hasOwnProperty.call(HISTORY_SECTIONS, t.type)
        || canInsertHistory(t.type as HistoryType, patient)).map((t) => (
        <button key={t.type} type="button" className="ib-b" aria-label={t.label} title={`${t.label} — ${t.title}`} onClick={() => onInsert(t.type)}>
          {t.tag}
        </button>
      ))}
      <style>{`
        /* Stays pinned to the top of the screen while the note scrolls underneath it. */
        .ib { position: sticky; top: 0; z-index: 10; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 12px 20px;
          background: var(--bg-card); border-bottom: 1px solid var(--border-light); border-radius: 14px 14px 0 0;
          box-shadow: 0 6px 12px -8px rgba(0,0,0,.2); }
        .ib-l { flex-shrink: 0; font-size: 11px; font-weight:500; letter-spacing: 1px; text-transform: uppercase; color: var(--text-subtle); margin-right: 4px; }
        .ib-b { height: 32px; padding: 0 10px 0 6px; border: 1px solid var(--btn2-line); border-radius: 8px; background: var(--btn2); color: var(--text-heading);
          font: inherit; font-size: 13px; font-weight:500; cursor: pointer; display: inline-flex; flex-shrink: 0; white-space: nowrap; align-items: center; gap: 7px; transition: background .15s; }
        .ib-b:focus-visible { outline: 2px solid var(--selection-accent); outline-offset: -2px; }
        .ib-b:hover { background: var(--ws-chip); }
        .ib-t { display: inline-flex; align-items: center; justify-content: center; min-width: 28px; height: 20px; padding: 0 5px; border-radius: 5px; background: var(--ws-chip);
          color: var(--text-muted); font-size: 10px; font-weight:500; letter-spacing: .3px; box-sizing: border-box; }
        .ib-b:hover .ib-t { background: var(--bg-card); }
      `}</style>
    </div>
  );
}
