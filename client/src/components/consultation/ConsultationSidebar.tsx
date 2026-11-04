import { useState, useEffect } from 'react';
import { ChevronDown, ChevronRight, AlertTriangle, Activity, History, Pill, FlaskConical, HeartPulse, X } from 'lucide-react';
import api from '../../api/client';
import { Patient, Encounter, Medication, Vital } from '../../types';
import { CanvasNode, ImportedBlockData, ImportedDiagnosis } from '../../types/consultation';
import { DisplayRecord, toDisplay, getStatus, calcBmi } from '../../lib/vitalsConfig';
import { parseRows, flagFor } from '../../lib/investigations';
import DiagnosisBlock from './blocks/DiagnosisBlock';
import InvestigationBlock from './blocks/InvestigationBlock';
import PrescriptionBlock from './blocks/PrescriptionBlock';
import PMHBlock from './blocks/PMHBlock';
import HistoryBlock from './blocks/HistoryBlock';
import { historySnapshots, isHistoryNode } from '../../lib/consultationHistory';
import VitalsTrendsPanel from './VitalsTrendsPanel';
import InvestigationResultsPanel from './InvestigationResultsPanel';

function calcAge(dob: string): number {
  const birth = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  if (today < new Date(today.getFullYear(), birth.getMonth(), birth.getDate())) age--;
  return age;
}

function deserializeNodes(raw: string | undefined | null): CanvasNode[] {
  if (!raw) return [];
  try {
    const p = JSON.parse(raw);
    return Array.isArray(p) ? p : [];
  } catch { return []; }
}

// Preserve the existing clinical tiers using theme-aware semantic colours.
function vitalColor(statusKey: string, value: number | null | undefined): string {
  const s = getStatus(statusKey, value);
  if (s === 'danger')  return 'var(--st-bad)'; // clinical-critical
  if (s === 'warning') return 'var(--clinical-abnormal)'; // clinical-abnormal
  if (s === 'caution') return 'var(--st-warn)'; // clinical-caution
  return 'var(--text-body)';
}

// ── Investigation result slide-out ────────────────────────────────────────────
// Opens from the right over a dimmed page: the test, its specimen and result time, the values with
// reference ranges and flags, and how earlier results of the same test compared.
const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

function FlagTag({ status }: { status?: string }) {
  const f = flagFor(status);
  if (f.level === 'normal') return <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--st-ok)' }}>{status === 'Negative' ? 'Negative' : 'Normal'}</span>;
  if (!f.text) return <span style={{ color: 'var(--text-subtle)' }}>—</span>;
  return (
    <span style={{
      display: 'inline-block', padding: '1px 8px', borderRadius: 999, fontSize: 11, fontWeight: 500, whiteSpace: 'nowrap',
      color: f.level === 'critical' ? 'var(--st-bad)' : 'var(--st-warn)',
      background: f.level === 'critical' ? 'var(--st-bad-bg)' : 'var(--st-warn-bg)',
    }}>{f.text}</span>
  );
}

function InvResultsPanel({ item, patientId, onClose }: { item: any; patientId: string; onClose: () => void }) {
  const open = !!item;
  const latest = item?.results?.[0];
  const rows = parseRows(latest?.resultsJson);
  const [history, setHistory] = useState<any[] | null>(null);

  useEffect(() => {
    if (!item?.name || !patientId) { setHistory(null); return; }
    let live = true;
    setHistory(null);
    api.get('/investigations/results', { params: { patientId, testName: item.name } })
      .then(r => { if (live) setHistory((r.data as any[]).filter(h => h.id !== item.id)); })
      .catch(() => { if (live) setHistory([]); });
    return () => { live = false; };
  }, [item?.id, item?.name, patientId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const th: React.CSSProperties = { textAlign: 'left', padding: '9px 12px', fontSize: 11, fontWeight: 500, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--text-subtle)' };
  const td: React.CSSProperties = { padding: '12px' };

  return (
    <>
      {open && <div onClick={onClose} aria-hidden="true" style={{ position: 'fixed', inset: 0, zIndex: 59, background: 'rgba(10,12,14,.45)' }} />}
      <aside
        role="dialog" aria-modal="true" aria-labelledby="rs-t" aria-hidden={!open}
        style={{
          position: 'fixed', right: 0, top: 0, height: '100vh', width: 'min(560px, 100vw)', zIndex: 60,
          background: 'var(--bg-card)', borderLeft: '1px solid var(--border)', boxShadow: '-16px 0 40px rgba(0,0,0,.25)',
          color: 'var(--text-body)', fontSize: 14, display: 'flex', flexDirection: 'column',
          transform: open ? 'translateX(0)' : 'translateX(105%)', visibility: open ? 'visible' : 'hidden', transition: 'transform .25s ease',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', padding: '18px 16px 16px 24px', borderBottom: '1px solid var(--border-light)', flexShrink: 0 }}>
          <div>
            <h2 id="rs-t" style={{ margin: '0 0 4px', fontFamily: 'var(--font-heading)', fontSize: 18, fontWeight: 500, color: 'var(--text-heading)' }}>{item?.name}</h2>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
              {[item?.specimen, latest ? `${latest.amendedAt ? 'amended' : 'resulted'} ${fmtWhen(latest.amendedAt ?? latest.resultedAt)}` : 'no result yet'].filter(Boolean).join(' · ')}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close result"
            style={{ width: 32, height: 32, border: 0, borderRadius: 999, background: 'transparent', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
          <h3 style={{ margin: '0 0 10px', fontSize: 11, fontWeight: 500, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--text-subtle)' }}>Result</h3>
          {rows.length === 0 ? (
            <p style={{ margin: 0, color: 'var(--text-muted)' }}>No result has been recorded for this test yet.</p>
          ) : (
            <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'var(--ws-head)' }}>
                    <th style={th}>Test</th><th style={th}>Result</th><th style={th}>Units</th><th style={th}>Ref range</th><th style={th}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const f = flagFor(r.status);
                    return (
                      <tr key={r.componentId ?? i} style={{ borderTop: '1px solid var(--border-light)' }}>
                        <td style={{ ...td, fontWeight: 500, color: 'var(--text-heading)' }}>{r.componentName}</td>
                        <td style={{ ...td, fontWeight: 500, color: f.level === 'critical' ? 'var(--st-bad)' : f.level === 'abnormal' ? 'var(--st-warn)' : 'var(--text-heading)' }}>{r.value || '—'}</td>
                        <td style={{ ...td, color: r.units ? 'var(--text-body)' : 'var(--text-subtle)' }}>{r.units || '—'}</td>
                        <td style={{ ...td, color: r.referenceRange ? 'var(--text-body)' : 'var(--text-subtle)', fontSize: 13 }}>{r.referenceRange || '—'}</td>
                        <td style={td}><FlagTag status={r.status} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <h3 style={{ margin: '24px 0 8px', fontSize: 11, fontWeight: 500, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--text-subtle)' }}>Result history</h3>
          {history === null ? (
            <p style={{ margin: 0, color: 'var(--text-muted)' }}>Loading…</p>
          ) : history.length === 0 ? (
            <p style={{ margin: 0, color: 'var(--text-muted)' }}>No previous results for this test.</p>
          ) : (
            <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
              {history.map((h, i) => {
                const hr = parseRows(h.results?.[0]?.resultsJson);
                const when = h.results?.[0] ? fmtWhen(h.results[0].amendedAt ?? h.results[0].resultedAt) : '';
                return (
                  <div key={h.id} style={{ padding: '12px', borderTop: i ? '1px solid var(--border-light)' : 0 }}>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>{when}</div>
                    {hr.length === 0 ? <span style={{ color: 'var(--text-subtle)' }}>No values recorded</span> : hr.map((r, j) => (
                      <div key={r.componentId ?? j} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '2px 0' }}>
                        <span style={{ flex: 1, color: 'var(--text-body)' }}>{r.componentName}</span>
                        <span style={{ fontWeight: 500, color: 'var(--text-heading)' }}>{r.value || '—'} {r.units}</span>
                        <FlagTag status={r.status} />
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}

function buildImportData(enc: Encounter, nodes: CanvasNode[], dbPrescriptions: any[], invItems: any[]): ImportedBlockData {
  const isStructural = (n: CanvasNode) => isHistoryNode(n) || ['diagnosis', 'investigation', 'prescription', 'pmh'].includes(n.type);

  // Find the index range of structural blocks
  const firstStructIdx = nodes.findIndex(isStructural);
  const lastStructIdx = firstStructIdx === -1 ? -1
    : nodes.length - 1 - [...nodes].reverse().findIndex(isStructural);

  // Text nodes before the first structural block
  const preNodes = (firstStructIdx === -1 ? nodes : nodes.slice(0, firstStructIdx))
    .filter(n => n.type === 'text');

  // Text nodes after the last structural block
  const postNodes = (firstStructIdx === -1 ? [] : nodes.slice(lastStructIdx + 1))
    .filter(n => n.type === 'text');

  const toText = (n: CanvasNode) => (n as Extract<CanvasNode, { type: 'text' }>).content.trim();

  const preBlockTexts = preNodes.map(toText).filter(Boolean);
  const postBlockTexts = postNodes.map(toText).filter(Boolean);
  const interBlockTexts = firstStructIdx === -1 ? [] : nodes.slice(firstStructIdx + 1, lastStructIdx)
    .filter(n => n.type === 'text').map(toText).filter(Boolean);

  const diagnoses: ImportedDiagnosis[] = nodes
    .filter(n => n.type === 'diagnosis')
    .map(n => {
      const d = (n as Extract<CanvasNode, { type: 'diagnosis' }>).data;
      return { code: d.icd11Code, description: d.icd11Description, status: d.status };
    })
    .filter(d => d.code);

  const rxParts: string[] = [];
  nodes.filter(n => n.type === 'prescription').forEach(n => {
    const items = (n as Extract<CanvasNode, { type: 'prescription' }>).data.items;
    items.forEach(item => {
      const live = dbPrescriptions.find((rx: any) => rx.id === item.prescriptionId) as any;
      const m = live?.substituteMedication;
      rxParts.push(m ? [m.name, m.dosage, m.frequency, m.duration, m.quantity != null ? 'Qty ' + m.quantity : '', '(substituted for ' + item.drugName + ')'].filter(Boolean).join(' ') : [item.drugName, item.dose, item.frequency, item.duration, item.quantity != null ? 'Qty ' + item.quantity : ''].filter(Boolean).join(' '));
    });
  });
  if (rxParts.length === 0 && dbPrescriptions.length > 0) {
    dbPrescriptions.forEach((rx: any) => {
      const m = rx.substituteMedication ?? rx.medication;
      const parts = [m?.name, m?.dosage, m?.frequency, m?.duration, m?.quantity != null ? 'Qty ' + m.quantity : '', rx.substituteMedication ? '(substituted for ' + rx.medication?.name + ')' : ''].filter(Boolean);
      rxParts.push(parts.join(' ').trim());
    });
  }

  const invParts: string[] = [];
  nodes.filter(n => n.type === 'investigation').forEach(n => {
    const items = (n as Extract<CanvasNode, { type: 'investigation' }>).data.items;
    items.forEach(item => {
      const match = invItems.find(i => i.name?.toLowerCase() === item.name?.toLowerCase());
      invParts.push(`${item.name} (${match?.status ?? item.status})`);
    });
  });

  return {
    encounterId: enc.id,
    encounterDate: enc.createdAt,
    preBlockTexts,
    postBlockTexts,
    interBlockTexts,
    diagnoses,
    prescriptionSummary: rxParts.filter(Boolean).join(', '),
    investigationSummary: invParts.join(', '),
    histories: historySnapshots(nodes),
  };
}

interface Props {
  patientId: string;
  patient: Patient | null;
  encounters: Encounter[];
  visible: boolean;
  currentNodes?: CanvasNode[];
  onImportEncounter?: (data: ImportedBlockData) => void;
}

export default function ConsultationSidebar({ patientId, patient, encounters, visible, currentNodes = [], onImportEncounter }: Props) {
  const [open, setOpen] = useState<Record<string, boolean>>({
    conditions: true, vitals: true, recentInvestigations: true, encounters: true, prescriptions: false, investigations: false,
  });
  const [medications, setMedications] = useState<Medication[]>([]);
  const [vitalsHistory, setVitalsHistory] = useState<DisplayRecord[]>([]);
  const [showTrendsPanel, setShowTrendsPanel] = useState(false);
  const [expandedEncId, setExpandedEncId] = useState<string | null>(null);
  const [encNotes, setEncNotes] = useState<Record<string, CanvasNode[]>>({});
  const [encDbPrescriptions, setEncDbPrescriptions] = useState<Record<string, any[]>>({});
  const [recentInvestigations, setRecentInvestigations] = useState<any[]>([]);
  const [encInvestigations, setEncInvestigations] = useState<Record<string, any[]>>({});
  const [patientDispensing, setPatientDispensing] = useState<Record<string, any>>({});
  const [invResultsPanel, setInvResultsPanel] = useState<any>(null);
  const [selectedRecentInv, setSelectedRecentInv] = useState<any>(null);

  useEffect(() => {
    api.get(`/patients/${patientId}/medications`).then(r => setMedications(r.data)).catch(() => {});
    api.get(`/patients/${patientId}/vitals`).then(r => {
      const mapped = (r.data as (Vital & { bmi?: number | null })[])
        .map(v => ({ ...toDisplay(v), bmi: v.bmi ?? calcBmi(v.weight, v.height) }))
        .sort((a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime());
      setVitalsHistory(mapped);
    }).catch(() => {});
    api.get(`/investigations/orders?patientId=${patientId}&limit=3`)
      .then(r => setRecentInvestigations(r.data.flatMap((o: any) => o.items)))
      .catch(() => {});
    api.get(`/patients/${patientId}/dispensing`)
      .then(r => {
        const map: Record<string, any> = {};
        for (const d of r.data) {
          if (d.prescriptionId) map[d.prescriptionId] = d;
        }
        setPatientDispensing(map);
      })
      .catch(() => {});
  }, [patientId]);

  if (!visible) return null;

  const latestVital = vitalsHistory.length > 0 ? vitalsHistory[vitalsHistory.length - 1] : null;
  const activeConditions = patient?.diagnoses?.filter(d => !d.resolvedAt) ?? [];
  const pastEncounters = encounters.filter(e => e.status === 'CLOSED').slice(0, 8);
  const activeMeds = medications.filter(m => !m.endDate || new Date(m.endDate) >= new Date());

  const pendingInvs = currentNodes
    .filter(n => n.type === 'investigation')
    .flatMap((n: any) => (n.data.items as any[]).filter(i => i.status === 'PENDING'));

  async function toggleEncounter(enc: Encounter) {
    if (expandedEncId === enc.id) { setExpandedEncId(null); return; }
    setExpandedEncId(enc.id);
    if (!encNotes[enc.id]) {
      try {
        const [encRes, invRes] = await Promise.all([
          api.get(`/encounters/${enc.id}`),
          api.get(`/investigations/orders?encounterId=${enc.id}`).catch(() => ({ data: [] })),
        ]);
        const { data } = encRes;
        setEncNotes(prev => ({ ...prev, [enc.id]: deserializeNodes(data.notes) }));
        if (Array.isArray(data.prescriptions) && data.prescriptions.length > 0) {
          setEncDbPrescriptions(prev => ({ ...prev, [enc.id]: data.prescriptions }));
        }
        const invItems = (invRes.data as any[]).flatMap((o: any) => o.items ?? []);
        setEncInvestigations(prev => ({ ...prev, [enc.id]: invItems }));
      } catch {
        setEncNotes(prev => ({ ...prev, [enc.id]: [] }));
      }
    }
  }

  function toggle(k: string) {
    setOpen(s => ({ ...s, [k]: !s[k] }));
  }

  function resultColor(status: string): string {
    if (status === 'High' || status === 'Low' || status === 'Abnormal') return 'var(--st-warn)'; // clinical-caution
    if (status === 'Critical' || status === 'Positive') return 'var(--st-bad)'; // clinical-critical
    if (status === 'Normal' || status === 'Negative') return 'var(--st-ok)'; // clinical-normal
    return 'var(--text-muted)';
  }

  function renderDispensingStatus(prescriptionId: string | undefined, prescribedDrug: string) {
    if (!prescriptionId) return null;
    const dispense = patientDispensing[prescriptionId];
    if (!dispense) {
      return <span style={{ fontSize: 10, color: 'var(--text-subtle)' }}>Not dispensed</span>;
    }
    if (dispense.dispensedDrug && dispense.dispensedDrug.toLowerCase() !== prescribedDrug.toLowerCase()) {
      return (
        <span style={{ fontSize: 10, color: 'var(--st-warn)', fontWeight: 500 }}>
          Dispensed as {dispense.dispensedDrug}
        </span>
      );
    }
    return <span style={{ fontSize: 10, color: 'var(--st-ok)', fontWeight: 500 }}>Dispensed</span>;
  }

  function SectionHeader({ k, label, Icon, count }: { k: string; label: string; Icon: any; count?: number }) {
    return (
      <button
        onClick={() => toggle(k)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: 'none', border: 'none', cursor: 'pointer', padding: '8px 0',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <Icon size={12} color="var(--text-subtle)" />
          <span style={{ fontSize: 10.5, fontWeight: 500, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            {label}
          </span>
          {!!count && count > 0 && (
            <span style={{ fontSize: 10, background: 'var(--ws-blue-bg)', color: 'var(--ws-link)', borderRadius: 10, padding: '1px 5px', fontWeight: 500 }}>
              {count}
            </span>
          )}
        </div>
        {open[k] ? <ChevronDown size={11} color="var(--text-subtle)" /> : <ChevronRight size={11} color="var(--text-subtle)" />}
      </button>
    );
  }

  // ── Vital cell in the 2-col grid ──────────────────────────────────────────
  function VitalCell({ label, displayValue, statusKey, rawValue }: {
    label: string; displayValue: string | null; statusKey: string; rawValue: number | null | undefined;
  }) {
    const color = displayValue !== null ? vitalColor(statusKey, rawValue) : 'var(--text-subtle)';
    const dotColor = getStatus(statusKey, rawValue) === 'normal' ? 'var(--clinical-normal)' : color;
    const parts = displayValue?.match(/^([\d./-]+)\s*(.*)$/);
    return (
      <div className="cs-vital">
        <div className="cs-vital-label">
          <span>{label}</span>
          {displayValue !== null && <span className="cs-vital-dot" aria-hidden="true" style={{ background: dotColor }} />}
        </div>
        <div className="cs-vital-reading" style={{ color }}>
          <span className="cs-vital-value">{parts ? parts[1] : displayValue ?? '—'}</span>
          {parts?.[2] && <span className="cs-vital-unit">{parts[2]}</span>}
        </div>
      </div>
    );
  }

  const patientName = patient ? `${patient.firstName} ${patient.lastName}` : '';

  return (
    <>
      <div className="clinical-summary" style={{
        width: '100%', minWidth: 0,
        background: 'var(--premium-panel-bg)',
        border: '1px solid var(--border)',
        borderRadius: 22,
        overflowY: 'auto',
        padding: '14px 14px',
        position: 'sticky',
        top: 12,
        alignSelf: 'flex-start',
        maxHeight: 'calc(100vh - 140px)',
      }}>
        {/* Allergies — only rendered when the patient has recorded allergies */}
        {patient?.allergies && patient.allergies.length > 0 && (
          <div style={{ marginBottom: 12, background: 'var(--st-bad-bg)', border: '1px solid var(--st-bad-bg)', borderRadius: 8, padding: '8px 10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <AlertTriangle size={11} color="var(--st-bad)" />
              <span style={{ fontSize: 10, fontWeight: 500, color: 'var(--st-bad)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Allergies</span>
            </div>
            {patient.allergies.map((a, i) => (
              <p key={i} style={{ fontSize: 12, color: 'var(--st-bad)', margin: i < patient.allergies!.length - 1 ? '0 0 2px' : 0 }}>{a}</p>
            ))}
          </div>
        )}

        {/* Active Conditions */}
        <div style={{ borderBottom: '1px solid var(--border-light)', paddingBottom: 8, marginBottom: 8 }}>
          <SectionHeader k="conditions" label="Active Conditions" Icon={Activity} count={activeConditions.length} />
          {open.conditions && (
            activeConditions.length > 0
              ? activeConditions.map(d => (
                <div key={d.id} style={{ paddingLeft: 19, marginBottom: 7 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 10, fontWeight: 500, color: 'var(--ws-link)', fontFamily: 'monospace' }}>{d.icd11.code}</span>
                    <span style={{ fontSize: 12, color: 'var(--text-body)' }}>{d.icd11.description}</span>
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-subtle)', marginTop: 1 }}>
                    {new Date(d.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </div>
                </div>
              ))
              : <p style={{ fontSize: 12, color: 'var(--text-subtle)', paddingLeft: 19, margin: '0 0 4px' }}>None on record</p>
          )}
        </div>

        {/* Latest Vitals — only rendered if a reading exists */}
        {latestVital && (
          <div style={{ borderBottom: '1px solid var(--border-light)', paddingBottom: 8, marginBottom: 8 }}>
            <SectionHeader k="vitals" label="Latest Vitals" Icon={HeartPulse} />
            {open.vitals && (
              <div style={{ paddingLeft: 4 }}>
                {/* Timestamp */}
                <div style={{ fontSize: 10, color: 'var(--text-subtle)', marginBottom: 8 }}>
                  {new Date(latestVital.recordedAt).toLocaleString('en-GB', {
                    day: 'numeric', month: 'short', year: 'numeric',
                    hour: '2-digit', minute: '2-digit', hour12: false,
                  })}
                </div>

                {/* 2-column vitals grid */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 14px', marginBottom: 10 }}>
                  <VitalCell
                    label="BP"
                    displayValue={
                      latestVital.systolic != null && latestVital.diastolic != null
                        ? `${latestVital.systolic}/${latestVital.diastolic}`
                        : null
                    }
                    statusKey="systolic"
                    rawValue={latestVital.systolic}
                  />
                  <VitalCell
                    label="HR"
                    displayValue={latestVital.hr != null ? `${latestVital.hr} bpm` : null}
                    statusKey="hr"
                    rawValue={latestVital.hr}
                  />
                  <VitalCell
                    label="Temp"
                    displayValue={latestVital.temp != null ? `${latestVital.temp} °C` : null}
                    statusKey="temp"
                    rawValue={latestVital.temp}
                  />
                  <VitalCell
                    label="SpO₂"
                    displayValue={latestVital.spo2 != null ? `${latestVital.spo2}%` : null}
                    statusKey="spo2"
                    rawValue={latestVital.spo2}
                  />
                  <VitalCell
                    label="Glucose"
                    displayValue={latestVital.glucose != null ? `${latestVital.glucose} mmol/L` : null}
                    statusKey="glucose"
                    rawValue={latestVital.glucose}
                  />
                  <VitalCell
                    label="BMI"
                    displayValue={latestVital.bmi != null ? String(latestVital.bmi) : null}
                    statusKey="neutral"
                    rawValue={null}
                  />
                </div>

                {/* View Trends button */}
                <button
                  onClick={() => setShowTrendsPanel(true)}
                  style={{
                    width: '100%', padding: '5px 0',
                    background: 'none', border: '1px solid var(--border)',
                    borderRadius: 999, cursor: 'pointer',
                    fontSize: 11, fontWeight: 500, color: 'var(--text-subtle)',
                    letterSpacing: '0.02em', transition: 'border-color 0.15s, color 0.15s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--text-subtle)'; e.currentTarget.style.color = 'var(--text-muted)'; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-subtle)'; }}
                >
                  View Trends
                </button>
              </div>
            )}
          </div>
        )}

        {/* Previous Encounters */}
        <div style={{ borderBottom: '1px solid var(--border-light)', paddingBottom: 8, marginBottom: 8 }}>
          <SectionHeader k="encounters" label="Previous Encounters" Icon={History} count={pastEncounters.length} />
          {open.encounters && (
            pastEncounters.length > 0
              ? pastEncounters.map(enc => {
                const isExpanded = expandedEncId === enc.id;
                const nodes = encNotes[enc.id];
                return (
                  <div key={enc.id} style={{ marginBottom: 8 }}>
                    <button
                      onClick={() => toggleEncounter(enc)}
                      style={{
                        width: '100%', textAlign: 'left', background: isExpanded ? 'var(--ws-chip)' : 'none',
                        border: 'none', cursor: 'pointer', borderRadius: 999, padding: '6px 8px 6px 19px',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ fontSize: 12, color: 'var(--text-body)', fontWeight: 500 }}>
                          {new Date(enc.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </div>
                        {isExpanded
                          ? <ChevronDown size={10} color="var(--text-subtle)" />
                          : <ChevronRight size={10} color="var(--text-subtle)" />
                        }
                      </div>
                      {enc.chiefComplaint && (
                        <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {enc.chiefComplaint}
                        </div>
                      )}
                      {enc.clinician?.name && (
                        <div style={{ fontSize: 10, color: 'var(--text-subtle)' }}>{enc.clinician.name}</div>
                      )}
                    </button>

                    {isExpanded && (
                      <div style={{
                        marginLeft: 10, marginTop: 6, marginBottom: 4,
                        borderLeft: '2px solid var(--border)', paddingLeft: 10,
                      }}>
                        {/* Import button — shown once data has loaded */}
                        {nodes != null && onImportEncounter && (
                          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
                            <button
                              onClick={() => onImportEncounter(
                                buildImportData(enc, nodes, encDbPrescriptions[enc.id] ?? [], encInvestigations[enc.id] ?? [])
                              )}
                              style={{
                                display: 'inline-flex', alignItems: 'center', gap: 4,
                                fontSize: 10, padding: '3px 8px',
                                border: '1px solid var(--border)', borderRadius: 999,
                                color: 'var(--text-subtle)', background: 'none', cursor: 'pointer',
                                fontFamily: 'inherit', fontWeight: 500,
                                transition: 'border-color 0.12s, color 0.12s',
                              }}
                              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--text-subtle)'; e.currentTarget.style.color = 'var(--text-muted)'; }}
                              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-subtle)'; }}
                            >
                              ↓ Import to canvas
                            </button>
                          </div>
                        )}
                        {/* Note content — exact original 3-way ternary, unchanged */}
                        {nodes == null ? (
                          <p style={{ fontSize: 11, color: 'var(--text-subtle)', fontStyle: 'italic' }}>Loading…</p>
                        ) : nodes.length === 0 && !encDbPrescriptions[enc.id]?.length ? (
                          <p style={{ fontSize: 11, color: 'var(--text-subtle)', fontStyle: 'italic' }}>No note content saved.</p>
                        ) : (
                          <div style={{ fontSize: 12 }}>
                            {nodes.map(node => {
                              if (node.type === 'text' && node.content.trim()) {
                                return (
                                  <p key={node.id} style={{ color: 'var(--text-muted)', whiteSpace: 'pre-wrap', margin: '0 0 6px', lineHeight: 1.5, fontSize: 12 }}>
                                    {node.content}
                                  </p>
                                );
                              }
                              if (isHistoryNode(node)) {
                                return <HistoryBlock key={node.id} type={node.type} data={node.data} onChange={() => {}} onRemove={() => {}} readOnly />;
                              }
                              if (node.type === 'diagnosis' && node.data.icd11Code) {
                                return (
                                  <div key={node.id} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5, flexWrap: 'wrap' }}>
                                    <span style={{ fontSize: 9, fontWeight: 500, color: 'var(--ws-link)', background: 'rgba(147,197,253,0.15)', padding: '1px 5px', borderRadius: 3, fontFamily: 'monospace' }}>Dx</span>
                                    <span style={{ fontSize: 10, fontWeight: 500, color: 'var(--ws-link)', fontFamily: 'monospace' }}>{node.data.icd11Code}</span>
                                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{node.data.icd11Description}</span>
                                    <span style={{ fontSize: 10, color: 'var(--text-subtle)', marginLeft: 'auto' }}>{node.data.status}</span>
                                  </div>
                                );
                              }
                              if (node.type === 'investigation') {
                                const dbItems = encInvestigations[enc.id] ?? [];
                                return node.data.items.map((item: any) => {
                                  const dbItem = dbItems.find((i: any) => i.name.toLowerCase() === item.name.toLowerCase());
                                  const dbStatus: string | undefined = dbItem?.status;
                                  const isPendingOrInProgress = !dbStatus || dbStatus === 'Pending' || dbStatus === 'In Progress';

                                  if (isPendingOrInProgress) {
                                    return (
                                      <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
                                        <span style={{ fontSize: 9, fontWeight: 500, color: 'var(--ws-link)', background: 'rgba(147,197,253,0.15)', padding: '1px 5px', borderRadius: 3, fontFamily: 'monospace' }}>Inv</span>
                                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{item.name}</span>
                                        <span style={{ fontSize: 10, color: 'var(--text-subtle)', marginLeft: 'auto' }}>{dbStatus ?? item.status}</span>
                                      </div>
                                    );
                                  }

                                  const latestResult = dbItem?.results?.[0];
                                  let resultRows: any[] = [];
                                  try { if (latestResult) resultRows = JSON.parse(latestResult.resultsJson); } catch {}
                                  const isPanel = dbItem?.type === 'panel';

                                  if (isPanel) {
                                    return (
                                      <div key={item.id} style={{ marginBottom: 5 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                          <span style={{ fontSize: 9, fontWeight: 500, color: 'var(--ws-link)', background: 'rgba(147,197,253,0.15)', padding: '1px 5px', borderRadius: 3, fontFamily: 'monospace' }}>Inv</span>
                                          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{item.name}</span>
                                          <button
                                            onClick={() => setInvResultsPanel(dbItem)}
                                            style={{
                                              marginLeft: 'auto', background: 'none', border: 'none',
                                              cursor: 'pointer', fontSize: 10, color: 'var(--ws-link)',
                                              textDecoration: 'underline', padding: 0, fontFamily: 'inherit',
                                            }}
                                          >
                                            View Results
                                          </button>
                                        </div>
                                      </div>
                                    );
                                  }

                                  const firstRow = resultRows[0];
                                  return (
                                    <div key={item.id} style={{ marginBottom: 5 }}>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                        <span style={{ fontSize: 9, fontWeight: 500, color: 'var(--ws-link)', background: 'rgba(147,197,253,0.15)', padding: '1px 5px', borderRadius: 3, fontFamily: 'monospace' }}>Inv</span>
                                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{item.name}</span>
                                      </div>
                                      {firstRow && (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 37, marginTop: 2 }}>
                                          <span style={{ fontSize: 12, fontWeight: 500, color: resultColor(firstRow.status) }}>{firstRow.value}</span>
                                          {firstRow.units && <span style={{ fontSize: 11, color: 'var(--text-subtle)' }}>{firstRow.units}</span>}
                                          <span style={{ fontSize: 10, color: resultColor(firstRow.status) }}>{firstRow.status}</span>
                                        </div>
                                      )}
                                    </div>
                                  );
                                });
                              }
                              if (node.type === 'prescription') {
                                const dbRx = encDbPrescriptions[enc.id] ?? [];
                                const canvasIds = new Set(node.data.items.map((i: any) => i.prescriptionId).filter(Boolean));
                                const extraDbRx = dbRx.filter(rx => !canvasIds.has(rx.id));
                                return [
                                  ...node.data.items.map((item: any) => (
                                    <div key={item.id} style={{ marginBottom: 5 }}>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                        <span style={{ fontSize: 9, fontWeight: 500, color: 'var(--ws-link)', background: 'rgba(147,197,253,0.15)', padding: '1px 5px', borderRadius: 3, fontFamily: 'monospace' }}>Rx</span>
                                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{item.drugName} {item.dose} {item.frequency}</span>
                                      </div>
                                      {item.prescriptionId && (
                                        <div style={{ marginLeft: 37, marginTop: 2 }}>
                                          {renderDispensingStatus(item.prescriptionId, item.drugName ?? '')}
                                        </div>
                                      )}
                                    </div>
                                  )),
                                  ...extraDbRx.map((rx: any) => (
                                    <div key={`db-${rx.id}`} style={{ marginBottom: 5 }}>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                        <span style={{ fontSize: 9, fontWeight: 500, color: 'var(--ws-link)', background: 'rgba(147,197,253,0.15)', padding: '1px 5px', borderRadius: 3, fontFamily: 'monospace' }}>Rx</span>
                                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{rx.medication?.name} {rx.medication?.dosage} {rx.medication?.frequency}</span>
                                      </div>
                                      <div style={{ marginLeft: 37, marginTop: 2 }}>
                                        {renderDispensingStatus(rx.id, rx.medication?.name ?? '')}
                                      </div>
                                    </div>
                                  )),
                                ];
                              }
                              return null;
                            })}
                            {/* DB prescriptions for encounters with no canvas Rx blocks */}
                            {!nodes.some(n => n.type === 'prescription') && (encDbPrescriptions[enc.id] ?? []).map((rx: any) => (
                              <div key={`db-${rx.id}`} style={{ marginBottom: 5 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                  <span style={{ fontSize: 9, fontWeight: 500, color: 'var(--ws-link)', background: 'rgba(147,197,253,0.15)', padding: '1px 5px', borderRadius: 3, fontFamily: 'monospace' }}>Rx</span>
                                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{rx.medication?.name} {rx.medication?.dosage} {rx.medication?.frequency}</span>
                                </div>
                                <div style={{ marginLeft: 37, marginTop: 2 }}>
                                  {renderDispensingStatus(rx.id, rx.medication?.name ?? '')}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
              : <p style={{ fontSize: 12, color: 'var(--text-subtle)', paddingLeft: 19, margin: '0 0 4px' }}>No previous encounters</p>
          )}
        </div>

        {/* Active Prescriptions */}
        <div style={{ borderBottom: '1px solid var(--border-light)', paddingBottom: 8, marginBottom: 8 }}>
          <SectionHeader k="prescriptions" label="Active Prescriptions" Icon={Pill} count={activeMeds.length} />
          {open.prescriptions && (
            activeMeds.length > 0
              ? activeMeds.map(m => (
                <div key={m.id} style={{ paddingLeft: 19, marginBottom: 7 }}>
                  <div style={{ fontSize: 12, color: 'var(--text-body)', fontWeight: 500 }}>{m.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-subtle)' }}>{m.dosage}{m.frequency ? ` · ${m.frequency}` : ''}</div>
                </div>
              ))
              : <p style={{ fontSize: 12, color: 'var(--text-subtle)', paddingLeft: 19, margin: '0 0 4px' }}>No active prescriptions</p>
          )}
        </div>

        {/* Recent Investigations (from V2 orders API — last 3 items) */}
        <div style={{ borderBottom: '1px solid var(--border-light)', paddingBottom: 8, marginBottom: 8 }}>
          <SectionHeader k="recentInvestigations" label="Recent Investigations" Icon={FlaskConical} count={recentInvestigations.length} />
          {open.recentInvestigations && (
            recentInvestigations.length > 0
              ? recentInvestigations.map((item: any) => {
                  const statusMap: Record<string, { bg: string; color: string }> = {
                    Pending:       { bg: 'var(--ws-chip)', color: 'var(--text-muted)' },
                    'In Progress': { bg: 'var(--ws-blue-bg)', color: 'var(--ws-link)' },
                    Resulted:      { bg: 'var(--st-ok-bg)', color: 'var(--st-ok)' },
                    Amended:       { bg: 'var(--st-warn-bg)', color: 'var(--st-warn)' },
                  };
                  const s = statusMap[item.status] ?? statusMap.Pending;
                  const isClickable = item.status === 'Resulted' || item.status === 'Amended';

                  return isClickable ? (
                    <div
                      key={item.id}
                      onClick={() => setSelectedRecentInv(item)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 4,
                        paddingLeft: 19, paddingRight: 8, paddingTop: 4, paddingBottom: 4,
                        marginBottom: 4, cursor: 'pointer', borderRadius: 6,
                        transition: 'background 0.1s',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, color: 'var(--text-body)', fontWeight: 500, marginBottom: 2 }}>
                          {item.name}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{
                            fontSize: 9, fontWeight: 500, padding: '1px 6px', borderRadius: 10,
                            background: s.bg, color: s.color,
                          }}>
                            {item.status}
                          </span>
                          {item.specimen && (
                            <span style={{ fontSize: 10, color: 'var(--text-subtle)' }}>{item.specimen}</span>
                          )}
                        </div>
                      </div>
                      <ChevronRight size={11} color="var(--text-subtle)" style={{ flexShrink: 0 }} />
                    </div>
                  ) : (
                    <div key={item.id} style={{ paddingLeft: 19, marginBottom: 8 }}>
                      <div style={{ fontSize: 12, color: 'var(--text-body)', fontWeight: 500, marginBottom: 2 }}>
                        {item.name}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{
                          fontSize: 9, fontWeight: 500, padding: '1px 6px', borderRadius: 10,
                          background: s.bg, color: s.color,
                        }}>
                          {item.status}
                        </span>
                        {item.specimen && (
                          <span style={{ fontSize: 10, color: 'var(--text-subtle)' }}>{item.specimen}</span>
                        )}
                      </div>
                    </div>
                  );
                })
              : <p style={{ fontSize: 12, color: 'var(--text-subtle)', paddingLeft: 19, margin: '0 0 4px' }}>None on record</p>
          )}
        </div>

        {/* Pending Investigations (from current canvas) */}
        <div style={{ paddingBottom: 8 }}>
          <SectionHeader k="investigations" label="Pending (This Visit)" Icon={FlaskConical} count={pendingInvs.length} />
          {open.investigations && (
            pendingInvs.length > 0
              ? pendingInvs.map((inv: any) => (
                <div key={inv.id} style={{ paddingLeft: 19, marginBottom: 6 }}>
                  <div style={{ fontSize: 12, color: 'var(--text-body)' }}>{inv.name}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-subtle)' }}>Pending · current encounter</div>
                </div>
              ))
              : <p style={{ fontSize: 12, color: 'var(--text-subtle)', paddingLeft: 19, margin: '0 0 4px' }}>None pending</p>
          )}
        </div>
      </div>

      {/* Slide-out trends panel — always in DOM when vitals exist so CSS transition works */}
      {vitalsHistory.length > 0 && (
        <VitalsTrendsPanel
          open={showTrendsPanel}
          patientName={patientName}
          history={vitalsHistory}
          onClose={() => setShowTrendsPanel(false)}
        />
      )}

      {/* Slide-out investigation results panel (encounter history) */}
      <InvResultsPanel
        item={invResultsPanel}
        patientId={patientId}
        onClose={() => setInvResultsPanel(null)}
      />

      {/* Slide-out investigation results panel (recent investigations) */}
      <InvestigationResultsPanel
        item={selectedRecentInv}
        patientId={patientId}
        onClose={() => setSelectedRecentInv(null)}
      />
    </>
  );
}
