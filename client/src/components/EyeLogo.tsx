interface EyeLogoProps {
  /** Rendered pixel width. Height is computed automatically from the 82:54 aspect ratio. */
  width?: number;
  /** Colour of the structural circuit-board lines. Defaults to currentColor. */
  color?: string;
  /** Colour of the iris rings, pupil, and accent nodes. Defaults to var(--accent). */
  accent?: string;
  style?: React.CSSProperties;
  className?: string;
}

/**
 * Circuit-board eye logo.
 * Structural lines use `color` (defaults to currentColor) so they
 * inherit the parent's text colour and blend into any surface.
 * The iris uses `accent` for the teal/blue glow.
 */
export default function EyeLogo({
  width = 80,
  color = 'currentColor',
  accent = 'var(--accent)',
  style,
  className,
}: EyeLogoProps) {
  const height = Math.round(width * 54 / 82);

  return (
    <svg
      width={width}
      height={height}
      viewBox="-4 -4 90 58"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={style}
      className={className}
    >
      {/* ── Circuit traces — LEFT ─────────────────────────────── */}

      {/* Upper-left fan: two parallel angled lines */}
      <line x1="18" y1="8"  x2="2"  y2="1"  stroke={color} strokeWidth="1"/>
      <circle cx="2"  cy="1"  r="1.8" fill={color}/>
      <line x1="18" y1="13" x2="2"  y2="8"  stroke={color} strokeWidth="0.8" opacity="0.5"/>
      <circle cx="2"  cy="8"  r="1.2" fill="none" stroke={color} strokeWidth="0.8" opacity="0.5"/>

      {/* Horizontal left tip */}
      <line x1="4"  y1="25" x2="-4" y2="25" stroke={color} strokeWidth="1"/>
      <circle cx="-4" cy="25" r="1.5" fill="none" stroke={color} strokeWidth="1"/>

      {/* Lower-left fan */}
      <line x1="18" y1="42" x2="2"  y2="49" stroke={color} strokeWidth="1"/>
      <circle cx="2"  cy="49" r="1.8" fill={color}/>
      <line x1="18" y1="37" x2="2"  y2="42" stroke={color} strokeWidth="0.8" opacity="0.5"/>
      <circle cx="2"  cy="42" r="1.2" fill="none" stroke={color} strokeWidth="0.8" opacity="0.5"/>

      {/* ── Circuit traces — RIGHT ────────────────────────────── */}

      {/* Upper-right fan */}
      <line x1="62" y1="8"  x2="78" y2="1"  stroke={color} strokeWidth="1"/>
      <circle cx="78" cy="1"  r="1.8" fill={color}/>
      <line x1="62" y1="13" x2="78" y2="8"  stroke={color} strokeWidth="0.8" opacity="0.5"/>
      <circle cx="78" cy="8"  r="1.2" fill="none" stroke={color} strokeWidth="0.8" opacity="0.5"/>

      {/* Horizontal right tip */}
      <line x1="76" y1="25" x2="84" y2="25" stroke={color} strokeWidth="1"/>
      <circle cx="84" cy="25" r="1.5" fill="none" stroke={color} strokeWidth="1"/>

      {/* Lower-right fan */}
      <line x1="62" y1="42" x2="78" y2="49" stroke={color} strokeWidth="1"/>
      <circle cx="78" cy="49" r="1.8" fill={color}/>
      <line x1="62" y1="37" x2="78" y2="42" stroke={color} strokeWidth="0.8" opacity="0.5"/>
      <circle cx="78" cy="42" r="1.2" fill="none" stroke={color} strokeWidth="0.8" opacity="0.5"/>

      {/* ── Eye outer frame (angular almond) ─────────────────── */}
      <path
        d="M4,25 L18,8 L32,4 L48,4 L62,8 L76,25 L62,42 L48,46 L32,46 L18,42 Z"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="miter"
      />

      {/* ── Inner geometric lens guide (subtle) ──────────────── */}
      <path
        d="M4,25 L22,13 L58,13 L76,25 L58,37 L22,37 Z"
        stroke={color}
        strokeWidth="0.8"
        strokeLinejoin="miter"
        opacity={0.25}
      />

      {/* ── Iris corner accent nodes ──────────────────────────── */}
      <circle cx="32" cy="4"  r="2"   fill="none" stroke={accent} strokeWidth="1.2"/>
      <circle cx="48" cy="4"  r="2"   fill="none" stroke={accent} strokeWidth="1.2"/>
      <circle cx="32" cy="46" r="2"   fill="none" stroke={accent} strokeWidth="1.2"/>
      <circle cx="48" cy="46" r="2"   fill="none" stroke={accent} strokeWidth="1.2"/>

      {/* ── Iris — outer ring ─────────────────────────────────── */}
      <circle cx="40" cy="25" r="13.5" stroke={accent} strokeWidth="2"/>

      {/* ── Iris — middle ring ───────────────────────────────── */}
      <circle cx="40" cy="25" r="9.5" stroke={accent} strokeWidth="1.3"/>

      {/* ── Iris — segmented inner ring ──────────────────────── */}
      <circle
        cx="40" cy="25" r="6.5"
        stroke={accent} strokeWidth="1"
        strokeDasharray="3.5 2.5"
      />

      {/* ── Pupil ─────────────────────────────────────────────── */}
      <circle cx="40" cy="25" r="4" fill={accent}/>

      {/* ── Iris specular highlight ───────────────────────────── */}
      <circle cx="43.5" cy="21.5" r="2" fill="#FFFFFF" opacity={0.88}/>
    </svg>
  );
}
