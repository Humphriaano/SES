import { PERIOD_PRESETS, type PeriodChoice, type PeriodKey } from '../../lib/reportPeriod';

// The period choice every report screen shares: presets, and two dates for a custom range. The parent owns the choice and what to do with it.
export default function PeriodBar({ choice, problem, onPick, onDate }: {
  choice: PeriodChoice; problem: string; onPick: (key: PeriodKey) => void; onDate: (which: 'from' | 'to', value: string) => void;
}) {
  return (
    <div className="rp-noprint">
      <div role="radiogroup" aria-label="Period" className="bl-seg">
        {PERIOD_PRESETS.map(p => <button key={p.key} type="button" role="radio" aria-checked={choice.key === p.key} onClick={() => onPick(p.key)}>{p.label}</button>)}
      </div>
      {choice.key === 'custom' && (
        <div className="rp-dates">
          <div><label htmlFor="rp-from">From</label><input id="rp-from" type="date" className="bl-in" value={choice.from} max={choice.to || undefined} onChange={e => onDate('from', e.target.value)} /></div>
          <div><label htmlFor="rp-to">To</label><input id="rp-to" type="date" className="bl-in" value={choice.to} min={choice.from || undefined} onChange={e => onDate('to', e.target.value)} /></div>
        </div>
      )}
      {problem && <div className="rp-note" role="status">{problem}</div>}
    </div>
  );
}
