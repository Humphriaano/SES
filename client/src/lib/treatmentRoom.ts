// Small pure helpers for the treatment room worklist and the procedure notes.
export interface TreatmentItem {
  id: string; encounterId: string; patientId: string;
  patient: { name: string; dateOfBirth: string; gender: string } | null;
  name: string; catalogueRef: string | null; site: string | null; note: string | null; instructions: string | null; priority: 'ROUTINE' | 'URGENT';
  status: 'ORDERED' | 'ACTIVE' | 'RETURNED';
  orderedAt: string | null; orderedBy: string | null; performedAt: string | null; performedBy: string | null; returnReason: string | null;
  charged: boolean; price: number | null; expectedPrice: number | null;
}

// "Just now", "12 min", "1 h 5 min", "3 h", "2 days": how long a patient has been waiting.
export function waitingText(from: string | Date | null | undefined, now: number = Date.now()): string {
  if (!from) return '';
  const minutes = Math.max(0, Math.floor((now - new Date(from).getTime()) / 60000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  if (hours < 24) return rest ? `${hours} h ${rest} min` : `${hours} h`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}

// "just now", "12 min ago", "2 days ago": how long ago something was done.
export function agoText(from: string | Date | null | undefined, now: number = Date.now()): string {
  const text = waitingText(from, now);
  return !text ? '' : text === 'Just now' ? 'just now' : `${text} ago`;
}

// "Female · 34 yrs" from a date of birth; the age is counted in calendar years, not elapsed milliseconds.
export function patientLine(patient: { dateOfBirth: string; gender: string } | null, today: Date = new Date()): string {
  if (!patient) return '';
  const sex = ({ FEMALE: 'Female', MALE: 'Male' } as Record<string, string>)[patient.gender] ?? '';
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(patient.dateOfBirth ?? '');
  let age = '';
  if (match) {
    const [, y, m, d] = match.map(Number);
    let years = today.getFullYear() - y;
    if (today.getMonth() < m - 1 || (today.getMonth() === m - 1 && today.getDate() < d)) years--;
    if (years >= 0) age = years < 1 ? 'Under 1 yr' : `${years} ${years === 1 ? 'yr' : 'yrs'}`;
  }
  return [sex, age].filter(Boolean).join(' · ');
}
