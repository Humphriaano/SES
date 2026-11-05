import type { CanvasNode, HistoryBlockData, HistoryType } from '../types/consultation';
import type { Patient } from '../types';

export const HISTORY_SECTIONS: Record<HistoryType, { label: string; tag: string }> = {
  'drug-history': { label: 'Drug History', tag: 'DH' },
  'gynae-history': { label: 'Obs & Gynae History', tag: 'OGH' },
  'obstetric-history': { label: 'Obstetric History', tag: 'OH' },
  'immunization-history': { label: 'Immunization History', tag: 'IH' },
  procedure: { label: 'Procedures', tag: 'Proc' },
};

export function canInsertHistory(type: HistoryType, patient: Pick<Patient, 'gender' | 'dateOfBirth'> | null, today = new Date()): boolean {
  if (!patient) return false;
  if (type === 'drug-history' || type === 'procedure') return true;
  if (type === 'gynae-history' || type === 'obstetric-history') return patient.gender === 'FEMALE';
  // Compare calendar dates, not elapsed milliseconds, so the fifth birthday is exact.
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T|$)/.exec(patient.dateOfBirth ?? '');
  if (!match) return false;
  const [, year, month, day] = match.map(Number);
  const birth = new Date(year, month - 1, day);
  if (birth.getFullYear() !== year || birth.getMonth() !== month - 1 || birth.getDate() !== day) return false;
  const currentDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (birth > currentDay) return false;
  let age = today.getFullYear() - year;
  if (today.getMonth() < month - 1 || (today.getMonth() === month - 1 && today.getDate() < day)) age--;
  return age < 5;
}

export function isHistoryNode(node: CanvasNode): node is Extract<CanvasNode, { type: HistoryType }> {
  return Object.prototype.hasOwnProperty.call(HISTORY_SECTIONS, node.type);
}

// One readable line per recorded procedure, e.g. "Peripheral IV cannulation · left forearm".
export function procedureLines(data: Pick<HistoryBlockData, 'procedures'>): string[] {
  return (data.procedures ?? []).map(p => [p.name, p.site, p.note].filter(Boolean).join(' · '));
}

export function historySnapshots(nodes: CanvasNode[]) {
  return nodes.filter(isHistoryNode)
    .filter(node => node.data.content.trim() || node.data.procedures?.length || node.data.lmp || node.data.isObstetric || node.data.gravidity !== undefined || node.data.parity !== undefined)
    .map(node => ({ type: node.type, ...node.data }));
}
