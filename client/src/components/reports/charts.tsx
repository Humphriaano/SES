import { useEffect, useRef, useState } from 'react';
import { heatLevel, hourWindow, labelIndexes, linePoints, niceAxis, sideWidth, stackHeights, yFor, type SexRow } from '../../lib/charts';

// The pictures of the report screens, drawn in plain SVG and HTML. Each is made only from rows a registered report returns. The numbers are always readable
// in the picture or in a table beside it; a tooltip is never the only way to read one. Colours are the system blue, a lighter blue, and one orange for male.

export interface StackPoint { label: string; a: number; b: number }   // a is drawn at the bottom, b on top

const H = 200, LEFT = 34, BOTTOM = 22, TOP = 8, MIN_WIDTH = 560;

// The width of the card a picture sits in, so the picture is drawn at its true size and its text stays readable. Narrower than a phone screen, it scrolls.
function useWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null), [width, setWidth] = useState(900);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const watch = new ResizeObserver(entries => setWidth(Math.max(MIN_WIDTH, Math.round(entries[0]!.contentRect.width))));
    watch.observe(el);
    return () => watch.disconnect();
  }, []);
  return [ref, width];
}

// Bars of two parts per day, week or month, with a round axis and a few dates under it.
export function StackedBars({ points, aName, bName, describe }: { points: StackPoint[]; aName: string; bName: string; describe: string }) {
  const [ref, W] = useWidth();
  const max = Math.max(0, ...points.map(p => p.a + p.b)), axis = niceAxis(max), plot = H - BOTTOM - TOP, width = W - LEFT;
  const slot = points.length ? width / points.length : width, bar = Math.max(1, slot * 0.78);
  const named = new Set(labelIndexes(points.length));
  return (
    <div ref={ref} className="rp-svg-wrap"><svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="rp-svg" role="img" aria-label={describe}>
      {axis.ticks.map(t => { const y = TOP + yFor(t, axis.max, plot); return (
        <g key={t}><line x1={LEFT} x2={W} y1={y} y2={y} className="rp-grid" /><text x={LEFT - 6} y={y + 4} textAnchor="end" className="rp-axis">{t}</text></g>
      ); })}
      {points.map((p, i) => {
        const h = stackHeights(p.a, p.b, axis.max, plot), x = LEFT + i * slot + (slot - bar) / 2, base = TOP + plot;
        return (
          <g key={i}>
            <title>{`${p.label}: ${p.a + p.b} (${aName} ${p.a}, ${bName} ${p.b})`}</title>
            {h.a > 0 && <rect x={x} y={base - h.a} width={bar} height={h.a} className="rp-bar-a" rx={1.5} />}
            {h.b > 0 && <rect x={x} y={base - h.a - h.b} width={bar} height={h.b} className="rp-bar-b" rx={1.5} />}
            {named.has(i) && <text x={Math.min(Math.max(x + bar / 2, LEFT + 14), W - 14)} y={H - 5} textAnchor="middle" className="rp-axis">{p.label}</text>}
          </g>
        );
      })}
    </svg></div>
  );
}

// Two lines over the same weeks, each point carrying its value and each line named at its end.
export function TwoLines({ labels, a, b, aName, bName, describe }: { labels: string[]; a: number[]; b: number[]; aName: string; bName: string; describe: string }) {
  const [ref, W] = useWidth();
  const max = Math.max(0, ...a, ...b), axis = niceAxis(max), L = 40, PAD = 28, R = 120, T = 22, B = 26, w = W - L - R - 2 * PAD, h = H + 20 - T - B;
  const pa = linePoints(a, axis.max, w, h), pb = linePoints(b, axis.max, w, h);
  const X = (x: number) => L + PAD + x, line = (pts: { x: number; y: number }[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.x)},${T + p.y}`).join(' ');
  const series = [{ pts: pa, values: a, name: aName, cls: 'a', dy: -9 }, { pts: pb, values: b, name: bName, cls: 'b', dy: 17 }];
  return (
    <div ref={ref} className="rp-svg-wrap"><svg width={W} height={H + 20} viewBox={`0 0 ${W} ${H + 20}`} className="rp-svg" role="img" aria-label={describe}>
      {axis.ticks.map(t => { const y = T + yFor(t, axis.max, h); return <g key={t}><line x1={L} x2={W - R + 20} y1={y} y2={y} className="rp-grid" /><text x={L - 6} y={y + 4} textAnchor="end" className="rp-axis">{t}</text></g>; })}
      {series.map(s => (
        <g key={s.name} className={`rp-line-${s.cls}`}>
          <path d={line(s.pts)} fill="none" strokeWidth={2.2} className="rp-stroke" />
          {s.pts.map((p, i) => <g key={i}><circle cx={X(p.x)} cy={T + p.y} r={3.6} className="rp-dot" /><text x={X(p.x)} y={T + p.y + s.dy} textAnchor="middle" className="rp-point">{s.values[i]}</text></g>)}
          {s.pts.length > 0 && <text x={X(s.pts.at(-1)!.x) + 14} y={T + s.pts.at(-1)!.y + 4} className="rp-end">{s.name}</text>}
        </g>
      ))}
      {labels.map((l, i) => <text key={i} x={X(pa[i]!.x)} y={H + 20 - 6} textAnchor="middle" className="rp-axis">{l}</text>)}
    </svg></div>
  );
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
// Weekday by hour of check-in. `cells[weekday][hour]` is the count; every cell shows its number, and the colour only repeats it.
export function Heatmap({ cells, perHour }: { cells: number[][]; perHour: number[] }) {
  const { from, to } = hourWindow(perHour), hours = Array.from({ length: to - from + 1 }, (_, i) => from + i), max = Math.max(0, ...cells.flat());
  return (
    <div className="rp-scroll">
      <table className="rp-heat">
        <thead><tr><th scope="col"><span className="rp-sr">Weekday</span></th>{hours.map(h => <th key={h} scope="col">{String(h).padStart(2, '0')}</th>)}</tr></thead>
        <tbody>{DAYS.map((d, w) => (
          <tr key={d}><th scope="row">{d}</th>{hours.map(h => {
            const v = cells[w]?.[h] ?? 0;
            return <td key={h} className={v === 0 ? 'rp-heat-zero' : undefined} style={v ? { background: `color-mix(in srgb, var(--selection-accent) ${Math.round(heatLevel(v, max) * 100)}%, var(--bg-card))`, color: heatLevel(v, max) > 0.5 ? '#fff' : 'var(--text-heading)' } : undefined}
              aria-label={`${d} ${String(h).padStart(2, '0')}:00, ${v} ${v === 1 ? 'attendance' : 'attendances'}`}>{v}</td>;
          })}</tr>
        ))}</tbody>
      </table>
    </div>
  );
}

// Back to back: one side female, one side male, the age band between, each bar with its number.
export function PairedBars({ rows }: { rows: SexRow[] }) {
  const max = Math.max(0, ...rows.flatMap(r => [r.female, r.male]));
  return (
    <ul className="rp-paired">
      {rows.map(r => (
        <li key={r.label} aria-label={`${r.label}: ${r.female} female, ${r.male} male`}>
          <span className="rp-pv">{r.female}</span>
          <span className="rp-side left"><i className="rp-female" style={{ width: `${sideWidth(r.female, max)}%` }} /></span>
          <span className="rp-pl">{r.label}</span>
          <span className="rp-side"><i className="rp-male" style={{ width: `${sideWidth(r.male, max)}%` }} /></span>
          <span className="rp-pv left">{r.male}</span>
        </li>
      ))}
    </ul>
  );
}
