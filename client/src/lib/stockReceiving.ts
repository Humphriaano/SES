import api from '../api/client';

export const STOCK_UNITS = ['tablet', 'capsule', 'sachet', 'bottle', 'mL', 'vial', 'ampoule', 'tube', 'inhaler', 'patch', 'suppository', 'pessary', 'unit'];
export function packConversion(packCount: string, packSize: string): string | null {
  const scaled = (value: string) => {
    if (!/^\d{1,11}(?:\.\d{1,2})?$/.test(value)) return null;
    const [whole, fraction = ''] = value.split('.');
    return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  };
  const count = scaled(packCount), size = scaled(packSize);
  if (count === null || size === null || count <= 0n || size <= 0n) return null;
  const product = count * size;
  if (product % 100n || product > 100000000000000n) return null;
  const cents = product / 100n;
  return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
}
export const stockNumber = (value: string | number) => Number(value).toLocaleString('en-GB', { maximumFractionDigits: 2 });

export interface PendingStockRequest { key: string; url: string; body: unknown }
export function readStockRequest(scope: string): PendingStockRequest | null {
  try {
    const request = JSON.parse(localStorage.getItem(scope) ?? 'null');
    return request && typeof request.key === 'string' && typeof request.url === 'string' && request.url.startsWith('/pharmacy-stock/') && request.body && typeof request.body === 'object' ? request : null;
  } catch { return null; }
}
export function newStockRequest(url: string, body: unknown): PendingStockRequest {
  return { key: crypto.randomUUID(), url, body };
}
export function storeStockRequest(scope: string, request: PendingStockRequest) { localStorage.setItem(scope, JSON.stringify(request)); }
export function clearStockRequest(scope: string) { localStorage.removeItem(scope); }
export function sendStockRequest(request: PendingStockRequest) {
  return api.post(request.url, request.body, { headers: { 'Idempotency-Key': request.key } });
}
export function stockRequestRejected(error: any): boolean {
  const status = error?.response?.status;
  return [400, 404, 409, 422].includes(status) && !/operation key/i.test(error?.response?.data?.error ?? '');
}
