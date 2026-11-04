function withoutTitle(name: string): string {
  return name.replace(/^(?:(?:dr|doctor|prof|professor)(?:\.\s*|\s+))+/i, '').trim();
}

export function staffDisplayName(name: unknown, designation?: unknown): string {
  const raw = typeof name === 'string' ? name.trim() : '';
  const job = typeof designation === 'string' ? designation.trim().toLowerCase() : '';
  const title = /\bprofessor\b/.test(job) ? 'Prof.' : /\bmedical doctor\b|\bsurgeons?\b/.test(job) ? 'Dr.' : '';
  return title && raw ? title + ' ' + withoutTitle(raw) : raw;
}

export function staffInitials(name: unknown, limit = 2): string {
  return withoutTitle(typeof name === 'string' ? name.trim() : '').split(/\s+/).slice(0, limit).map(part => part.charAt(0)).join('').toUpperCase();
}

export function staffPosition(designation: unknown, role: unknown): string {
  if (typeof designation === 'string' && designation.trim()) return designation.trim();
  const labels: Record<string, string> = { admin: 'Administrator', clinician: 'Clinician', doctor: 'Doctor', nurse: 'Nurse', pharmacist: 'Pharmacist', lab_tech: 'Laboratory Technician', lab_technician: 'Laboratory Technician', receptionist: 'Receptionist', billing: 'Billing', paramedic: 'Paramedic' };
  return (typeof role === 'string' ? role : '').split(',').map(value => labels[value.trim()]).find(Boolean) ?? '';
}
