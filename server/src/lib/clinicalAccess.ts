export const CLINICAL_ROLES = ['admin', 'clinician', 'doctor', 'nurse', 'pharmacist', 'lab_tech', 'lab_technician', 'paramedic'] as const;

export function canReadClinical(role: string | null | undefined): boolean {
  return (role ?? '').split(',').some(item => (CLINICAL_ROLES as readonly string[]).includes(item.trim()));
}

// Billing and reception need the patient's identity and contact details, not
// consultation notes, HIV status, diagnoses, medications or test results.
export const PATIENT_IDENTITY_SELECT = {
  id: true, firstName: true, lastName: true, preferredName: true,
  dateOfBirth: true, gender: true, nationalId: true, phone: true,
  email: true, address: true, createdAt: true,
} as const;
