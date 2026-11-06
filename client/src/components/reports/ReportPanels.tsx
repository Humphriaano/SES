import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { barFraction, minutesText, percent } from '../../lib/reportPeriod';
import type { ChronicRow, Overview } from '../../lib/populationReport';

// Exact figures from the server, drawn as plain labelled lists: every number is written out, so nothing depends on colour or on reading an axis.

export function Panel({ title, note, aside, children }: { title: string; note?: ReactNode; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="rp-card" aria-label={title}>
      <div className="rp-card-head">
        <div style={{ minWidth: 0 }}>
          <h2>{title}</h2>
          {note && <p className="rp-sub">{note}</p>}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

interface BarRow { key: string; label: string; sub?: string; value: number }
export function BarList({ rows, empty }: { rows: BarRow[]; empty: string }) {
  if (rows.length === 0) return <p className="rp-empty">{empty}</p>;
  const max = Math.max(...rows.map(r => r.value));
  return (
    <ul className="rp-bars">
      {rows.map(r => (
        <li key={r.key}>
          <div className="rp-bar-text">
            <span className="rp-bar-label">{r.label}{r.sub && <span className="rp-sub"> · {r.sub}</span>}</span>
            <b className="rp-bar-value">{r.value.toLocaleString()}</b>
          </div>
          <div className="rp-track" aria-hidden="true"><div className="rp-fill" style={{ width: `${barFraction(r.value, max) * 100}%` }} /></div>
        </li>
      ))}
    </ul>
  );
}

function Stat({ value, label }: { value: ReactNode; label: string }) {
  return <div className="rp-stat"><b>{value}</b><span>{label}</span></div>;
}

const none = (period: Overview['period']) => (period.allTime ? 'Nothing is recorded yet.' : 'Nothing was recorded in this period.');

export function DiagnosesPanel({ o }: { o: Overview }) {
  return (
    <Panel title="Diagnoses recorded" note={`${o.diagnoses.total.toLocaleString()} recorded · ${o.period.label}`}>
      <BarList rows={o.diagnoses.top.map(d => ({ key: d.code + d.description, label: d.description, sub: d.code, value: d.count }))} empty={none(o.period)} />
    </Panel>
  );
}

export function MedicinesPanel({ o }: { o: Overview }) {
  return (
    <Panel title="Medicines dispensed" note={`${o.medications.dispensed.toLocaleString()} dispensed · ${o.medications.prescriptions.toLocaleString()} prescriptions written · ${o.period.label}`}>
      <BarList rows={o.medications.top.map(m => ({ key: m.name, label: m.name, value: m.count }))} empty={none(o.period)} />
    </Panel>
  );
}

export function InvestigationsPanel({ o }: { o: Overview }) {
  const waiting = o.investigations.waiting;
  return (
    <Panel title="Investigations" note={`Ordered in ${o.period.allTime ? 'all time' : o.period.label}. Waiting now: ${waiting.pending} pending, ${waiting.inProgress} in progress.`}>
      <p className="rp-k">By status</p>
      <BarList rows={o.investigations.byStatus.map(s => ({ key: s.status, label: s.status, value: s.count }))} empty={none(o.period)} />
      {o.investigations.byTest.length > 0 && (<>
        <p className="rp-k" style={{ marginTop: 16 }}>By test</p>
        <BarList rows={o.investigations.byTest.map(t => ({ key: t.name, label: t.name, value: t.count }))} empty="" />
      </>)}
    </Panel>
  );
}

export function PatientsPanel({ o }: { o: Overview }) {
  const p = o.patients;
  return (
    <Panel title="Patients by age" note={`${p.total.toLocaleString()} on record · ${p.female.toLocaleString()} female · ${p.male.toLocaleString()} male${p.other ? ` · ${p.other.toLocaleString()} other` : ''}`}>
      <BarList rows={p.byAge.map(b => ({ key: b.band, label: `${b.band} years`, sub: `${b.female} female · ${b.male} male${b.other ? ` · ${b.other} other` : ''}`, value: b.total }))} empty="No patients are registered yet." />
    </Panel>
  );
}

export function ProceduresPanel({ o, roomLink }: { o: Overview; roomLink: boolean }) {
  const pr = o.procedures, w = pr.waiting;
  const oldest = w.oldestOrderedAt ? Math.max(0, (Date.parse(o.generatedAt) - Date.parse(w.oldestOrderedAt)) / 60000) : null;
  return (
    <Panel title="Procedures and treatment room" note={o.period.label}
      aside={roomLink ? <Link className="rp-link" to="/treatment-room">Treatment room <ArrowUpRight size={14} aria-hidden="true" /></Link> : undefined}>
      <div className="rp-stats">
        <Stat value={pr.done.toLocaleString()} label="Done" />
        <Stat value={pr.doneViaRoom.toLocaleString()} label="Done in treatment room" />
        <Stat value={pr.returned.toLocaleString()} label="Sent back to doctor" />
        <Stat value={minutesText(pr.medianWaitMinutes)} label="Median wait before done" />
      </div>
      <p className={w.total ? 'rp-now' : 'rp-sub'} style={{ margin: '12px 0 14px' }}>
        {w.total ? `${w.total} waiting now${w.urgent ? `, ${w.urgent} urgent` : ''}. The longest has waited ${minutesText(oldest)}.` : 'Nothing is waiting in the treatment room now.'}
      </p>
      <p className="rp-k">Most done</p>
      <BarList rows={pr.top.map(t => ({ key: t.name, label: t.name, value: t.count }))} empty={none(o.period)} />
    </Panel>
  );
}

function ChronicItem({ r, o }: { r: ChronicRow; o: Overview }) {
  const c = o.chronic, bp = r.bpControl;
  const sexes = [r.female && `${r.female} female`, r.male && `${r.male} male`, r.other && `${r.other} other`].filter(Boolean).join(' · ');
  return (
    <li className="rp-ch">
      <div className="rp-ch-name"><b>{r.label}</b><span className="rp-sub">{sexes}</span></div>
      <div className="rp-ch-num"><b>{r.active.toLocaleString()}</b><span>active</span></div>
      <div className="rp-ch-num"><b>{r.newInPeriod.toLocaleString()}</b><span>{o.period.allTime ? 'recorded' : 'new'}</span></div>
      <div className="rp-ch-care">
        <span>Seen in last {c.seenDays} days: <b>{r.seenRecently} of {r.active}</b> ({percent(r.seenRecently, r.active)})</span>
        <div className="rp-track" aria-hidden="true"><div className="rp-fill" style={{ width: `${r.active ? (r.seenRecently / r.active) * 100 : 0}%` }} /></div>
      </div>
      {bp && (
        <p className="rp-ch-bp">
          Latest blood pressure under {c.bp.systolic}/{c.bp.diastolic} (taken in the last {c.bp.recentDays} days): <b>{bp.controlled} of {r.active}</b> ({percent(bp.controlled, r.active)}).
          {' '}{bp.notControlled} at or above it · {bp.noRecentReading} with no reading in {c.bp.recentDays} days.
        </p>
      )}
    </li>
  );
}

export function ChronicPanel({ o }: { o: Overview }) {
  const c = o.chronic;
  const shown = c.rows.filter(r => r.active > 0 || r.newInPeriod > 0).sort((a, b) => b.active - a.active || b.newInPeriod - a.newInPeriod);
  const quiet = c.rows.filter(r => !shown.includes(r));
  return (
    <Panel title="Chronic diseases"
      note={`Patients with an active diagnosis, matched on ICD-11 codes. Seen means any visit in the last ${c.seenDays} days, as of today.`}
      aside={<div className="rp-pill" title="Patients with at least one active chronic disease">{c.patientsWithAny.toLocaleString()} patients{c.patientsWithSeveral ? ` · ${c.patientsWithSeveral.toLocaleString()} with more than one` : ''}</div>}>
      {shown.length === 0 ? <p className="rp-empty">No chronic disease diagnoses are recorded yet.</p> : <ul className="rp-chronic">{shown.map(r => <ChronicItem key={r.key} r={r} o={o} />)}</ul>}
      {quiet.length > 0 && shown.length > 0 && <p className="rp-sub" style={{ marginTop: 12 }}>No active patients: {quiet.map(r => r.label).join(', ')}.</p>}
      <p className="rp-sub" style={{ marginTop: 8 }}>Starter list of conditions, pending clinical review. Age and sex splits are in the Excel export.</p>
    </Panel>
  );
}
