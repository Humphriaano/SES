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
