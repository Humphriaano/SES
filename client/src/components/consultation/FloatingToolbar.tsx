import { BlockType } from '../../types/consultation';

// All four block types share one neutral identity with a thin blue accent —
// block type is distinguished by label/icon, not by a per-type brand color,
// so it never competes visually with brand-red primary actions.
const TOOLS: { type: BlockType; label: string; color: string; bg: string; title: string }[] = [
  { type: 'diagnosis',    label: 'Dx',  color: 'var(--ses-blue-deep)', bg: 'var(--ses-blue-tint)', title: 'Diagnosis (ICD-11)' },
  { type: 'investigation',label: 'Inv', color: 'var(--ses-blue-deep)', bg: 'var(--ses-blue-tint)', title: 'Investigations'     },
  { type: 'prescription', label: 'Rx',  color: 'var(--ses-blue-deep)', bg: 'var(--ses-blue-tint)', title: 'Prescription'       },
  { type: 'pmh',          label: 'PMH', color: 'var(--ses-blue-deep)', bg: 'var(--ses-blue-tint)', title: 'Past Medical History'},
];

interface Props {
  onInsert: (type: BlockType) => void;
  disabled?: boolean;
}

export default function FloatingToolbar({ onInsert, disabled }: Props) {
  return (
    <div style={{
      position: 'fixed',
      top: '50%',
      transform: 'translateY(-50%)',
      right: 20,
      zIndex: 30,
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
      background: 'var(--bg-card)',
      backdropFilter: 'blur(8px)',
      borderRadius: 14,
      padding: '8px 6px',
      boxShadow: '0 4px 24px rgba(0,0,0,0.13)',
      border: '1px solid var(--border)',
    }}>
      {TOOLS.map(tool => (
        <button
          key={tool.type}
          onClick={() => !disabled && onInsert(tool.type)}
          title={tool.title}
          disabled={disabled}
          style={{
            width: 44, height: 44,
            borderRadius: 10,
            background: disabled ? 'var(--bg-surface)' : tool.bg,
            color: disabled ? 'var(--text-subtle)' : tool.color,
            border: 'none',
            cursor: disabled ? 'not-allowed' : 'pointer',
            fontSize: 11,
            fontWeight: 700,
            fontFamily: 'monospace',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'transform 0.1s, box-shadow 0.1s',
          }}
          onMouseEnter={e => {
            if (!disabled) {
              (e.currentTarget as HTMLElement).style.transform = 'scale(1.1)';
              (e.currentTarget as HTMLElement).style.boxShadow = '0 2px 10px rgba(0,0,0,0.15)';
            }
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLElement).style.transform = 'scale(1)';
            (e.currentTarget as HTMLElement).style.boxShadow = 'none';
          }}
        >
          {tool.label}
        </button>
      ))}
    </div>
  );
}
