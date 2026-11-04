export interface StockPage<T> { page: number; pageSize: number; total: number; rows: T[] }
export interface StockTotals { physical: string; available: string; expired: string; quarantined: string; inactive: string }
export interface OnHandRow { catalogueRef: string; name: string; detail: string | null; baseUnit: string | null; productCount: number; batchCount: number; tracked: boolean; physical: string | null; available: string | null; expired: string | null; quarantined: string | null; inactive: string | null; state: string }
export interface StockProduct extends StockTotals { productId: string; catalogueRef: string; name: string; detail: string | null; brand: string; manufacturer: string | null; baseUnit: string; packSize: string; packLabel: string; active: boolean; batchCount: number }
export interface ExpiryBatch { batchId: string; productId: string; catalogueRef: string; name: string; detail: string | null; brand: string; manufacturer: string | null; baseUnit: string; lotNumber: string; expiryDate: string; physical: string; available: string; state: string; daysToExpiry: number }
export interface CardMovement { id: string; postingOrder: string; batchId: string; type: string; quantity: string; baseUnit: string; reference: string; reason: string | null; createdAt: string; lotNumber: string; expiryDate: string; receiptKind: string | null; counterparty: string | null; actorId: string; actorName: string | null; actorDesignation: string | null; runningBalance: string }
export interface StockCardData extends StockPage<CardMovement> { product: Pick<StockProduct, 'productId' | 'catalogueRef' | 'name' | 'detail' | 'brand' | 'manufacturer' | 'baseUnit' | 'packSize' | 'packLabel' | 'active'>; batches: { id: string; lotNumber: string; expiryDate: string; status: string }[]; selectedBatchId: string | null; balanceUnit: string; openingBalance: string; closingBalance: string; currentBalance: string }

// Preserve exact decimal strings, even when a ledger total exceeds JS's safe
// integer range. Display formatting never converts stock balances to Number.
export function stockQuantity(value: string | null | undefined): string {
  if (value == null) return '—';
  if (!/^-?\d+(?:\.\d+)?$/.test(value)) return '—';
  const [whole, fraction = ''] = value.split('.');
  const clean = fraction.replace(/0+$/, '');
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (clean ? '.' + clean : '');
}
export function movementColumns(row: Pick<CardMovement, 'type' | 'quantity'>) {
  return { received: row.type === 'RECEIVED' ? row.quantity : null, issued: row.type === 'ISSUED' ? row.quantity.replace(/^-/, '') : null, adjustment: ['LOSS', 'ADJUSTMENT', 'REVERSAL'].includes(row.type) ? row.quantity : null };
}
export const STOCK_STATE_LABELS: Record<string, string> = { AVAILABLE: 'Available', USABLE: 'Usable', UNAVAILABLE: 'Unavailable', OUT_OF_STOCK: 'No stock', UNTRACKED: 'Untracked', EXPIRED: 'Expired', QUARANTINED: 'Quarantined', INACTIVE: 'Inactive' };
