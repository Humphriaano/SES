import { useEffect, useState } from 'react';
import api from '../api/client';
import { stockQuantity } from './stockViews';

export interface PrescribingProduct { id: string; brand: string; manufacturer: string | null; baseUnit: string; available: string }
export interface PrescribingAvailability { catalogueRef: string; tracked: boolean; products: PrescribingProduct[] }
export function availabilityText(item: PrescribingAvailability | undefined, baseUnit?: string): string {
  if (!item) return 'Stock not checked';
  if (!item.tracked) return 'Untracked';
  const products = item.products.filter(product => !baseUnit || product.baseUnit === baseUnit);
  if (!products.length) return 'No usable stock';
  const totals = new Map<string,bigint>();
  for (const product of products) {
    const [whole,fraction=''] = product.available.split('.');
    totals.set(product.baseUnit, (totals.get(product.baseUnit) ?? 0n) + BigInt(whole)*100n + BigInt(fraction.padEnd(2,'0')));
  }
  return [...totals].map(([unit,cents]) => `${stockQuantity(`${cents/100n}.${String(cents%100n).padStart(2,'0')}`)} ${unit}`).join(' · ');
}
export type StockLevel = 'ok' | 'low' | 'out' | 'unregistered';
export interface ItemStockStatus { level: StockLevel; text: string }
const hundredths = (value: string) => { const [whole,fraction=''] = value.split('.'); return BigInt(whole)*100n + BigInt(fraction.padEnd(2,'0').slice(0,2)); };
// Flag for a medicine that has been prescribed. The pharmacy still confirms at
// dispensing; this only tells the prescriber early. null = nothing to say yet.
export function itemStockStatus(item: PrescribingAvailability | undefined, unit?: string | null, required?: number | null, markedUnavailable = false): ItemStockStatus | null {
  if (markedUnavailable) return { level: 'out', text: 'Not available at the pharmacy' };
  if (!item) return null;
  if (!item.tracked) return { level: 'unregistered', text: 'Not in the pharmacy stock register: pharmacy will confirm' };
  const matching = item.products.filter(product => !unit || product.baseUnit === unit);
  const have = matching.reduce((sum, product) => sum + hundredths(product.available), 0n);
  const label = unit ?? 'units';
  if (have <= 0n) return { level: 'out', text: `Out of stock${unit ? ` (${unit})` : ''}` };
  const shown = availabilityText(item, unit ?? undefined);
  if (required != null && Number.isFinite(required) && required > 0 && have < BigInt(Math.round(required * 100))) return { level: 'low', text: `Low stock: ${shown} available, ${required} ${label} needed` };
  return { level: 'ok', text: `In stock: ${shown}` };
}
export function usePrescribingAvailability(refs: string[], enabled: boolean) {
  const signature = [...new Set(refs.filter(Boolean))].sort().join(',');
  const [items,setItems] = useState<Record<string,PrescribingAvailability>>({}), [loading,setLoading] = useState(false), [error,setError] = useState('');
  useEffect(() => {
    let cancelled = false, request = 0;
    setItems({}); setError('');
    if (!enabled || !signature) { setLoading(false); return; }
    const load = () => {
      const current = ++request;
      setLoading(true);
      api.get('/prescribing-stock/availability', { params: { refs: signature } }).then(response => {
        if (!cancelled && current === request) { setItems(Object.fromEntries(response.data.items.map((item: PrescribingAvailability) => [item.catalogueRef,item]))); setError(''); }
      }).catch(() => { if (!cancelled && current === request) { setItems({}); setError('Stock unavailable'); } }).finally(() => { if (!cancelled && current === request) setLoading(false); });
    };
    const timer = setTimeout(load,150), interval = setInterval(load,30000);
    window.addEventListener('focus',load);
    return () => { cancelled = true; clearTimeout(timer); clearInterval(interval); window.removeEventListener('focus',load); };
  }, [signature,enabled]);
  return { items, loading, error };
}
