import { X, History } from 'lucide-react';
import { ImportedBlockData } from '../../../types/consultation';

// Section label conventions for pre-block text nodes (SOAP order)
const PRE_BLOCK_LABELS = ['COMPLAINTS', 'SOCIAL HISTORY', 'EXAMINATION'];

interface Props {
  data: ImportedBlockData;
  onRemove: () => void;
}

function SectionLabel({ text }: { text: string }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 700, color: '#94a3b8',
      textTransform: 'uppercase', letterSpacing: '0.07em',
      marginBottom: 6,
    }}>
      {text}
    </div>
  );
}

function Divider() {
  return <div style={{ height: 1, background: '#e2e8f0', margin: '12px 0' }} />;
}

export default function ImportedBlock({ data, onRemove }: Props) {
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
        <p style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 14, lineHeight: 1.7, color: 'var(--text-heading, #0f172a)' }}>
          {text}
        </p>
      ),
    });
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
                fontSize: 9, fontWeight: 700, color: '#B41720', background: '#FEE2E2',
                padding: '1px 5px', borderRadius: 3, fontFamily: 'monospace', flexShrink: 0,
              }}>Dx</span>
              <span style={{
                fontSize: 11, fontWeight: 700, color: '#B41720',
                fontFamily: 'monospace', flexShrink: 0,
              }}>{d.code}</span>
              <span style={{
                fontSize: 14, color: 'var(--text-heading, #0f172a)', flex: 1, fontWeight: 500,
              }}>{d.description}</span>
              <span style={{
                fontSize: 10, color: '#64748b', fontWeight: 600,
                background: '#f1f5f9', padding: '1px 6px', borderRadius: 3, flexShrink: 0,
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
          <p style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 14, lineHeight: 1.7, color: 'var(--text-heading, #0f172a)' }}>
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
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.7, color: 'var(--text-heading, #0f172a)' }}>
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
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.7, color: 'var(--text-heading, #0f172a)' }}>
          {data.investigationSummary}
        </p>
      ),
    });
  }

  return (
    <div style={{
      marginBottom: 16,
      borderRadius: 10,
      border: '1px solid #bfcfe0',
      overflow: 'hidden',
    }}>
      {/* Header bar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 16px',
        background: '#dce8f5',
        borderBottom: '1px solid #bfcfe0',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <History size={13} color="#475569" />
          <span style={{ fontSize: 12.5, fontWeight: 600, color: '#334155' }}>
            Imported from {dateStr}
          </span>
        </div>
        <button
          onClick={onRemove}
          title="Remove imported block"
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: '#94a3b8', padding: '2px 4px', borderRadius: 4,
            display: 'flex', alignItems: 'center',
            transition: 'color 0.12s',
          }}
          onMouseEnter={e => (e.currentTarget.style.color = '#475569')}
          onMouseLeave={e => (e.currentTarget.style.color = '#94a3b8')}
        >
          <X size={13} />
        </button>
      </div>

      {/* Content area — white background */}
      <div style={{ background: 'var(--bg-card, #ffffff)', padding: '14px 20px' }}>
        {sections.length === 0 && preTexts.length === 0 ? (
          <p style={{ margin: 0, fontStyle: 'italic', color: '#94a3b8', fontSize: 13 }}>
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
