import { BlockType } from '../../types/consultation';

const TOOLS: { type: BlockType; label: string; color: string; bg: string; title: string }[] = [
  { type: 'diagnosis',    label: 'Dx',  color: '#2979FF', bg: 'rgba(41,121,255,0.14)', title: 'Diagnosis (ICD-11)'   },
  { type: 'investigation',label: 'Inv', color: '#00897B', bg: 'rgba(0,137,123,0.14)',   title: 'Investigations'       },
  { type: 'prescription', label: 'Rx',  color: '#1565C0', bg: 'rgba(21,101,192,0.14)',  title: 'Prescription'         },
  { type: 'pmh',          label: 'PMH', color: '#3A6B8A', bg: 'rgba(58,107,138,0.14)',  title: 'Past Medical History' },
];

/* Vertical hex tile — pointed top/bottom, wider at equator */
const HEX_V = 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)';

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
      right: 14,
      zIndex: 30,
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 6,
      padding: 6,
      background: 'var(--bg-card)',
      border: '1px solid var(--border)',
      boxShadow: '0 4px 24px rgba(0,0,0,0.18)',
    }}>
      {TOOLS.map(tool => (
        <button
          key={tool.type}
          onClick={() => !disabled && onInsert(tool.type)}
          title={tool.title}
          disabled={disabled}
          style={{
            width: 44,
            height: 52,
            background: disabled ? 'rgba(100,116,139,0.10)' : tool.bg,
            color: disabled ? 'var(--text-subtle)' : tool.color,
            border: 'none',
            clipPath: HEX_V,
            cursor: disabled ? 'not-allowed' : 'pointer',
            fontSize: 10,
            fontWeight: 700,
            fontFamily: 'monospace',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'background 0.12s, filter 0.12s, color 0.12s',
            filter: 'none',
          }}
          onMouseEnter={e => {
            if (disabled) return;
            const el = e.currentTarget as HTMLElement;
            el.style.background = tool.color;
            el.style.color = '#fff';
            el.style.filter = `drop-shadow(0 0 8px ${tool.color}99)`;
          }}
          onMouseLeave={e => {
            const el = e.currentTarget as HTMLElement;
            el.style.filter = 'none';
            el.style.background = disabled ? 'rgba(100,116,139,0.10)' : tool.bg;
            el.style.color = disabled ? 'var(--text-subtle)' : tool.color;
          }}
        >
          {tool.label}
        </button>
      ))}
    </div>
  );
}
