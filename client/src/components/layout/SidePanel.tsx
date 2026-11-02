import { useEffect, useState } from 'react';
import { usePatient } from '../../context/PatientContext';
import { Patient } from '../../types';
import api from '../../api/client';
import toast from 'react-hot-toast';
import { Activity, Pill, TestTube, Heart, ChevronLeft, ChevronRight, Shield, Smartphone, Send, CalendarCheck, Pencil } from 'lucide-react';
import RegisterModal from '../RegisterModal';

function HIVBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string; label: string }> = {
    POSITIVE: { bg: 'var(--badge-red-bg)',   color: 'var(--badge-red-text)',   label: 'HIV Positive' },
    NEGATIVE: { bg: 'var(--badge-green-bg)', color: 'var(--badge-green-text)', label: 'HIV Negative' },
    UNKNOWN:  { bg: 'var(--bg-surface)',     color: 'var(--text-muted)',        label: 'HIV Unknown'  },
  };
  const s = map[status] ?? map['UNKNOWN'];
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      background: s.bg, color: s.color,
      fontSize: 11.5, fontWeight: 600, padding: '3px 9px', borderRadius: 20,
      border: `1px solid ${s.color}22`,
    }}>
      <Shield size={10} />
      {s.label}
    </div>
  );
}

export default function SidePanel() {
  const { activePatient, setActivePatient } = usePatient();
  const [patient, setPatient] = useState<Patient | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [togglingPortal, setTogglingPortal] = useState(false);
  const [sendingInvite, setSendingInvite] = useState(false);
  const [showEditProfile, setShowEditProfile] = useState(false);

  function handleProfileSaved(updated: Patient) {
    setPatient((p) => (p ? { ...p, ...updated } : updated));
    setActivePatient(updated);
  }

  useEffect(() => {
    if (!activePatient) return;
    api.get(`/patients/${activePatient.id}`).then((r) => setPatient(r.data));
  }, [activePatient?.id]);

  async function togglePortalAccess() {
    if (!patient) return;
    setTogglingPortal(true);
    try {
      const { data } = await api.patch(`/patients/${patient.id}`, { portalEnabled: !patient.portalEnabled });
      setPatient((p) => (p ? { ...p, portalEnabled: data.portalEnabled } : p));
    } catch {
      toast.error("Couldn't update portal access");
    } finally {
      setTogglingPortal(false);
    }
  }

  async function sendPortalInvitation() {
    if (!patient) return;
    setSendingInvite(true);
    try {
      await api.post(`/patients/${patient.id}/portal-invite`);
      setPatient((p) => (p ? { ...p, portalEnabled: true } : p));
      toast.success('Portal invitation sent');
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? "Couldn't send invitation");
    } finally {
      setSendingInvite(false);
    }
  }

  if (!activePatient) return null;

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        style={{
          width: 28, background: 'var(--bg-card)', borderLeft: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', border: 'none', color: 'var(--text-subtle)',
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
      width: 260, background: 'var(--bg-card)', borderLeft: '1px solid var(--border)',
      overflowY: 'auto', flexShrink: 0, display: 'flex', flexDirection: 'column',
      transition: 'background-color 0.2s, border-color 0.2s',
    }}>
      {/* Panel header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 14px', background: 'var(--bg-nav)', position: 'sticky', top: 0, zIndex: 1,
        transition: 'background-color 0.2s',
      }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, color: '#94a3b8', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          Patient Summary
        </span>
        <button onClick={() => setCollapsed(true)} style={{
          background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: 5,
          padding: '3px 5px', cursor: 'pointer', color: '#9ca3af', display: 'flex',
        }}>
          <ChevronRight size={13} />
        </button>
      </div>

      {patient ? (
        <div style={{ padding: '14px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Name, age, NRC and phone live in the patient banner above — not repeated here. */}

          {/* Portal access */}
          <Section icon={Smartphone} label="Portal Access">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{
                fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20,
                background: patient.portalEnabled ? 'var(--badge-green-bg)' : 'var(--bg-surface)',
                color: patient.portalEnabled ? 'var(--badge-green-text)' : 'var(--text-muted)',
              }}>
                {patient.portalEnabled ? 'Enabled' : 'Disabled'}
              </span>
              <button
                onClick={togglePortalAccess}
                disabled={togglingPortal}
                style={{
                  fontSize: 10.5, fontWeight: 600, background: 'none', border: '1px solid var(--border)',
                  borderRadius: 6, padding: '3px 8px', cursor: 'pointer', color: 'var(--text-body)',
                }}
              >
                {patient.portalEnabled ? 'Disable' : 'Enable'}
              </button>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginBottom: 8 }}>
              {patient.portalLastSeenAt
                ? `Last seen ${new Date(patient.portalLastSeenAt).toLocaleDateString()}`
                : patient.portalEnabled ? 'Never logged in' : 'Not yet invited'}
            </div>
            <button
              onClick={sendPortalInvitation}
              disabled={sendingInvite || !patient.email}
              title={!patient.email ? 'Add an email address to send a portal invitation' : undefined}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, width: '100%', justifyContent: 'center',
                fontSize: 11.5, fontWeight: 600, padding: '6px 10px', borderRadius: 7,
                background: patient.email ? 'var(--ses-red-tint)' : 'var(--bg-surface)',
                color: patient.email ? 'var(--ses-red)' : 'var(--text-muted)',
                border: 'none', cursor: patient.email ? 'pointer' : 'not-allowed',
              }}
            >
              <Send size={11} />
              {sendingInvite ? 'Sending…' : 'Send Portal Invitation'}
            </button>
          </Section>

          {/* HIV */}
          <Section icon={Shield} label="HIV Status">
            <HIVBadge status={patient.hivStatus} />
            {patient.hivTestDate && (
              <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 4 }}>
                Last tested: {new Date(patient.hivTestDate).toLocaleDateString()}
              </div>
            )}
          </Section>

          {/* Latest vitals */}
          {latestVital && (
            <Section icon={Activity} label="Latest Vitals">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {latestVital.bloodPressureSystolic && (
                  <VitalRow label="BP" value={`${latestVital.bloodPressureSystolic}/${latestVital.bloodPressureDiastolic}`} unit="mmHg" />
                )}
                {latestVital.heartRate && <VitalRow label="HR" value={String(latestVital.heartRate)} unit="bpm" />}
                {latestVital.temperature && <VitalRow label="Temp" value={String(latestVital.temperature)} unit="°C" />}
                {latestVital.glucose && <VitalRow label="Glucose" value={String(latestVital.glucose)} unit="mmol/L" />}
                {latestVital.oxygenSat && <VitalRow label="SpO₂" value={String(latestVital.oxygenSat)} unit="%" />}
              </div>
              <div style={{ fontSize: 10.5, color: 'var(--text-faint)', marginTop: 6 }}>
                {new Date(latestVital.recordedAt).toLocaleDateString()}
              </div>
            </Section>
          )}

          {/* Appointments */}
          {(patient.appointments?.length ?? 0) > 0 && (
            <Section icon={CalendarCheck} label="Appointments">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {patient.appointments?.slice(0, 5).map((a) => (
                  <div key={a.id} style={{
                    padding: '6px 8px', background: 'var(--bg-surface)', borderRadius: 7,
                    border: '1px solid var(--border)',
                  }}>
                    <div style={{ fontSize: 11.5, color: 'var(--text-body)' }}>
                      {new Date(a.scheduledAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 3 }}>
                      <span style={{
                        fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 10,
                        background: a.status === 'CONFIRMED' || a.status === 'COMPLETED' ? 'var(--badge-green-bg)' : 'var(--bg-card)',
                        color: a.status === 'CONFIRMED' || a.status === 'COMPLETED' ? 'var(--badge-green-text)' : 'var(--text-muted)',
                      }}>{a.status}</span>
                      {a.confirmedVia && (
                        <span style={{ fontSize: 10, color: 'var(--text-subtle)' }}>
                          via {a.confirmedVia === 'PORTAL' ? 'portal' : 'email link'}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Active diagnoses */}
          {activeDiagnoses.length > 0 && (
            <Section icon={Heart} label="Active Diagnoses">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {activeDiagnoses.map((d) => (
                  <div key={d.id} style={{
                    background: 'var(--ses-blue-tint)', border: '1px solid #BEDAEA',
                    borderRadius: 7, padding: '5px 8px',
                  }}>
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--badge-red-text)', letterSpacing: '0.03em' }}>{d.icd11.code}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-body)', lineHeight: 1.3 }}>{d.icd11.description}</div>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Medications */}
          {activeMeds.length > 0 && (
            <Section icon={Pill} label="Active Medications">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {activeMeds.slice(0, 5).map((m) => (
                  <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-body)' }}>{m.name}</span>
                    {m.dosage && <span style={{ fontSize: 11, color: 'var(--text-subtle)' }}>{m.dosage}</span>}
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Recent labs */}
          {recentLabs.length > 0 && (
            <Section icon={TestTube} label="Recent Labs">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {recentLabs.map((l) => (
                  <div key={l.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 11.5, color: 'var(--text-body)' }}>{l.testName}</span>
                    <span style={{
                      fontSize: 11.5, fontWeight: 700,
                      color: l.isAbnormal ? 'var(--badge-red-text)' : 'var(--badge-green-text)',
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
            <Section icon={Activity} label="Recent Encounters">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {patient.encounters?.slice(0, 3).map((e) => (
                  <div key={e.id} style={{
                    padding: '6px 8px', background: 'var(--bg-surface)', borderRadius: 7,
                    border: '1px solid var(--border)',
                  }}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{new Date(e.createdAt).toLocaleDateString()}</div>
                    {e.chiefComplaint && (
                      <div style={{ fontSize: 11.5, color: 'var(--text-body)', marginTop: 2 }}>
                        {e.chiefComplaint.substring(0, 40)}{e.chiefComplaint.length > 40 ? '…' : ''}
                      </div>
                    )}
                    <span style={{
                      fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 10,
                      background: e.status === 'OPEN' ? 'var(--badge-green-bg)' : 'var(--badge-gray-bg)',
                      color: e.status === 'OPEN' ? 'var(--badge-green-text)' : 'var(--badge-gray-text)',
                      display: 'inline-block', marginTop: 3,
                    }}>{e.status}</span>
                  </div>
                ))}
              </div>
            </Section>
          )}
        </div>
      ) : (
        <div style={{ padding: 14, color: 'var(--text-subtle)', fontSize: 12, textAlign: 'center' }}>Loading…</div>
      )}
    </aside>
  );
}

function Section({ icon: Icon, label, children }: { icon: any; label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 8 }}>
        <Icon size={11} color="var(--text-subtle)" />
        <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{label}</span>
      </div>
      {children}
    </div>
  );
}

function VitalRow({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-heading)' }}>
        {value} <span style={{ fontSize: 10.5, fontWeight: 400, color: 'var(--text-subtle)' }}>{unit}</span>
      </span>
    </div>
  );
}
