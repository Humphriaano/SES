import { useMemo, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { useReport } from '../../hooks/useReport';
import { bandSplit, grains, type Grain as GrainKey } from '../../lib/charts';
import { duration } from '../../lib/labReport';
import { BarList } from './ReportPanels';
import { Heatmap, PairedBars, StackedBars, TwoLines } from './charts';

// The attendance and laboratory pictures. Each is a picture of a registered report: it asks for the same figures as that report's own screen, for the same
// period, says how many records it covers, and has its numbers on the picture or in a table beside it.

interface Period { from: string; to: string }
interface Table { title: string; period: string; columns: { key: string; header: string }[]; rows: Record<string, unknown>[]; totals: Record<string, unknown> | null; summary: { label: string; value: number | string }[] }
interface AttRow { label: string; key: string; newTotal: number; reTotal: number; all: number; newMale: number; newFemale: number; reMale: number; reFemale: number }
const ATT = '/reports/attendance/attendance', BUSY = '/reports/attendance/busy-times', TURN = '/reports/lab/turnaround';
const dates = (p: Period): Record<string, string> => (p.from ? { from: p.from, to: p.to } : {});
const NONE: Record<string, string> = {};
const num = (v: unknown) => Number(v ?? 0);

type Grain = GrainKey;
const GRAIN_TEXT: Record<Grain, string> = { day: 'Day', week: 'Week', month: 'Month' };
const Err = ({ text, retry }: { text: string; retry: () => void }) => <div className="rp-note bad" role="alert"><span>{text}</span><button type="button" className="bl-btn sm" onClick={retry}>Try again</button></div>;
const Open = ({ to, text, onOpen }: { to: string; text: string; onOpen: (tab: string) => void }) => <button type="button" className="rp-link rp-noprint" onClick={() => onOpen(to)}>{text} <ArrowRight size={13} aria-hidden="true" /></button>;

// Attendance per day, week or month, new and re-attendance stacked.
export function AttendancePerDay({ period, onOpen }: { period: Period; onOpen: (tab: string) => void }) {
  const { allowed, first } = useMemo(() => grains(period), [period]);
  const [chosen, setChosen] = useState<Grain>(first), [asTable, setAsTable] = useState(false), [reload, setReload] = useState(0);
  const grain = allowed.includes(chosen) ? chosen : first;
  const params = useMemo(() => ({ ...dates(period), groupBy: grain }), [period, grain]);
  const { data, error, loading } = useReport<Table>(ATT, params, reload);
  const rows = (data?.rows ?? []) as unknown as AttRow[], totals = data?.totals as unknown as AttRow | null;
  return (
    <section className="rp-card" aria-label="Attendance per day" aria-busy={loading} style={{ opacity: loading && data ? 0.55 : 1 }}>
      <div className="rp-card-head">
        <div><h2>Attendance</h2><p className="rp-sub">OPD attendances per {grain}{data ? `, ${data.period}` : ''}. New and re-attendance stacked.</p></div>
        <div className="rp-seg rp-noprint" role="group" aria-label="Group by">{allowed.map(g => <button key={g} type="button" aria-pressed={grain === g} onClick={() => setChosen(g)}>{GRAIN_TEXT[g]}</button>)}</div>
      </div>
      {error && <Err text={error} retry={() => setReload(n => n + 1)} />}
      {!data && !error && <div className="rp-skel" style={{ height: 200 }} aria-hidden="true" />}
      {data && rows.length === 0 && <p className="rp-empty">Nothing was recorded in this period.</p>}
      {data && rows.length > 0 && !asTable && <StackedBars points={rows.map(r => ({ label: r.label, a: r.reTotal, b: r.newTotal }))} aName="re-attendance" bName="new attendance" describe={`Attendance per ${grain}: ${totals?.all ?? 0} attendances, ${totals?.newTotal ?? 0} new and ${totals?.reTotal ?? 0} re-attendance. A table follows the picture.`} />}
      {data && rows.length > 0 && asTable && (
        <div className="rp-scroll" style={{ maxHeight: 260, overflowY: 'auto' }}><table className="rp-matrix"><thead><tr><th scope="col">{grain === 'day' ? 'Day' : grain === 'week' ? 'Week' : 'Month'}</th><th scope="col">New attendance</th><th scope="col">Re-attendance</th><th scope="col">All</th></tr></thead>
          <tbody>{rows.map(r => <tr key={r.key}><th scope="row">{r.label}</th><td>{r.newTotal}</td><td>{r.reTotal}</td><td>{r.all}</td></tr>)}</tbody></table></div>
      )}
      {data && rows.length > 0 && (
        <div className="rp-legend-row">
          <p className="rp-legend"><i className="rp-sw rp-sw-new" /> New attendance <b>{num(totals?.newTotal).toLocaleString()}</b> <i className="rp-sw rp-sw-re" /> Re-attendance <b>{num(totals?.reTotal).toLocaleString()}</b></p>
          <span className="rp-noprint" style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            <button type="button" className="rp-link" onClick={() => setAsTable(t => !t)} aria-pressed={asTable}>{asTable ? 'View as chart' : 'View as table'}</button>
            <Open to="attendance" text="Aggregate and line list" onOpen={onOpen} />
          </span>
        </div>
      )}
    </section>
  );
}

// Who attends: female and male per age band.
export function WhoAttends({ period, onOpen }: { period: Period; onOpen: (tab: string) => void }) {
  const [reload, setReload] = useState(0);
  const params = useMemo(() => dates(period), [period]);
  const { data, error, loading } = useReport<Table>(ATT, Object.keys(params).length ? params : NONE, reload);
  const rows = (data?.rows ?? []) as unknown as AttRow[], totals = data?.totals as unknown as (AttRow & { newOther?: number; reOther?: number }) | null;
  const split = bandSplit(rows), female = split.reduce((s, r) => s + r.female, 0), male = split.reduce((s, r) => s + r.male, 0), other = num(totals?.newOther) + num(totals?.reOther);
  return (
    <section className="rp-card" aria-label="Who attends" aria-busy={loading} style={{ opacity: loading && data ? 0.55 : 1 }}>
      <div className="rp-card-head"><div><h2>Who attends</h2><p className="rp-sub">All attendances by age band and sex{data ? `, ${num(totals?.all).toLocaleString()} in the period` : ''}.</p></div></div>
      {error && <Err text={error} retry={() => setReload(n => n + 1)} />}
      {!data && !error && <div className="rp-skel" style={{ height: 180 }} aria-hidden="true" />}
      {data && num(totals?.all) === 0 && <p className="rp-empty">Nothing was recorded in this period.</p>}
      {data && num(totals?.all) > 0 && (<>
        <PairedBars rows={split} />
        <p className="rp-legend"><i className="rp-sw rp-sw-female" /> Female <b>{female.toLocaleString()}</b> <i className="rp-sw rp-sw-male" /> Male <b>{male.toLocaleString()}</b>{other ? <span className="rp-sub"> · {other.toLocaleString()} recorded as another sex are not drawn</span> : null}</p>
        <Open to="attendance" text="Age and sex table" onOpen={onOpen} />
      </>)}
    </section>
  );
}

// Busy times: weekday by hour of check-in.
export function BusyTimes({ period }: { period: Period }) {
  const [reload, setReload] = useState(0);
  const params = useMemo(() => (period.from ? dates(period) : NONE), [period]);
  const { data, error, loading } = useReport<Table>(BUSY, params, reload);
  const { cells, perHour } = useMemo(() => {
    const rows = (data?.rows ?? []) as Record<string, unknown>[];
    return { cells: rows.map(r => Array.from({ length: 24 }, (_, h) => num(r['h' + String(h).padStart(2, '0')]))), perHour: Array.from({ length: 24 }, (_, h) => num(data?.totals?.['h' + String(h).padStart(2, '0')])) };
  }, [data]);
  const total = num(data?.totals?.['total']), busiest = data?.summary.find(s => s.label === 'Busiest hour');
  return (
    <section className="rp-card" aria-label="Busy times" aria-busy={loading} style={{ opacity: loading && data ? 0.55 : 1 }}>
      <div className="rp-card-head"><div><h2>Busy times</h2><p className="rp-sub">Attendances by weekday and hour of check-in{data ? `, ${total.toLocaleString()} in the period` : ''}. Use it to plan staffing.</p></div></div>
      {error && <Err text={error} retry={() => setReload(n => n + 1)} />}
      {!data && !error && <div className="rp-skel" style={{ height: 220 }} aria-hidden="true" />}
      {data && total === 0 && <p className="rp-empty">Nothing was recorded in this period.</p>}
      {data && total > 0 && (<>
        <Heatmap cells={cells} perHour={perHour} />
        <div className="rp-legend-row"><p className="rp-legend"><span className="rp-sub">Fewer</span> <i className="rp-ramp" aria-hidden="true" /> <span className="rp-sub">More</span></p>{busiest && <span className="rp-sub">Busiest: <b style={{ color: 'var(--text-heading)', fontWeight: 500 }}>{busiest.value}</b></span>}</div>
      </>)}
    </section>
  );
}

// Lab turnaround: the median time from order to result, test by test, slowest first.
export function LabTurnaround({ period, onOpen }: { period: Period; onOpen?: (tab: string) => void }) {
  const [reload, setReload] = useState(0);
  const params = useMemo(() => (period.from ? dates(period) : NONE), [period]);
  const { data, error, loading } = useReport<Table>(TURN, params, reload);
  const rows = ((data?.rows ?? []) as unknown as { key: string; label: string; resulted: number; medianMin: number | null }[]).filter(r => r.medianMin !== null).slice(0, 8);
  return (
    <section className="rp-card" aria-label="Lab turnaround" aria-busy={loading} style={{ opacity: loading && data ? 0.55 : 1 }}>
      <div className="rp-card-head"><div><h2>Lab turnaround</h2><p className="rp-sub">Median time from order to result, by test. Slowest first{data ? `, ${num(data.totals?.['resulted']).toLocaleString()} tests resulted` : ''}.</p></div></div>
      {error && <Err text={error} retry={() => setReload(n => n + 1)} />}
      {!data && !error && <div className="rp-skel" style={{ height: 160 }} aria-hidden="true" />}
      {data && rows.length === 0 && <p className="rp-empty">No results were entered in this period.</p>}
      {data && rows.length > 0 && <BarList rows={rows.map(r => ({ key: r.key, label: r.label, sub: `${r.resulted} ${r.resulted === 1 ? 'test' : 'tests'}`, value: r.medianMin ?? 0 }))} empty="" format={duration} />}
      {onOpen && data && rows.length > 0 && <Open to="lab" text="Turnaround report" onOpen={onOpen} />}
    </section>
  );
}

// The Attendance tab's pictures, which follow its filters: the weekly trend, and attendance by service point.
export function WeeklyTrend({ params }: { params: Record<string, string> }) {
  const [reload, setReload] = useState(0);
  const query = useMemo(() => ({ ...params, groupBy: 'week' }), [params]);
  const { data, error, loading } = useReport<Table>(ATT, query, reload);
  const rows = (data?.rows ?? []) as unknown as AttRow[];
  return (
    <section className="rp-card" aria-label="Weekly trend" aria-busy={loading} style={{ opacity: loading && data ? 0.55 : 1 }}>
      <div className="rp-card-head"><div><h2>Weekly trend</h2><p className="rp-sub">New and re-attendance per week{data ? `, ${data.period}` : ''}. Follows the filters above; a week cut by the period counts only the days inside it.</p></div></div>
      {error && <Err text={error} retry={() => setReload(n => n + 1)} />}
      {!data && !error && <div className="rp-skel" style={{ height: 200 }} aria-hidden="true" />}
      {data && rows.length < 2 && <p className="rp-empty">A trend needs at least two weeks. Choose a longer period.</p>}
      {data && rows.length >= 2 && (<>
        <TwoLines labels={rows.map(r => r.label.replace('Week of ', ''))} a={rows.map(r => r.reTotal)} b={rows.map(r => r.newTotal)} aName="Re-attendance" bName="New" describe={`Weekly trend over ${rows.length} weeks. The values are written beside each point.`} />
        <p className="rp-legend"><i className="rp-sw rp-sw-re" /> Re-attendance <i className="rp-sw rp-sw-new" /> New attendance</p>
      </>)}
    </section>
  );
}

export function ByServicePoint({ params, onPick }: { params: Record<string, string>; onPick: (id: string) => void }) {
  const [reload, setReload] = useState(0);
  const query = useMemo(() => ({ ...params, groupBy: 'servicePoint' }), [params]);
  const { data, error, loading } = useReport<Table>(ATT, query, reload);
  const rows = (data?.rows ?? []) as unknown as AttRow[], max = Math.max(1, ...rows.map(r => r.all));
  return (
    <section className="rp-card" aria-label="By service point" aria-busy={loading} style={{ opacity: loading && data ? 0.55 : 1 }}>
      <div className="rp-card-head"><div><h2>By service point</h2><p className="rp-sub">{data ? `${num(data.totals?.['all']).toLocaleString()} attendances in the period, busiest first.` : 'Attendances by service point, busiest first.'} Select one to filter the page to it.</p></div></div>
      {error && <Err text={error} retry={() => setReload(n => n + 1)} />}
      {!data && !error && <div className="rp-skel" style={{ height: 140 }} aria-hidden="true" />}
      {data && rows.length === 0 && <p className="rp-empty">Nothing was recorded in this period.</p>}
      {data && rows.length > 0 && (
        <ul className="rp-bars">{rows.map(r => (
          <li key={r.key}><div className="rp-bar-text"><button type="button" className="rp-link rp-bar-label" onClick={() => onPick(r.key)} aria-label={`${r.label}: ${r.all} attendances. Filter the page to this service point.`}>{r.label}</button><b className="rp-bar-value">{r.all.toLocaleString()}</b></div>
            <div className="rp-track" aria-hidden="true"><div className="rp-fill" style={{ width: `${(r.all / max) * 100}%` }} /></div></li>
        ))}</ul>
      )}
    </section>
  );
}
