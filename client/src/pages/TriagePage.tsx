import { useEffect, useState, FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import api from '../api/client';
import { usePatient } from '../context/PatientContext';
import { ClipboardCheck, Plus, Clock, AlertTriangle, CheckCircle } from 'lucide-react';
import toast from 'react-hot-toast';

interface TriageRecord {
  id: string;
  encounterId: string;
  arrivalTime: string;
  chiefComplaint: string;
  priority: 'IMMEDIATE' | 'URGENT' | 'LESS_URGENT' | 'NON_URGENT';
  notes?: string;
  systolic?: number;
  diastolic?: number;
  heartRate?: number;
  temperature?: number;
  oxygenSat?: number;
  createdAt: string;
}

const PRIORITY_CONFIG = {
  IMMEDIATE:   { label: 'Immediate',   color: 'var(--clinical-critical)', bg: 'var(--clinical-critical-bg)', border: '#F6C9B8', code: 'P1' },
  URGENT:      { label: 'Urgent',      color: 'var(--clinical-abnormal)', bg: 'var(--clinical-abnormal-bg)', border: '#F6C9B8', code: 'P2' },
  LESS_URGENT: { label: 'Less Urgent', color: 'var(--clinical-caution)',  bg: 'var(--clinical-caution-bg)',  border: '#fde68a', code: 'P3' },
  NON_URGENT:  { label: 'Non-Urgent',  color: 'var(--clinical-normal)',   bg: 'var(--clinical-normal-bg)',   border: '#bbf7d0', code: 'P4' },
};

export default function TriagePage() {
  const { patientId } = useParams<{ patientId: string }>();
  const { setActivePatient, activeEncounterId, setActiveEncounterId } = usePatient();
  const [triageRecords, setTriageRecords] = useState<TriageRecord[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    chiefComplaint: '',
    priority: 'URGENT' as TriageRecord['priority'],
    notes: '',
    systolic: '', diastolic: '', heartRate: '', temperature: '', oxygenSat: '',
  });

  useEffect(() => {
    if (!patientId) return;
    api.get(`/patients/${patientId}`).then((r) => setActivePatient(r.data));
    loadTriage();
  }, [patientId]);

  async function loadTriage() {
    try {
      const { data } = await api.get(`/patients/${patientId}/triage`);
      setTriageRecords(data);
    } catch {
      setTriageRecords([]);
    }
  }

  function set(field: string, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      // Create encounter if none active
      let encId = activeEncounterId;
      if (!encId) {
        const { data: enc } = await api.post(`/patients/${patientId}/encounters`);
        setActiveEncounterId(enc.id);
        encId = enc.id;
        // Set chief complaint on the encounter
        await api.patch(`/encounters/${enc.id}`, { chiefComplaint: form.chiefComplaint });
      }

      // Record vitals if any entered
      const hasVitals = form.systolic || form.heartRate || form.temperature || form.oxygenSat;
      if (hasVitals && encId) {
        const vitalsPayload: Record<string, number | string> = { encounterId: encId };
        if (form.systolic) vitalsPayload['bloodPressureSystolic'] = parseInt(form.systolic);
        if (form.diastolic) vitalsPayload['bloodPressureDiastolic'] = parseInt(form.diastolic);
        if (form.heartRate) vitalsPayload['heartRate'] = parseInt(form.heartRate);
        if (form.temperature) vitalsPayload['temperature'] = parseFloat(form.temperature);
        if (form.oxygenSat) vitalsPayload['oxygenSat'] = parseFloat(form.oxygenSat);
        await api.post(`/patients/${patientId}/vitals`, vitalsPayload);
      }

      // Store triage as a note on the encounter
      const triageNote = `[TRIAGE] Priority: ${PRIORITY_CONFIG[form.priority].label} (${PRIORITY_CONFIG[form.priority].code})\nChief Complaint: ${form.chiefComplaint}${form.notes ? `\nNotes: ${form.notes}` : ''}`;
      await api.patch(`/encounters/${encId}`, { notes: triageNote, chiefComplaint: form.chiefComplaint });

      const newRecord: TriageRecord = {
        id: Date.now().toString(),
        encounterId: encId!,
        arrivalTime: new Date().toISOString(),
        chiefComplaint: form.chiefComplaint,
        priority: form.priority,
        notes: form.notes,
        systolic: form.systolic ? parseInt(form.systolic) : undefined,
        diastolic: form.diastolic ? parseInt(form.diastolic) : undefined,
        heartRate: form.heartRate ? parseInt(form.heartRate) : undefined,
        temperature: form.temperature ? parseFloat(form.temperature) : undefined,
        oxygenSat: form.oxygenSat ? parseFloat(form.oxygenSat) : undefined,
        createdAt: new Date().toISOString(),
      };
      setTriageRecords((prev) => [newRecord, ...prev]);
      setShowForm(false);
      setForm({ chiefComplaint: '', priority: 'URGENT', notes: '', systolic: '', diastolic: '', heartRate: '', temperature: '', oxygenSat: '' });
      toast.success('Triage recorded');
    } finally {
      setSaving(false);
    }
  }

  const cfg = PRIORITY_CONFIG[form.priority];

  return (
    <div style={{ padding: '24px 28px', maxWidth: 860, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 34, height: 34, borderRadius: 9, background: 'var(--clinical-caution-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <ClipboardCheck size={16} color="var(--clinical-caution)" />
          </div>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--ses-text)' }}>Triage</h2>
            <p style={{ fontSize: 11.5, color: '#94a3b8', marginTop: 1 }}>Initial patient assessment and priority assignment</p>
          </div>
        </div>
        <button className="btn-primary" onClick={() => setShowForm((v) => !v)}>
          <Plus size={14} /> New Triage Entry
        </button>
      </div>

      {/* Triage form */}
      {showForm && (
        <form onSubmit={submit} className="card" style={{ padding: '20px 22px', marginBottom: 18 }}>
          <h3 style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--ses-text)', marginBottom: 16 }}>Triage Assessment</h3>

          {/* Priority selector */}
          <div style={{ marginBottom: 18 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 8 }}>
              Triage Priority <span style={{ color: 'var(--ses-red)' }}>*</span>
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
              {(Object.keys(PRIORITY_CONFIG) as TriageRecord['priority'][]).map((p) => {
                const c = PRIORITY_CONFIG[p];
                const selected = form.priority === p;
                return (
                  <button
                    key={p} type="button" onClick={() => set('priority', p)}
                    style={{
                      padding: '10px 8px', borderRadius: 9, cursor: 'pointer', textAlign: 'center',
                      border: `2px solid ${selected ? c.color : '#e8ecf0'}`,
                      background: selected ? c.bg : '#f8fafc',
                      transition: 'all 0.15s',
                    }}
                  >
                    <div style={{ fontSize: 16, fontWeight: 800, color: c.color }}>{c.code}</div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: selected ? c.color : '#94a3b8', marginTop: 2 }}>{c.label}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Chief complaint */}
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 5 }}>
              Chief Complaint <span style={{ color: 'var(--ses-red)' }}>*</span>
            </label>
            <textarea
              required value={form.chiefComplaint} onChange={(e) => set('chiefComplaint', e.target.value)}
              rows={2} placeholder="Reason for visit…"
              className="field-input" style={{ resize: 'vertical' }}
            />
          </div>

          {/* Quick vitals */}
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 8 }}>
              Quick Vitals <span style={{ fontSize: 11, fontWeight: 400, color: '#94a3b8' }}>(optional — also saved to Vitals)</span>
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
              {[
                { label: 'Systolic', field: 'systolic', placeholder: 'mmHg' },
                { label: 'Diastolic', field: 'diastolic', placeholder: 'mmHg' },
                { label: 'Heart Rate', field: 'heartRate', placeholder: 'bpm' },
                { label: 'Temp', field: 'temperature', placeholder: '°C' },
                { label: 'SpO₂', field: 'oxygenSat', placeholder: '%' },
              ].map(({ label, field, placeholder }) => (
                <div key={field}>
                  <div style={{ fontSize: 10.5, fontWeight: 600, color: '#64748b', marginBottom: 4 }}>{label}</div>
                  <input
                    type="number" step="any"
                    value={form[field as keyof typeof form] as string}
                    onChange={(e) => set(field, e.target.value)}
                    placeholder={placeholder}
                    className="field-input" style={{ fontSize: 13 }}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div style={{ marginBottom: 18 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 5 }}>Notes</label>
            <textarea
              value={form.notes} onChange={(e) => set('notes', e.target.value)}
              rows={2} placeholder="Additional triage observations…"
              className="field-input" style={{ resize: 'vertical' }}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, borderTop: '1px solid #f1f5f9', paddingTop: 14 }}>
            <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">
              <CheckCircle size={13} /> {saving ? 'Saving…' : 'Save Triage'}
            </button>
          </div>
        </form>
      )}

      {/* Records */}
      {triageRecords.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {triageRecords.map((rec) => {
            const p = PRIORITY_CONFIG[rec.priority];
            return (
              <div key={rec.id} className="card" style={{ padding: '16px 20px', borderLeft: `4px solid ${p.color}` }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{
                      fontSize: 13, fontWeight: 800, color: p.color,
                      background: p.bg, border: `1px solid ${p.border}`,
                      padding: '3px 10px', borderRadius: 7,
                    }}>{p.code} — {p.label}</span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ses-text)' }}>{rec.chiefComplaint}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: '#94a3b8' }}>
                    <Clock size={11} /> {new Date(rec.createdAt).toLocaleString()}
                  </div>
                </div>

                {(rec.systolic || rec.heartRate || rec.temperature || rec.oxygenSat) && (
                  <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                    {rec.systolic && <VChip label="BP" value={`${rec.systolic}/${rec.diastolic}`} unit="mmHg" />}
                    {rec.heartRate && <VChip label="HR" value={String(rec.heartRate)} unit="bpm" />}
                    {rec.temperature && <VChip label="Temp" value={String(rec.temperature)} unit="°C" />}
                    {rec.oxygenSat && <VChip label="SpO₂" value={String(rec.oxygenSat)} unit="%" />}
                  </div>
                )}

                {rec.notes && (
                  <p style={{ marginTop: 8, fontSize: 12.5, color: '#64748b', fontStyle: 'italic' }}>{rec.notes}</p>
                )}
              </div>
            );
          })}
        </div>
      ) : !showForm ? (
        <div className="card" style={{ padding: '60px 24px', textAlign: 'center' }}>
          <AlertTriangle size={32} color="#e2e8f0" style={{ margin: '0 auto 12px' }} />
          <p style={{ fontWeight: 600, color: '#374151', marginBottom: 6 }}>No triage records</p>
          <p style={{ fontSize: 13, color: '#94a3b8', marginBottom: 20 }}>Record the initial triage assessment for this patient.</p>
          <button className="btn-primary" onClick={() => setShowForm(true)} style={{ margin: '0 auto' }}>
            <Plus size={14} /> Start Triage
          </button>
        </div>
      ) : null}
    </div>
  );
}

function VChip({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div style={{ background: '#f8fafc', border: '1px solid #e8ecf0', borderRadius: 7, padding: '5px 10px', display: 'flex', gap: 6, alignItems: 'center' }}>
      <span style={{ fontSize: 11, fontWeight: 600, color: '#64748b' }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ses-text)' }}>{value}</span>
      <span style={{ fontSize: 11, color: '#94a3b8' }}>{unit}</span>
    </div>
  );
}
