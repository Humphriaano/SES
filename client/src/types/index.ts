export interface User {
  id: string;
  name: string;
  email: string;
  role: string;
}

export interface Patient {
  id: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender: 'MALE' | 'FEMALE' | 'OTHER';
  phone?: string;
  address?: string;
  nationalId?: string;
  hivStatus: 'POSITIVE' | 'NEGATIVE' | 'UNKNOWN';
  hivTestDate?: string;
  allergies?: string[];
  createdAt: string;
  email?: string;
  preferredName?: string;
  portalEnabled: boolean;
  emailOptedIn: boolean;
  portalLastSeenAt?: string;
  diagnoses?: PatientDiagnosis[];
  medications?: Medication[];
  vitals?: Vital[];
  labResults?: LabResult[];
  encounters?: Encounter[];
  billingItems?: BillingItem[];
  appointments?: Appointment[];
}

export interface Appointment {
  id: string;
  patientId: string;
  clinicianName?: string;
  clinicName: string;
  scheduledAt: string;
  status: 'SCHEDULED' | 'CONFIRMED' | 'CANCELLED' | 'COMPLETED';
  confirmedAt?: string;
  confirmedVia?: 'EMAIL' | 'PORTAL';
}

export interface ICD11Code {
  id: string;
  code: string;
  description: string;
  category?: string;
}

export interface PatientDiagnosis {
  id: string;
  patientId: string;
  icd11Id: string;
  icd11: ICD11Code;
  notes?: string;
  resolvedAt?: string;
  createdAt: string;
}

export interface EncounterDiagnosis {
  id: string;
  encounterId: string;
  icd11Id: string;
  icd11: ICD11Code;
  isPrimary: boolean;
  notes?: string;
}

export interface Encounter {
  id: string;
  patientId: string;
  clinicianId: string;
  clinician?: { id: string; name: string };
  status: 'OPEN' | 'CLOSED';
  chiefComplaint?: string;
  hpi?: string;
  examination?: string;
  treatmentPlan?: string;
  investigations?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  diagnoses?: EncounterDiagnosis[];
  vitals?: Vital[];
  labOrders?: LabOrder[];
  prescriptions?: Prescription[];
  billingItems?: BillingItem[];
}

export interface Vital {
  id: string;
  patientId: string;
  encounterId?: string;
  bloodPressureSystolic?: number;
  bloodPressureDiastolic?: number;
  heartRate?: number;
  temperature?: number;
  weight?: number;
  height?: number;
  oxygenSat?: number;
  glucose?: number;
  recordedAt: string;
}

export interface Medication {
  id: string;
  patientId: string;
  name: string;
  dosage?: string;
  frequency?: string;
  route?: string;
  startDate: string;
  endDate?: string;
  notes?: string;
}

export interface Prescription {
  id: string;
  encounterId: string;
  medicationId: string;
  medication: Medication;
  dispensed: boolean;
  dispensedAt?: string;
}

export interface LabOrder {
  id: string;
  encounterId: string;
  testName: string;
  notes?: string;
  orderedAt: string;
  status: string;
  results?: LabResult[];
}

export interface LabResult {
  id: string;
  patientId: string;
  labOrderId?: string;
  testName: string;
  result: string;
  unit?: string;
  referenceRange?: string;
  isAbnormal: boolean;
  recordedAt: string;
}

export interface BillingItem {
  id: string;
  patientId: string;
  encounterId?: string;
  encounter?: { id: string; createdAt: string };
  description: string;
  amount: number;
  status: 'PENDING' | 'PAID' | 'WAIVED';
  paidAt?: string;
  createdAt: string;
}
