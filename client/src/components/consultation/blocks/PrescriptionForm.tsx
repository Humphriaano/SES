import { calculateSupply, isLiquidMedicine, basisFromUnit, pricingUnit, dispensingUnits, PriceBasis } from '../../../lib/prescriptionSupply';
import { ReactNode, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { PrescriptionItem } from '../../../types/consultation';
import { searchCatalog, getDrugVariants, DrugEntry } from '../../../data/drugCatalog';
import api from '../../../api/client';
import { usePrices, usePriceDetails, notifyPricesChanged, priceText } from '../../../lib/prices';
import { flushPriceEdits } from '../../../lib/priceEditing';
import { apiError, zmw } from '../../../lib/money';
import { calculateCourse, durationInDays, medicationDateInput, formatCourseDate, prescriptionUnit, todayInput, validCourseDate } from '../../../lib/prescriptionCourse';
import InlinePrice from '../../billing/InlinePrice';

export type PrescriptionDraft = Omit<PrescriptionItem, 'id'>;
const FREQUENCIES = ['OD', 'BD', 'TDS', 'QDS', 'PRN', 'Stat', 'Weekly', 'Monthly'];
const ROUTES = ['Oral', 'IV', 'IM', 'IV/IM', 'SC', 'Topical', 'Inhaled', 'SL', 'PR', 'Nasal', 'Ophthalmic', 'Rectal', 'Vaginal', 'Transdermal'];

export default function PrescriptionForm({ onAdd, onSave, onCancel, patientId, encounterId, children, submitLabel = 'Add Drug', canSubmit = true, requirePrice = false, initial, lockDrug = false }: {
  onAdd?: (item: PrescriptionDraft) => void; onSave?: (item: PrescriptionDraft) => Promise<void>;
  onCancel: () => void; patientId?: string; encounterId?: string; children?: ReactNode;
  submitLabel?: string; canSubmit?: boolean; requirePrice?: boolean; initial?: Partial<PrescriptionDraft>; lockDrug?: boolean;
}) {
  const [drug, setDrug] = useState(initial?.drugName ?? '');
  const [sku, setSku] = useState(initial?.drugCode ?? '');
  const [suggestions, setSuggestions] = useState<DrugEntry[]>([]);
  const [showDrugs, setShowDrugs] = useState(false);
  const initialEntry = getDrugVariants(initial?.drugName ?? '').find(entry => entry.sku === initial?.drugCode);
  const initialForm = initialEntry ? `${initialEntry.form} ${initialEntry.dose}` : (/\/\s*\d+(?:\.\d+)?\s*ml\b/i.test(initial?.dose ?? '') && (!initial?.route || initial.route === 'Oral') ? 'liquid' : initial?.dose ?? '');
  const [liquid, setLiquid] = useState(initial?.doseUnit === 'mL' || isLiquidMedicine(initialForm));
  const [unit, setUnit] = useState(prescriptionUnit(initial?.doseUnit ?? initial?.quantityUnit ?? initialForm));
  const [basis, setBasis] = useState<PriceBasis>(initial?.priceBasis ?? (isLiquidMedicine(initialForm) || initial?.doseUnit === 'mL' ? 'BOTTLE' : 'ITEM'));
  const [bottleSize, setBottleSize] = useState(initial?.bottleSizeMl != null ? String(initial.bottleSizeMl) : '');
  const pricingTouched = useRef(false);
  const details = usePriceDetails(sku);
  useEffect(() => {
    if (!details || pricingTouched.current) return;
    if (!initial?.priceBasis) {
      const storedBasis = basisFromUnit(details.unit);
      // A historical bottle label must not turn a dry sachet into liquid doses.
      setBasis(storedBasis === 'BOTTLE' && !liquid ? 'ITEM' : storedBasis ?? (liquid ? 'BOTTLE' : 'ITEM'));
      const storedUnit = details.unit.replace(/^per /, '');
      if (!liquid && dispensingUnits.some(value => value === storedUnit) && storedUnit !== 'unit') setUnit(prescriptionUnit(storedUnit));
    }
    if (liquid && initial?.bottleSizeMl == null && details.bottleSizeMl != null) setBottleSize(String(details.bottleSizeMl));
  }, [details, liquid]);
  const [saving, setSaving] = useState(false);
  const [manualPrice, setManualPrice] = useState(initial?.unitPrice != null ? String(initial.unitPrice) : '');
  const [form, setForm] = useState({ dose: initial?.dose ?? '', frequency: initial?.frequency ?? 'OD', duration: initial?.durationCount != null ? String(initial.durationCount) : initial?.durationDays != null ? String(initial.durationDays) : '', durationUnit: initial?.durationUnit ?? 'days', route: initial?.route ?? 'Oral', specialInstructions: initial?.specialInstructions ?? '', unitsPerDose: initial?.doseUnit ? String(initial.unitsPerDose ?? '') : isLiquidMedicine(initialForm) ? '' : String(initial?.unitsPerDose ?? 1), quantity: initial?.quantity != null ? String(initial.quantity) : '', startDate: initial?.startDate ? medicationDateInput(initial.startDate) ?? todayInput() : todayInput() });
  const prices = usePrices([...suggestions.map(item => item.sku), sku]);
  const effectiveStart = form.startDate || todayInput();
  const days = durationInDays(effectiveStart, form.duration, form.durationUnit);
  const course = calculateCourse(effectiveStart, days ?? '', form.frequency, form.unitsPerDose);
  const doseUnit = liquid ? 'mL' : unit.name;
  const bottle = bottleSize.trim() ? Number(bottleSize) : null;
  const supply = calculateSupply(course?.quantity ?? null, doseUnit, basis, bottle, form.quantity.trim() ? Number(form.quantity) : null);
  const calculated = supply?.calculated ? supply.quantity : null;
  const quantity = supply?.quantity ?? null;
  const sharedUnit = pricingUnit(basis, doseUnit);
  const metadataBottle = liquid ? bottle ?? details?.bottleSizeMl ?? null : null;
  const priceMetadata = details ? { unit: sharedUnit, bottleSizeMl: metadataBottle, expectedUnit: details.unit, expectedBottleSizeMl: details.bottleSizeMl ?? null } : undefined;
  const enteredPrice = manualPrice.trim() ? Number(manualPrice) : null;
  const price = sku ? prices[sku] : enteredPrice;
  const validPrice = enteredPrice !== null && Number.isFinite(enteredPrice) && enteredPrice >= 0 && enteredPrice <= 10000000;
  const canAdd = Boolean(drug.trim() && form.dose.trim() && validCourseDate(effectiveStart)
    && (!form.duration.trim() || course) && Number.isFinite(Number(form.unitsPerDose)) && Number(form.unitsPerDose) > 0 && Number(form.unitsPerDose) <= 10000
    && quantity !== null && Number.isFinite(quantity) && quantity > 0 && quantity <= 10000
    && (!bottleSize.trim() || (Number.isFinite(bottle) && bottle! >= 0.01 && bottle! <= 1000000))
    && (!manualPrice.trim() || validPrice) && (!requirePrice || sku || validPrice) && canSubmit && !saving);
  const set = (key: keyof typeof form, value: string) => setForm(current => ({ ...current, [key]: value }));
  const style: React.CSSProperties = { width: '100%', padding: '7px 10px', border: '1.5px solid var(--border)', borderRadius: 14, fontSize: 13, boxSizing: 'border-box', background: 'var(--bg-input)', color: 'var(--text-heading)', minHeight: 36 };
  const labelStyle: React.CSSProperties = { fontSize: 11, fontWeight: 500, color: 'var(--text-body)', marginBottom: 3, display: 'block' };

  function pick(entry: DrugEntry) {
    const productForm = `${entry.form} ${entry.dose}`;
    const isLiquid = isLiquidMedicine(productForm);
    setDrug(entry.name); setSku(entry.sku); setShowDrugs(false); setUnit(prescriptionUnit(productForm)); setManualPrice('');
    setLiquid(isLiquid); setBasis(isLiquid ? 'BOTTLE' : 'ITEM'); setBottleSize(''); pricingTouched.current = false;
    setForm(current => ({ ...current, dose: entry.dose || current.dose, route: ROUTES.includes(entry.route) ? entry.route : current.route, unitsPerDose: isLiquid ? '' : '1', quantity: '' }));
  }

  async function save() {
    if (!canAdd) return;
    const draft: PrescriptionDraft = { drugName: drug.trim(), drugCode: sku || undefined, dose: form.dose, frequency: form.frequency, duration: form.duration ? `${Number(form.duration)} ${form.durationUnit}` : '', durationCount: form.duration ? Number(form.duration) : undefined, durationUnit: form.duration ? form.durationUnit : undefined, durationDays: days ?? undefined, route: form.route, specialInstructions: form.specialInstructions, unitsPerDose: Number(form.unitsPerDose), quantity: quantity!, quantityUnit: supply!.quantityUnit, quantityManual: !supply!.calculated, doseUnit, priceBasis: basis, bottleSizeMl: liquid && bottle != null ? bottle : undefined, courseQuantity: supply!.courseQuantity ?? undefined, billingQuantity: supply!.billingQuantity, startDate: effectiveStart, endDate: course?.endDate, ...(!sku && validPrice ? { unitPrice: enteredPrice! } : {}) };
    setSaving(true);
    let clinicalStarted = false;
    try {
      if (!(await flushPriceEdits([sku]))) { toast.error('The price has not saved yet. Check the price field and try again.'); return; }
      if (sku) {
        const { data: found } = await api.get('/price-list/lookup', { params: { refs: sku, details: '1' } });
        const current = found[sku];
        if (!current || typeof current !== 'object') throw new Error('Restart the SES API to load bottle and course pricing.');
        if (current.unit !== sharedUnit || (current.bottleSizeMl ?? null) !== metadataBottle) {
          await api.patch('/price-list/point-of-care', { itemType: 'DRUG', catalogueRef: sku, unitPrice: current.unitPrice, expectedPrice: current.unitPrice, unit: sharedUnit, expectedUnit: current.unit, bottleSizeMl: metadataBottle, expectedBottleSizeMl: current.bottleSizeMl ?? null, ...(patientId ? { patientId } : {}) });
          notifyPricesChanged();
        }
      }
      clinicalStarted = true;
      if (onSave) { await onSave(draft); return; }
      if (patientId && encounterId) {
        const med = await api.post(`/patients/${patientId}/medications`, { name: draft.drugName, dosage: draft.dose, frequency: draft.frequency, route: draft.route, duration: draft.duration, catalogueCode: draft.drugCode, startDate: draft.startDate, endDate: draft.endDate, unitsPerDose: draft.unitsPerDose, durationDays: draft.durationDays, durationCount: draft.durationCount, durationUnit: draft.durationUnit, quantity: draft.quantity, quantityUnit: draft.quantityUnit, quantityManual: draft.quantityManual, doseUnit: draft.doseUnit, priceBasis: draft.priceBasis, bottleSizeMl: draft.bottleSizeMl, courseQuantity: draft.courseQuantity, billingQuantity: draft.billingQuantity, unitPrice: draft.unitPrice, notes: draft.specialInstructions });
        const rx = await api.post(`/encounters/${encounterId}/prescriptions`, { medicationId: med.data.id });
        onAdd?.({ ...draft, medicationId: med.data.id, prescriptionId: rx.data.id });
      } else onAdd?.(draft);
    } catch (error) {
      const message = (error as any)?.response ? apiError(error) : error instanceof Error ? error.message : apiError(error);
      if (onSave) toast.error(message);
      else if (!clinicalStarted) toast.error(message);
      else { toast.error('Saved locally — sync to server failed'); onAdd?.(draft); }
    } finally { setSaving(false); }
  }

  return <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 12, marginTop: 8 }}>
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9 }}>
      <div style={{ gridColumn: '1/-1', position: 'relative' }}>
        <label style={labelStyle}>Drug</label>
        <input aria-label="Drug" readOnly={lockDrug} style={style} value={drug} placeholder="Search drug name…" onChange={event => { setDrug(event.target.value); setSku(''); setUnit(prescriptionUnit('')); setLiquid(false); setBasis('ITEM'); setBottleSize(''); pricingTouched.current = false; setSuggestions(event.target.value.length >= 2 ? searchCatalog(event.target.value, 10) : []); setShowDrugs(true); }} onFocus={() => !lockDrug && setShowDrugs(true)} onBlur={() => setTimeout(() => setShowDrugs(false), 150)} />
        {showDrugs && suggestions.length > 0 && <div style={{ position: 'absolute', zIndex: 100, background: 'var(--bg-card)', border: '1px solid var(--border-input)', borderRadius: 12, boxShadow: '0 8px 24px rgba(0,0,0,.1)', width: '100%', maxHeight: 220, overflowY: 'auto', marginTop: 4 }}>
          {suggestions.map((entry, index) => <button key={entry.sku + index} type="button" onMouseDown={() => pick(entry)} style={{ width: '100%', textAlign: 'left', padding: '8px 12px', background: 'none', border: 'none', borderBottom: '1px solid var(--border-light)', cursor: 'pointer', color: 'var(--text-heading)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><span>{entry.name}</span><span>{priceText(prices[entry.sku])}</span></div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{[entry.brand, entry.dose, entry.form, entry.route].filter(Boolean).join(' · ')}</div>
          </button>)}
        </div>}
      </div>
      {drug.trim() && <div style={{ gridColumn: '1/-1', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, fontSize: 12 }}>
        <span>Price:</span><select aria-label="Price basis" value={basis === 'ITEM' && !liquid ? `ITEM:${unit.name}` : basis} onChange={event => { pricingTouched.current = true; const [value, selectedUnit] = event.target.value.split(':'); setBasis(value as PriceBasis); if (selectedUnit) setUnit(prescriptionUnit(selectedUnit)); }} style={{ ...style, width: 140 }}>{liquid ? <option value="ITEM">Per mL</option> : dispensingUnits.map(value => <option key={value} value={`ITEM:${value}`}>Per {value}</option>)}{liquid && <option value="BOTTLE">Per bottle</option>}<option value="COURSE">Per course</option></select>{sku ? <InlinePrice catalogueRef={sku} itemType="DRUG" name={drug} value={prices[sku]} patientId={patientId} suffix={" " + sharedUnit} unpricedLabel={"ZMW — " + sharedUnit} priceMetadata={priceMetadata} editable={Boolean(details)} /> : <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>ZMW <input aria-label="Unit price (ZMW)" type="number" min={0} step="0.01" max={10000000} value={manualPrice} onChange={e => setManualPrice(e.target.value)} style={{ ...style, width: 100 }} /></label>}
        {supply !== null && price !== null && price !== undefined && Number.isFinite(price) && <span style={{ marginLeft: 'auto' }}>Course cost <b>{zmw(supply!.billingQuantity * price)}</b></span>}
      </div>}
      <div><label style={labelStyle}>{liquid ? 'Strength' : 'Dosage'}</label><input aria-label="Dosage" style={style} value={form.dose} onChange={e => set('dose', e.target.value)} /></div>
      <div><label style={labelStyle}>{liquid ? 'mL per dose' : `Items per dose (${unit.name})`}</label><input aria-label="Items per dose" type="number" min="0.01" max={10000} step="0.01" style={style} value={form.unitsPerDose} onChange={e => set('unitsPerDose', e.target.value)} /></div>
      <div><label style={labelStyle}>Frequency</label><select aria-label="Frequency" style={style} value={form.frequency} onChange={e => set('frequency', e.target.value)}><option value="">Not specified</option>{FREQUENCIES.map(value => <option key={value}>{value}</option>)}</select></div>
      <div><label style={labelStyle}>Route</label><select aria-label="Route" style={style} value={form.route} onChange={e => set('route', e.target.value)}><option value="">Not specified</option>{ROUTES.map(value => <option key={value}>{value}</option>)}</select></div>
      <div><label style={labelStyle}>Duration</label><input aria-label="Duration" type="number" min={1} max={3660} step={1} style={style} value={form.duration} onChange={e => set('duration', e.target.value)} /></div>
      <div><label style={labelStyle}>Duration unit</label><select aria-label="Duration unit" style={style} value={form.durationUnit} onChange={e => set('durationUnit', e.target.value)}><option value="days">Days</option><option value="weeks">Weeks</option><option value="months">Months</option></select></div>
      {liquid && <div style={{ gridColumn: '1/-1' }}><label style={labelStyle}>Bottle size (mL) · optional</label><input aria-label="Bottle size (mL)" type="number" min="0.01" max={1000000} step="0.01" style={style} value={bottleSize} onChange={event => { pricingTouched.current = true; setBottleSize(event.target.value); }} /></div>}
      {liquid && course?.quantity != null && <div style={{ gridColumn: '1/-1', fontSize: 12, color: 'var(--text-body2)' }}>Total volume for course: <b>{course.quantity} mL</b></div>}
      <div><label style={labelStyle}>Quantity ({supply?.quantityUnit ?? (basis === 'BOTTLE' ? 'bottle' : doseUnit)}){calculated !== null ? ' · calculated' : ''}</label><input aria-label="Quantity to supply" title={calculated !== null ? 'Supply quantity calculated from the dose, frequency and duration, including bottle size where applicable' : 'Enter the supply quantity when it cannot be calculated'} type="number" min="0.01" max={10000} step={supply?.quantityUnit === 'bottle' ? 1 : 0.01} readOnly={course?.quantity != null && !(basis === 'BOTTLE' && !(bottle != null && bottle > 0))} style={style} value={calculated !== null ? calculated : form.quantity} onChange={e => set('quantity', e.target.value)} /></div>
      <div><label style={labelStyle}>Start date</label><input aria-label="Start date" type="date" style={style} value={form.startDate} onChange={e => set('startDate', e.target.value)} /></div>
      <div><label style={labelStyle}>End date (last day)</label><output aria-label="Course end date" style={{ ...style, display: 'block' }}>{course ? formatCourseDate(course.endDate) : '—'}</output></div>
      <div style={{ gridColumn: '1/-1' }}><label style={labelStyle}>Special instructions (optional)</label><textarea aria-label="Special instructions" style={{ ...style, resize: 'vertical' }} rows={2} value={form.specialInstructions} onChange={e => set('specialInstructions', e.target.value)} /></div>
      {children && <div style={{ gridColumn: '1/-1' }}>{children}</div>}
    </div>
    <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
      <button type="button" className="bl-btn" disabled={saving} onClick={onCancel} style={{ borderRadius: 999, padding: '6px 14px', background: 'var(--bg-surface-2)', color: 'var(--text-body)', border: '1px solid var(--border)' }}>Cancel</button>
      <button type="button" disabled={!canAdd} onClick={save} style={{ background: canAdd ? 'var(--ses-red)' : 'var(--border-input)', color: canAdd ? '#fff' : 'var(--text-subtle)', border: 'none', borderRadius: 999, padding: '7px 15px', fontSize: 12, fontWeight: 500, cursor: canAdd ? 'pointer' : 'not-allowed' }}>{saving ? 'Saving…' : submitLabel}</button>
    </div>
  </div>;
}
