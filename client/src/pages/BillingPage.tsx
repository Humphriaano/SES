import { useEffect, useState, FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import api from '../api/client';
import { BillingItem } from '../types';
import { usePatient } from '../context/PatientContext';
import { Plus, DollarSign } from 'lucide-react';
import toast from 'react-hot-toast';

export default function BillingPage() {
  const { patientId } = useParams<{ patientId: string }>();
  const { activeEncounterId } = usePatient();
  const [items, setItems] = useState<BillingItem[]>([]);
  const [balance, setBalance] = useState({ total: 0, paid: 0, balance: 0 });
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ description: '', amount: '' });

  function load() {
    api.get(`/patients/${patientId}/billing`).then((r) => setItems(r.data));
    api.get(`/patients/${patientId}/billing/balance`).then((r) => setBalance(r.data));
  }

  useEffect(() => { if (patientId) load(); }, [patientId]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    await api.post(`/patients/${patientId}/billing`, {
      description: form.description,
      amount: parseFloat(form.amount),
      encounterId: activeEncounterId,
    });
    setForm({ description: '', amount: '' });
    setShowForm(false);
    load();
    toast.success('Billing item added');
  }

  async function updateStatus(id: string, status: 'PAID' | 'WAIVED') {
    await api.patch(`/billing/${id}/status`, { status });
    load();
    toast.success(status === 'PAID' ? 'Marked as paid' : 'Waived');
  }

  const pending = items.filter((i) => i.status === 'PENDING');
  const settled = items.filter((i) => i.status !== 'PENDING');

  const thStyle: React.CSSProperties = {
    textAlign: 'left', padding: '10px 16px',
    fontSize: 11, fontWeight: 700, color: 'var(--text-subtle)',
    textTransform: 'uppercase', letterSpacing: '0.05em',
    background: 'var(--bg-surface)',
  };
  const tdStyle: React.CSSProperties = { padding: '12px 16px' };

  return (
    <div className="page-container" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-heading)', margin: 0 }}>Billing</h2>
        <button onClick={() => setShowForm((v) => !v)} className="btn-primary">
          <Plus size={14} /> Add Item
        </button>
      </div>

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
        <SummaryCard label="Total Billed"  value={`ZMW ${balance.total.toFixed(2)}`}   color="var(--text-body)" />
        <SummaryCard label="Total Paid"    value={`ZMW ${balance.paid.toFixed(2)}`}    color="var(--badge-green-text)" />
        <SummaryCard label="Outstanding"   value={`ZMW ${balance.balance.toFixed(2)}`} color={balance.balance > 0 ? 'var(--badge-red-text)' : 'var(--badge-green-text)'} />
      </div>

      {showForm && (
        <div className="card" style={{ padding: 16 }}>
          <h3 style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>New Billing Item</h3>
          <form onSubmit={submit}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div>
                <label style={{ display: 'block', fontSize: 11.5, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 5 }}>Description *</label>
                <input required value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  className="field-input" placeholder="e.g. Consultation fee, Lab test…" />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 11.5, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 5 }}>Amount (ZMW) *</label>
                <input required type="number" step="0.01" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                  className="field-input" />
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button>
              <button type="submit" className="btn-primary">Add</button>
            </div>
          </form>
        </div>
      )}

      {/* Pending items */}
      {pending.length > 0 && (
        <div className="card" style={{ overflow: 'hidden' }}>
          <div style={{ padding: '10px 16px', background: 'var(--badge-amber-bg)', borderBottom: '1px solid var(--border)' }}>
            <h3 style={{ fontSize: 11, fontWeight: 700, color: 'var(--badge-amber-text)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: 0 }}>Outstanding</h3>
          </div>
          <div className="table-scroll"><table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 520 }}>
            <thead>
              <tr>
                <th style={thStyle}>Description</th>
                <th style={thStyle}>Date</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Amount</th>
                <th style={thStyle}></th>
              </tr>
            </thead>
            <tbody>
              {pending.map((item, i) => (
                <tr key={item.id} style={{ borderTop: i === 0 ? 'none' : '1px solid var(--border-light)' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-surface)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
                  <td style={{ ...tdStyle, color: 'var(--text-heading)', fontWeight: 500 }}>{item.description}</td>
                  <td style={{ ...tdStyle, color: 'var(--text-muted)' }}>{new Date(item.createdAt).toLocaleDateString()}</td>
                  <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, color: 'var(--text-heading)' }}>ZMW {item.amount.toFixed(2)}</td>
                  <td style={tdStyle}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
                      <button onClick={() => updateStatus(item.id, 'PAID')}
                        style={{ fontSize: 12, background: 'var(--badge-green-text)', color: '#fff', border: 'none', padding: '4px 10px', borderRadius: 6, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <DollarSign size={11} /> Pay
                      </button>
                      <button onClick={() => updateStatus(item.id, 'WAIVED')}
                        style={{ fontSize: 12, color: 'var(--text-muted)', border: '1px solid var(--border)', background: 'transparent', padding: '4px 10px', borderRadius: 6, cursor: 'pointer' }}>
                        Waive
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
      )}

      {/* Settled items */}
      {settled.length > 0 && (
        <div className="card" style={{ overflow: 'hidden' }}>
          <div style={{ padding: '10px 16px', background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)' }}>
            <h3 style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: 0 }}>Settled</h3>
          </div>
          <div className="table-scroll"><table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 520 }}>
            <thead>
              <tr>
                <th style={thStyle}>Description</th>
                <th style={thStyle}>Date</th>
                <th style={thStyle}>Status</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {settled.map((item, i) => (
                <tr key={item.id} style={{ borderTop: i === 0 ? 'none' : '1px solid var(--border-light)' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-surface)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
                  <td style={{ ...tdStyle, color: 'var(--text-body)' }}>{item.description}</td>
                  <td style={{ ...tdStyle, color: 'var(--text-muted)' }}>{new Date(item.createdAt).toLocaleDateString()}</td>
                  <td style={tdStyle}>
                    <span style={{
                      fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20,
                      background: item.status === 'PAID' ? 'var(--badge-green-bg)' : 'var(--badge-gray-bg)',
                      color: item.status === 'PAID' ? 'var(--badge-green-text)' : 'var(--badge-gray-text)',
                    }}>
                      {item.status}
                    </span>
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'right', color: 'var(--text-body)' }}>ZMW {item.amount.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
      )}

      {items.length === 0 && (
        <div className="card" style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--text-subtle)' }}>
          No billing items yet.
        </div>
      )}
    </div>
  );
}

function SummaryCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="card" style={{ padding: 16, textAlign: 'center' }}>
      <p style={{ fontSize: 11, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{label}</p>
      <p style={{ fontSize: 20, fontWeight: 700, color, margin: 0 }}>{value}</p>
    </div>
  );
}
