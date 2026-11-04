import { hasRole } from './money';

const ACCESS = {
  home: ['admin', 'clinician', 'doctor', 'nurse', 'pharmacist', 'lab_tech', 'lab_technician', 'receptionist', 'paramedic'],
  pharmacy: ['admin', 'pharmacist', 'clinician', 'doctor', 'nurse'],
  investigations: ['admin', 'clinician', 'doctor', 'lab_tech', 'lab_technician'],
  billing: ['admin', 'billing', 'receptionist', 'clinician', 'pharmacist'],
  billingDesk: ['admin', 'billing', 'receptionist'],
  billingReports: ['admin', 'billing'],
  vitals: ['admin', 'clinician', 'doctor', 'nurse', 'paramedic'],
  consultation: ['admin', 'clinician', 'doctor'],
  documents: ['admin', 'clinician', 'doctor', 'nurse', 'pharmacist', 'lab_tech', 'lab_technician', 'paramedic'],
  reports: ['admin', 'clinician', 'doctor', 'nurse', 'pharmacist', 'lab_tech', 'lab_technician', 'receptionist', 'paramedic'],
} as const;
export type ModuleId = keyof typeof ACCESS;

export function canAccessModule(role: string | null | undefined, module: ModuleId): boolean {
  if (!role?.trim()) return false;
  const allowed = ACCESS[module];
  return hasRole(role, ...allowed);
}

export function billingHref(role: string | null | undefined, patientId?: string): string | null {
  if (patientId && canAccessModule(role, 'billing')) return `/patient/${patientId}/billing`;
  return canAccessModule(role, 'billingDesk') ? '/billing' : null;
}

export function moduleLanding(role: string | null | undefined): string {
  return canAccessModule(role, 'home') ? '/' : canAccessModule(role, 'billingDesk') ? '/billing' : '/login';
}

export function patientLanding(role: string | null | undefined, patientId: string): string {
  const module = (['vitals', 'pharmacy', 'investigations'] as const).find(item => canAccessModule(role, item));
  return module ? `/patient/${patientId}/${module}` : billingHref(role, patientId) ?? moduleLanding(role);
}

// Patient selection changes the person being attended, while the current
// workspace decides what staff are doing. A queue room never selects a module.
export function patientSelectionPath(role: string | null | undefined, patientId: string, pathname: string): string {
  const match = pathname.match(/^\/patient\/[^/]+\/(vitals|consultation|pharmacy|investigations|billing|documents)(?:\/|$)/);
  const module = match?.[1] as 'vitals' | 'consultation' | 'pharmacy' | 'investigations' | 'billing' | 'documents' | undefined;
  if (module && canAccessModule(role, module)) return `/patient/${patientId}/${module}`;
  if (/^\/billing(?:\/|$)/.test(pathname) && canAccessModule(role, 'billing')) return `/patient/${patientId}/billing`;
  if (/^\/pharmacy(?:\/|$)/.test(pathname) && canAccessModule(role, 'pharmacy')) return `/patient/${patientId}/pharmacy`;
  if (/^\/reports(?:\/|$)/.test(pathname) && canAccessModule(role, 'reports')) return '/reports';
  return patientLanding(role, patientId);
}
