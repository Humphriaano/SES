import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { Save, CheckCircle, Plus, FileText, ChevronDown, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useWindowSize } from '../hooks/useWindowSize';
import toast from 'react-hot-toast';
import api from '../api/client';
import { usePatient } from '../context/PatientContext';
import { Encounter, Patient } from '../types';
import { CanvasNode, BlockType, PMHEntry, ImportedBlockData } from '../types/consultation';
import DiagnosisBlock from '../components/consultation/blocks/DiagnosisBlock';
import InvestigationBlock from '../components/consultation/blocks/InvestigationBlock';
import PrescriptionBlock from '../components/consultation/blocks/PrescriptionBlock';
import PMHBlock from '../components/consultation/blocks/PMHBlock';
import ImportedBlock from '../components/consultation/blocks/ImportedBlock';
import FloatingToolbar from '../components/consultation/FloatingToolbar';
import ConsultationSidebar from '../components/consultation/ConsultationSidebar';
import CdsPanel from '../components/consultation/CdsPanel/CdsPanel';

function uid() { return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }

const INIT_NODES: CanvasNode[] = [{ type: 'text', id: 'root', content: '' }];

function deserializeNodes(raw: string | undefined): CanvasNode[] {
  if (!raw) return INIT_NODES;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed as CanvasNode[];
    return INIT_NODES;
  } catch {
    return INIT_NODES;
  }
}

const ENCOUNTER_TYPES = ['Consultation', 'Follow-up', 'Emergency'] as const;
type EncounterType = typeof ENCOUNTER_TYPES[number];

export default function ConsultationPage() {
  const { patientId } = useParams<{ patientId: string }>();
  const { setActivePatient, setActiveEncounterId } = usePatient();
  const { isMobile, isTablet } = useWindowSize();

  const [patient, setPatient] = useState<Patient | null>(null);
  const [encounters, setEncounters] = useState<Encounter[]>([]);
  const [current, setCurrent] = useState<Encounter | null>(null);
  const [nodes, setNodes] = useState<CanvasNode[]>(INIT_NODES);
  const [encounterType, setEncounterType] = useState<EncounterType>('Consultation');
  const [saving, setSaving] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(!isMobile);
  const [showFinalNote, setShowFinalNote] = useState(false);

  const lastCursorRef = useRef<{ id: string; pos: number } | null>(null);
  const autoSaveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDirtyRef = useRef(false);
  const currentIdRef = useRef<string | null>(null);
  const nodesRef = useRef<CanvasNode[]>(INIT_NODES);

  useEffect(() => {
    if (!patientId) return;
    api.get(`/patients/${patientId}`).then(r => {
      setPatient(r.data);
      setActivePatient(r.data);
    });
    api.get(`/patients/${patientId}/encounters`).then(r => {
      setEncounters(r.data);
      const open = r.data.find((e: Encounter) => e.status === 'OPEN');
      if (open) loadEncounter(open);
    });
  }, [patientId]);

  async function refreshPatient() {
    if (!patientId) return;
    const { data } = await api.get(`/patients/${patientId}`);
    setPatient(data);
    setActivePatient(data);
  }

  async function handleDiagnosisConfirmed(icd11Id: string) {
    const encId = currentIdRef.current;
    if (!encId) return;
    try {
      await api.post(`/encounters/${encId}/diagnoses`, { icd11Id, isPrimary: false });
    } catch { /* already exists — server deduplicates */ }
    await refreshPatient();
  }

  async function handleDiagnosisResolved(diagnosisId: string) {
    if (!patientId) return;
    try {
      await api.patch(`/patients/${patientId}/diagnoses/${diagnosisId}/resolve`, {});
    } catch { /* ignore if already resolved */ }
    await refreshPatient();
  }

  useEffect(() => {
    autoSaveTimerRef.current = setInterval(() => {
      if (isDirtyRef.current) saveNow();
    }, 30000);
    return () => { if (autoSaveTimerRef.current) clearInterval(autoSaveTimerRef.current); };
  }, []);

  function loadEncounter(e: Encounter) {
    setCurrent(e);
    currentIdRef.current = e.id;
    setActiveEncounterId(e.id);
    setNodes(deserializeNodes(e.notes ?? undefined));
    isDirtyRef.current = false;
  }

  async function startEncounter() {
    const { data } = await api.post(`/patients/${patientId}/encounters`);
    setEncounters(prev => [data, ...prev]);
    loadEncounter(data);
    toast.success('New encounter started');
  }

  async function saveNow(showToast = false) {
    const id = currentIdRef.current;
    if (!id) return;
    setSaving(true);
    const snap = nodesRef.current;
    try {
      const { data } = await api.patch(`/encounters/${id}`, {
        notes: JSON.stringify(snap),
        chiefComplaint: extractChiefComplaint(snap),
      });
      setCurrent(data);
      isDirtyRef.current = false;
      if (showToast) toast.success('Draft saved');
    } catch {
      if (showToast) toast.error('Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function finaliseNote() {
    await saveNow();
    const id = currentIdRef.current;
    if (!id) return;
    await api.post(`/encounters/${id}/close`);
    setCurrent(c => c ? { ...c, status: 'CLOSED' } : c);
    setEncounters(prev => prev.map(e => e.id === id ? { ...e, status: 'CLOSED' } : e));
    toast.success('Note finalised');
    setShowFinalNote(true);
  }

  function updateNodes(updated: CanvasNode[]) {
    setNodes(updated);
    nodesRef.current = updated;
    isDirtyRef.current = true;
    if (currentIdRef.current && updated !== INIT_NODES) {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(() => saveNow(), 3000);
    }
  }

  function insertBlock(type: BlockType) {
    const cursor = lastCursorRef.current;
    const block = makeBlock(type);
    const after: CanvasNode = { type: 'text', id: uid(), content: '' };

    if (!cursor) {
      updateNodes([...nodes, block, after]);
      return;
    }

    const idx = nodes.findIndex(n => n.id === cursor.id);
    if (idx === -1) {
      updateNodes([...nodes, block, after]);
      return;
    }

    const textNode = nodes[idx];
    if (textNode.type !== 'text') {
      updateNodes([...nodes.slice(0, idx + 1), block, after, ...nodes.slice(idx + 1)]);
      return;
    }

    const before = textNode.content.slice(0, cursor.pos);
    const rest   = textNode.content.slice(cursor.pos);
    const newNodes: CanvasNode[] = [
      ...nodes.slice(0, idx),
      { type: 'text', id: cursor.id, content: before },
      block,
      { type: 'text', id: uid(), content: rest },
      ...nodes.slice(idx + 1),
    ];
    updateNodes(newNodes);
  }

  function makeBlock(type: BlockType): CanvasNode {
    switch (type) {
      case 'diagnosis':
        return { type: 'diagnosis', id: uid(), data: { icd11Code: '', icd11Description: '', status: 'SUSPECTED', isChronic: false, isPrimary: false } };
      case 'investigation':
        return { type: 'investigation', id: uid(), data: { items: [] } };
      case 'prescription':
        return { type: 'prescription', id: uid(), data: { items: [] } };
      case 'pmh': {
        const entries: PMHEntry[] = (patient?.diagnoses ?? []).map(d => ({
          id: d.id,
          icd11Code: d.icd11.code,
          icd11Description: d.icd11.description,
          dateFirstConfirmed: d.createdAt,
          status: d.resolvedAt ? 'RESOLVED' : 'CONFIRMED',
        }));
        return { type: 'pmh', id: uid(), data: { entries } };
      }
    }
  }

  function updateNodeText(id: string, content: string) {
    updateNodes(nodes.map(n => n.id === id && n.type === 'text' ? { ...n, content } : n));
  }

  function updateBlockData(id: string, data: any) {
    updateNodes(nodes.map(n => n.id === id ? { ...n, data } as CanvasNode : n));
  }

  function removeNode(id: string) {
    const filtered = nodes.filter(n => n.id !== id);
    const cleaned = filtered.length === 0 || filtered[filtered.length - 1].type !== 'text'
      ? [...filtered, { type: 'text' as const, id: uid(), content: '' }]
      : filtered;
    updateNodes(cleaned);
  }

  function handleImportEncounter(data: ImportedBlockData) {
    if (!isOpen) { toast.error('Open an encounter before importing'); return; }
    // Deduplicate: skip if this encounter is already imported
    if (nodes.some(n => n.type === 'imported' && (n as Extract<CanvasNode, { type: 'imported' }>).data.encounterId === data.encounterId)) {
      toast('Already imported', { icon: 'ℹ️' });
      return;
    }
    const importedNode: CanvasNode = { type: 'imported', id: uid(), data };
    // Insert before all non-imported nodes, preserving a trailing text node
    const nonImported = nodes.filter(n => n.type !== 'imported');
    const existing = nodes.filter(n => n.type === 'imported');
    // Sort existing imported by date ascending, insert new one in order
    const allImported = [...existing, importedNode].sort((a, b) => {
      const da = (a as Extract<CanvasNode, { type: 'imported' }>).data.encounterDate;
      const db = (b as Extract<CanvasNode, { type: 'imported' }>).data.encounterDate;
      return new Date(da).getTime() - new Date(db).getTime();
    });
    updateNodes([...allImported, ...nonImported]);
    toast.success('Encounter imported to canvas');
  }

  const isOpen = current?.status === 'OPEN';
  const readOnly = !isOpen;

  if (showFinalNote && current) {
    return <FinalNoteView patient={patient} encounter={current} nodes={nodes} encounterType={encounterType} onBack={() => setShowFinalNote(false)} />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%', background: 'var(--bg-page)' }}>
      {/* Consultation top bar */}
      <div style={{
        background: 'var(--bg-card)', borderBottom: '1px solid var(--border)',
        padding: '10px 20px', display: 'flex', alignItems: 'center', gap: 12,
        position: 'sticky', top: 0, zIndex: 20,
        boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
      }}>
        {/* Left: patient meta */}
        <button
          onClick={() => setSidebarOpen(v => !v)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-subtle)', padding: 4, flexShrink: 0 }}
          title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
        >
          {sidebarOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
        </button>

        <div style={{ flex: 1, minWidth: 0 }}>
          {patient && (
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-heading)' }}>
                {patient.firstName} {patient.lastName}
              </span>
              <span style={{ fontSize: 12, color: 'var(--text-subtle)' }}>
                {calcAge(patient.dateOfBirth)} yrs · {patient.gender}
                {patient.nationalId ? ` · ${patient.nationalId}` : ''}
              </span>
              {current && (
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  · {new Date(current.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Centre: encounter type */}
        {isOpen && (
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <select
              value={encounterType}
              onChange={e => setEncounterType(e.target.value as EncounterType)}
              style={{
                appearance: 'none', background: 'var(--bg-surface)', border: '1.5px solid var(--border-input)',
                 padding: '5px 28px 5px 12px', fontSize: 12.5,
                color: 'var(--text-body)', fontWeight: 600, cursor: 'pointer', outline: 'none',
              }}
            >
              {ENCOUNTER_TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
            <ChevronDown size={12} style={{ position: 'absolute', right: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-subtle)', pointerEvents: 'none' }} />
          </div>
        )}

        {/* Right: actions */}
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          {isOpen && (
            <>
              <button
                onClick={() => saveNow(true)}
                disabled={saving}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  background: 'var(--bg-surface)', color: 'var(--text-body)', border: '1.5px solid var(--border-input)',
                   padding: '6px 14px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
                }}
              >
                <Save size={13} /> {saving ? 'Saving…' : 'Save Draft'}
              </button>
              <button
                onClick={finaliseNote}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  background: 'var(--accent)', color: '#fff', border: 'none',
                  padding: '7px 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                  letterSpacing: '0.02em',
                }}
              >
                <CheckCircle size={14} /> Finalise Note
              </button>
            </>
          )}
          {current?.status === 'CLOSED' && (
            <button
              onClick={() => setShowFinalNote(true)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--badge-green-bg)', color: 'var(--badge-green-text)', border: '1.5px solid var(--badge-green-text)',  padding: '6px 14px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}
            >
              <FileText size={13} /> View Note
            </button>
          )}
          {(!current || current.status === 'CLOSED') && (
            <button
              onClick={startEncounter}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#2979FF', color: '#fff', border: 'none',  padding: '6px 14px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}
            >
              <Plus size={13} /> New Encounter
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      <div style={{ display: 'flex', flex: 1 }}>
        {/* Sidebar */}
        <ConsultationSidebar
          patientId={patientId!}
          patient={patient}
          encounters={encounters}
          visible={sidebarOpen}
          currentNodes={nodes}
          onImportEncounter={isOpen ? handleImportEncounter : undefined}
        />

        {/* Canvas area */}
        <div style={{ flex: 1, padding: isMobile ? '14px 14px 14px 14px' : '28px 80px 28px 24px' }}>
          <div style={{ display: 'flex', height: isMobile ? 'auto' : 'calc(100vh - 60px)', minHeight: isMobile ? 'calc(100vh - 120px)' : undefined, overflow: isMobile ? 'visible' : 'hidden', gap: 24 }}>
            {/* Left: notes area */}
            <div style={{ flex: 1, minWidth: 0, overflowX: 'hidden', overflowY: isMobile ? 'visible' : 'auto', height: isMobile ? 'auto' : '100%' }}>
              {current ? (
                <>
                  {current.status === 'CLOSED' && (
                    <div style={{ background: 'var(--badge-amber-bg)', border: '1px solid var(--badge-amber-text)',  padding: '10px 16px', fontSize: 13, color: 'var(--badge-amber-text)', marginBottom: 18, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span>⚠</span> This encounter has been finalised. Open a new encounter to continue documenting.
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 0, maxWidth: 860 }}>
                    {/* Note canvas */}
                    <div style={{ flex: 1, background: 'var(--bg-card)',  border: '1px solid var(--border)', padding: isMobile ? '16px 16px' : '28px 32px', boxShadow: '0 1px 6px rgba(0,0,0,0.05)', minHeight: isMobile ? 320 : 560, position: 'relative' }}>
                      {/* Hex corner accent frames — purely decorative */}
                      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" style={{ position: 'absolute', top: 6, left: 6, pointerEvents: 'none' }}>
                        <path d="M 14,2 L 3,2 L 0,10" stroke="var(--border)" strokeWidth="1.5" strokeLinecap="square" opacity="0.45"/>
                      </svg>
                      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" style={{ position: 'absolute', top: 6, right: 6, pointerEvents: 'none' }}>
                        <path d="M 4,2 L 15,2 L 18,10" stroke="var(--border)" strokeWidth="1.5" strokeLinecap="square" opacity="0.45"/>
                      </svg>
                      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" style={{ position: 'absolute', bottom: 6, right: 6, pointerEvents: 'none' }}>
                        <path d="M 18,8 L 15,16 L 4,16" stroke="var(--border)" strokeWidth="1.5" strokeLinecap="square" opacity="0.45"/>
                      </svg>
                      {(() => {
                        const importedNodes = nodes.filter(n => n.type === 'imported') as Extract<CanvasNode, { type: 'imported' }>[];
                        const regularNodes = nodes.filter(n => n.type !== 'imported');
                        const hasImports = importedNodes.length > 0;
                        const regularNonEmpty = regularNodes.filter(n => n.type !== 'text' || (n as Extract<CanvasNode, { type: 'text' }>).content);
                        return (
                          <>
                            {/* Imported blocks — always at top, sorted chronologically */}
                            {importedNodes.map(node => (
                              <ImportedBlock
                                key={node.id}
                                data={node.data}
                                onRemove={() => removeNode(node.id)}
                              />
                            ))}
                            {/* Separator between imported context and new note */}
                            {hasImports && (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '20px 0 16px' }}>
                                <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                                <span style={{ fontSize: 11, color: 'var(--text-subtle)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                                  Continue note below
                                </span>
                                <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                              </div>
                            )}
                            {/* Regular canvas nodes */}
                            {regularNodes.map(node => {
                        if (node.type === 'text') {
                          const isOnlyEmpty = regularNodes.length === 1 && !node.content;
                          const placeholder = !node.content
                            ? (hasImports
                                ? 'Begin writing your continuation note here…'
                                : (isOnlyEmpty
                                    ? 'Begin writing your consultation note…\n\nUse the block buttons on the right to insert structured data at any point.'
                                    : ''))
                            : '';
                          return (
                            <AutoTextarea
                              key={node.id}
                              nodeId={node.id}
                              value={node.content}
                              readOnly={readOnly}
                              minHeight={hasImports && isOnlyEmpty ? 160 : undefined}
                              placeholder={placeholder}
                              onChange={content => updateNodeText(node.id, content)}
                              onCursor={(id, pos) => { lastCursorRef.current = { id, pos }; }}
                            />
                          );
                        }
                        if (node.type === 'diagnosis') {
                          return (
                            <DiagnosisBlock key={node.id} data={node.data} readOnly={readOnly}
                              onChange={data => updateBlockData(node.id, data)}
                              onRemove={() => removeNode(node.id)}
                              onConfirmed={handleDiagnosisConfirmed}
                            />
                          );
                        }
                        if (node.type === 'investigation') {
                          return (
                            <InvestigationBlock key={node.id} data={node.data} readOnly={readOnly}
                              onChange={data => updateBlockData(node.id, data)}
                              onRemove={() => removeNode(node.id)}
                              patientId={patientId}
                              encounterId={currentIdRef.current ?? undefined}
                            />
                          );
                        }
                        if (node.type === 'prescription') {
                          return (
                            <PrescriptionBlock key={node.id} data={node.data} readOnly={readOnly}
                              onChange={data => updateBlockData(node.id, data)}
                              onRemove={() => removeNode(node.id)}
                              patientId={patientId}
                              encounterId={currentIdRef.current ?? undefined}
                            />
                          );
                        }
                        if (node.type === 'pmh') {
                          return (
                            <PMHBlock key={node.id} data={node.data} readOnly={readOnly}
                              onChange={data => updateBlockData(node.id, data)}
                              onRemove={() => removeNode(node.id)}
                              onResolve={handleDiagnosisResolved}
                            />
                          );
                        }
                        return null;
                      })}
                          </>
                        );
                      })()}
                    </div>

                    {/* Floating toolbar */}
                    {isOpen && (
                      <FloatingToolbar onInsert={insertBlock} />
                    )}
                  </div>
                </>
              ) : (
                <div style={{ maxWidth: 480, margin: '80px auto', textAlign: 'center' }}>
                  <div style={{ width: 56, height: 56, background: 'var(--accent-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
                    <FileText size={24} color="var(--accent)" />
                  </div>
                  <p style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-heading)', marginBottom: 8 }}>No active encounter</p>
                  <p style={{ fontSize: 14, color: 'var(--text-subtle)', marginBottom: 24 }}>Start a new encounter to begin documenting this visit.</p>
                  <button
                    onClick={startEncounter}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#2979FF', color: '#fff', border: 'none',  padding: '10px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
                  >
                    <Plus size={16} /> Start New Encounter
                  </button>
                </div>
              )}
            </div>

            {/* Right: CDS panel — hidden on mobile and tablet */}
            {!isTablet && (
              <div style={{ width: 380, flexShrink: 0, height: '100%', overflowY: 'auto', position: 'relative' }}>
                <CdsPanel patientId={patientId!} patient={patient} nodes={nodes} />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Auto-growing textarea ────────────────────────────────────────────────────

interface TextAreaProps {
  nodeId: string;
  value: string;
  onChange: (v: string) => void;
  onCursor: (id: string, pos: number) => void;
  readOnly?: boolean;
  placeholder?: string;
  minHeight?: number;
}

function AutoTextarea({ nodeId, value, onChange, onCursor, readOnly, placeholder, minHeight }: TextAreaProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  function resize(el: HTMLTextAreaElement) {
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }

  useEffect(() => {
    if (ref.current) resize(ref.current);
  }, [value]);

  return (
    <textarea
      ref={ref}
      value={value}
      readOnly={readOnly}
      placeholder={placeholder}
      rows={1}
      onChange={e => { onChange(e.target.value); resize(e.target); }}
      onSelect={e => onCursor(nodeId, (e.target as HTMLTextAreaElement).selectionStart ?? 0)}
      onBlur={e => onCursor(nodeId, e.target.selectionStart ?? 0)}
      style={{
        display: 'block',
        width: '100%',
        minHeight: minHeight ?? 40,
        resize: 'none',
        border: 'none',
        outline: 'none',
        background: 'transparent',
        fontSize: 15,
        lineHeight: 1.75,
        color: 'var(--text-heading)',
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
        padding: '2px 0',
        overflow: 'hidden',
        boxSizing: 'border-box',
      }}
    />
  );
}

// ─── Final note view ──────────────────────────────────────────────────────────

function FinalNoteView({ patient, encounter, nodes, encounterType, onBack }: {
  patient: Patient | null;
  encounter: Encounter;
  nodes: CanvasNode[];
  encounterType: string;
  onBack: () => void;
}) {
  const dxBlocks = nodes.filter(n => n.type === 'diagnosis') as Extract<CanvasNode, { type: 'diagnosis' }>[];
  const invBlocks = nodes.filter(n => n.type === 'investigation') as Extract<CanvasNode, { type: 'investigation' }>[];
  const rxBlocks = nodes.filter(n => n.type === 'prescription') as Extract<CanvasNode, { type: 'prescription' }>[];

  return (
    <div style={{ padding: '28px 32px', maxWidth: 820, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: 'var(--text-subtle)', cursor: 'pointer', fontSize: 13 }}>
          ← Back to note
        </button>
        <button
          onClick={() => window.print()}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--bg-surface)', color: 'var(--text-body)', border: '1.5px solid var(--border-input)',  padding: '6px 14px', fontSize: 12.5, cursor: 'pointer' }}
        >
          Print / Export PDF
        </button>
      </div>

      <div id="print-area">

      {/* Header */}
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)',  padding: '20px 24px', marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-heading)' }}>
              {patient?.firstName} {patient?.lastName}
            </div>
            {patient && (
              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 3 }}>
                {calcAge(patient.dateOfBirth)} yrs · {patient.gender}
                {patient.nationalId ? ` · NRC: ${patient.nationalId}` : ''}
              </div>
            )}
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-body)' }}>{encounterType}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              {new Date(encounter.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
            </div>
            {encounter.clinician?.name && (
              <div style={{ fontSize: 12, color: 'var(--text-subtle)' }}>Dr. {encounter.clinician.name}</div>
            )}
          </div>
        </div>
      </div>

      {/* Note body */}
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)',  padding: '28px 32px', marginBottom: 16 }}>
        <h3 style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 20 }}>Consultation Note</h3>
        {nodes.map(node => {
          if (node.type === 'text' && node.content) {
            return (
              <p key={node.id} style={{ fontSize: 15, lineHeight: 1.75, color: 'var(--text-heading)', whiteSpace: 'pre-wrap', margin: '0 0 8px' }}>
                {node.content}
              </p>
            );
          }
          if (node.type === 'diagnosis') {
            return <DiagnosisBlock key={node.id} data={node.data} onChange={() => {}} onRemove={() => {}} readOnly />;
          }
          if (node.type === 'investigation') {
            return <InvestigationBlock key={node.id} data={node.data} onChange={() => {}} onRemove={() => {}} readOnly />;
          }
          if (node.type === 'prescription') {
            return <PrescriptionBlock key={node.id} data={node.data} onChange={() => {}} onRemove={() => {}} readOnly />;
          }
          if (node.type === 'pmh') {
            return <PMHBlock key={node.id} data={node.data} onChange={() => {}} onRemove={() => {}} readOnly />;
          }
          return null;
        })}
      </div>

      {/* Summaries */}
      {dxBlocks.length > 0 && (
        <SummaryCard title="Diagnoses">
          {dxBlocks.map(b => (
            <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: '1px solid var(--border-light)' }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#2979FF', fontFamily: 'monospace' }}>{b.data.icd11Code}</span>
              <span style={{ fontSize: 13, color: 'var(--text-body)' }}>{b.data.icd11Description}</span>
              <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)' }}>{b.data.status}</span>
            </div>
          ))}
        </SummaryCard>
      )}

      {invBlocks.length > 0 && (
        <SummaryCard title="Investigations Ordered">
          {invBlocks.flatMap(b => b.data.items).map(item => (
            <div key={item.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid var(--border-light)' }}>
              <span style={{ fontSize: 13, color: 'var(--text-body)' }}>{item.name}</span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{item.status}</span>
            </div>
          ))}
        </SummaryCard>
      )}

      {rxBlocks.length > 0 && (
        <SummaryCard title="Prescriptions Issued">
          {rxBlocks.flatMap(b => b.data.items).map(item => (
            <div key={item.id} style={{ padding: '5px 0', borderBottom: '1px solid var(--border-light)' }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-heading)' }}>{item.drugName}</span>
              <span style={{ fontSize: 12, color: 'var(--text-body)' }}> — {item.dose} {item.frequency}{item.duration ? `, ${item.duration}` : ''}, {item.route}</span>
            </div>
          ))}
        </SummaryCard>
      )}

      </div>{/* end #print-area */}
    </div>
  );
}

function SummaryCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)',  padding: '16px 20px', marginBottom: 12 }}>
      <h4 style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 12px' }}>{title}</h4>
      {children}
    </div>
  );
}

function calcAge(dob: string): number {
  const birth = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  if (today < new Date(today.getFullYear(), birth.getMonth(), birth.getDate())) age--;
  return age;
}

function extractChiefComplaint(nodes: CanvasNode[]): string {
  for (const n of nodes) {
    if (n.type === 'text' && n.content.trim()) {
      return n.content.trim().split('\n')[0].slice(0, 200);
    }
  }
  return '';
}
