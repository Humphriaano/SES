import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Brain, ChevronDown, ChevronUp,
  AlertTriangle, CheckCircle, Clock, Zap,
  BookOpen, FlaskConical, RefreshCw,
} from 'lucide-react';
import api from '../../../api/client';
import { Patient, Vital, Medication } from '../../../types';
import { CanvasNode } from '../../../types/consultation';
import { calcBmi } from '../../../lib/vitalsConfig';

const CDS_URL         = 'http://localhost:8000/cds/suggest';
const DEFAULT_QUESTION = 'What are the guideline-based recommendations for this patient?';
const DEBOUNCE_MS     = 1500;

interface Recommendation {
  action: string;
  rationale: string;
  urgency: 'routine' | 'urgent' | 'emergency';
  source: string;
}

interface CdsResponse {
  summary: string;
  recommendations: Recommendation[];
  warnings: string[];
  investigations_suggested: string[];
  disclaimer: string;
  retrieved_sources: string[];
  low_confidence: boolean;
  error?: string;
  direct_suggestion?: string;
}

interface Props {
  patientId: string;
  patient: Patient | null;
  nodes: CanvasNode[];
}

const URGENCY_STYLE: Record<string, { bg: string; border: string; color: string; icon: any; label: string }> = {
  routine:   { bg: 'var(--badge-green-bg)', border: 'var(--border)', color: 'var(--badge-green-text)', icon: CheckCircle, label: 'Routine'   },
  urgent:    { bg: 'var(--badge-amber-bg)', border: 'var(--border)', color: 'var(--badge-amber-text)', icon: Clock,       label: 'Urgent'    },
  emergency: { bg: 'var(--badge-red-bg)',   border: 'var(--border)', color: 'var(--badge-red-text)',   icon: Zap,         label: 'Emergency' },
};

function calcAge(dob: string): number {
  const birth = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  if (today < new Date(today.getFullYear(), birth.getMonth(), birth.getDate())) age--;
  return age;
}

function extractEncounterNotes(nodes: CanvasNode[]): string {
  return nodes
    .filter(n => n.type === 'text')
    .map(n => (n as any).content as string)
    .filter(Boolean)
    .join('\n')
    .slice(0, 1000);
}

function extractPendingInvestigations(nodes: CanvasNode[]): string[] {
  return nodes
    .filter(n => n.type === 'investigation')
    .flatMap(n => ((n as any).data.items as any[]).filter(i => i.status === 'PENDING').map(i => i.name));
}

function extractPrescriptionKey(nodes: CanvasNode[]): string {
  return JSON.stringify(
    nodes
      .filter(n => n.type === 'prescription')
      .flatMap(n => ((n as any).data.items as any[]).map((i: any) => `${i.drugName}|${i.dose}|${i.frequency}`))
      .sort()
  );
}

export default function CdsPanel({ patientId, patient, nodes }: Props) {
  const [collapsed, setCollapsed]   = useState(false);
  const [loading, setLoading]       = useState(false);
  const [response, setResponse]     = useState<CdsResponse | null>(null);
  const [serviceError, setError]    = useState<string | null>(null);
  const [latestVital, setLatestVital] = useState<(Vital & { bmi?: number | null }) | null>(null);
  const [medications, setMedications] = useState<Medication[]>([]);
  const [dataReady, setDataReady]   = useState(false);

  const patientRef     = useRef(patient);
  const nodesRef       = useRef(nodes);
  const vitalRef       = useRef(latestVital);
  const medsRef        = useRef(medications);
  patientRef.current   = patient;
  nodesRef.current     = nodes;
  vitalRef.current     = latestVital;
  medsRef.current      = medications;

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef    = useRef<AbortController | null>(null);
  const isMounted   = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  useEffect(() => {
    let loaded = 0;
    const onLoaded = () => { if (++loaded === 2) setDataReady(true); };

    api.get(`/patients/${patientId}/vitals`)
      .then(r => {
        const data = r.data as (Vital & { bmi?: number | null })[];
        if (data.length > 0) setLatestVital(data[data.length - 1]);
      })
      .catch(() => {})
      .finally(onLoaded);

    api.get(`/patients/${patientId}/medications`)
      .then(r => setMedications(r.data))
      .catch(() => {})
      .finally(onLoaded);

    return () => { setDataReady(false); };
  }, [patientId]);

  const fetchSuggestion = useCallback(async (signal: AbortSignal) => {
    const p   = patientRef.current;
    const v   = vitalRef.current;
    const ns  = nodesRef.current;
    const ms  = medsRef.current;
    if (!p) return;

    if (isMounted.current) {
      setLoading(true);
      setError(null);
    }

    const payload = {
      question: DEFAULT_QUESTION,
      patient: {
        age: calcAge(p.dateOfBirth),
        sex: p.gender,
        patient_id: p.id,
        active_diagnoses: (p.diagnoses ?? [])
          .filter(d => !d.resolvedAt)
          .map(d => ({ icd_code: d.icd11.code, label: d.icd11.description })),
        current_medications: ms
          .filter(m => !m.endDate || new Date(m.endDate) >= new Date())
          .map(m => `${m.name}${m.dosage ? ` ${m.dosage}` : ''}`),
        allergies: p.allergies ?? [],
        latest_vitals: v ? {
          bp_systolic:   v.bloodPressureSystolic  ?? null,
          bp_diastolic:  v.bloodPressureDiastolic ?? null,
          heart_rate:    v.heartRate              ?? null,
          temperature_c: v.temperature            ?? null,
          spo2_pct:      v.oxygenSat              ?? null,
        } : null,
        pending_investigations: extractPendingInvestigations(ns),
        encounter_notes: extractEncounterNotes(ns),
      },
    };

    try {
      const res = await fetch(CDS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      if (isMounted.current) setResponse(data);
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      if (isMounted.current) setError(err.message ?? 'CDS service unreachable. Make sure it is running on port 8000.');
    } finally {
      if (isMounted.current) setLoading(false);
    }
  }, []);

  const trigger = useCallback((immediate = false) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (abortRef.current)    abortRef.current.abort();

    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;

    if (immediate) {
      fetchSuggestion(signal);
    } else {
      debounceRef.current = setTimeout(() => fetchSuggestion(signal), DEBOUNCE_MS);
    }
  }, [fetchSuggestion]);

  const diagnosisKey    = JSON.stringify(
    (patient?.diagnoses ?? []).filter(d => !d.resolvedAt).map(d => d.id).sort()
  );
  const vitalKey        = latestVital?.id ?? null;
  const prescriptionKey = extractPrescriptionKey(nodes);

  const triggeredOnce = useRef(false);
  useEffect(() => {
    if (!dataReady || !patient) return;

    const isFirst = !triggeredOnce.current;
    triggeredOnce.current = true;
    trigger(isFirst);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataReady, diagnosisKey, vitalKey, prescriptionKey]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (abortRef.current)    abortRef.current.abort();
    };
  }, []);

  return (
    <div style={{
      maxWidth: 860, marginTop: 16,
      background: 'var(--bg-card)', borderRadius: 12,
      border: '1px solid var(--border)',
      boxShadow: '0 1px 6px rgba(0,0,0,0.05)',
      overflow: 'hidden',
    }}>
      <style>{`
        @keyframes cds-pulse {
          0%, 100% { opacity: 1;   transform: scale(1);   }
          50%       { opacity: 0.3; transform: scale(0.75); }
        }
      `}</style>

      {/* Header — always dark (matches nav bar) */}
      <div style={{
        width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 20px', background: 'var(--bg-nav)',
      }}>
        <button
          onClick={() => setCollapsed(v => !v)}
          style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left' }}
        >
          <Brain size={15} color="#c0392b" />
          <span style={{ fontSize: 13, fontWeight: 700, color: '#f1f5f9', letterSpacing: '0.02em' }}>
            Clinical Decision Support
          </span>
          <span style={{ fontSize: 10, color: '#64748b', fontWeight: 500 }}>AI · Guideline-based</span>
          {loading && (
            <span style={{
              width: 7, height: 7, borderRadius: '50%', background: '#c0392b',
              display: 'inline-block', marginLeft: 2,
              animation: 'cds-pulse 1.4s ease-in-out infinite',
            }} />
          )}
          {collapsed
            ? <ChevronDown size={14} color="#64748b" style={{ marginLeft: 'auto' }} />
            : <ChevronUp   size={14} color="#64748b" style={{ marginLeft: 'auto' }} />
          }
        </button>

        <button
          onClick={e => { e.stopPropagation(); trigger(true); }}
          disabled={loading}
          title="Re-run CDS analysis"
          style={{
            background: 'none', border: 'none', cursor: loading ? 'not-allowed' : 'pointer',
            color: loading ? '#374151' : '#64748b', padding: '2px 4px', marginLeft: 8,
            display: 'flex', alignItems: 'center', borderRadius: 4,
            transition: 'color 0.15s',
          }}
          onMouseEnter={e => { if (!loading) e.currentTarget.style.color = '#94a3b8'; }}
          onMouseLeave={e => { e.currentTarget.style.color = loading ? '#374151' : '#64748b'; }}
        >
          <RefreshCw size={13} />
        </button>
      </div>

      {!collapsed && (
        <div style={{ padding: '16px 20px 20px' }}>

          {/* Service error */}
          {serviceError && (
            <div style={{ padding: '12px 16px', background: 'var(--badge-red-bg)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--badge-red-text)', fontSize: 13, marginBottom: 12 }}>
              <strong>CDS service error:</strong> {serviceError}
            </div>
          )}

          {/* No response yet + not loading */}
          {!response && !loading && !serviceError && (
            <div style={{ padding: '14px 16px', background: 'var(--bg-surface)', borderRadius: 8, border: '1px solid var(--border)', color: 'var(--text-muted)', fontSize: 13 }}>
              Waiting for patient data…
            </div>
          )}

          {/* Response */}
          {response && (
            <div style={{ opacity: loading ? 0.5 : 1, transition: 'opacity 0.2s' }}>
              {/* Low confidence warning */}
              {response.low_confidence && (
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '10px 14px', background: 'var(--badge-amber-bg)', border: '1px solid var(--border)', borderRadius: 8, marginBottom: 12 }}>
                  <AlertTriangle size={14} color="var(--badge-amber-text)" style={{ flexShrink: 0, marginTop: 1 }} />
                  <span style={{ fontSize: 12, color: 'var(--badge-amber-text)' }}>
                    <strong>Low confidence:</strong> No closely matching guideline excerpts were found. Suggestions below may not be grounded in indexed guidelines.
                  </span>
                </div>
              )}

              {/* Summary — always dark card, matches the CDS "AI" brand */}
              {response.summary && (
                <div style={{ padding: '12px 16px', background: 'var(--bg-nav)', borderRadius: 8, marginBottom: 12 }}>
                  <p style={{ fontSize: 13, color: '#e2e8f0', lineHeight: 1.6, margin: 0 }}>
                    <span style={{ color: '#94a3b8', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 4 }}>Clinical Impression</span>
                    {response.summary}
                  </p>
                </div>
              )}

              {/* Warnings */}
              {response.warnings.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  {response.warnings.map((w, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '9px 14px', background: 'var(--badge-red-bg)', border: '1px solid var(--border)', borderRadius: 7, marginBottom: 6 }}>
                      <AlertTriangle size={13} color="var(--badge-red-text)" style={{ flexShrink: 0, marginTop: 1 }} />
                      <span style={{ fontSize: 12.5, color: 'var(--badge-red-text)' }}>{w}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Recommendations */}
              {response.recommendations.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                    Recommendations
                  </div>
                  {response.recommendations.map((rec, i) => {
                    const u = URGENCY_STYLE[rec.urgency] ?? URGENCY_STYLE.routine;
                    const UIcon = u.icon;
                    return (
                      <div key={i} style={{ background: u.bg, border: `1px solid ${u.border}`, borderRadius: 9, padding: '12px 16px', marginBottom: 8 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                          <UIcon size={12} color={u.color} />
                          <span style={{ fontSize: 10, fontWeight: 700, color: u.color, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            {u.label}
                          </span>
                        </div>
                        <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-heading)', margin: '0 0 4px' }}>{rec.action}</p>
                        <p style={{ fontSize: 12, color: 'var(--text-body2)', margin: '0 0 6px', lineHeight: 1.5 }}>{rec.rationale}</p>
                        {rec.source && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <BookOpen size={10} color="var(--text-muted)" />
                            <span style={{ fontSize: 10.5, color: 'var(--text-body2)', fontStyle: 'italic' }}>{rec.source}</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Investigations suggested */}
              {response.investigations_suggested.length > 0 && (
                <div style={{ marginBottom: 12, padding: '10px 14px', background: 'var(--badge-green-bg)', border: '1px solid var(--border)', borderRadius: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                    <FlaskConical size={12} color="#0f766e" />
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#0f766e', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Suggested Investigations</span>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {response.investigations_suggested.map((inv, i) => (
                      <span key={i} style={{ fontSize: 12, background: '#ccfbf1', color: '#0f766e', padding: '2px 10px', borderRadius: 20, fontWeight: 500 }}>
                        {inv}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Sources */}
              {response.retrieved_sources.length > 0 && (
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, marginBottom: 4 }}>Sources</div>
                  {response.retrieved_sources.map((s, i) => (
                    <div key={i} style={{ fontSize: 11, color: 'var(--text-body2)', display: 'flex', alignItems: 'center', gap: 5, marginBottom: 2 }}>
                      <BookOpen size={9} color="var(--text-muted)" />
                      {s}
                    </div>
                  ))}
                </div>
              )}

              {/* Differential diagnosis (AI) — keeps purple identity */}
              {response.direct_suggestion && (
                <div style={{ marginBottom: 12, padding: '12px 14px', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#7c3aed', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
                    Differential Diagnosis (AI)
                  </div>
                  <pre style={{ fontSize: 12.5, color: 'var(--text-body)', margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'inherit', lineHeight: 1.6 }}>
                    {response.direct_suggestion}
                  </pre>
                  <p style={{ fontSize: 10.5, color: '#a78bfa', margin: '8px 0 0', fontStyle: 'italic' }}>
                    Not guideline-grounded — based on patient context only. Requires clinician review.
                  </p>
                </div>
              )}

              {/* Disclaimer */}
              <div style={{ padding: '8px 12px', background: 'var(--bg-surface)', borderRadius: 7, borderLeft: '3px solid var(--border)' }}>
                <p style={{ fontSize: 10.5, color: 'var(--text-muted)', margin: 0, lineHeight: 1.5, fontStyle: 'italic' }}>
                  {response.disclaimer}
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
