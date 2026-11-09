import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle, Plus, FileText, ChevronDown, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useWindowSize } from '../hooks/useWindowSize';
import toast from 'react-hot-toast';
import api from '../api/client';
import { createAutosaver } from '../lib/autosave';
import type { Autosaver, AutosaveStatus } from '../lib/autosave';
import { usePatient } from '../context/PatientContext';
import { Encounter, Patient } from '../types';
import { CanvasNode, BlockType, PMHEntry, ImportedBlockData } from '../types/consultation';
import DiagnosisBlock from '../components/consultation/blocks/DiagnosisBlock';
import InvestigationBlock from '../components/consultation/blocks/InvestigationBlock';
import PrescriptionBlock from '../components/consultation/blocks/PrescriptionBlock';
import PMHBlock from '../components/consultation/blocks/PMHBlock';
import HistoryBlock from '../components/consultation/blocks/HistoryBlock';
import { canInsertHistory, isHistoryNode, HISTORY_SECTIONS } from '../lib/consultationHistory';
import { insertCanvasBlock } from '../lib/canvasInsertion';
import type { HistoryType } from '../types/consultation';
import FinalInvestigationResults from '../components/consultation/FinalInvestigationResults';
import ImportedBlock from '../components/consultation/blocks/ImportedBlock';
import InsertBar from '../components/consultation/InsertBar';
import ConsultationSidebar from '../components/consultation/ConsultationSidebar';
import CdsPanel from '../components/consultation/CdsPanel/CdsPanel';
import SuggestTextarea from '../components/consultation/SuggestTextarea';
import ProcedureRecorder from '../components/consultation/blocks/ProcedureRecorder';
import AutocompleteToggle from '../components/consultation/AutocompleteToggle';

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
  const [saveStatus, setSaveStatus] = useState<AutosaveStatus>('saved');
  const [finalising, setFinalising] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(!isMobile);
  const [showFinalNote, setShowFinalNote] = useState(false);

  const lastCursorRef = useRef<{ id: string; pos: number } | null>(null);
  const autosaversRef = useRef(new Map<string, Autosaver<CanvasNode[]>>());
  const mountedRef = useRef(true);
  const currentIdRef = useRef<string | null>(null);
  const nodesRef = useRef<CanvasNode[]>(INIT_NODES);

  useEffect(() => {
    if (!patientId) return;
    let live = true;
    currentIdRef.current = null;
    nodesRef.current = INIT_NODES;
    setCurrent(null);
    setPatient(null);
    setNodes(INIT_NODES);
    setShowFinalNote(false);
    setSaveStatus('saved');
    api.get(`/patients/${patientId}`).then(r => {
      if (!live) return;
      setPatient(r.data);
      setActivePatient(r.data);
    });
    api.get(`/patients/${patientId}/encounters`).then(r => {
      if (!live) return;
      setEncounters(r.data);
      const open = r.data.find((e: Encounter) => e.status === 'OPEN');
      if (open) loadEncounter(open);
    });
    return () => { live = false; };
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
    mountedRef.current = true;
    const flushAll = () => { for (const saver of autosaversRef.current.values()) void saver.flush(); };
    const protectUnsaved = (event: BeforeUnloadEvent) => {
      if ([...autosaversRef.current.values()].some(saver => saver.hasPending())) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    const onVisibility = () => { if (document.visibilityState === 'hidden') flushAll(); };
    window.addEventListener('online', flushAll);
    window.addEventListener('beforeunload', protectUnsaved);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      mountedRef.current = false;
      window.removeEventListener('online', flushAll);
      window.removeEventListener('beforeunload', protectUnsaved);
      document.removeEventListener('visibilitychange', onVisibility);
      for (const saver of autosaversRef.current.values()) saver.dispose();
      autosaversRef.current.clear();
    };
  }, []);

  function loadEncounter(e: Encounter) {
    lastCursorRef.current = null;
    currentIdRef.current = e.id;
    let saver = autosaversRef.current.get(e.id);
    if (!saver) {
      saver = createAutosaver<CanvasNode[]>(async snapshot => {
        const { data } = await api.patch<Encounter>(`/encounters/${e.id}`, {
          notes: JSON.stringify(snapshot),
          chiefComplaint: extractChiefComplaint(snapshot),
        });
        if (mountedRef.current && currentIdRef.current === e.id) setCurrent(data);
      }, status => {
        if (mountedRef.current && currentIdRef.current === e.id) setSaveStatus(status);
      });
      autosaversRef.current.set(e.id, saver);
    }
    setCurrent(e);
    setActiveEncounterId(e.id);
    const loaded = saver.latest() ?? deserializeNodes(e.notes ?? undefined);
    setNodes(loaded);
    nodesRef.current = loaded;
    setSaveStatus(saver.status());
  }

  async function startEncounter() {
    const { data } = await api.post(`/patients/${patientId}/encounters`);
    setEncounters(prev => [data, ...prev]);
    loadEncounter(data);
    toast.success('New encounter started');
  }

  async function finaliseNote() {
    const id = currentIdRef.current;
    if (!id || finalising) return;
    setFinalising(true);
    try {
      const saver = autosaversRef.current.get(id);
      if (saver && (!(await saver.flush()) || saver.hasPending())) {
        toast.error('Your latest changes have not saved yet. They will retry automatically.');
        return;
      }
      await api.post(`/encounters/${id}/close`);
      setEncounters(prev => prev.map(e => e.id === id ? { ...e, status: 'CLOSED' } : e));
      if (currentIdRef.current === id) {
        setCurrent(c => c?.id === id ? { ...c, status: 'CLOSED' } : c);
        setShowFinalNote(true);
      }
      toast.success('Note finalised');
    } catch {
      // The API client reports the failure; leave the encounter open.
    } finally {
      if (mountedRef.current) setFinalising(false);
    }
  }

  function updateNodes(updated: CanvasNode[]) {
    if (finalising) return;
    setNodes(updated);
    nodesRef.current = updated;
    const id = currentIdRef.current;
    if (id) autosaversRef.current.get(id)?.enqueue(updated);
  }

  function insertBlock(type: BlockType) {
    if (current?.status !== 'OPEN' || finalising) return;
    if (Object.prototype.hasOwnProperty.call(HISTORY_SECTIONS, type) && !canInsertHistory(type as HistoryType, patient)) return;
    // Read the live list, not the one captured at the last render — two quick edits must not overwrite each other.
    const nodes = nodesRef.current;
    const cursor = lastCursorRef.current;
    const block = makeBlock(type);
    updateNodes(insertCanvasBlock(nodes, cursor, block, uid()));
    lastCursorRef.current = { id: block.id, pos: 0 };
  }

  // Adds a new block directly below an existing one (e.g. a second diagnosis under the first).
  function insertBlockAfter(afterId: string, type: BlockType) {
    // Read the live list, not the one captured at the last render — two quick edits must not overwrite each other.
    const nodes = nodesRef.current;
    const idx = nodes.findIndex(n => n.id === afterId);
    const block = makeBlock(type);
    if (idx === -1) { updateNodes([...nodes, block, { type: 'text', id: uid(), content: '' }]); return; }
    updateNodes([...nodes.slice(0, idx + 1), block, ...nodes.slice(idx + 1)]);
  }

  function makeBlock(type: BlockType): CanvasNode {
    switch (type) {
      case 'diagnosis':
        return { type: 'diagnosis', id: uid(), data: { icd11Code: '', icd11Description: '', status: 'SUSPECTED', isChronic: false, isPrimary: false } };
      case 'investigation':
        return { type: 'investigation', id: uid(), data: { items: [] } };
      case 'prescription':
        return { type: 'prescription', id: uid(), data: { items: [] } };
      case 'drug-history':
      case 'gynae-history':
      case 'obstetric-history':
      case 'immunization-history':
      case 'procedure':
        return { type, id: uid(), data: { content: '' } };
      case 'pmh': {
        const entries: PMHEntry[] = (patient?.diagnoses ?? []).map(d => ({
          id: d.id,
          icd11Code: d.icd11.code,
          icd11Description: d.icd11.description,
          dateFirstConfirmed: d.diagnosedAt ?? d.createdAt,
          diagnosedYear: d.diagnosedAt ? new Date(d.diagnosedAt).getUTCFullYear() : undefined,
          status: d.resolvedAt ? 'RESOLVED' : 'CONFIRMED',
        }));
        return { type: 'pmh', id: uid(), data: { entries } };
      }
    }
  }

  function updateNodeText(id: string, content: string) {
    // Read the live list, not the one captured at the last render — two quick edits must not overwrite each other.
    const nodes = nodesRef.current;
    updateNodes(nodes.map(n => n.id === id && n.type === 'text' ? { ...n, content } : n));
  }

  function updateBlockData(id: string, data: any) {
    // Read the live list, not the one captured at the last render — two quick edits must not overwrite each other.
    const nodes = nodesRef.current;
    updateNodes(nodes.map(n => n.id === id ? { ...n, data } as CanvasNode : n));
  }

  function removeNode(id: string) {
    // Read the live list, not the one captured at the last render — two quick edits must not overwrite each other.
    const nodes = nodesRef.current;
    const filtered = nodes.filter(n => n.id !== id);
    const cleaned = filtered.length === 0 || filtered[filtered.length - 1].type !== 'text'
      ? [...filtered, { type: 'text' as const, id: uid(), content: '' }]
      : filtered;
    updateNodes(cleaned);
  }

  function handleImportEncounter(data: ImportedBlockData) {
    // Read the live list, not the one captured at the last render — two quick edits must not overwrite each other.
    const nodes = nodesRef.current;
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
  const readOnly = !isOpen || finalising;

  if (showFinalNote && current) {
    return <FinalNoteView patient={patient} encounter={current} nodes={nodes} encounterType={encounterType} onBack={() => setShowFinalNote(false)} />;
  }

  return (
    <div className="clinical-module" style={{ display: 'flex', flexDirection: 'column', minHeight: '100%', background: 'var(--bg-page)' }}>
      {/* Toolbar strip */}
      <div className="cx-toolbar">
        <div className="cx-toolbar-inner">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <button
              className="cx-ib"
              type="button"
              onClick={() => setSidebarOpen(v => !v)}
              aria-label={sidebarOpen ? 'Hide patient summary' : 'Show patient summary'}
              aria-pressed={!sidebarOpen}
              title={sidebarOpen ? 'Hide patient summary' : 'Show patient summary'}
            >
              {sidebarOpen ? <PanelLeftClose size={17} /> : <PanelLeftOpen size={17} />}
            </button>

            {isOpen && (
              <div style={{ position: 'relative' }}>
                <select
                  className="cx-btn"
                  value={encounterType}
                  onChange={e => setEncounterType(e.target.value as EncounterType)}
                  aria-label="Encounter type"
                  style={{ appearance: 'none', paddingRight: 30 }}
                >
                  {ENCOUNTER_TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
                <ChevronDown size={13} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-subtle)', pointerEvents: 'none' }} />
              </div>
            )}

            {isOpen && (
              <>
                <AutocompleteToggle />
                <span className={saveStatus === 'error' ? 'cx-save-status cx-save-error' : 'cx-save-status'} role="status" aria-live="polite">
                  <span className="cx-save-dot" aria-hidden="true" />
                  {saveStatus === 'error' ? 'Not saved · retrying…' : saveStatus === 'saving' ? 'Saving…' : 'Saved'}
                </span>
                <button className="cx-red" type="button" onClick={finaliseNote} disabled={finalising}>{finalising ? 'Finalising…' : 'Finalise note'}</button>
              </>
            )}
            {current?.status === 'CLOSED' && (
              <button className="cx-btn" type="button" onClick={() => setShowFinalNote(true)}>
                <FileText size={14} /> View note
              </button>
            )}
            {(!current || current.status === 'CLOSED') && (
              <button className="cx-red" type="button" onClick={startEncounter}>
                <Plus size={14} /> New encounter
              </button>
            )}
          </div>
          {current && (
            <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
              {current.status === 'OPEN' ? 'Open encounter' : 'Finalised'} · {new Date(current.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
            </span>
          )}
        </div>
      </div>

      {/* Body: patient summary | note | decision support */}
      <main style={{ maxWidth: 1600, margin: '0 auto', width: '100%', boxSizing: 'border-box', padding: isMobile ? '8px 14px 32px' : '8px 24px 40px' }}>
        <div style={{
          display: 'grid', gap: 20, alignItems: 'start',
          gridTemplateColumns: isMobile ? '1fr'
            : isTablet ? (sidebarOpen ? '270px minmax(0, 1fr)' : 'minmax(0, 1fr)')
              : (sidebarOpen ? '270px minmax(0, 1fr) 400px' : 'minmax(0, 1fr) 400px'),
        }}>
          <ConsultationSidebar
            patientId={patientId!}
            patient={patient}
            encounters={encounters}
            visible={sidebarOpen}
            currentNodes={nodes}
            onImportEncounter={isOpen ? handleImportEncounter : undefined}
          />

          <section className="cx-card" aria-label="Consultation note" style={{ minWidth: 0 }}>
            {isOpen && <InsertBar onInsert={insertBlock} patient={patient} />}
            <div style={{ padding: isMobile ? '16px' : '20px 24px 28px' }}>
              {current ? (
                <>
                  {current.status === 'CLOSED' && (
                    <div style={{ background: 'var(--badge-amber-bg)', border: '1px solid var(--badge-amber-text)', borderRadius: 10, padding: '10px 16px', fontSize: 13, color: 'var(--badge-amber-text)', marginBottom: 18, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span>⚠</span> This encounter has been finalised. Open a new encounter to continue documenting.
                    </div>
                  )}
                  <div style={{ minHeight: isMobile ? 320 : 520 }}>
                      {(() => {
                        const importedNodes = nodes.filter(n => n.type === 'imported') as Extract<CanvasNode, { type: 'imported' }>[];
                        const regularNodes = nodes.filter(n => n.type !== 'imported');
                        const hasImports = importedNodes.length > 0;
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
                                <span style={{ fontSize: 11, color: 'var(--text-subtle)', fontWeight: 500, whiteSpace: 'nowrap' }}>
                                  Continue note below
                                </span>
                                <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                              </div>
                            )}
                            {/* Regular canvas nodes */}
                            {regularNodes.map((node, index) => {
                        if (node.type === 'text') {
                          // Show one editing area for consecutive empty paragraphs; keep saved nodes intact.
                          const previous = regularNodes[index - 1];
                          if (!node.content && previous?.type === 'text' && !previous.content) return null;
                          const isOnlyEmpty = regularNodes.length === 1 && !node.content;
                          return (
                            <AutoTextarea
                              key={node.id}
                              nodeId={node.id}
                              value={node.content}
                              readOnly={readOnly}
                              minHeight={hasImports && isOnlyEmpty ? 160 : undefined}
                              label={hasImports ? 'Continuation note' : 'Consultation note'}
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
                              onAddAnother={() => insertBlockAfter(node.id, 'diagnosis')}
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
                        if (isHistoryNode(node)) {
                          return <HistoryBlock key={node.id} type={node.type} data={node.data} readOnly={readOnly}
                            onFocus={() => { lastCursorRef.current = { id: node.id, pos: 0 }; }}
                            top={node.type === 'procedure' ? <ProcedureRecorder data={node.data} onChange={data => updateBlockData(node.id, data)} patientId={patientId} encounterId={currentIdRef.current ?? undefined} /> : undefined}
                            onChange={data => updateBlockData(node.id, data)}
                            onRemove={() => {
                              // Each recorded procedure has a charge, so they are taken off one by one, not dropped with the block.
                              if (node.type === 'procedure' && node.data.procedures?.length) { toast.error('Remove the recorded procedures first. Each one has a charge.'); return; }
                              removeNode(node.id);
                            }} />;
                        }
                        if (node.type === 'pmh') {
                          return (
                            <PMHBlock key={node.id} data={node.data} readOnly={readOnly}
                              onChange={data => updateBlockData(node.id, data)}
                              onRemove={() => removeNode(node.id)}
                              onResolve={handleDiagnosisResolved}
                              patientId={patientId}
                            />
                          );
                        }
                        return null;
                      })}
                          </>
                        );
                      })()}
                    </div>

                </>
              ) : (
                <div style={{ maxWidth: 480, margin: '60px auto', textAlign: 'center' }}>
                  <div style={{ width: 56, height: 56, borderRadius: 14, background: 'var(--ws-chip)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
                    <FileText size={24} color="var(--text-muted)" />
                  </div>
                  <p style={{ fontSize: 16, fontWeight: 500, color: 'var(--text-heading)', marginBottom: 8 }}>No active encounter</p>
                  <p style={{ fontSize: 14, color: 'var(--text-subtle)', marginBottom: 24 }}>Start a new encounter to begin documenting this visit.</p>
                  <button className="cx-red" type="button" onClick={startEncounter} style={{ height: 40, padding: '0 18px', fontSize: 14 }}>
                    <Plus size={16} /> Start new encounter
                  </button>
                </div>
              )}
            </div>
          </section>

          {/* Decision support — hidden on mobile and tablet */}
          {!isTablet && (
            <aside aria-label="Clinical decision support" style={{ position: 'sticky', top: 12, alignSelf: 'start', maxHeight: 'calc(100vh - 140px)', overflowY: 'auto' }}>
              <CdsPanel patientId={patientId!} patient={patient} nodes={nodes} />
            </aside>
          )}
        </div>
      </main>

      <style>{`
        .cx-card { background: var(--bg-card); border: 1px solid var(--border); border-radius: 14px; }
        .cx-ib { width: 32px; height: 32px; border: 1px solid var(--btn2-line); border-radius: 10px; background: var(--btn2); color: var(--text-muted); display: inline-flex; align-items: center; justify-content: center; cursor: pointer; }
        .cx-ib:hover { background: var(--ws-chip); color: var(--text-heading); }
        .cx-btn { height: 32px; padding: 0 14px; border: 1px solid var(--btn2-line); border-radius: 10px; background: var(--btn2); color: var(--text-heading); font: inherit; font-size: 13px; font-weight:500;
          cursor: pointer; display: inline-flex; align-items: center; gap: 8px; white-space: nowrap; }
        .cx-btn:hover:not(:disabled) { background: var(--ws-chip); }
        .cx-btn:disabled { opacity: .6; cursor: wait; }
        .cx-red { height: 32px; padding: 0 16px; border: 0; border-radius: 10px; background: var(--btn-accent); color: #fff; font: inherit; font-size: 13px; font-weight:500; cursor: pointer;
          display: inline-flex; align-items: center; gap: 8px; white-space: nowrap; transition: filter .15s; }
        .cx-red:hover { filter: brightness(1.06); }
        .cx-red:disabled { opacity: .6; cursor: wait; }
        .cx-save-status { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-muted); white-space: nowrap; }
        .cx-save-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--st-ok); }
        .cx-save-error { color: var(--badge-red-text); }
        .cx-save-error .cx-save-dot { background: currentColor; }
      `}</style>
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
  label: string;
  minHeight?: number;
}

function AutoTextarea({ nodeId, value, onChange, onCursor, readOnly, label, minHeight }: TextAreaProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  function resize(el: HTMLTextAreaElement) {
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }

  useEffect(() => {
    if (ref.current) resize(ref.current);
  }, [value]);

  return (
    <SuggestTextarea
      ref={ref}
      value={value}
      readOnly={readOnly}
      aria-label={label}
      rows={1}
      onChange={e => { onChange(e.target.value); onCursor(nodeId, e.target.selectionStart ?? 0); resize(e.target); }}
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
        fontFamily: 'var(--font-body)',
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
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--bg-surface)', color: 'var(--text-body)', border: '1.5px solid var(--border-input)', borderRadius: 999, padding: '6px 14px', fontSize: 12.5, cursor: 'pointer' }}
        >
          Print / Export PDF
        </button>
      </div>

      <div id="print-area">

      {/* Header */}
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 22, padding: '20px 24px', marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 500, color: 'var(--text-heading)' }}>
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
            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-body)' }}>{encounterType}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              {new Date(encounter.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
            </div>
            {encounter.clinician?.name && (
              <div style={{ fontSize: 12, color: 'var(--text-subtle)' }}>{encounter.clinician.name}</div>
            )}
          </div>
        </div>
      </div>

      {/* Note body */}
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 22, padding: '28px 32px', marginBottom: 16 }}>
        <h3 style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 20 }}>Consultation Note</h3>
        {nodes.map(node => {
          if (node.type === 'imported') {
            return <ImportedBlock key={node.id} data={node.data} onRemove={() => {}} readOnly />;
          }
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
          if (isHistoryNode(node)) {
            return <HistoryBlock key={node.id} type={node.type} data={node.data} onChange={() => {}} onRemove={() => {}} readOnly />;
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
              <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--ses-blue-deep)', fontFamily: 'monospace' }}>{b.data.icd11Code}</span>
              <span style={{ fontSize: 13, color: 'var(--text-body)' }}>{b.data.icd11Description}</span>
              <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 500, color: 'var(--text-muted)' }}>{b.data.status}</span>
            </div>
          ))}
        </SummaryCard>
      )}

      {invBlocks.length > 0 && (
        <SummaryCard title="Investigations & Results">
          <FinalInvestigationResults items={invBlocks.flatMap(b => b.data.items)} encounterId={encounter.id} />
        </SummaryCard>
      )}

      {rxBlocks.length > 0 && (
        <SummaryCard title="Prescriptions Issued">
          {rxBlocks.flatMap(b => b.data.items).map(item => (
            <div key={item.id} style={{ padding: '5px 0', borderBottom: '1px solid var(--border-light)' }}>
              <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-heading)' }}>{item.drugName}</span>
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
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 22, padding: '16px 20px', marginBottom: 12 }}>
      <h4 style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 12px' }}>{title}</h4>
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
