function withoutTitle(name: string): string {
  return name.replace(/^(?:(?:dr|doctor|prof|professor)(?:\.\s*|\s+))+/i, '').trim();
}

export function staffDisplayName(name: unknown, designation?: unknown): string {
  const raw = typeof name === 'string' ? name.trim() : '';
  const job = typeof designation === 'string' ? designation.trim().toLowerCase() : '';
  const title = /\bprofessor\b/.test(job) ? 'Prof.' : /\bmedical doctor\b|\bsurgeons?\b/.test(job) ? 'Dr.' : '';
  return title && raw ? title + ' ' + withoutTitle(raw) : raw;
}

// Format staff DTOs at the API boundary, preserving stored legal names and auth claims.
export function staffJsonReplacer(_key: string, value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const staff = value as Record<string, unknown>;
  if (typeof staff['name'] !== 'string' || typeof staff['designation'] !== 'string') return value;
  const name = staffDisplayName(staff['name'], staff['designation']);
  return name === staff['name'] ? value : { ...staff, name };
}
