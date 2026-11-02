import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Brain, ChevronDown, ChevronUp,
  AlertTriangle, CheckCircle, Clock, Zap,
  BookOpen, FlaskConical, RefreshCw, Activity,
} from 'lucide-react';
import api from '../../../api/client';
import { Patient, Vital } from '../../../types';
import { CanvasNode } from '../../../types/consultation';

const CDS_URL          = 'http://localhost:8000/cds/suggest';
const DEFAULT_QUESTION = 'What are the guideline-based recommendations for this patient?';
const DEBOUNCE_MS      = 1500;

// ── Types ─────────────────────────────────────────────────────────────────────

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

interface ShapFactor {
  feature: string;
  value: number | null;
  impact: number;
  direction: 'increases_risk' | 'decreases_risk';
  comment: string;
}

interface ConditionRisk {
  probability: number;
  risk_level: 'low' | 'moderate' | 'high' | 'very high';
  top_factors: ShapFactor[];
  summary: string;
}

interface RiskPredictions {
  hypertension:   ConditionRisk;
  cardiovascular: ConditionRisk;
  diabetes:       ConditionRisk;
  ckd:            ConditionRisk;
}

interface Props {
  patientId: string;
  patient: Patient | null;
  nodes: CanvasNode[];
}

// ── Constants ─────────────────────────────────────────────────────────────────

const URGENCY_STYLE: Record<string, { bg: string; border: string; color: string; icon: any; label: string }> = {
  routine:   { bg: 'var(--badge-green-bg)', border: 'var(--border)', color: 'var(--badge-green-text)', icon: CheckCircle, label: 'Routine'   },
  urgent:    { bg: 'var(--badge-amber-bg)', border: 'var(--border)', color: 'var(--badge-amber-text)', icon: Clock,       label: 'Urgent'    },
  emergency: { bg: 'var(--badge-red-bg)',   border: 'var(--border)', color: 'var(--badge-red-text)',   icon: Zap,         label: 'Emergency' },
};

const RISK_STYLE: Record<string, { bg: string; text: string; dot: string; label: string }> = {
  'low':       { bg: 'var(--badge-green-bg)',    text: 'var(--badge-green-text)',    dot: 'var(--clinical-normal)',   label: 'Low'       },
  'moderate':  { bg: 'var(--badge-amber-bg)',    text: 'var(--badge-amber-text)',    dot: 'var(--clinical-caution)',  label: 'Moderate'  },
  'high':      { bg: 'var(--clinical-abnormal-bg)', text: 'var(--clinical-abnormal)', dot: 'var(--clinical-abnormal)', label: 'High'      },
  'very high': { bg: 'var(--clinical-critical-bg)', text: 'var(--clinical-critical)', dot: 'var(--clinical-critical)', label: 'Very High' },
};

const CONDITION_LABELS: Record<string, string> = {
  hypertension:   'Hypertension',
  cardiovascular: 'Cardiovascular',
  diabetes:       'Diabetes',
  ckd:            'CKD',
};

const CONDITION_ORDER = ['hypertension', 'cardiovascular', 'diabetes', 'ckd'] as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

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

// Canvas data sent to the server-side payload builder — unsaved diagnoses/
// prescriptions/notes that may not be committed to the DB yet. The backend
// merges these with the full committed record.
function extractCanvasDiagnoses(nodes: CanvasNode[]): { icd_code: string; label: string; status: string }[] {
  return nodes
    .filter(n => n.type === 'diagnosis')
    .map(n => (n as any).data)
    .filter((d: any) => d.icd11Code)
    .map((d: any) => ({ icd_code: d.icd11Code, label: d.icd11Description, status: d.status }));
}

function extractCanvasMedications(nodes: CanvasNode[]): string[] {
  return nodes
    .filter(n => n.type === 'prescription')
    .flatMap(n => ((n as any).data.items as any[]).map(
      (i: any) => `${i.drugName}${i.dose ? ` ${i.dose}` : ''}${i.frequency ? ` ${i.frequency}` : ''}`,
    ));
}

// ── Session cache ─────────────────────────────────────────────────────────────
// Module-level (survives unmount/remount within the SPA session; a page
// refresh legitimately starts cold). Keyed by the full input signature —
// patientId first, so an entry can never be served for a different patient.
// Only successful responses are cached; errors always retry on next mount.

interface CdsCacheEntry {
  cds: CdsResponse | null;
  risk: RiskPredictions | null;
}

const cdsSessionCache = new Map<string, CdsCacheEntry>();

function cacheWrite(sig: string, patch: Partial<CdsCacheEntry>): void {
  const entry = cdsSessionCache.get(sig) ?? { cds: null, risk: null };
  cdsSessionCache.set(sig, { ...entry, ...patch });
}

// ── Main component ────────────────────────────────────────────────────────────

export default function CdsPanel({ patientId, patient, nodes }: Props) {
  // Existing CDS state
  const [collapsed, setCollapsed]     = useState(false);
  const [loading, setLoading]         = useState(false);
  const [response, setResponse]       = useState<CdsResponse | null>(null);
  const [serviceError, setError]      = useState<string | null>(null);
  const [latestVital, setLatestVital] = useState<(Vital & { bmi?: number | null }) | null>(null);
  const [sigExtras, setSigExtras]     = useState<{ latestResultedInvestigation: string | null; latestDispense: string | null } | null>(null);
  const [dataReady, setDataReady]     = useState(false);

  // Risk section state
  const [riskCollapsed, setRiskCollapsed]           = useState(false);
  const [riskData, setRiskData]                     = useState<RiskPredictions | null>(null);
  const [riskLoading, setRiskLoading]               = useState(false);
  const [riskError, setRiskError]                   = useState<string | null>(null);
  const [expandedConditions, setExpandedConditions] = useState<Set<string>>(new Set());

  const patientRef   = useRef(patient);
  const nodesRef     = useRef(nodes);
  patientRef.current = patient;
  nodesRef.current   = nodes;

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef    = useRef<AbortController | null>(null);
  const isMounted   = useRef(true);
  const signatureRef = useRef<string | null>(null);

  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  // Load the cheap signature inputs: latest vital (for vitalKey) and the
  // latest resulted-investigation / dispense timestamps. These small Express
  // lookups run on every mount — they're what lets a remount detect that a
  // new lab result or dispense arrived and invalidate the cached CDS run.
  // The expensive AI/ML pipelines below are the ones the cache short-circuits.
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

    api.get(`/patients/${patientId}/cds-signature`)
      .then(r => setSigExtras(r.data))
      .catch(() => setSigExtras({ latestResultedInvestigation: null, latestDispense: null }))
      .finally(onLoaded);

    return () => { setDataReady(false); };
  }, [patientId]);

  // ── Risk prediction fetch ──────────────────────────────────────────────────
  const fetchRisk = useCallback(async () => {
    if (!isMounted.current) return;
    setRiskLoading(true);
    setRiskError(null);
    try {
      const { data } = await api.get(`/patients/${patientId}/risk-predict`);
      if (isMounted.current) {
        setRiskData(data.predictions as RiskPredictions);
        if (signatureRef.current) cacheWrite(signatureRef.current, { risk: data.predictions as RiskPredictions });
      }
    } catch (err: any) {
      if (isMounted.current)
        setRiskError(err?.response?.data?.error ?? 'Risk prediction service unavailable');
    } finally {
      if (isMounted.current) setRiskLoading(false);
    }
  }, [patientId]);

  // ── Guideline CDS fetch ────────────────────────────────────────────────────
  const fetchSuggestion = useCallback(async (signal: AbortSignal) => {
    const p  = patientRef.current;
    const ns = nodesRef.current;
    if (!p) return;

    if (isMounted.current) { setLoading(true); setError(null); }

    // Captured before the awaits so results are cached under the inputs they
    // were generated from, even if the canvas changes while in flight.
    const sig = signatureRef.current;

    try {
      // 1. Server-side payload assembly: Express merges the full committed
      //    record (investigation results, PMH, vitals history, dispensing)
      //    with the unsaved canvas data sent here.
      const { data: patientPayload } = await api.post(
        `/patients/${p.id}/cds-payload`,
        {
          canvas: {
            diagnoses: extractCanvasDiagnoses(ns),
            medications: extractCanvasMedications(ns),
            pending_investigations: extractPendingInvestigations(ns),
            encounter_notes: extractEncounterNotes(ns),
          },
        },
        { signal },
      );

      // 2. Guideline CDS call with the enriched payload.
      const res = await fetch(CDS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: DEFAULT_QUESTION, patient: patientPayload }),
        signal,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      if (isMounted.current) {
        setResponse(data);
        if (sig) cacheWrite(sig, { cds: data });
      }
    } catch (err: any) {
      if (err.name === 'AbortError' || err.name === 'CanceledError') return;
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

  // Refresh button bypasses the cache: force both pipelines immediately;
  // their success handlers overwrite the cached entry for this signature.
  function handleRefresh() {
    trigger(true);
    fetchRisk();
  }

  const diagnosisKey    = JSON.stringify((patient?.diagnoses ?? []).filter(d => !d.resolvedAt).map(d => d.id).sort());
  const vitalKey        = latestVital?.id ?? null;
  const prescriptionKey = extractPrescriptionKey(nodes);

  // Full cache signature. patientId comes first — strict per-patient
  // isolation; an entry can never match across patients.
  const signature = JSON.stringify([
    patientId, diagnosisKey, vitalKey, prescriptionKey,
    sigExtras?.latestResultedInvestigation ?? null,
    sigExtras?.latestDispense ?? null,
  ]);
  signatureRef.current = dataReady && patient ? signature : null;

  const triggeredOnce = useRef(false);
  useEffect(() => {
    if (!dataReady || !patient) return;
    const isFirst = !triggeredOnce.current;
    triggeredOnce.current = true;

    const cached = cdsSessionCache.get(signature);

    // Cache hit: render instantly, no pipeline calls, no loading flash.
    if (cached?.cds) {
      setResponse(cached.cds);
      setError(null);
      setLoading(false);
    }
    if (cached?.risk) {
      setRiskData(cached.risk);
      setRiskError(null);
    }

    // Cache miss (whole entry or a missing half): run what's needed.
    // Mid-session signature changes (new diagnosis/prescription/vital) keep
    // the existing behaviour — only the debounced CDS call refires; risk
    // refetches only on first mount for this panel instance (or via Refresh).
    if (!cached?.cds) trigger(isFirst);
    if (!cached?.risk && isFirst) fetchRisk();

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataReady, signature]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (abortRef.current)    abortRef.current.abort();
    };
  }, []);

  function toggleCondition(key: string) {
    setExpandedConditions(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{
      maxWidth: 860,
      background: 'var(--bg-card)', borderRadius: 14, border: '1px solid var(--border)',
      boxShadow: '0 1px 6px rgba(0,0,0,0.05)',
      overflow: 'hidden',
    }}>
      <style>{`
        @keyframes cds-pulse {
          0%, 100% { opacity: 1;   transform: scale(1);   }
          50%       { opacity: 0.3; transform: scale(0.75); }
        }
      `}</style>

      {/* ── Panel header ───────────────────────────────────────────────────── */}
      <div style={{
        width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 20px', background: 'var(--ws-head)',
      }}>
        <button
          onClick={() => setCollapsed(v => !v)}
          style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left' }}
        >
          <Brain size={15} color="var(--ses-red)" />
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-heading)', letterSpacing: '0.02em' }}>
            Clinical Decision Support
          </span>
          <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 500 }}>AI · Guideline-based</span>
          {loading && (
            <span style={{
              width: 7, height: 7, borderRadius: '50%', background: 'var(--ses-red)',
              display: 'inline-block', marginLeft: 2,
              animation: 'cds-pulse 1.4s ease-in-out infinite',
            }} />
          )}
          {collapsed
            ? <ChevronDown size={14} color="var(--text-muted)" style={{ marginLeft: 'auto' }} />
            : <ChevronUp   size={14} color="var(--text-muted)" style={{ marginLeft: 'auto' }} />
          }
        </button>

        <button
          onClick={e => { e.stopPropagation(); handleRefresh(); }}
          disabled={loading || riskLoading}
          title="Re-run CDS analysis"
          style={{
            background: 'none', border: 'none',
            cursor: (loading || riskLoading) ? 'not-allowed' : 'pointer',
            color: (loading || riskLoading) ? 'var(--text-faint)' : 'var(--text-muted)',
            padding: '2px 4px', marginLeft: 8,
            display: 'flex', alignItems: 'center', borderRadius: 4,
            transition: 'color 0.15s',
          }}
          onMouseEnter={e => { if (!loading && !riskLoading) e.currentTarget.style.color = 'var(--text-subtle)'; }}
          onMouseLeave={e => { e.currentTarget.style.color = (loading || riskLoading) ? 'var(--text-faint)' : 'var(--text-muted)'; }}
        >
          <RefreshCw size={13} />
        </button>
      </div>

      {!collapsed && (
        <div style={{ padding: '16px 20px 20px' }}>

          {/* ── Chronic Disease Risk ────────────────────────────────────────── */}
          <div style={{ marginBottom: 14, border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>

            {/* Risk section header */}
            <button
              onClick={() => setRiskCollapsed(v => !v)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 14px', background: 'var(--ws-head)', border: 'none', cursor: 'pointer',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <Activity size={13} color="var(--ses-red)" />
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-heading)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Chronic Disease Risk
                </span>
                {riskLoading && (
                  <span style={{
                    width: 6, height: 6, borderRadius: '50%', background: 'var(--ses-red)',
                    display: 'inline-block',
                    animation: 'cds-pulse 1.4s ease-in-out infinite',
                  }} />
                )}
              </div>
              {riskCollapsed
                ? <ChevronDown size={13} color="var(--text-muted)" />
                : <ChevronUp   size={13} color="var(--text-muted)" />
              }
            </button>

            {!riskCollapsed && (
              <div>
                {/* Error state */}
                {riskError && !riskLoading && (
                  <div style={{ padding: '10px 14px', fontSize: 12, color: 'var(--badge-red-text)', background: 'var(--badge-red-bg)', borderTop: '1px solid var(--border)' }}>
                    {riskError}
                  </div>
                )}

                {/* Loading skeleton */}
                {riskLoading && !riskData && (
                  <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 7, borderTop: '1px solid var(--border)' }}>
                    {[...Array(4)].map((_, i) => (
                      <div key={i} style={{ height: 34, borderRadius: 6, background: 'var(--bg-surface)', opacity: 0.5 }} />
                    ))}
                  </div>
                )}

                {/* Condition rows */}
                {riskData && (
                  <div style={{ opacity: riskLoading ? 0.5 : 1, transition: 'opacity 0.2s' }}>
                    {CONDITION_ORDER.map(key => {
                      const cond = riskData[key];
                      if (!cond) return null;
                      const rs         = RISK_STYLE[cond.risk_level] ?? RISK_STYLE['low'];
                      const isExpanded = expandedConditions.has(key);
                      const pct        = Math.round(cond.probability * 100);

                      return (
                        <div key={key} style={{ borderTop: '1px solid var(--border)' }}>
                          {/* Condition summary row */}
                          <button
                            onClick={() => toggleCondition(key)}
                            style={{
                              width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                              padding: '10px 14px', background: 'none', border: 'none',
                              cursor: 'pointer', textAlign: 'left', transition: 'background 0.12s',
                            }}
                            onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-surface)'; }}
                            onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}
                          >
                            {/* Risk dot indicator */}
                            <span style={{ width: 8, height: 8, borderRadius: '50%', background: rs.dot, flexShrink: 0 }} />

                            {/* Condition name */}
                            <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-heading)', flex: 1 }}>
                              {CONDITION_LABELS[key]}
                            </span>

                            {/* Percentage */}
                            <span style={{ fontSize: 12, fontWeight: 700, color: rs.text, minWidth: 30, textAlign: 'right' }}>
                              {pct}%
                            </span>

                            {/* Risk level badge */}
                            <span style={{
                              fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10,
                              background: rs.bg, color: rs.text, flexShrink: 0,
                            }}>
                              {rs.label}
                            </span>

                            {/* Expand chevron */}
                            {isExpanded
                              ? <ChevronUp   size={12} color="var(--text-subtle)" style={{ flexShrink: 0 }} />
                              : <ChevronDown size={12} color="var(--text-subtle)" style={{ flexShrink: 0 }} />
                            }
                          </button>

                          {/* Expanded detail: summary + SHAP factors */}
                          {isExpanded && (
                            <div style={{ padding: '0 14px 12px', borderTop: '1px solid var(--border-light)' }}>
                              <p style={{ fontSize: 12, color: 'var(--text-body2)', lineHeight: 1.55, margin: '10px 0', fontStyle: 'italic' }}>
                                {cond.summary}
                              </p>

                              {cond.top_factors.length > 0 && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>
                                    Key Factors
                                  </div>
                                  {cond.top_factors.map((f, i) => {
                                    const isRisk = f.direction === 'increases_risk';
                                    return (
                                      <div key={i} style={{
                                        display: 'flex', alignItems: 'flex-start', gap: 8,
                                        padding: '7px 10px', borderRadius: 7,
                                        background: isRisk ? 'var(--badge-red-bg)' : 'var(--badge-green-bg)',
                                      }}>
                                        <span style={{
                                          fontSize: 11, fontWeight: 700, flexShrink: 0, marginTop: 1,
                                          color: isRisk ? 'var(--badge-red-text)' : 'var(--badge-green-text)',
                                        }}>
                                          {isRisk ? '↑' : '↓'}
                                        </span>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                          <span style={{ fontSize: 12, color: 'var(--text-body)', lineHeight: 1.4 }}>
                                            {f.comment}
                                          </span>
                                          <span style={{ fontSize: 10, color: 'var(--text-subtle)', marginLeft: 6 }}>
                                            ({f.impact > 0 ? '+' : ''}{f.impact.toFixed(2)})
                                          </span>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Empty state */}
                {!riskLoading && !riskData && !riskError && (
                  <div style={{ padding: '12px 14px', fontSize: 12, color: 'var(--text-muted)', borderTop: '1px solid var(--border)' }}>
                    Awaiting patient data…
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Guideline CDS content ───────────────────────────────────────── */}

          {serviceError && (
            <div style={{ padding: '12px 16px', background: 'var(--badge-red-bg)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--badge-red-text)', fontSize: 13, marginBottom: 12 }}>
              <strong>CDS service error:</strong> {serviceError}
            </div>
          )}

          {!response && !loading && !serviceError && (
            <div style={{ padding: '14px 16px', background: 'var(--bg-surface)', borderRadius: 8, border: '1px solid var(--border)', color: 'var(--text-muted)', fontSize: 13 }}>
              Waiting for patient data…
            </div>
          )}

          {response && (
            <div style={{ opacity: loading ? 0.5 : 1, transition: 'opacity 0.2s' }}>

              {response.low_confidence && (
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '10px 14px', background: 'var(--badge-amber-bg)', border: '1px solid var(--border)', borderRadius: 8, marginBottom: 12 }}>
                  <AlertTriangle size={14} color="var(--badge-amber-text)" style={{ flexShrink: 0, marginTop: 1 }} />
                  <span style={{ fontSize: 12, color: 'var(--badge-amber-text)' }}>
                    <strong>Low confidence:</strong> No closely matching guideline excerpts were found. Suggestions below may not be grounded in indexed guidelines.
                  </span>
                </div>
              )}

              {response.summary && (
                <div style={{ padding: '12px 16px', background: 'var(--ws-head)', borderRadius: 8, marginBottom: 12 }}>
                  <p style={{ fontSize: 13, color: 'var(--text-heading)', lineHeight: 1.6, margin: 0 }}>
                    <span style={{ color: 'var(--text-subtle)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 4 }}>Clinical Impression</span>
                    {response.summary}
                  </p>
                </div>
              )}

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

              {response.recommendations.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                    Recommendations
                  </div>
                  {response.recommendations.map((rec, i) => {
                    const u     = URGENCY_STYLE[rec.urgency] ?? URGENCY_STYLE.routine;
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

              {response.investigations_suggested.length > 0 && (
                <div style={{ marginBottom: 12, padding: '10px 14px', background: 'var(--badge-green-bg)', border: '1px solid var(--border)', borderRadius: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                    <FlaskConical size={12} color="var(--ses-blue-deep)" />
                    <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ses-blue-deep)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Suggested Investigations</span>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {response.investigations_suggested.map((inv, i) => (
                      <span key={i} style={{ fontSize: 12, background: 'var(--ses-blue-tint)', color: 'var(--ses-blue-deep)', padding: '2px 10px', borderRadius: 20, fontWeight: 500 }}>
                        {inv}
                      </span>
                    ))}
                  </div>
                </div>
              )}

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

              {response.direct_suggestion && (
                <div style={{ marginBottom: 12, padding: '12px 14px', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ws-link)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
                    Differential Diagnosis (AI)
                  </div>
                  <pre style={{ fontSize: 12.5, color: 'var(--text-body)', margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'inherit', lineHeight: 1.6 }}>
                    {response.direct_suggestion}
                  </pre>
                  <p style={{ fontSize: 10.5, color: 'var(--ws-link)', margin: '8px 0 0', fontStyle: 'italic' }}>
                    Not guideline-grounded — based on patient context only. Requires clinician review.
                  </p>
                </div>
              )}

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
