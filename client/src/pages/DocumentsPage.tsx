import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import api from '../api/client';
import {
  Upload, FileText, X, Check, Loader2, Eye, ChevronDown, ChevronRight,
  AlertTriangle, FolderOpen,
} from 'lucide-react';
import toast from 'react-hot-toast';

// ── Types ─────────────────────────────────────────────────────────────────────

interface LabResult   { test_name: string; value: string; unit: string; flag: string; }
interface Diagnosis   { text: string; }
interface Medication  { name: string; dose: string; frequency: string; }
interface Vital       { parameter: string; value: string; unit: string; date: string; }

interface ExtractionResult {
  document_type:  string;
  lab_results:    LabResult[];
  diagnoses:      string[];
  medications:    Medication[];
  vitals:         Vital[];
  other_notes:    string;
  _file_path:     string;
  _filename:      string;
}

interface SavedDocument {
  id:            string;
  patient_id:    string;
  filename:      string;
  file_path:     string;
  document_type: string;
  extracted_json: string;
  uploaded_at:   string;
}

// Checkbox key format: "<section>_<index>"
type CheckedMap = Record<string, boolean>;

// ── Vital → API field mapper ──────────────────────────────────────────────────

function mapVital(v: Vital): Record<string, number | undefined> {
  const p  = v.parameter.toLowerCase();
  const n  = parseFloat(v.value);
  const ok = !isNaN(n);
  if (!ok) return {};

  if (p.includes('systolic'))                                   return { bloodPressureSystolic: n };
  if (p.includes('diastolic'))                                  return { bloodPressureDiastolic: n };
  if (p.includes('blood pressure') || p.includes('bp')) {
    const parts = v.value.split('/');
    return {
      bloodPressureSystolic:  parseInt(parts[0] ?? '0'),
      bloodPressureDiastolic: parseInt(parts[1] ?? '0'),
    };
  }
  if (p.includes('heart rate') || p.includes('pulse') || p.includes('hr')) return { heartRate: n };
  if (p.includes('temp'))                                        return { temperature: n };
  if (p.includes('spo2') || p.includes('oxygen') || p.includes('saturation')) return { oxygenSat: n };
  if (p.includes('glucose') || p.includes('blood sugar'))        return { glucose: n };
  if (p.includes('weight'))                                      return { weight: n };
  if (p.includes('height'))                                      return { height: n };
  return {};
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function flagColor(flag: string) {
  const f = flag.toLowerCase();
  if (f === 'high' || f === 'critical') return '#dc2626';
  if (f === 'low')  return '#d97706';
  if (f === 'normal') return '#16a34a';
  return 'var(--text-subtle)';
}

// ── Section row component ─────────────────────────────────────────────────────

function Section({
  title, items, sectionKey, checked, onToggle, children,
}: {
  title: string;
  items: unknown[];
  sectionKey: string;
  checked: CheckedMap;
  onToggle: (key: string) => void;
  children: (item: unknown, idx: number) => React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  if (items.length === 0) return null;

  return (
    <div style={{ marginBottom: 16, border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          width: '100%', textAlign: 'left', padding: '8px 14px',
          background: 'var(--bg-surface)', border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
          {title} <span style={{ color: 'var(--text-subtle)', fontWeight: 500 }}>({items.length})</span>
        </span>
        {open ? <ChevronDown size={13} color="var(--text-subtle)" /> : <ChevronRight size={13} color="var(--text-subtle)" />}
      </button>
      {open && (
        <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 7 }}>
          {items.map((item, idx) => {
            const key = `${sectionKey}_${idx}`;
            return (
              <label key={key} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={checked[key] ?? true}
                  onChange={() => onToggle(key)}
                  style={{ marginTop: 2, accentColor: '#c8102e', width: 15, height: 15, flexShrink: 0 }}
                />
                <span style={{ fontSize: 13, color: 'var(--text-heading)', flex: 1 }}>
                  {children(item, idx)}
                </span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Confirmation modal ────────────────────────────────────────────────────────

function ConfirmModal({
  patientId,
  data,
  onSave,
  onDiscard,
}: {
  patientId: string;
  data: ExtractionResult;
  onSave: () => void;
  onDiscard: () => void;
}) {
  const [checked, setChecked] = useState<CheckedMap>(() => {
    const map: CheckedMap = {};
    data.lab_results.forEach((_, i)  => { map[`lab_${i}`]   = true; });
    data.diagnoses.forEach((_, i)    => { map[`dx_${i}`]     = true; });
    data.medications.forEach((_, i)  => { map[`med_${i}`]    = true; });
    data.vitals.forEach((_, i)       => { map[`vital_${i}`]  = true; });
    if (data.other_notes) map['notes_0'] = true;
    return map;
  });
  const [saving, setSaving] = useState(false);

  function toggleAll(select: boolean) {
    setChecked(prev => Object.fromEntries(Object.keys(prev).map(k => [k, select])));
  }

  function toggle(key: string) {
    setChecked(prev => ({ ...prev, [key]: !prev[key] }));
  }

  const selectedCount = Object.values(checked).filter(Boolean).length;

  async function handleSave() {
    setSaving(true);
    try {
      // 1. Save document metadata
      await api.post('/documents/save', {
        patient_id:     patientId,
        filename:       data._filename,
        file_path:      data._file_path,
        document_type:  data.document_type || 'Unknown',
        extracted_json: JSON.stringify(data),
      });

      // 2. Save checked lab results
      const labSaves = data.lab_results
        .filter((_, i) => checked[`lab_${i}`])
        .map(lr => api.post(`/patients/${patientId}/lab-results`, {
          testName:    lr.test_name,
          result:      lr.value,
          unit:        lr.unit || null,
          isAbnormal:  lr.flag.toLowerCase() !== 'normal' && lr.flag !== '',
        }));

      // 3. Save checked medications
      const medSaves = data.medications
        .filter((_, i) => checked[`med_${i}`])
        .map(m => api.post(`/patients/${patientId}/medications`, {
          name:      m.name,
          dosage:    m.dose || null,
          frequency: m.frequency || null,
          route:     null,
          startDate: new Date().toISOString(),
        }));

      // 4. Save checked vitals — merge all into one vitals record
      const checkedVitals = data.vitals.filter((_, i) => checked[`vital_${i}`]);
      const vitalPayload: Record<string, number | undefined> = {};
      checkedVitals.forEach(v => Object.assign(vitalPayload, mapVital(v)));
      const hasVitals = Object.keys(vitalPayload).some(k => vitalPayload[k] !== undefined);
      const vitalSave = hasVitals
        ? [api.post(`/patients/${patientId}/vitals`, vitalPayload)]
        : [];

      await Promise.allSettled([...labSaves, ...medSaves, ...vitalSave]);

      toast.success('Document data saved successfully');
      onSave();
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 60,
      background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(3px)',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      overflowY: 'auto', padding: '32px 16px',
    }}>
      <div style={{
        background: 'var(--bg-card)', borderRadius: 16, width: '100%', maxWidth: 660,
        boxShadow: '0 24px 64px rgba(0,0,0,0.25)', overflow: 'hidden',
        marginBottom: 32,
      }}>
        {/* Header */}
        <div style={{
          padding: '16px 22px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-heading)', marginBottom: 2 }}>
              AI Extraction Results
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{
                fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
                background: 'var(--badge-blue-bg)', color: 'var(--badge-blue-text)',
              }}>
                {data.document_type || 'Unknown Document Type'}
              </span>
              <span style={{ fontSize: 12, color: 'var(--text-subtle)' }}>
                Review and select what to save
              </span>
            </div>
          </div>
          <button onClick={onDiscard} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4, borderRadius: 6, display: 'flex' }}>
            <X size={18} />
          </button>
        </div>

        {/* Select all / none */}
        <div style={{ padding: '10px 22px', background: 'var(--bg-surface)', borderBottom: '1px solid var(--border-light)', display: 'flex', gap: 10 }}>
          <button onClick={() => toggleAll(true)} style={{ fontSize: 12, color: '#c8102e', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
            Select all
          </button>
          <span style={{ color: 'var(--text-subtle)' }}>·</span>
          <button onClick={() => toggleAll(false)} style={{ fontSize: 12, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}>
            Deselect all
          </button>
          <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-subtle)' }}>
            {selectedCount} item{selectedCount !== 1 ? 's' : ''} selected
          </span>
        </div>

        {/* Sections */}
        <div style={{ padding: '16px 22px', maxHeight: '55vh', overflowY: 'auto' }}>

          {/* Lab Results */}
          <Section title="Lab Results" items={data.lab_results} sectionKey="lab" checked={checked} onToggle={toggle}>
            {(item) => {
              const lr = item as LabResult;
              return (
                <span>
                  <strong>{lr.test_name}</strong>{' '}
                  <span style={{ color: flagColor(lr.flag) }}>{lr.value}</span>
                  {lr.unit && <span style={{ color: 'var(--text-subtle)' }}> {lr.unit}</span>}
                  {lr.flag && (
                    <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 600, color: flagColor(lr.flag) }}>
                      [{lr.flag}]
                    </span>
                  )}
                </span>
              );
            }}
          </Section>

          {/* Diagnoses */}
          <Section title="Diagnoses" items={data.diagnoses} sectionKey="dx" checked={checked} onToggle={toggle}>
            {(item) => <span>{item as string}</span>}
          </Section>

          {/* Medications */}
          <Section title="Medications" items={data.medications} sectionKey="med" checked={checked} onToggle={toggle}>
            {(item) => {
              const m = item as Medication;
              return (
                <span>
                  <strong>{m.name}</strong>
                  {m.dose && <span style={{ color: 'var(--text-body2)' }}> · {m.dose}</span>}
                  {m.frequency && <span style={{ color: 'var(--text-subtle)' }}> · {m.frequency}</span>}
                </span>
              );
            }}
          </Section>

          {/* Vitals */}
          <Section title="Vitals" items={data.vitals} sectionKey="vital" checked={checked} onToggle={toggle}>
            {(item) => {
              const v = item as Vital;
              return (
                <span>
                  <strong>{v.parameter}</strong>{' '}
                  <span style={{ color: 'var(--text-heading)' }}>{v.value}</span>
                  {v.unit && <span style={{ color: 'var(--text-subtle)' }}> {v.unit}</span>}
                  {v.date && <span style={{ color: 'var(--text-subtle)', fontSize: 11 }}> ({v.date})</span>}
                </span>
              );
            }}
          </Section>

          {/* Other Notes */}
          {data.other_notes && (
            <div style={{ marginBottom: 16, border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ padding: '8px 14px', background: 'var(--bg-surface)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Other Notes</span>
              </div>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 14px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={checked['notes_0'] ?? true}
                  onChange={() => toggle('notes_0')}
                  style={{ marginTop: 2, accentColor: '#c8102e', width: 15, height: 15, flexShrink: 0 }}
                />
                <span style={{ fontSize: 13, color: 'var(--text-heading)', whiteSpace: 'pre-wrap' }}>
                  {data.other_notes}
                </span>
              </label>
            </div>
          )}

          {/* Diagnoses note */}
          {data.diagnoses.length > 0 && (
            <div style={{ padding: '8px 12px', background: 'var(--badge-amber-bg)', border: '1px solid var(--badge-amber-text)', borderRadius: 7, fontSize: 12, color: 'var(--badge-amber-text)', display: 'flex', gap: 7, alignItems: 'flex-start' }}>
              <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
              Diagnoses are saved as document notes. To add them to Past Medical History with ICD-11 codes, use the Diagnosis block in Consultation.
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div style={{
          padding: '14px 22px', borderTop: '1px solid var(--border)',
          display: 'flex', justifyContent: 'flex-end', gap: 10,
          background: 'var(--bg-card)',
        }}>
          <button onClick={onDiscard} className="btn-secondary">Discard</button>
          <button
            onClick={handleSave}
            disabled={saving || selectedCount === 0}
            className="btn-primary"
          >
            {saving ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Saving…</> : <><Check size={14} /> Save Selected ({selectedCount})</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Documents list ────────────────────────────────────────────────────────────

function DocumentsList({ patientId, refreshKey }: { patientId: string; refreshKey: number }) {
  const [docs, setDocs] = useState<SavedDocument[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get(`/documents/${patientId}`)
      .then(r => setDocs(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [patientId, refreshKey]);

  if (loading) return <div style={{ padding: '20px 0', color: 'var(--text-subtle)', fontSize: 13 }}>Loading documents…</div>;

  if (docs.length === 0) return (
    <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-subtle)' }}>
      <FolderOpen size={32} style={{ marginBottom: 10, opacity: 0.4 }} />
      <div style={{ fontSize: 13 }}>No documents uploaded yet</div>
    </div>
  );

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)' }}>
            {['Filename', 'Uploaded', 'Document Type', ''].map(h => (
              <th key={h} style={{ textAlign: 'left', padding: '10px 16px', fontSize: 10.5, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {docs.map(doc => (
            <tr key={doc.id} style={{ borderBottom: '1px solid var(--border-light)' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-surface)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
              <td style={{ padding: '12px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <FileText size={14} color="#c8102e" />
                  <span style={{ fontWeight: 500, color: 'var(--text-heading)' }}>{doc.filename}</span>
                </div>
              </td>
              <td style={{ padding: '12px 16px', color: 'var(--text-body2)', whiteSpace: 'nowrap' }}>
                {fmtDate(doc.uploaded_at)}
              </td>
              <td style={{ padding: '12px 16px' }}>
                <span style={{
                  fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20,
                  background: 'var(--badge-blue-bg)', color: 'var(--badge-blue-text)',
                }}>
                  {doc.document_type || 'Unknown'}
                </span>
              </td>
              <td style={{ padding: '12px 16px' }}>
                <a
                  href={`/api/documents/file/${doc.id}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    fontSize: 12, fontWeight: 600, color: '#c8102e',
                    textDecoration: 'none', padding: '4px 10px',
                    border: '1px solid var(--chip-red-border)', borderRadius: 6,
                  }}
                >
                  <Eye size={12} /> View
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function DocumentsPage() {
  const { patientId } = useParams<{ patientId: string }>();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [uploading, setUploading]         = useState(false);
  const [extraction, setExtraction]       = useState<ExtractionResult | null>(null);
  const [showModal, setShowModal]         = useState(false);
  const [refreshKey, setRefreshKey]       = useState(0);
  const [dragOver, setDragOver]           = useState(false);

  const processFile = useCallback(async (file: File) => {
    const ALLOWED = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword',
      'image/jpeg', 'image/jpg', 'image/png', 'image/webp',
    ];
    if (!ALLOWED.includes(file.type) && !file.name.endsWith('.docx') && !file.name.endsWith('.doc')) {
      toast.error('Only PDF, Word (.docx), JPG, PNG, and WebP files are supported');
      return;
    }

    setUploading(true);
    setExtraction(null);

    const fd = new FormData();
    fd.append('patient_id', patientId!);
    fd.append('file', file);

    try {
      const { data } = await api.post('/documents/upload', fd);
      setExtraction(data);
      setShowModal(true);
    } catch (err: any) {
      const detail = err?.response?.data?.detail ?? 'Upload failed';
      toast.error(detail);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [patientId]);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  }

  function handleSaved() {
    setShowModal(false);
    setExtraction(null);
    setRefreshKey(k => k + 1);
    toast.success('Document saved and data imported');
  }

  return (
    <div className="page-container">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 28, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-heading)', margin: 0, lineHeight: 1.2 }}>
            Documents
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-subtle)', marginTop: 4 }}>
            Upload PDFs or images — AI extracts lab results, medications, diagnoses, and vitals
          </p>
        </div>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="btn-primary"
          style={{ flexShrink: 0 }}
        >
          <Upload size={14} />
          Upload Document
        </button>
      </div>

      {/* Drop zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => !uploading && fileInputRef.current?.click()}
        style={{
          border: `2px dashed ${dragOver ? '#c8102e' : 'var(--border)'}`,
          borderRadius: 12,
          padding: '32px 24px',
          textAlign: 'center',
          marginBottom: 28,
          cursor: uploading ? 'default' : 'pointer',
          background: dragOver ? 'var(--chip-red-bg)' : 'var(--bg-surface)',
          transition: 'border-color 0.15s, background 0.15s',
        }}
      >
        {uploading ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            <Loader2 size={32} color="#c8102e" style={{ animation: 'spin 1s linear infinite' }} />
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-heading)' }}>AI is reading document…</div>
            <div style={{ fontSize: 13, color: 'var(--text-subtle)' }}>Extracting clinical data with Llama 3.2</div>
          </div>
        ) : (
          <>
            <Upload size={28} color={dragOver ? '#c8102e' : 'var(--text-subtle)'} style={{ marginBottom: 10, opacity: dragOver ? 1 : 0.5 }} />
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-heading)', marginBottom: 4 }}>
              Drop a file here or click to browse
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-subtle)' }}>
              PDF, Word (.docx), JPG, PNG, WebP · AI will extract lab results, medications, diagnoses and vitals
            </div>
          </>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.docx,.doc,.jpg,.jpeg,.png,.webp"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      {/* Uploaded documents list */}
      <div style={{ marginBottom: 12 }}>
        <h2 style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 14 }}>
          Uploaded Documents
        </h2>
        {patientId && <DocumentsList patientId={patientId} refreshKey={refreshKey} />}
      </div>

      {/* Confirmation modal */}
      {showModal && extraction && patientId && (
        <ConfirmModal
          patientId={patientId}
          data={extraction}
          onSave={handleSaved}
          onDiscard={() => { setShowModal(false); setExtraction(null); }}
        />
      )}

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
