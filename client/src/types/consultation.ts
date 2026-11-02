export type DiagnosisStatus = 'SUSPECTED' | 'CONFIRMED' | 'CHRONIC' | 'RESOLVED';

export interface DiagnosisBlockData {
  icd11Id?: string;
  icd11Code: string;
  icd11Description: string;
  icd11Category?: string;
  status: DiagnosisStatus;
  isChronic: boolean;
  isPrimary: boolean;
  dateFirstConfirmed?: string;
  dateResolved?: string;
}

export interface InvestigationItem {
  id: string;
  name: string;
  catalogCode?: string;
  catalogueType?: 'panel' | 'single';
  status: 'PENDING' | 'RESULTED';
  orderItemId?: string;   // the real lab order item this entry tracks, once it has been ordered
  resultText?: string;
  resultDate?: string;
}

export interface InvestigationBlockData {
  items: InvestigationItem[];
}

export interface PrescriptionItem {
  id: string;
  drugName: string;
  drugCode?: string;
  dose: string;
  frequency: string;
  duration: string;
  route: string;
  specialInstructions?: string;
  prescriptionId?: string;  // DB Prescription.id — set after API save
  medicationId?: string;    // DB Medication.id — set after API save
}

export interface PrescriptionBlockData {
  items: PrescriptionItem[];
}

export interface PMHEntry {
  id: string;
  icd11Code: string;
  icd11Description: string;
  dateFirstConfirmed: string;
  diagnosedYear?: number;   // set when the year first diagnosed is known
  status: DiagnosisStatus;
}

export interface PMHBlockData {
  entries: PMHEntry[];
}

export type BlockType = 'diagnosis' | 'investigation' | 'prescription' | 'pmh';

export interface ImportedDiagnosis {
  code: string;
  description: string;
  status: string;
}

export interface ImportedBlockData {
  encounterId: string;
  encounterDate: string;
  // Text nodes before the first structural block (complaints, social history, examination in order)
  preBlockTexts: string[];
  // Text nodes after the last structural block (plan, management)
  postBlockTexts: string[];
  diagnoses: ImportedDiagnosis[];
  prescriptionSummary: string;
  investigationSummary: string;
}

export type CanvasNode =
  | { type: 'text'; id: string; content: string }
  | { type: 'diagnosis'; id: string; data: DiagnosisBlockData }
  | { type: 'investigation'; id: string; data: InvestigationBlockData }
  | { type: 'prescription'; id: string; data: PrescriptionBlockData }
  | { type: 'pmh'; id: string; data: PMHBlockData }
  | { type: 'imported'; id: string; data: ImportedBlockData };
