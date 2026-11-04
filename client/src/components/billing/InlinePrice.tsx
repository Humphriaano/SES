import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { apiError, hasRole } from '../../lib/money';
import { notifyPricesChanged, priceText, usePrices, usePriceDetails } from '../../lib/prices';
import { registerPriceEditor } from '../../lib/priceEditing';

interface Props {
  catalogueRef: string;
  itemType: 'DRUG' | 'INVESTIGATION' | 'PROCEDURE';
  name: string;
  value: number | null | undefined;
  patientId?: string;
  suffix?: string;
  editable?: boolean;
  unpricedLabel?: string;
  priceMetadata?: { unit: string; bottleSizeMl: number | null; expectedUnit: string; expectedBottleSizeMl: number | null };
}

export default function InlinePrice({ catalogueRef, itemType, name, value, patientId, suffix = '', editable = true, unpricedLabel = 'Add price', priceMetadata }: Props) {
  const { user } = useAuth();
  const canAdd = editable && (hasRole(user?.role, 'admin', 'billing', 'clinician') || (itemType === 'DRUG' && hasRole(user?.role, 'pharmacist')));
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState<number | undefined>(undefined);
  const reference = useRef(catalogueRef);
  const expected = useRef<number | null>(null);
  const pending = useRef<{ ref: string; promise: Promise<boolean> } | null>(null);
  const cancelled = useRef(false);
  reference.current = catalogueRef;

  useEffect(() => { setSaved(undefined); setEditing(false); setError(''); setSaving(false); setInput(''); }, [catalogueRef]);
  useEffect(() => { if (value !== null && value !== undefined) setSaved(undefined); }, [value]);

  const save = useCallback((): Promise<boolean> => {
    if (pending.current?.ref === catalogueRef) return pending.current.promise;
    if (cancelled.current || !editing) return Promise.resolve(true);
    if (!canAdd) return Promise.resolve(false);
    const price = Number(input);
    if (!input.trim() || !Number.isFinite(price) || price < 0 || price > 10_000_000) { setError('Enter a valid price in ZMW.'); return Promise.resolve(false); }
    const ref = catalogueRef;
    if (price === expected.current && (!priceMetadata || (priceMetadata.unit === priceMetadata.expectedUnit && priceMetadata.bottleSizeMl === priceMetadata.expectedBottleSizeMl))) { setEditing(false); return Promise.resolve(true); }
    const expectedPrice = expected.current;
    setSaving(true); setError('');
    const promise: Promise<boolean> = Promise.resolve().then(async () => {
      try {
        const { data } = await api.patch('/price-list/point-of-care', { itemType, catalogueRef: ref, unitPrice: price, expectedPrice, ...(patientId ? { patientId } : {}), ...priceMetadata });
        if (reference.current === ref) { expected.current = data.unitPrice; setSaved(data.unitPrice); setEditing(false); }
        notifyPricesChanged();
        return true;
      } catch (err) {
        if (reference.current === ref) {
          setError(apiError(err, 'Could not save the price.'));
          if ((err as any)?.response?.status === 409) setEditing(false);
        }
        notifyPricesChanged();
        return false;
      } finally {
        if (pending.current?.promise === promise) pending.current = null;
        if (reference.current === ref) setSaving(false);
      }
    });
    pending.current = { ref, promise };
    return promise;
  }, [catalogueRef, input, canAdd, editing, itemType, patientId, priceMetadata?.unit, priceMetadata?.bottleSizeMl, priceMetadata?.expectedUnit, priceMetadata?.expectedBottleSizeMl]);

  useEffect(() => {
    if (editing && canAdd) return registerPriceEditor(catalogueRef, save);
  }, [editing, canAdd, catalogueRef, save]);

  const shown = saved ?? value;
  if (shown === undefined) return <span>Checking price…</span>;
  if (!canAdd || !catalogueRef) return <span>{shown === null ? 'No price yet' : priceText(shown, suffix)}</span>;
  return <span style={{ display: 'inline-flex', alignItems: 'center', flexWrap: 'wrap', gap: 5, fontSize: 12 }}>
    {!editing ? <button type="button" onClick={() => { expected.current = shown; cancelled.current = false; setInput(shown === null ? '' : shown.toFixed(2)); setEditing(true); setError(''); }}
      aria-label={`${shown === null ? 'Add' : 'Edit'} price for ${name}`} title="Click to edit the shared price"
      style={{ padding: '2px 0', border: 'none', background: 'transparent', color: 'inherit', font: 'inherit', cursor: 'pointer', textDecoration: 'underline dotted', textUnderlineOffset: 3 }}>{shown === null ? unpricedLabel : priceText(shown, suffix)}</button> : <>
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>ZMW
        <input type="number" inputMode="decimal" min={0} max={10000000} step="0.01" value={input} autoFocus disabled={saving}
          aria-label={`Price in ZMW for ${name}`} onChange={e => setInput(e.target.value)}
          title="Click away or press Enter to save; Escape cancels" onBlur={() => { void save(); }}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void save(); } else if (e.key === 'Escape' && !saving) { cancelled.current = true; setError(''); setEditing(false); } }}
          style={{ width: 92, boxSizing: 'border-box', height: 30, padding: '4px 8px', borderRadius: 10, border: '1px solid var(--border-input)', background: 'var(--bg-card)', color: 'var(--text-heading)', font: 'inherit' }} />
      </label>
      {saving && <span role="status">Saving…</span>}
    </>}
    {error && <span role="alert" style={{ color: 'var(--badge-red-text)', width: '100%', whiteSpace: 'normal' }}>{error}</span>}
  </span>;
}

export function CataloguePrice({ catalogueRef, ...props }: Omit<Props, 'value'>) {
  const prices = usePrices([catalogueRef]);
  const details = usePriceDetails(props.itemType === 'DRUG' ? catalogueRef : '');
  const suffix = props.itemType === 'DRUG' && details?.unit ? ' ' + details.unit : props.suffix;
  return <InlinePrice {...props} suffix={suffix} catalogueRef={catalogueRef} value={prices[catalogueRef]} />;
}
