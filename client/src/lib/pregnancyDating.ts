const DAY_MS = 86_400_000;

export function calendarToday(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function calendarTime(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day] = match.map(Number);
  const time = Date.UTC(year, month - 1, day);
  const parsed = new Date(time);
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day ? time : null;
}

// LMP-based dating: ACOG Committee Opinion 700, EDD = first day of LMP + 280 days.
// Calendar-day arithmetic avoids time zone and daylight-saving rounding errors.
export function pregnancyDating(lmp: string, asOf: string) {
  const start = calendarTime(lmp);
  const assessment = calendarTime(asOf);
  if (start === null || assessment === null || start > assessment) return null;
  const elapsed = Math.round((assessment - start) / DAY_MS);
  return { edd: new Date(start + 280 * DAY_MS).toISOString().slice(0, 10), weeks: Math.floor(elapsed / 7), days: elapsed % 7, asOf };
}

export function displayCalendarDate(value: string): string {
  const time = calendarTime(value);
  return time === null ? value : new Date(time).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}
