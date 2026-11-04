import { useEffect, useMemo, useState } from 'react';
import api from '../api/client';
import { zmw } from './money';

// Current price list prices by catalogue reference (drug SKU, "panel_…", "single_…").
// undefined = not looked up yet; null = unavailable/unpriced; a number = ZMW.
export type PriceMap = Record<string, number | null | undefined>;
export interface PriceDetails { id: string; catalogueRef: string; unitPrice: number | null; unit: string; bottleSizeMl: number | null }

export function usePriceDetails(ref: string): PriceDetails | null | undefined {
  const [record, setRecord] = useState<{ ref: string; value: PriceDetails | null }>();
  useEffect(() => {
    if (!ref) return;
    let live = true, request = 0;
    const refresh = async () => {
      const id = ++request;
      try {
        const { data } = await api.get('/price-list/lookup', { params: { refs: ref, details: '1' } });
        const value = data[ref];
        if (live && id === request) setRecord({ ref, value: value && typeof value === 'object' ? value : null });
      } catch { }
    };
    void refresh();
    window.addEventListener('price-list-changed', refresh); window.addEventListener('focus', refresh);
    return () => { live = false; window.removeEventListener('price-list-changed', refresh); window.removeEventListener('focus', refresh); };
  }, [ref]);
  return record?.ref === ref ? record.value : undefined;
}

const PRICE_CHANGE_EVENT = 'price-list-changed';
const REFRESH_MS = 30000;

export function notifyPricesChanged() {
  window.dispatchEvent(new Event(PRICE_CHANGE_EVENT));
}

// Refresh on opening, edits, and returning to the app. Never cache an unpriced
// answer for the lifetime of the app: staff may have just set that price.
export function usePrices(refs: string[]): PriceMap {
  const key = [...new Set(refs.filter(Boolean))].sort().join(',');
  const [prices, setPrices] = useState<PriceMap>({});

  useEffect(() => {
    if (!key) return;
    const wanted = key.split(',');
    let live = true;
    let requestId = 0;
    async function refresh() {
      if (document.hidden || !navigator.onLine) return;
      const id = ++requestId;
      try {
        // The lookup endpoint accepts up to 100 references per request.
        const batches = [];
        for (let i = 0; i < wanted.length; i += 100) batches.push(wanted.slice(i, i + 100));
        const responses = await Promise.all(batches.map(batch =>
          api.get<Record<string, number | null>>('/price-list/lookup', { params: { refs: batch.join(',') } })
        ));
        const found = Object.assign({}, ...responses.map(response => response.data));
        if (live && id === requestId) setPrices(Object.fromEntries(wanted.map(ref => [ref, found[ref] ?? null])));
      } catch {
        // Keep the last answer on a connection failure; focus/online/poll retries.
      }
    }
    void refresh();
    const timer = window.setInterval(refresh, REFRESH_MS);
    window.addEventListener(PRICE_CHANGE_EVENT, refresh);
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      live = false;
      window.clearInterval(timer);
      window.removeEventListener(PRICE_CHANGE_EVENT, refresh);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [key]);

  return useMemo(() => {
    const out: PriceMap = {};
    for (const r of key.split(',')) {
      if (!r) continue;
      out[r] = prices[r];
    }
    return out;
  }, [key, prices]);
}

export const priceText = (p: number | null | undefined, unit = ''): string =>
  p === undefined ? '' : p === null ? 'No price yet' : `${zmw(p)}${unit}`;
