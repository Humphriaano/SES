import { useState, useEffect } from 'react';
import { ChevronDown, ChevronRight, AlertTriangle, Activity, History, Pill, FlaskConical, HeartPulse, X } from 'lucide-react';
import api from '../../api/client';
import { Patient, Encounter, Medication, Vital } from '../../types';
import { CanvasNode, ImportedBlockData, ImportedDiagnosis } from '../../types/consultation';
import { DisplayRecord, toDisplay, getStatus, calcBmi } from '../../lib/vitalsConfig';
import DiagnosisBlock from './blocks/DiagnosisBlock';
import InvestigationBlock from './blocks/InvestigationBlock';
import PrescriptionBlock from './blocks/PrescriptionBlock';
import PMHBlock from './blocks/PMHBlock';
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

// Abnormal color for the dark sidebar — electric cyan scale for visibility
function vitalColor(statusKey: string, value: number | null | undefined): string {
  const s = getStatus(statusKey, value);
  if (s === 'danger')  return '#00E5FF';
  if (s === 'warning') return '#38BDF8';
  if (s === 'caution') return '#60A5FA';
  return '#cbd5e1';
}

// ── Investigation Results slide-out panel ─────────────────────────────────────
function InvResultsPanel({ item, onClose }: { item: any; onClose: () => void }) {
  const open = !!item;
  let resultRows: any[] = [];
  if (item?.results?.[0]) {
    try { resultRows = JSON.parse(item.results[0].resultsJson); } catch {}
  }

  function rc(status: string): string {
    if (status === 'High' || status === 'Low' || status === 'Abnormal') return '#d97706';
    if (status === 'Critical' || status === 'Positive') return 'var(--accent)';
    if (status === 'Normal' || status === 'Negative') return '#16a34a';
    return '#475569';
  }

  return (
    <div
      style={{
        position: 'fixed',
        top: 96,
        right: 0,
        width: 480,
        height: 'calc(100vh - 96px)',
        background: 'var(--bg-card)',
        borderLeft: '1px solid var(--border)',
        boxShadow: '-6px 0 32px rgba(0,0,0,0.12)',
        zIndex: 41,
        display: 'flex',
        flexDirection: 'column',
        transform: open ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 0.25s ease',
      }}
    >
      <div style={{
        padding: '16px 20px 12px',
        borderBottom: '1px solid var(--border-light)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-heading)' }}>Investigation Results</div>
          {item && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{item.name}</div>}
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--text-muted)', padding: 6, borderRadius: 6,
            display: 'flex', alignItems: 'center', transition: 'background 0.15s',
          }}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-surface)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'none')}
        >
          <X size={16} />
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px 20px' }}>
        {resultRows.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 13, fontStyle: 'italic' }}>No results recorded.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['Component', 'Result', 'Units', 'Ref Range', 'Status'].map(h => (
                  <th key={h} style={{
                    textAlign: 'left', padding: '6px 10px',
                    fontSize: 10, fontWeight: 600, color: 'var(--text-body2)', textTransform: 'uppercase',
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {resultRows.map((r: any, i: number) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--border-light)' }}>
                  <td style={{ padding: '8px 10px', color: 'var(--text-heading)', fontWeight: 500 }}>{r.componentName}</td>
                  <td style={{ padding: '8px 10px', fontWeight: 700, color: rc(r.status) }}>{r.value || '—'}</td>
                  <td style={{ padding: '8px 10px', color: 'var(--text-body2)' }}>{r.units ?? '—'}</td>
                  <td style={{ padding: '8px 10px', color: 'var(--text-body2)', fontSize: 12 }}>{r.referenceRange ?? '—'}</td>
                  <td style={{ padding: '8px 10px' }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: rc(r.status) }}>{r.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {item?.results?.[0] && (
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 12 }}>
            {item.results[0].amendedAt
              ? `Amended ${new Date(item.results[0].amendedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`
              : `Resulted ${new Date(item.results[0].resultedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`
            }
          </div>
        )}
      </div>
    </div>
  );
}

function buildImportData(enc: Encounter, nodes: CanvasNode[], dbPrescriptions: any[], invItems: any[]): ImportedBlockData {
  const STRUCT_TYPES = ['diagnosis', 'investigation', 'prescription', 'pmh'];

  // Find the index range of structural blocks
  const firstStructIdx = nodes.findIndex(n => STRUCT_TYPES.includes(n.type));
  const lastStructIdx = firstStructIdx === -1 ? -1
    : nodes.length - 1 - [...nodes].reverse().findIndex(n => STRUCT_TYPES.includes(n.type));

  // Text nodes before the first structural block
  const preNodes = (firstStructIdx === -1 ? nodes : nodes.slice(0, firstStructIdx))
    .filter(n => n.type === 'text');

  // Text nodes after the last structural block
  const postNodes = (firstStructIdx === -1 ? [] : nodes.slice(lastStructIdx + 1))
    .filter(n => n.type === 'text');

  const toText = (n: CanvasNode) => (n as Extract<CanvasNode, { type: 'text' }>).content.trim();

  const preBlockTexts = preNodes.map(toText).filter(Boolean);
  const postBlockTexts = postNodes.map(toText).filter(Boolean);

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
    items.forEach(item => rxParts.push(`${item.drugName} ${item.dose} ${item.frequency}`.trim()));
  });
  if (rxParts.length === 0 && dbPrescriptions.length > 0) {
    dbPrescriptions.forEach((rx: any) => {
      const parts = [rx.medication?.name, rx.medication?.dosage, rx.medication?.frequency].filter(Boolean);
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
    diagnoses,
    prescriptionSummary: rxParts.filter(Boolean).join(', '),
    investigationSummary: invParts.join(', '),
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
  const [encDetails, setEncDetails] = useState<Record<string, { hpi?: string; examination?: string }>>({});

  useEffect(() => {
    api.get(`/patients/${patientId}/medications`).then(r => setMedications(r.data)).catch(() => {});
    api.get(`/patients/${patientId}/vitals`).then(r => {
      const mapped = (r.data as (Vital & { bmi?: number | null })[])
        .map(v => ({ ...toDisplay(v), bmi: v.bmi ?? calcBmi(v.weight, v.height) }))
        .sort((a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime());
      setVitalsHistory(mapped);
    }).catch(() => {});
    api.get(`/investigations/orders?patientId=${patientId}`)
      .then(r => {
        const STATUS_RANK: Record<string, number> = { Resulted: 0, Amended: 1, 'In Progress': 2, Pending: 3 };
        const items: any[] = r.data.flatMap((o: any) => o.items ?? []);
        items.sort((a, b) => (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9));
        setRecentInvestigations(items);
      })
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
        setEncDetails(prev => ({ ...prev, [enc.id]: { hpi: data.hpi ?? '', examination: data.examination ?? '' } }));
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
    if (status === 'High' || status === 'Low' || status === 'Abnormal') return '#38BDF8';
    if (status === 'Critical' || status === 'Positive') return '#00E5FF';
    if (status === 'Normal' || status === 'Negative') return '#16a34a';
    return '#94a3b8';
  }

  function renderDispensingStatus(prescriptionId: string | undefined, prescribedDrug: string) {
    if (!prescriptionId) return null;
    const dispense = patientDispensing[prescriptionId];
    if (!dispense) {
      return <span style={{ fontSize: 10, color: '#64748b' }}>Not dispensed</span>;
    }
    if (dispense.dispensedDrug && dispense.dispensedDrug.toLowerCase() !== prescribedDrug.toLowerCase()) {
      return (
        <span style={{ fontSize: 10, color: '#60A5FA', fontWeight: 500 }}>
          Dispensed as {dispense.dispensedDrug}
        </span>
      );
    }
    return <span style={{ fontSize: 10, color: '#16a34a', fontWeight: 500 }}>Dispensed</span>;
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
          <Icon size={12} color="#64748b" />
          <span style={{ fontSize: 10.5, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            {label}
          </span>
          {!!count && count > 0 && (
            <span style={{ fontSize: 10, background: '#2979FF', color: '#fff', borderRadius: 10, padding: '1px 5px', fontWeight: 700 }}>
              {count}
            </span>
          )}
        </div>
        {open[k] ? <ChevronDown size={11} color="#475569" /> : <ChevronRight size={11} color="#475569" />}
      </button>
    );
  }

  // ── Vital cell in the 2-col grid ──────────────────────────────────────────
  function VitalCell({ label, displayValue, statusKey, rawValue }: {
    label: string; displayValue: string | null; statusKey: string; rawValue: number | null | undefined;
  }) {
    const color = displayValue !== null ? vitalColor(statusKey, rawValue) : '#374151';
    return (
      <div style={{ minWidth: 0, borderLeft: '2px solid rgba(0,229,255,0.5)', paddingLeft: 6 }}>
        <div style={{ fontSize: 9, fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>
          {label}
        </div>
        <div style={{ fontSize: 13, fontWeight: 700, color, lineHeight: 1.2 }}>
          {displayValue ?? '—'}
        </div>
      </div>
    );
  }

  // ── Labelled sub-section inside an expanded encounter card ───────────────
  function EncSummarySection({ label, children }: { label: string; children: React.ReactNode }) {
    return (
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 9, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>
          {label}
        </div>
        {children}
      </div>
    );
  }

  // ── Section divider with centred hex pip ──────────────────────────────────
  function HexDivider() {
    return (
      <div style={{ display: 'flex', alignItems: 'center', margin: '4px 0 8px' }}>
        <div style={{ flex: 1, height: 1, background: '#2D3748' }} />
        <svg width="8" height="8" viewBox="0 0 8 8" style={{ margin: '0 4px', flexShrink: 0 }}>
          <polygon points="4,0 8,2 8,6 4,8 0,6 0,2" fill="#2D3748" />
        </svg>
        <div style={{ flex: 1, height: 1, background: '#2D3748' }} />
      </div>
    );
  }

  const patientName = patient ? `${patient.firstName} ${patient.lastName}` : '';

  return (
    <>
      <div style={{
        width: 264, flexShrink: 0,
        background: '#252A2D',
        overflowY: 'auto',
        padding: '14px 14px',
        borderRight: '1px solid #2D3748',
        position: 'sticky',
        top: 0,
        alignSelf: 'flex-start',
        maxHeight: 'calc(100vh - 112px)',
      }}>
        {/* Patient header */}
        {patient && (
          <div style={{ marginBottom: 14, paddingBottom: 12, borderBottom: '1px solid #2D3748' }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#f1f5f9' }}>
              {patient.firstName} {patient.lastName}
            </div>
            <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
              {calcAge(patient.dateOfBirth)} yrs · {patient.gender} · {patient.nationalId ?? 'No NRC'}
            </div>
            {patient.hivStatus === 'POSITIVE' && (
              <div style={{ marginTop: 6, fontSize: 11, fontWeight: 700, background: 'var(--badge-blue-bg)', color: 'var(--badge-blue-text)', padding: '3px 8px', display: 'inline-block' }}>
                HIV+
              </div>
            )}
          </div>
        )}

        {/* Allergies — only rendered when the patient has recorded allergies */}
        {patient?.allergies && patient.allergies.length > 0 && (
          <div style={{ marginBottom: 12, background: 'var(--badge-blue-bg)', border: '1px solid var(--accent-border)', padding: '8px 10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <AlertTriangle size={11} color="var(--accent)" />
              <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--badge-blue-text)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Allergies</span>
            </div>
            {patient.allergies.map((a, i) => (
              <p key={i} style={{ fontSize: 12, color: 'var(--badge-blue-text)', margin: i < patient.allergies!.length - 1 ? '0 0 2px' : 0 }}>{a}</p>
            ))}
          </div>
        )}

        {/* Active Conditions */}
        <div>
          <SectionHeader k="conditions" label="Active Conditions" Icon={Activity} count={activeConditions.length} />
          {open.conditions && (
            activeConditions.length > 0
              ? activeConditions.map(d => (
                <div key={d.id} style={{ paddingLeft: 19, marginBottom: 7 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: '#2979FF', fontFamily: 'monospace' }}>{d.icd11.code}</span>
                    <span style={{ fontSize: 12, color: '#cbd5e1' }}>{d.icd11.description}</span>
                  </div>
                  <div style={{ fontSize: 10, color: '#475569', marginTop: 1 }}>
                    {new Date(d.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </div>
                </div>
              ))
              : <p style={{ fontSize: 12, color: '#475569', paddingLeft: 19, margin: '0 0 4px' }}>None on record</p>
          )}
          <HexDivider />
        </div>

        {/* Latest Vitals — only rendered if a reading exists */}
        {latestVital && (
          <div>
            <SectionHeader k="vitals" label="Latest Vitals" Icon={HeartPulse} />
            {open.vitals && (
              <div style={{ paddingLeft: 4 }}>
                {/* Timestamp */}
                <div style={{ fontSize: 10, color: '#475569', marginBottom: 8 }}>
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

                {/* View Trends button — horizontal hex clip */}
                <button
                  onClick={() => setShowTrendsPanel(true)}
                  style={{
                    width: '100%', padding: '6px 0',
                    background: 'rgba(45,55,72,0.7)', border: 'none',
                    clipPath: 'polygon(8px 0%, calc(100% - 8px) 0%, 100% 50%, calc(100% - 8px) 100%, 8px 100%, 0% 50%)',
                    cursor: 'pointer',
                    fontSize: 11, fontWeight: 600, color: '#64748b',
                    letterSpacing: '0.02em', transition: 'background 0.15s, color 0.15s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(71,85,105,0.7)'; e.currentTarget.style.color = '#94a3b8'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'rgba(45,55,72,0.7)'; e.currentTarget.style.color = '#64748b'; }}
                >
                  View Trends
                </button>
              </div>
            )}
            <HexDivider />
          </div>
        )}

        {/* Previous Encounters */}
        <div>
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
                        width: '100%', textAlign: 'left', background: isExpanded ? '#1E2427' : 'none',
                        border: 'none', cursor: 'pointer', borderRadius: 6, padding: '6px 8px 6px 19px',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ fontSize: 12, color: '#cbd5e1', fontWeight: 500 }}>
                          {new Date(enc.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </div>
                        {isExpanded
                          ? <ChevronDown size={10} color="#64748b" />
                          : <ChevronRight size={10} color="#64748b" />
                        }
                      </div>
                      {enc.chiefComplaint && (
                        <div style={{ fontSize: 11, color: '#64748b', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {enc.chiefComplaint}
                        </div>
                      )}
                      {enc.clinician?.name && (
                        <div style={{ fontSize: 10, color: '#475569' }}>Dr. {enc.clinician.name}</div>
                      )}
                    </button>

                    {isExpanded && (
                      <div style={{
                        marginLeft: 10, marginTop: 6, marginBottom: 4,
                        borderLeft: '2px solid #374151', paddingLeft: 10,
                      }}>
                        {nodes == null ? (
                          <p style={{ fontSize: 11, color: '#475569', fontStyle: 'italic', margin: '4px 0' }}>Loading…</p>
                        ) : (
                          <>
                            {/* History — canvas free-text narrative (all text nodes, plus legacy hpi field) */}
                            {(() => {
                              const canvasTexts = nodes
                                .filter(n => n.type === 'text' && (n as any).content?.trim())
                                .map((n: any) => n.content as string);
                              const hpi = encDetails[enc.id]?.hpi || '';
                              const allLines = hpi ? [hpi, ...canvasTexts] : canvasTexts;
                              if (allLines.length === 0) return null;
                              return (
                                <EncSummarySection label="History">
                                  {allLines.map((text, i) => (
                                    <p key={i} style={{ fontSize: 11, color: '#94a3b8', margin: '0 0 4px', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                                      {text}
                                    </p>
                                  ))}
                                </EncSummarySection>
                              );
                            })()}

                            {/* Examination */}
                            {encDetails[enc.id]?.examination && (
                              <EncSummarySection label="Examination">
                                <p style={{ fontSize: 11, color: '#94a3b8', margin: 0, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{encDetails[enc.id].examination}</p>
                              </EncSummarySection>
                            )}

                            {/* Diagnoses — deduplicated by ICD code */}
                            {enc.diagnoses && enc.diagnoses.length > 0 && (() => {
                              const seen = new Set<string>();
                              const unique = enc.diagnoses!.filter(d => {
                                if (seen.has(d.icd11.code)) return false;
                                seen.add(d.icd11.code);
                                return true;
                              });
                              return (
                                <EncSummarySection label="Diagnoses">
                                  {unique.map(d => (
                                    <div key={d.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 5, marginBottom: 4 }}>
                                      <span style={{ fontSize: 9, fontWeight: 700, color: '#2979FF', background: 'rgba(41,121,255,0.1)', padding: '1px 5px', borderRadius: 3, fontFamily: 'monospace', flexShrink: 0, marginTop: 1 }}>Dx</span>
                                      <div style={{ minWidth: 0 }}>
                                        <span style={{ fontSize: 10, fontWeight: 700, color: '#2979FF', fontFamily: 'monospace' }}>{d.icd11.code} </span>
                                        <span style={{ fontSize: 11, color: '#94a3b8' }}>{d.icd11.description}</span>
                                        {d.isPrimary && <span style={{ fontSize: 9, color: '#475569', marginLeft: 4 }}>(primary)</span>}
                                      </div>
                                    </div>
                                  ))}
                                </EncSummarySection>
                              );
                            })()}

                            {/* Vitals at time of encounter */}
                            {enc.vitals && enc.vitals.length > 0 && (() => {
                              const v = [...enc.vitals!].sort((a, b) => new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime())[0];
                              const bmi = v.weight && v.height ? (v.weight / Math.pow(v.height / 100, 2)).toFixed(1) : null;
                              const pairs: [string, string][] = [];
                              if (v.bloodPressureSystolic && v.bloodPressureDiastolic) pairs.push(['BP', `${v.bloodPressureSystolic}/${v.bloodPressureDiastolic} mmHg`]);
                              if (v.heartRate) pairs.push(['HR', `${v.heartRate} bpm`]);
                              if (v.temperature) pairs.push(['Temp', `${v.temperature} °C`]);
                              if (v.oxygenSat) pairs.push(['SpO₂', `${v.oxygenSat}%`]);
                              if (v.glucose) pairs.push(['Glucose', `${v.glucose} mmol/L`]);
                              if (bmi) pairs.push(['BMI', bmi]);
                              if (pairs.length === 0) return null;
                              return (
                                <EncSummarySection label="Vitals">
                                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3px 8px' }}>
                                    {pairs.map(([label, val]) => (
                                      <div key={label} style={{ fontSize: 11 }}>
                                        <span style={{ fontSize: 9, fontWeight: 600, color: '#64748b', textTransform: 'uppercase' }}>{label} </span>
                                        <span style={{ color: '#94a3b8' }}>{val}</span>
                                      </div>
                                    ))}
                                  </div>
                                </EncSummarySection>
                              );
                            })()}

                            {/* Investigations ordered in this encounter */}
                            {encInvestigations[enc.id]?.length > 0 && (
                              <EncSummarySection label="Investigations">
                                {encInvestigations[enc.id].map((item: any) => {
                                  const sClr: Record<string, string> = {
                                    Resulted: '#6ee7b7', Amended: '#fcd34d', 'In Progress': '#93c5fd', Pending: '#64748b',
                                  };
                                  const isResulted = item.status === 'Resulted' || item.status === 'Amended';
                                  return (
                                    <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
                                      <span style={{ fontSize: 9, fontWeight: 700, color: '#00897B', background: '#CCFBF1', padding: '1px 5px', borderRadius: 3, fontFamily: 'monospace', flexShrink: 0 }}>Inv</span>
                                      <span style={{ fontSize: 11, color: '#94a3b8', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</span>
                                      <span style={{ fontSize: 9, fontWeight: 600, color: sClr[item.status] ?? '#64748b', flexShrink: 0 }}>{item.status}</span>
                                      {isResulted && (
                                        <button
                                          onClick={() => setInvResultsPanel(item)}
                                          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 9, color: '#00897B', padding: 0, flexShrink: 0, fontFamily: 'inherit' }}
                                        >
                                          ↗
                                        </button>
                                      )}
                                    </div>
                                  );
                                })}
                              </EncSummarySection>
                            )}

                            {/* Prescriptions issued in this encounter */}
                            {encDbPrescriptions[enc.id]?.length > 0 && (
                              <EncSummarySection label="Prescriptions">
                                {encDbPrescriptions[enc.id].map((rx: any) => (
                                  <div key={rx.id} style={{ marginBottom: 4 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                      <span style={{ fontSize: 9, fontWeight: 700, color: '#1565C0', background: '#DBEAFE', padding: '1px 5px', borderRadius: 3, fontFamily: 'monospace', flexShrink: 0 }}>Rx</span>
                                      <span style={{ fontSize: 11, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {[rx.medication?.name, rx.medication?.dosage, rx.medication?.frequency].filter(Boolean).join(' ')}
                                      </span>
                                    </div>
                                    <div style={{ marginLeft: 37, marginTop: 1 }}>
                                      {renderDispensingStatus(rx.id, rx.medication?.name ?? '')}
                                    </div>
                                  </div>
                                ))}
                              </EncSummarySection>
                            )}

                            {/* Nothing at all */}
                            {!encDetails[enc.id]?.hpi &&
                             !encDetails[enc.id]?.examination &&
                             nodes.filter(n => n.type === 'text' && (n as any).content?.trim()).length === 0 &&
                             (!enc.diagnoses || enc.diagnoses.length === 0) &&
                             (!enc.vitals || enc.vitals.length === 0) &&
                             !encInvestigations[enc.id]?.length && !encDbPrescriptions[enc.id]?.length && (
                              <p style={{ fontSize: 11, color: '#475569', fontStyle: 'italic', margin: '4px 0' }}>No encounter details on record.</p>
                            )}
                          </>
                        )}

                        {/* Import button — at bottom, only on ConsultationPage */}
                        {nodes != null && onImportEncounter && (
                          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
                            <button
                              onClick={() => onImportEncounter(
                                buildImportData(enc, nodes, encDbPrescriptions[enc.id] ?? [], encInvestigations[enc.id] ?? [])
                              )}
                              style={{
                                display: 'inline-flex', alignItems: 'center', gap: 4,
                                fontSize: 10, padding: '3px 8px',
                                border: '1px solid #374151', borderRadius: 4,
                                color: '#64748b', background: 'none', cursor: 'pointer',
                                fontFamily: 'inherit', fontWeight: 500,
                                transition: 'border-color 0.12s, color 0.12s',
                              }}
                              onMouseEnter={e => { e.currentTarget.style.borderColor = '#475569'; e.currentTarget.style.color = '#94a3b8'; }}
                              onMouseLeave={e => { e.currentTarget.style.borderColor = '#374151'; e.currentTarget.style.color = '#64748b'; }}
                            >
                              ↓ Import to canvas
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
              : <p style={{ fontSize: 12, color: '#475569', paddingLeft: 19, margin: '0 0 4px' }}>No previous encounters</p>
          )}
          <HexDivider />
        </div>

        {/* Active Prescriptions */}
        <div>
          <SectionHeader k="prescriptions" label="Active Prescriptions" Icon={Pill} count={activeMeds.length} />
          {open.prescriptions && (
            activeMeds.length > 0
              ? activeMeds.map(m => (
                <div key={m.id} style={{ paddingLeft: 19, marginBottom: 7 }}>
                  <div style={{ fontSize: 12, color: '#cbd5e1', fontWeight: 500 }}>{m.name}</div>
                  <div style={{ fontSize: 11, color: '#64748b' }}>{m.dosage}{m.frequency ? ` · ${m.frequency}` : ''}</div>
                </div>
              ))
              : <p style={{ fontSize: 12, color: '#475569', paddingLeft: 19, margin: '0 0 4px' }}>No active prescriptions</p>
          )}
          <HexDivider />
        </div>

        {/* Recent Investigations (from V2 orders API — last 3 items) */}
        <div>
          <SectionHeader k="recentInvestigations" label="Recent Investigations" Icon={FlaskConical} count={recentInvestigations.length} />
          {open.recentInvestigations && (
            recentInvestigations.length > 0
              ? recentInvestigations.map((item: any) => {
                  const statusMap: Record<string, { bg: string; color: string }> = {
                    Pending:       { bg: '#1E2427', color: '#94a3b8' },
                    'In Progress': { bg: '#1e3a5f', color: '#93c5fd' },
                    Resulted:      { bg: '#14311f', color: '#6ee7b7' },
                    Amended:       { bg: '#2d2008', color: '#fcd34d' },
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
                        <div style={{ fontSize: 12, color: '#cbd5e1', fontWeight: 500, marginBottom: 2 }}>
                          {item.name}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{
                            fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 10,
                            background: s.bg, color: s.color,
                          }}>
                            {item.status}
                          </span>
                          {item.specimen && (
                            <span style={{ fontSize: 10, color: '#475569' }}>{item.specimen}</span>
                          )}
                        </div>
                      </div>
                      <ChevronRight size={11} color="#475569" style={{ flexShrink: 0 }} />
                    </div>
                  ) : (
                    <div key={item.id} style={{ paddingLeft: 19, marginBottom: 8 }}>
                      <div style={{ fontSize: 12, color: '#cbd5e1', fontWeight: 500, marginBottom: 2 }}>
                        {item.name}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{
                          fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 10,
                          background: s.bg, color: s.color,
                        }}>
                          {item.status}
                        </span>
                        {item.specimen && (
                          <span style={{ fontSize: 10, color: '#475569' }}>{item.specimen}</span>
                        )}
                      </div>
                    </div>
                  );
                })
              : <p style={{ fontSize: 12, color: '#475569', paddingLeft: 19, margin: '0 0 4px' }}>None on record</p>
          )}
          <HexDivider />
        </div>

        {/* Pending Investigations (from current canvas) */}
        <div style={{ paddingBottom: 8 }}>
          <SectionHeader k="investigations" label="Pending (This Visit)" Icon={FlaskConical} count={pendingInvs.length} />
          {open.investigations && (
            pendingInvs.length > 0
              ? pendingInvs.map((inv: any) => (
                <div key={inv.id} style={{ paddingLeft: 19, marginBottom: 6 }}>
                  <div style={{ fontSize: 12, color: '#cbd5e1' }}>{inv.name}</div>
                  <div style={{ fontSize: 10, color: '#475569' }}>Pending · current encounter</div>
                </div>
              ))
              : <p style={{ fontSize: 12, color: '#475569', paddingLeft: 19, margin: '0 0 4px' }}>None pending</p>
          )}
        </div>

        {/* Ghost hex watermark — decorative, bottom-right of sidebar */}
        <div style={{ position: 'relative', height: 80, overflow: 'hidden', marginTop: 8, pointerEvents: 'none' }}>
          <svg
            width="140" height="120"
            viewBox="0 0 140 120"
            fill="none"
            style={{ position: 'absolute', bottom: -24, right: -24 }}
          >
            <polygon
              points="35,2 105,2 140,60 105,118 35,118 0,60"
              stroke="#FFFFFF" strokeWidth="1.5" fill="none" opacity="0.04"
            />
            <polygon
              points="47,16 93,16 116,60 93,104 47,104 24,60"
              stroke="#FFFFFF" strokeWidth="1" fill="none" opacity="0.04"
            />
          </svg>
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
