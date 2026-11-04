import { pricingUnit } from '../../../lib/prescriptionSupply';
import PrescriptionForm from './PrescriptionForm';
import { formatCourseDate } from '../../../lib/prescriptionCourse';
import { useEffect, useState } from 'react';
import api from '../../../api/client';
import { Plus, X } from 'lucide-react';
import { PrescriptionBlockData, PrescriptionItem } from '../../../types/consultation';

import { CataloguePrice } from '../../billing/InlinePrice';


interface Props {
  data: PrescriptionBlockData;
  onChange: (data: PrescriptionBlockData) => void;
  onRemove: () => void;
  readOnly?: boolean;
  patientId?: string;
  encounterId?: string;
}

export default function PrescriptionBlock({ data, onChange, onRemove, readOnly, patientId, encounterId }: Props) {
  const [addingItem, setAddingItem] = useState(data.items.length === 0 && !readOnly);
  const [live, setLive] = useState<Record<string, PrescriptionItem>>({});
  useEffect(() => {
    if (!encounterId) return;
    let active = true;
    const refresh = () => api.get(`/encounters/${encounterId}/prescriptions`).then(({ data: rows }) => {
      if (!active) return;
      const next: Record<string, PrescriptionItem> = {};
      for (const rx of rows) if (rx.substituteMedication) {
        const m = rx.substituteMedication;
        next[rx.id] = { id: rx.id, drugName: m.name, drugCode: m.catalogueCode, dose: m.dosage ?? '', frequency: m.frequency ?? '', duration: m.duration ?? '', route: m.route ?? '', quantity: m.quantity == null ? undefined : Number(m.quantity), quantityUnit: m.quantityUnit, startDate: m.startDate, endDate: m.endDate, specialInstructions: m.notes, doseUnit: m.doseUnit, priceBasis: m.priceBasis, bottleSizeMl: m.bottleSizeMl == null ? undefined : Number(m.bottleSizeMl), courseQuantity: m.courseQuantity == null ? undefined : Number(m.courseQuantity), billingQuantity: m.billingQuantity == null ? undefined : Number(m.billingQuantity) };
      }
      setLive(next);
    }).catch(() => {});
    refresh(); const timer = setInterval(refresh, 30000); window.addEventListener('focus', refresh);
    return () => { active = false; clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [encounterId]);
  const displayed = data.items.map(item => item.prescriptionId && live[item.prescriptionId] ? { ...item, ...live[item.prescriptionId], id: item.id } : item);


  return (
    <div className="note-block" style={{
      border: '1px solid var(--border)',
      background: 'var(--bg-surface)',
      borderRadius: 18,
      padding: '10px 14px',
      margin: '16px 0',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: data.items.length > 0 ? 8 : 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 10, color: 'var(--text-muted)', background: 'var(--ws-chip)', padding: '0 6px', minWidth: 28, height: 20, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 5, fontWeight: 500, letterSpacing: '0.3px', boxSizing: 'border-box' }}>Rx</span>
          <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-heading)' }}>Prescription</span>
        </div>
        {!readOnly && (
          <button onClick={onRemove} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
            <X size={12} />
          </button>
        )}
      </div>

      {displayed.map((item, i) => (
        <div key={item.id} style={{
          background: 'var(--bg-surface)', border: '1px solid var(--border)',
          borderRadius: 8, padding: '8px 12px', marginBottom: 6,
          display: 'flex', alignItems: 'flex-start', gap: 10,
        }}>
          <div style={{ flex: 1 }}>
            {data.items[i].prescriptionId && live[data.items[i].prescriptionId!] && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Substituted: <s>{data.items[i].drugName} {data.items[i].dose}</s></div>}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-heading)' }}>{item.drugName}</span>
              <span style={{ fontSize: 12, color: 'var(--text-body)' }}>{item.dose}</span>
              <span style={{ fontSize: 11, background: 'var(--badge-blue-bg)', color: 'var(--badge-blue-text)', padding: '1px 7px', borderRadius: 4 }}>{item.frequency}</span>
              {item.duration && <span style={{ fontSize: 11, color: 'var(--text-body2)' }}>{item.duration}</span>}
              <span style={{ fontSize: 11, color: 'var(--text-subtle)' }}>·</span>
              <span style={{ fontSize: 11, color: 'var(--text-body2)' }}>{item.route}</span>
              {!readOnly && item.drugCode && <CataloguePrice catalogueRef={item.drugCode} itemType="DRUG" name={item.drugName} patientId={patientId} suffix={" " + pricingUnit(item.priceBasis ?? 'ITEM', item.doseUnit || item.quantityUnit || 'unit')} unpricedLabel="Add price" />}
            </div>
            {(item.quantity != null || item.startDate) && <div style={{ fontSize: 11, color: 'var(--text-body2)', marginTop: 4 }}>{item.quantity != null ? `Qty ${item.quantity} ${item.quantityUnit || 'units'}` : ''}{item.startDate ? ` · ${formatCourseDate(item.startDate)}${item.endDate ? ' – ' + formatCourseDate(item.endDate) : ''}` : ''}</div>}
            {item.specialInstructions && (
              <p style={{ fontSize: 12, color: 'var(--text-body2)', margin: '3px 0 0', fontStyle: 'italic' }}>{item.specialInstructions}</p>
            )}
          </div>
          {!readOnly && (
            <button
              onClick={() => onChange({ items: data.items.filter((_, j) => j !== i) })}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', flexShrink: 0 }}
            >
              <X size={12} />
            </button>
          )}
        </div>
      ))}

      {addingItem && !readOnly ? (
        <PrescriptionForm
          patientId={patientId}
          encounterId={encounterId}
          onAdd={item => { onChange({ items: [...data.items, { ...item, id: `${Date.now()}` }] }); setAddingItem(false); }}
          onCancel={() => { setAddingItem(false); if (data.items.length === 0) onRemove(); }}
        />
      ) : (
        !readOnly && (
          <button
            onClick={() => setAddingItem(true)}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              background: 'none', border: '1.5px dashed var(--border)',
              borderRadius: 999, padding: '6px 12px', fontSize: 12,
              color: 'var(--badge-blue-text)', cursor: 'pointer', marginTop: data.items.length > 0 ? 4 : 0,
            }}
          >
            <Plus size={12} /> Add Drug
          </button>
        )
      )}
    </div>
  );
}
