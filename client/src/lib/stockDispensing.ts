import api from '../api/client';

export interface StockAllocation { batchId: string; quantity: string }
export interface StockSelection { productId?: string; allocations?: StockAllocation[]; overrideReason?: string }
export interface DispensePlan {
  catalogueRef: string; baseUnit: string; quantity: string; tracked: boolean; available: string | null; sufficient: boolean;
  suggested: StockAllocation[]; defaultSuggested: StockAllocation[];
  batches: { batchId: string; productId: string; brand: string; manufacturer: string | null; lotNumber: string; expiryDate: string; available: string }[];
}
export const DISPENSING_PENDING_EVENT = 'ses-dispensing-pending';
export interface PendingDispensing { key: string; body: Record<string, any> }
const scope = (userId: string) => 'ses.dispensing.pending:' + userId;
export function readPendingDispensing(userId: string): PendingDispensing | null {
  const raw = localStorage.getItem(scope(userId));
  if (!raw) return null;
  const saved = JSON.parse(raw);
  if (!saved || typeof saved.key !== 'string' || !saved.body?.patientId) throw new Error('The pending dispensing request could not be read. Keep this browser data and contact support.');
  return saved;
}
function changed() { window.dispatchEvent(new Event(DISPENSING_PENDING_EVENT)); }
async function sendPending(userId: string, pending: PendingDispensing) {
  try {
    const response = await api.post('/dispensing', pending.body, { headers: { 'Idempotency-Key': pending.key } });
    localStorage.removeItem(scope(userId)); changed();
    return response;
  } catch (error: any) {
    // Only a definite rejection permits editing/resubmission. Network failures
    // and 5xx responses retain the exact original intent across reloads.
    if ([400,404,409,422].includes(error?.response?.status) && !/operation key/i.test(error?.response?.data?.error ?? '')) { localStorage.removeItem(scope(userId)); changed(); }
    throw error;
  }
}
export function retryDispensing(userId: string) {
  const pending = readPendingDispensing(userId);
  if (!pending) throw new Error('There is no pending dispensing request.');
  return sendPending(userId, pending);
}
export function sendDispensing(body: Record<string, unknown>, userId: string) {
  if (readPendingDispensing(userId)) throw new Error('Resolve the pending dispensing request before dispensing again.');
  const pending = { key: crypto.randomUUID(), body: JSON.parse(JSON.stringify(body)) };
  localStorage.setItem(scope(userId), JSON.stringify(pending));
  changed();
  return sendPending(userId, pending);
}
export function sameStockAllocations(a: StockAllocation[], b: StockAllocation[]) {
  const normalize = (rows: StockAllocation[]) => rows.map(row => row.batchId + ':' + Number(row.quantity)).sort().join('|');
  return normalize(a) === normalize(b);
}
export function validStockAllocations(plan: DispensePlan, rows: StockAllocation[], productId?: string) {
  const cents = (value: string) => /^\d+(?:\.\d{1,2})?$/.test(value) ? BigInt(value.split('.')[0]) * 100n + BigInt((value.split('.')[1] ?? '').padEnd(2,'0')) : null;
  let sum = 0n;
  if (!rows.length || new Set(rows.map(row => row.batchId)).size !== rows.length) return false;
  for (const row of rows) {
    const batch = plan.batches.find(batch => batch.batchId === row.batchId), amount = cents(row.quantity);
    if (!batch || (productId && batch.productId !== productId) || amount === null || amount <= 0n || amount > cents(batch.available)!) return false;
    sum += amount;
  }
  return sum === cents(plan.quantity);
}
