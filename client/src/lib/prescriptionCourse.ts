const DAY = 86400000;

export function todayInput(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lusaka', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = (type: string) => parts.find(value => value.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function validCourseDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function medicationDateInput(value: string): string | null {
  if (validCourseDate(value)) return value;
  if (!value.includes('T') || !validCourseDate(value.slice(0, 10))) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? todayInput(date) : null;
}

export function courseInstant(day: string, end = false): Date {
  return new Date(`${day}T${end ? '23:59:59.999' : '00:00:00.000'}+02:00`);
}

export function calculateCourse(startDate: string, days: number | string, frequency: string, unitsPerDose: number | string) {
  const length = Number(days), units = Number(unitsPerDose);
  if (!validCourseDate(startDate) || !Number.isInteger(length) || length < 1 || length > 3660) return null;
  const start = new Date(startDate + 'T00:00:00Z');
  const end = new Date(start.getTime() + (length - 1) * DAY);
  if (end.getUTCFullYear() > 9999) return null;
  const freq = frequency.trim().toUpperCase().replace(/\./g, '');
  const perDay: Record<string, number> = { OD: 1, DAILY: 1, BD: 2, BID: 2, TDS: 3, TID: 3, QDS: 4, QID: 4 };
  let doses: number | null = perDay[freq] ? length * perDay[freq] : freq === 'STAT' ? 1 : freq === 'WEEKLY' ? Math.floor((length - 1) / 7) + 1 : null;
  if (freq === 'MONTHLY') {
    doses = 1;
    for (let month = 1; month <= 121; month++) {
      const first = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + month, 1));
      const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
      const scheduled = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(start.getUTCDate(), lastDay)));
      if (scheduled > end) break;
      doses++;
    }
  }
  return { endDate: end.toISOString().slice(0, 10), doses, quantity: doses !== null && Number.isFinite(units) && units > 0 ? Math.round(doses * units * 100) / 100 : null };
}

export function prescriptionUnit(form: string): { name: string; calculate: boolean } {
  const value = form.toLowerCase();
  for (const [match, name] of [['sachet', 'sachet'], ['tablet', 'tablet'], ['capsule', 'capsule'], ['suppositor', 'suppository'], ['pessar', 'pessary'], ['patch', 'patch'], ['vial', 'vial'], ['ampou', 'ampoule'], ['tube', 'tube'], ['inhaler', 'inhaler']] as const) {
    if (value.includes(match)) return { name, calculate: true };
  }
  if (!value) return { name: 'unit', calculate: true };
  return { name: /inhaler/.test(value) ? 'inhaler' : /sachet/.test(value) ? 'sachet' : 'unit', calculate: false };
}

export function formatCourseDate(value: string): string {
  const day = medicationDateInput(value);
  return day ? new Date(day + 'T12:00:00Z').toLocaleDateString('en-GB', { timeZone: 'Africa/Lusaka', day: 'numeric', month: 'short', year: 'numeric' }) : '';
}

export function durationInDays(start: string, amount: number | string, unit = 'days'): number | null {
  const n = Number(amount);
  if (!validCourseDate(start) || !Number.isInteger(n) || n < 1) return null;
  let days = unit === 'days' ? n : unit === 'weeks' ? n * 7 : 0;
  if (unit === 'months' && n <= 120) {
    const date = new Date(start + 'T00:00:00Z');
    const month = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + n, 1));
    const last = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0)).getUTCDate();
    const boundary = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), Math.min(date.getUTCDate(), last)));
    days = (boundary.getTime() - date.getTime()) / DAY;
  }
  return Number.isInteger(days) && days > 0 && days <= 3660 ? days : null;
}
