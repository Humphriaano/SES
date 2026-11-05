import { useEffect, useRef, useId } from 'react';
import { X } from 'lucide-react';
import type { HistoryBlockData, HistoryType } from '../../../types/consultation';
import { HISTORY_SECTIONS } from '../../../lib/consultationHistory';
import { calendarToday, displayCalendarDate, pregnancyDating } from '../../../lib/pregnancyDating';
import SuggestTextarea from '../SuggestTextarea';

interface Props {
  type: HistoryType;
  data: HistoryBlockData;
  onChange: (data: HistoryBlockData) => void;
  onRemove: () => void;
  readOnly?: boolean;
  onFocus?: () => void;
}

export function HistorySummary({ data }: { data: HistoryBlockData }) {
  const dating = data.isObstetric && data.lmp && data.datingAsOf ? pregnancyDating(data.lmp, data.datingAsOf) : null;
  return <>
    {data.isObstetric && (data.gravidity !== undefined || data.parity !== undefined) && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, fontSize: 13, marginBottom: 8, color: 'var(--text-heading)' }}>
      {data.gravidity !== undefined && <span>Gravidity: {data.gravidity}</span>}
      {data.parity !== undefined && <span>Parity: {data.parity}</span>}
    </div>}
    {data.lmp && <div style={{ fontSize: 13, marginBottom: 8, color: 'var(--text-heading)' }}>LMP: {displayCalendarDate(data.lmp)}</div>}
    {data.isObstetric && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>Obstetric patient</div>}
    {dating && <DatingSummary dating={dating} />}
    {data.content && <p style={{ margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 14, lineHeight: 1.7, color: 'var(--text-heading)' }}>{data.content}</p>}
  </>;
}

function DatingSummary({ dating }: { dating: NonNullable<ReturnType<typeof pregnancyDating>> }) {
  return <div style={{ margin: '10px 0 12px' }}>
    <dl style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 28px', margin: 0, fontSize: 13, color: 'var(--text-heading)' }}>
      <div><dt style={{ fontSize: 11, color: 'var(--text-muted)' }}>Estimated due date (EDD)</dt><dd style={{ margin: '3px 0 0', fontWeight: 500 }}>{displayCalendarDate(dating.edd)}</dd></div>
      <div><dt style={{ fontSize: 11, color: 'var(--text-muted)' }}>Gestational age (GA)</dt><dd style={{ margin: '3px 0 0', fontWeight: 500 }}>{dating.weeks} weeks {dating.days} days</dd></div>
    </dl>
    <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-muted)' }}>LMP-based estimate · 28-day cycle · GA on {displayCalendarDate(dating.asOf)}</div>
  </div>;
}

export default function HistoryBlock({ type, data, onChange, onRemove, readOnly, onFocus }: Props) {
  const field = useRef<HTMLTextAreaElement>(null);
  const lmpId = useId();
  const today = calendarToday();
  const { label, tag } = HISTORY_SECTIONS[type];
  const dating = data.isObstetric && data.lmp ? pregnancyDating(data.lmp, today) : null;
  const invalidLmp = !!data.lmp && !pregnancyDating(data.lmp, today);
  const change = (patch: Partial<HistoryBlockData>) => onChange({ ...data, ...patch, datingAsOf: today });

  useEffect(() => {
    if (!readOnly && type === 'gynae-history' && dating && data.datingAsOf !== today) {
      onChange({ ...data, datingAsOf: today });
    }
  }, [readOnly, type, data, today, onChange]);

  useEffect(() => {
    if (!field.current) return;
    field.current.style.height = 'auto';
    field.current.style.height = `${field.current.scrollHeight}px`;
  }, [data.content, readOnly]);

  return (
    <section className="note-block" aria-label={label} style={{
      border: '1px solid var(--border)', background: 'var(--bg-surface)',
      borderRadius: 18, padding: '10px 14px', margin: '16px 0',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span aria-hidden="true" style={{ fontSize: 10, color: 'var(--text-muted)', background: 'var(--ws-chip)', padding: '2px 6px', borderRadius: 5 }}>{tag}</span>
          <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-heading)' }}>{label}</span>
        </div>
        {!readOnly && (
          <button type="button" onClick={onRemove} aria-label={`Remove ${label}`} title={`Remove ${label}`}
            style={{ display: 'flex', alignItems: 'center', background: 'none', border: 'none', padding: 4, borderRadius: 999, cursor: 'pointer', color: 'var(--text-muted)' }}>
            <X size={14} />
          </button>
        )}
      </div>
      {readOnly ? <HistorySummary data={data} /> : <>
        {type === 'gynae-history' && <div style={{ marginBottom: 10 }} onFocus={onFocus}>
          <label htmlFor={lmpId} style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 5 }}>Last menstrual period (LMP) · first day</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px 18px' }}>
            <input id={lmpId} type="date" value={data.lmp ?? ''} max={today} aria-invalid={invalidLmp || undefined}
              onChange={event => change({ lmp: event.target.value })}
              style={{ boxSizing: 'border-box', minWidth: 155, minHeight: 36, padding: '6px 10px', border: '1px solid var(--border-input)', borderRadius: 12, background: 'var(--bg-card)', color: 'var(--text-heading)', font: 'inherit', fontSize: 13 }} />
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, color: 'var(--text-heading)', fontSize: 12, cursor: 'pointer' }}>
              <input type="checkbox" checked={data.isObstetric ?? false} onChange={event => change({ isObstetric: event.target.checked })} style={{ accentColor: 'var(--selection-accent)' }} />Obstetric patient
            </label>
          </div>
          {data.isObstetric && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 12 }}>
            {(['gravidity', 'parity'] as const).map(key => <label key={key} style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)' }}>
              {key === 'gravidity' ? 'Gravidity' : 'Parity'}
              <input type="number" inputMode="numeric" min={0} step={1} value={data[key] ?? ''}
                onChange={event => {
                  const raw = event.target.value;
                  if (!raw) change({ [key]: undefined });
                  else if (/^\d+$/.test(raw) && Number.isSafeInteger(Number(raw))) change({ [key]: Number(raw) });
                }}
                style={{ display: 'block', width: 110, boxSizing: 'border-box', minHeight: 36, marginTop: 5, padding: '6px 10px', border: '1px solid var(--border-input)', borderRadius: 12, background: 'var(--bg-card)', color: 'var(--text-heading)', font: 'inherit', fontSize: 13 }} />
            </label>)}
          </div>}
          {invalidLmp && <div role="alert" style={{ marginTop: 5, fontSize: 12, color: 'var(--badge-red-text)' }}>Enter a valid LMP date that is not in the future.</div>}
          {dating && <DatingSummary dating={dating} />}
        </div>}
        <SuggestTextarea ref={field} aria-label={label} value={data.content} rows={2}
          onFocus={onFocus}
          onChange={event => change({ content: event.target.value })}
          style={{ display: 'block', width: '100%', boxSizing: 'border-box', minHeight: 56, resize: 'none', overflow: 'hidden', border: 'none', outline: 'none', borderRadius: 6, padding: '2px 0', background: 'transparent', font: 'inherit', fontSize: 14, lineHeight: 1.7, color: 'var(--text-heading)' }} />
      </>}
    </section>
  );
}
