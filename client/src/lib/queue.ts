import { useEffect, useRef, useState } from 'react';

// Stored value is 'Normal'; staff see it as "Standard".
export type Priority = 'Normal' | 'Urgent' | 'Emergency';

export const PRIORITIES: { value: Priority; label: string; hint: string; color: string; bg: string }[] = [
  { value: 'Normal',    label: 'Standard',  hint: 'Served in order of arrival',               color: 'var(--st-ok)',      bg: 'var(--st-ok-bg)' },
  { value: 'Urgent',    label: 'Urgent',    hint: 'Ahead of standard patients',               color: 'var(--st-warn)',    bg: 'var(--st-warn-bg)' },
  { value: 'Emergency', label: 'Emergency', hint: 'Goes to the front of the room’s queue',    color: 'var(--st-bad)',     bg: 'var(--st-bad-bg)' },
];

export const priorityStyle = (p: string) => PRIORITIES.find((x) => x.value === p) ?? PRIORITIES[0];

export const priorityLabel = (p: string) => PRIORITIES.find((x) => x.value === p)?.label ?? p;

const PRIORITY_RANK: Record<string, number> = { Emergency: 0, Urgent: 1, Normal: 2 };
const STATUS_RANK: Record<string, number> = { Waiting: 0, 'In Progress': 1, Done: 2 };

interface Sortable { status: string; priority: string; queueNumber: number }

// Same order the server uses: waiting by priority then arrival, then being seen, then done.
export function sortQueue<T extends Sortable>(entries: T[]): T[] {
  return [...entries].sort((a, b) =>
    (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9)
    || (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9)
    || a.queueNumber - b.queueNumber);
}

export const queueNo = (n: number) => `Q${String(n).padStart(3, '0')}`;

export function ordinal(n: number) {
  const v = n % 100;
  const s = ['th', 'st', 'nd', 'rd'];
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

// ── Cross-component refresh ──────────────────────────────────────────────────
// Assigning a patient anywhere should update the Home queue, the queue panel and
// the patient banner straight away, without waiting for their next poll.

const EVENT = 'ses:queue-changed';

export function notifyQueueChanged() {
  window.dispatchEvent(new Event(EVENT));
}

export function useQueueChanged(cb: () => void) {
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => {
    const h = () => ref.current();
    window.addEventListener(EVENT, h);
    return () => window.removeEventListener(EVENT, h);
  }, []);
}

// ── Time and waiting ─────────────────────────────────────────────────────────

interface Timed { status: string; checkedInAt: string; startedAt?: string | null }

// Arrival time of day, e.g. "09:42".
export const arrivedAt = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

// Minutes waited: still counting while waiting, frozen once the patient was first seen.
export function waitMinutes(e: Timed, now: number): number | null {
  const start = new Date(e.checkedInAt).getTime();
  if (e.startedAt) return Math.max(0, Math.round((new Date(e.startedAt).getTime() - start) / 60000));
  if (e.status === 'Waiting') return Math.max(0, Math.floor((now - start) / 60000));
  return null; // seen before waiting time was recorded
}

export function formatWait(min: number | null): string {
  if (min === null) return '—';
  if (min < 1) return '<1m';
  return min < 60 ? `${min}m` : `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m`;
}

// Re-render on a timer so waiting times tick without refetching.
export function useNow(ms = 30000) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

// ── Queue drawer open/close ──────────────────────────────────────────────────
// The top-bar Queue button and the drawer live in different parts of the layout; this is how they talk.
const TOGGLE = 'ses:queue-toggle';

export function toggleQueueDrawer() {
  window.dispatchEvent(new Event(TOGGLE));
}

export function useQueueDrawerToggle(cb: () => void) {
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => {
    const h = () => ref.current();
    window.addEventListener(TOGGLE, h);
    return () => window.removeEventListener(TOGGLE, h);
  }, []);
}
