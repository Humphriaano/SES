import { useEffect, useState } from 'react';
import { usePatient } from '../../context/PatientContext';
import { useTheme } from '../../context/ThemeContext';
import { Patient } from '../../types';
import api from '../../api/client';
import { Activity, Pill, TestTube, Heart, ChevronLeft, ChevronRight, Shield } from 'lucide-react';

function HIVBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string; label: string }> = {
    POSITIVE: { bg: 'var(--badge-blue-bg)',  color: 'var(--badge-blue-text)',  label: 'HIV Positive' },
    NEGATIVE: { bg: 'var(--badge-green-bg)', color: 'var(--badge-green-text)', label: 'HIV Negative' },
    UNKNOWN:  { bg: 'transparent',           color: 'rgba(148,163,184,0.8)',   label: 'HIV Unknown'  },
  };
  const s = map[status] ?? map['UNKNOWN'];
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      background: s.bg, color: s.color,
      fontSize: 11.5, fontWeight: 600, padding: '3px 9px',
      border: `1px solid ${s.color}33`,
    }}>
      <Shield size={10} />
      {s.label}
    </div>
  );
}

export default function SidePanel() {
  const { activePatient } = usePatient();
  const { isDark } = useTheme();
  const [patient, setPatient] = useState<Patient | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  /* Polarity: sidebar mirrors the header — white on dark, black on light */
  const sidebarBg = 'var(--bg-sidebar)';
  const sidebarText = 'var(--text-sidebar)';
  const sidebarBorder = isDark ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.15)';
  const sidebarMuted = isDark ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.55)';
  const sidebarSurface = isDark ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.1)';
  const sidebarItemBorder = isDark ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.18)';
  const accentColor = 'var(--accent)';

  useEffect(() => {
    if (!activePatient) return;
    api.get(`/patients/${activePatient.id}`).then((r) => setPatient(r.data));
  }, [activePatient?.id]);

  if (!activePatient) return null;

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        style={{
          width: 28, background: sidebarBg,
          borderLeft: `1px solid ${sidebarBorder}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', border: 'none', color: sidebarMuted,
        }}
      >
        <ChevronLeft size={14} />
      </button>
    );
  }

  const age = patient
    ? Math.floor((Date.now() - new Date(patient.dateOfBirth).getTime()) / (365.25 * 24 * 3600 * 1000))
    : null;

  const latestVital = patient?.vitals?.[0];
  const activeMeds = patient?.medications?.filter((m) => !m.endDate) ?? [];
  const recentLabs = patient?.labResults?.slice(0, 5) ?? [];
  const activeDiagnoses = patient?.diagnoses?.filter((d) => !d.resolvedAt) ?? [];

  return (
    <aside style={{
      width: 260,
      background: sidebarBg,
      borderLeft: `1px solid ${sidebarBorder}`,
      overflowY: 'auto', flexShrink: 0, display: 'flex', flexDirection: 'column',
      transition: 'background-color 0.2s, border-color 0.2s',
    }}>
      {/* Panel header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 14px',
        borderBottom: `1px solid ${sidebarBorder}`,
        position: 'sticky', top: 0, zIndex: 1,
        background: sidebarBg,
      }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, color: sidebarMuted, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          Patient Summary
        </span>
        <button onClick={() => setCollapsed(true)} style={{
          background: sidebarSurface,
          border: `1px solid ${sidebarItemBorder}`,
          padding: '3px 5px', cursor: 'pointer', color: sidebarMuted, display: 'flex',
        }}>
          <ChevronRight size={13} />
        </button>
      </div>

      {patient ? (
        <div style={{ padding: '14px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Demographics */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <div style={{
              width: 40, height: 40, flexShrink: 0,
              background: accentColor,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 14, fontWeight: 700, color: isDark ? '#000' : '#fff',
            }}>
              {patient.firstName.charAt(0)}{patient.lastName.charAt(0)}
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 13.5, color: sidebarText, lineHeight: 1.2 }}>
                {patient.firstName} {patient.lastName}
              </div>
              <div style={{ fontSize: 11.5, color: sidebarMuted, marginTop: 3 }}>
                {age} yrs · {patient.gender} {patient.nationalId && `· ${patient.nationalId}`}
              </div>
              {patient.phone && <div style={{ fontSize: 11.5, color: sidebarMuted, marginTop: 2 }}>{patient.phone}</div>}
            </div>
          </div>

          {/* HIV */}
          <Section icon={Shield} label="HIV Status" muted={sidebarMuted}>
            <HIVBadge status={patient.hivStatus} />
            {patient.hivTestDate && (
              <div style={{ fontSize: 11, color: sidebarMuted, marginTop: 4 }}>
                Last tested: {new Date(patient.hivTestDate).toLocaleDateString()}
              </div>
            )}
          </Section>

          {/* Latest vitals */}
          {latestVital && (
            <Section icon={Activity} label="Latest Vitals" muted={sidebarMuted}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {latestVital.bloodPressureSystolic && (
                  <VitalRow label="BP" value={`${latestVital.bloodPressureSystolic}/${latestVital.bloodPressureDiastolic}`} unit="mmHg" textColor={sidebarText} muted={sidebarMuted} accent={accentColor} />
                )}
                {latestVital.heartRate && <VitalRow label="HR" value={String(latestVital.heartRate)} unit="bpm" textColor={sidebarText} muted={sidebarMuted} accent={accentColor} />}
                {latestVital.temperature && <VitalRow label="Temp" value={String(latestVital.temperature)} unit="°C" textColor={sidebarText} muted={sidebarMuted} accent={accentColor} />}
                {latestVital.glucose && <VitalRow label="Glucose" value={String(latestVital.glucose)} unit="mmol/L" textColor={sidebarText} muted={sidebarMuted} accent={accentColor} />}
                {latestVital.oxygenSat && <VitalRow label="SpO₂" value={String(latestVital.oxygenSat)} unit="%" textColor={sidebarText} muted={sidebarMuted} accent={accentColor} />}
              </div>
              <div style={{ fontSize: 10.5, color: sidebarMuted, marginTop: 6, opacity: 0.6 }}>
                {new Date(latestVital.recordedAt).toLocaleDateString()}
              </div>
            </Section>
          )}

          {/* Active diagnoses */}
          {activeDiagnoses.length > 0 && (
            <Section icon={Heart} label="Active Diagnoses" muted={sidebarMuted}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {activeDiagnoses.map((d) => (
                  <div key={d.id} style={{
                    borderLeft: `2px solid ${accentColor}`,
                    padding: '5px 8px',
                    background: sidebarSurface,
                  }}>
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: accentColor, letterSpacing: '0.03em' }}>{d.icd11.code}</div>
                    <div style={{ fontSize: 11.5, color: sidebarText, lineHeight: 1.3 }}>{d.icd11.description}</div>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Medications */}
          {activeMeds.length > 0 && (
            <Section icon={Pill} label="Active Medications" muted={sidebarMuted}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {activeMeds.slice(0, 5).map((m) => (
                  <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: sidebarText }}>{m.name}</span>
                    {m.dosage && <span style={{ fontSize: 11, color: sidebarMuted }}>{m.dosage}</span>}
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Recent labs */}
          {recentLabs.length > 0 && (
            <Section icon={TestTube} label="Recent Labs" muted={sidebarMuted}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {recentLabs.map((l) => (
                  <div key={l.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 11.5, color: sidebarText }}>{l.testName}</span>
                    <span style={{
                      fontSize: 11.5, fontWeight: 700,
                      color: l.isAbnormal ? accentColor : 'var(--badge-green-text)',
                    }}>
                      {l.result} {l.unit}
                    </span>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Recent encounters */}
          {(patient.encounters?.length ?? 0) > 0 && (
            <Section icon={Activity} label="Recent Encounters" muted={sidebarMuted}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {patient.encounters?.slice(0, 3).map((e) => (
                  <div key={e.id} style={{
                    padding: '6px 8px',
                    background: sidebarSurface,
                    border: `1px solid ${sidebarItemBorder}`,
                  }}>
                    <div style={{ fontSize: 11, color: sidebarMuted }}>{new Date(e.createdAt).toLocaleDateString()}</div>
                    {e.chiefComplaint && (
                      <div style={{ fontSize: 11.5, color: sidebarText, marginTop: 2 }}>
                        {e.chiefComplaint.substring(0, 40)}{e.chiefComplaint.length > 40 ? '…' : ''}
                      </div>
                    )}
                    <span style={{
                      fontSize: 10, fontWeight: 600, padding: '1px 6px',
                      background: e.status === 'OPEN' ? 'var(--badge-green-bg)' : sidebarSurface,
                      color: e.status === 'OPEN' ? 'var(--badge-green-text)' : sidebarMuted,
                      display: 'inline-block', marginTop: 3,
                    }}>{e.status}</span>
                  </div>
                ))}
              </div>
            </Section>
          )}
        </div>
      ) : (
        <div style={{ padding: 14, color: sidebarMuted, fontSize: 12, textAlign: 'center' }}>Loading…</div>
      )}
    </aside>
  );
}

function Section({ icon: Icon, label, children, muted }: { icon: any; label: string; children: React.ReactNode; muted: string }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 8 }}>
        <Icon size={11} color={muted} />
        <span style={{ fontSize: 10, fontWeight: 700, color: muted, textTransform: 'uppercase', letterSpacing: '0.07em' }}>{label}</span>
      </div>
      {children}
    </div>
  );
}

function VitalRow({ label, value, unit, textColor, muted, accent }: {
  label: string; value: string; unit: string;
  textColor: string; muted: string; accent: string;
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ fontSize: 11.5, color: muted }}>{label}</span>
      <span style={{ fontSize: 12, fontWeight: 600, color: accent }}>
        {value} <span style={{ fontSize: 10.5, fontWeight: 400, color: muted }}>{unit}</span>
      </span>
    </div>
  );
}
