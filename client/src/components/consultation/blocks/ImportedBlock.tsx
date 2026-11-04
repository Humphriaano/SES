import { X, History } from 'lucide-react';
import { ImportedBlockData } from '../../../types/consultation';
import { HISTORY_SECTIONS } from '../../../lib/consultationHistory';
import { HistorySummary } from './HistoryBlock';

// Section label conventions for pre-block text nodes (SOAP order)
const PRE_BLOCK_LABELS = ['COMPLAINTS', 'SOCIAL HISTORY', 'EXAMINATION'];

interface Props {
  data: ImportedBlockData;
  onRemove: () => void;
  readOnly?: boolean;
}

function SectionLabel({ text }: { text: string }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 500, color: 'var(--text-subtle)',
      textTransform: 'uppercase', letterSpacing: '0.07em',
      marginBottom: 6,
    }}>
      {text}
    </div>
  );
}

function Divider() {
  return <div style={{ height: 1, background: 'var(--border)', margin: '12px 0' }} />;
}

export default function ImportedBlock({ data, onRemove, readOnly }: Props) {
  const dateStr = new Date(data.encounterDate).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric',
  });

  // Backward-compat: old nodes stored textContent as a string, new ones use preBlockTexts[]
  const legacy = data as any;
  const preTexts: string[] = Array.isArray(data.preBlockTexts)
    ? data.preBlockTexts
    : (legacy.textContent ? [legacy.textContent] : []);
  const postTexts: string[] = Array.isArray(data.postBlockTexts) ? data.postBlockTexts : [];

  // Build an ordered list of sections that have content
  const sections: Array<{ key: string; label: string; content: React.ReactNode }> = [];

  // Pre-block texts: complaints, social history, examination
  preTexts.forEach((text, i) => {
    if (!text) return;
    const label = PRE_BLOCK_LABELS[i] ?? 'NOTES';
    sections.push({
      key: `pre-${i}`,
      label,
      content: (
        <p style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 14, lineHeight: 1.7, color: 'var(--text-heading, var(--text-heading))' }}>
          {text}
        </p>
      ),
    });
  });

  // Explicit history sections retain their labels when a previous visit is imported.
  (data.histories ?? []).forEach((history, i) => {
    if (!(history.content.trim() || history.lmp || history.isObstetric || history.gravidity !== undefined || history.parity !== undefined) || !Object.prototype.hasOwnProperty.call(HISTORY_SECTIONS, history.type)) return;
    sections.push({
      key: `history-${i}`, label: HISTORY_SECTIONS[history.type].label,
      content: <HistorySummary data={history} />,
    });
  });

  (data.interBlockTexts ?? []).forEach((text, i) => {
    if (!text.trim()) return;
    sections.push({ key: `between-${i}`, label: 'NOTES', content: <p style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 14, lineHeight: 1.7, color: 'var(--text-heading)' }}>{text}</p> });
  });

  // Diagnoses
  if (data.diagnoses.length > 0) {
    sections.push({
      key: 'diagnosis',
      label: 'DIAGNOSIS',
      content: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {data.diagnoses.map((d, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
              <span style={{
                fontSize: 9, fontWeight: 500, color: 'var(--ses-blue-deep)', background: 'var(--ses-blue-tint)',
                padding: '1px 5px', borderRadius: 3, fontFamily: 'monospace', flexShrink: 0,
              }}>Dx</span>
              <span style={{
                fontSize: 11, fontWeight: 500, color: 'var(--ses-blue-deep)',
                fontFamily: 'monospace', flexShrink: 0,
              }}>{d.code}</span>
              <span style={{
                fontSize: 14, color: 'var(--text-heading, var(--text-heading))', flex: 1, fontWeight: 500,
              }}>{d.description}</span>
              <span style={{
                fontSize: 10, color: 'var(--text-muted)', fontWeight: 500,
                background: 'var(--ws-chip)', padding: '1px 6px', borderRadius: 3, flexShrink: 0,
              }}>{d.status}</span>
            </div>
          ))}
        </div>
      ),
    });
  }

  // Post-block texts: plan, management notes
  if (postTexts.length > 0) {
    const planText = postTexts.join('\n\n').trim();
    if (planText) {
      sections.push({
        key: 'plan',
        label: 'PLAN',
        content: (
          <p style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 14, lineHeight: 1.7, color: 'var(--text-heading, var(--text-heading))' }}>
            {planText}
          </p>
        ),
      });
    }
  }

  // Prescribed
  if (data.prescriptionSummary) {
    sections.push({
      key: 'prescribed',
      label: 'PRESCRIBED',
      content: (
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.7, color: 'var(--text-heading, var(--text-heading))' }}>
          {data.prescriptionSummary}
        </p>
      ),
    });
  }

  // Investigations
  if (data.investigationSummary) {
    sections.push({
      key: 'investigations',
      label: 'INVESTIGATIONS',
      content: (
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.7, color: 'var(--text-heading, var(--text-heading))' }}>
          {data.investigationSummary}
        </p>
      ),
    });
  }

  return (
    <div style={{
      marginBottom: 16,
      borderRadius: 10,
      border: '1px solid var(--border)',
      overflow: 'hidden',
    }}>
      {/* Header bar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 16px',
        background: 'var(--ws-blue-bg)',
        borderBottom: '1px solid var(--border)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <History size={13} color="var(--text-muted)" />
          <span style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--text-body)' }}>
            Imported from {dateStr}
          </span>
        </div>
        {!readOnly && <button
          onClick={onRemove}
          title="Remove imported block"
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--text-subtle)', padding: '2px 4px', borderRadius: 999,
            display: 'flex', alignItems: 'center',
            transition: 'color 0.12s',
          }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-muted)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-subtle)')}
        >
          <X size={13} />
        </button>}
      </div>

      {/* Content area — white background */}
      <div style={{ background: 'var(--bg-card, var(--bg-card))', padding: '14px 20px' }}>
        {sections.length === 0 && preTexts.length === 0 ? (
          <p style={{ margin: 0, fontStyle: 'italic', color: 'var(--text-subtle)', fontSize: 13 }}>
            No note content in this encounter.
          </p>
        ) : (
          sections.map((section, idx) => (
            <div key={section.key}>
              {idx > 0 && <Divider />}
              <SectionLabel text={section.label} />
              {section.content}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
