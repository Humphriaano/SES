import { useState, useEffect } from 'react';
import api from '../api/client';
import {
  Users, Clock, CheckCircle, XCircle, RefreshCw,
  AlertCircle, Search, UserCheck, UserX, Shield,
  DoorOpen, Plus, Trash2, Pencil, Check, X,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface AdminUser {
  id: string;
  name: string;
  firstName: string | null;
  surname: string | null;
  email: string;
  username: string | null;
  role: string | null;
  status: string;
  designation: string | null;
  createdAt: string;
  rejectionReason: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const ROLES: { value: string; label: string }[] = [
  { value: 'admin', label: 'Admin' },
  { value: 'clinician', label: 'Clinician' },
  { value: 'nurse', label: 'Nurse' },
  { value: 'pharmacist', label: 'Pharmacist' },
  { value: 'lab_tech', label: 'Lab Technician' },
  { value: 'receptionist', label: 'Receptionist' },
  { value: 'billing', label: 'Billing Officer' },
];

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { bg: string; color: string; label: string }> = {
    active:      { bg: 'var(--badge-green-bg)',  color: 'var(--badge-green-text)',  label: 'Active' },
    pending:     { bg: 'var(--badge-amber-bg)',  color: 'var(--badge-amber-text)',  label: 'Pending' },
    rejected:    { bg: 'var(--badge-red-bg)',    color: 'var(--badge-red-text)',    label: 'Rejected' },
    deactivated: { bg: 'var(--badge-gray-bg)',   color: 'var(--badge-gray-text)',   label: 'Deactivated' },
  };
  const c = config[status] ?? { bg: 'var(--badge-gray-bg)', color: 'var(--badge-gray-text)', label: status };
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 20,
      background: c.bg, color: c.color, whiteSpace: 'nowrap',
    }}>
      {c.label}
    </span>
  );
}

function RoleBadge({ role }: { role: string | null }) {
  if (!role) return <span style={{ fontSize: 12, color: 'var(--text-subtle)', fontStyle: 'italic' }}>—</span>;
  const parts = role.split(',').map(r => r.trim()).filter(Boolean);
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      {parts.map(r => {
        const label = ROLES.find(x => x.value === r)?.label ?? r;
        return (
          <span key={r} style={{
            fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 4,
            background: 'var(--badge-blue-bg)', color: 'var(--badge-blue-text)', whiteSpace: 'nowrap',
          }}>
            {label}
          </span>
        );
      })}
    </div>
  );
}

// ── Approve inline flow ───────────────────────────────────────────────────────

function ApproveFlow({ userId, onDone, onCancel }: { userId: string; onDone: () => void; onCancel: () => void }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  function toggle(value: string) {
    setSelected(prev => prev.includes(value) ? prev.filter(r => r !== value) : [...prev, value]);
  }

  async function confirm() {
    setLoading(true);
    try {
      await api.patch(`/auth/users/${userId}`, { action: 'approve', roles: selected });
      onDone();
    } catch (err: any) {
      setError(err?.response?.data?.error ?? 'Failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border-light)' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
        Assign Roles
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
        {ROLES.map(r => {
          const on = selected.includes(r.value);
          return (
            <button
              key={r.value}
              type="button"
              onClick={() => toggle(r.value)}
              style={{
                padding: '5px 14px', borderRadius: 20, fontSize: 12.5, fontWeight: 600,
                cursor: 'pointer', border: `1px solid ${on ? '#c8102e' : 'var(--border-input)'}`,
                background: on ? '#c8102e' : 'var(--bg-surface)',
                color: on ? '#fff' : 'var(--text-body)',
                transition: 'background 0.12s, color 0.12s, border-color 0.12s',
              }}
            >
              {r.label}
            </button>
          );
        })}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button
          onClick={confirm}
          disabled={loading || selected.length === 0}
          style={{
            height: 32, padding: '0 18px',
            background: selected.length === 0 ? 'var(--border-input)' : '#16a34a',
            color: selected.length === 0 ? 'var(--text-subtle)' : '#fff',
            border: 'none', borderRadius: 6, fontSize: 12.5, fontWeight: 600,
            cursor: selected.length === 0 ? 'not-allowed' : 'pointer',
            transition: 'background 0.15s',
          }}
        >
          {loading ? '…' : 'Confirm'}
        </button>
        <button
          onClick={onCancel}
          style={{ fontSize: 12, color: 'var(--text-subtle)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
        >
          Cancel
        </button>
        {error && <span style={{ fontSize: 11.5, color: 'var(--badge-red-text)' }}>{error}</span>}
      </div>
    </div>
  );
}

// ── Reject inline flow ────────────────────────────────────────────────────────

function RejectFlow({ userId, onDone }: { userId: string; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function confirm() {
    if (!reason.trim()) { setError('Reason is required'); return; }
    setLoading(true);
    try {
      await api.patch(`/auth/users/${userId}`, { action: 'reject', rejectionReason: reason.trim() });
      onDone();
    } catch (err: any) {
      setError(err?.response?.data?.error ?? 'Failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
      <textarea
        value={reason}
        onChange={e => { setReason(e.target.value); setError(''); }}
        placeholder="Reason for rejection…"
        rows={2}
        style={{
          padding: '6px 10px', border: `1px solid ${error ? 'var(--badge-red-text)' : 'var(--border-input)'}`,
          borderRadius: 6, fontSize: 12.5, resize: 'vertical', outline: 'none', fontFamily: 'inherit',
          minHeight: 52, background: 'var(--bg-input)', color: 'var(--text-heading)',
        }}
      />
      {error && <p style={{ fontSize: 11.5, color: 'var(--badge-red-text)', margin: 0 }}>{error}</p>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={confirm}
          disabled={loading}
          style={{
            height: 30, padding: '0 14px', background: '#dc2626', color: '#fff',
            border: 'none', borderRadius: 6, fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
          }}
        >
          {loading ? '…' : 'Confirm Rejection'}
        </button>
      </div>
    </div>
  );
}

// ── Pending row ───────────────────────────────────────────────────────────────

function PendingRow({ user, onRefresh }: { user: AdminUser; onRefresh: () => void }) {
  const [mode, setMode] = useState<'idle' | 'approve' | 'reject'>('idle');

  return (
    <div style={{
      padding: '16px 20px', border: '1px solid var(--border)', borderRadius: 10,
      background: 'var(--bg-card)', marginBottom: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-heading)' }}>
              {user.firstName} {user.surname}
            </span>
            {user.username && (
              <span style={{ fontSize: 11.5, color: 'var(--text-subtle)' }}>@{user.username}</span>
            )}
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 2 }}>{user.email}</div>
          {user.designation && (
            <div style={{ fontSize: 12, color: 'var(--text-body2)' }}>{user.designation}</div>
          )}
          <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 4 }}>
            Applied {fmtDate(user.createdAt)}
          </div>
        </div>

        {mode === 'idle' && (
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <button
              onClick={() => setMode('approve')}
              style={{
                display: 'flex', alignItems: 'center', gap: 5, height: 32, padding: '0 14px',
                background: '#16a34a', color: '#fff', border: 'none', borderRadius: 6,
                fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
              }}
            >
              <UserCheck size={13} /> Approve
            </button>
            <button
              onClick={() => setMode('reject')}
              style={{
                display: 'flex', alignItems: 'center', gap: 5, height: 32, padding: '0 14px',
                background: 'var(--bg-card)', color: 'var(--badge-red-text)', border: '1px solid var(--badge-red-bg)',
                borderRadius: 6, fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
              }}
            >
              <UserX size={13} /> Reject
            </button>
          </div>
        )}

      </div>

      {mode === 'approve' && (
        <ApproveFlow userId={user.id} onDone={onRefresh} onCancel={() => setMode('idle')} />
      )}

      {mode === 'reject' && (
        <div>
          <RejectFlow userId={user.id} onDone={onRefresh} />
          <button onClick={() => setMode('idle')} style={{ fontSize: 11.5, color: 'var(--text-subtle)', background: 'none', border: 'none', cursor: 'pointer', marginTop: 4, padding: 0 }}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

// ── All users row ─────────────────────────────────────────────────────────────

function UserRow({ user, onRefresh }: { user: AdminUser; onRefresh: () => void }) {
  const [loading, setLoading] = useState(false);

  async function toggle() {
    const action = user.status === 'deactivated' ? 'reactivate' : 'deactivate';
    setLoading(true);
    try {
      await api.patch(`/auth/users/${user.id}`, { action });
      onRefresh();
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }

  return (
    <tr style={{ borderBottom: '1px solid var(--border-light)' }}
      onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-surface)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
    >
      <td style={{ padding: '12px 16px' }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-heading)' }}>
          {user.firstName ? `${user.firstName} ${user.surname}` : user.name}
        </div>
        {user.username && (
          <div style={{ fontSize: 11.5, color: 'var(--text-subtle)' }}>@{user.username}</div>
        )}
      </td>
      <td style={{ padding: '12px 16px', fontSize: 13, color: 'var(--text-body2)' }}>{user.email}</td>
      <td style={{ padding: '12px 16px', fontSize: 12.5, color: 'var(--text-body2)' }}>{user.designation ?? '—'}</td>
      <td style={{ padding: '12px 16px' }}><RoleBadge role={user.role} /></td>
      <td style={{ padding: '12px 16px' }}><StatusBadge status={user.status} /></td>
      <td style={{ padding: '12px 16px', fontSize: 12, color: 'var(--text-subtle)' }}>{fmtDate(user.createdAt)}</td>
      <td style={{ padding: '12px 16px' }}>
        {(user.status === 'active' || user.status === 'deactivated') && (
          <button
            onClick={toggle}
            disabled={loading}
            style={{
              height: 28, padding: '0 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
              border: '1px solid', borderRadius: 6,
              background: user.status === 'deactivated' ? 'var(--badge-green-bg)' : 'var(--bg-card)',
              color: user.status === 'deactivated' ? 'var(--badge-green-text)' : 'var(--badge-red-text)',
              borderColor: user.status === 'deactivated' ? 'var(--badge-green-text)' : 'var(--badge-red-bg)',
            }}
          >
            {loading ? '…' : user.status === 'deactivated' ? 'Reactivate' : 'Deactivate'}
          </button>
        )}
        {user.status === 'rejected' && user.rejectionReason && (
          <span style={{ fontSize: 11.5, color: 'var(--text-subtle)', fontStyle: 'italic' }} title={user.rejectionReason}>
            Rejected
          </span>
        )}
      </td>
    </tr>
  );
}

// ── Rooms tab ─────────────────────────────────────────────────────────────────

interface FacilityRoom { id: string; name: string; tag: string; active: boolean; waitingCount: number; }

function RoomsTab() {
  const [rooms, setRooms] = useState<FacilityRoom[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newTag, setNewTag] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [showTagSuggestions, setShowTagSuggestions] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editTag, setEditTag] = useState('');
  const [saving, setSaving] = useState(false);

  const existingTags = [...new Set(rooms.map(r => r.tag))].sort();
  const tagSuggestions = existingTags.filter(t => t.toLowerCase().includes(tagInput.toLowerCase()) && t !== tagInput);

  async function load() {
    setLoading(true);
    try {
      const { data } = await api.get('/queue/admin/rooms');
      setRooms(data);
    } catch { /* ignore */ } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  async function createRoom() {
    if (!newName.trim() || !newTag.trim()) return;
    setSaving(true);
    try {
      await api.post('/queue/admin/rooms', { name: newName.trim(), tag: newTag.trim() });
      setNewName(''); setNewTag(''); setTagInput(''); setAdding(false);
      load();
    } catch (err: any) { setError(err?.response?.data?.error ?? 'Failed'); }
    finally { setSaving(false); }
  }

  async function saveEdit(id: string) {
    if (!editName.trim() || !editTag.trim()) return;
    setSaving(true);
    try {
      await api.patch(`/queue/admin/rooms/${id}`, { name: editName.trim(), tag: editTag.trim() });
      setEditId(null);
      load();
    } catch (err: any) { setError(err?.response?.data?.error ?? 'Failed'); }
    finally { setSaving(false); }
  }

  async function toggleActive(room: FacilityRoom) {
    try {
      await api.patch(`/queue/admin/rooms/${room.id}`, { active: !room.active });
      load();
    } catch (err: any) { setError(err?.response?.data?.error ?? 'Failed'); }
  }

  async function removeRoom(id: string) {
    try {
      await api.delete(`/queue/admin/rooms/${id}`);
      load();
    } catch (err: any) { setError(err?.response?.data?.error ?? 'Cannot remove — patients are active in this room'); }
  }

  const inp: React.CSSProperties = {
    height: 34, padding: '0 10px', border: '1px solid var(--border-input)',
    borderRadius: 6, fontSize: 13, outline: 'none',
    background: 'var(--bg-input)', color: 'var(--text-heading)',
  };

  return (
    <div>
      {error && (
        <div style={{ marginBottom: 14, padding: '8px 12px', background: 'var(--badge-red-bg)', border: '1px solid var(--border)', borderRadius: 7, fontSize: 13, color: 'var(--badge-red-text)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <AlertCircle size={14} /> {error}
          <button onClick={() => setError('')} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}>✕</button>
        </div>
      )}

      {/* Add room inline form */}
      <div style={{ marginBottom: 20 }}>
        {adding ? (
          <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>New Room</div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 200px' }}>
                <label style={{ display: 'block', fontSize: 11.5, fontWeight: 600, color: 'var(--text-body)', marginBottom: 4 }}>Room Name</label>
                <input autoFocus value={newName} onChange={e => setNewName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Escape') { setAdding(false); setNewName(''); setNewTag(''); setTagInput(''); } }}
                  placeholder="e.g. Triage Room 1" style={{ ...inp, width: '100%', boxSizing: 'border-box' }} />
              </div>
              <div style={{ flex: '1 1 160px', position: 'relative' }}>
                <label style={{ display: 'block', fontSize: 11.5, fontWeight: 600, color: 'var(--text-body)', marginBottom: 4 }}>Tag / Group</label>
                <input
                  value={tagInput}
                  onChange={e => { setTagInput(e.target.value); setNewTag(e.target.value); setShowTagSuggestions(true); }}
                  onFocus={() => setShowTagSuggestions(true)}
                  onBlur={() => setTimeout(() => setShowTagSuggestions(false), 150)}
                  placeholder="e.g. Triage" style={{ ...inp, width: '100%', boxSizing: 'border-box' }} />
                {showTagSuggestions && tagSuggestions.length > 0 && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.1)', zIndex: 10, marginTop: 2 }}>
                    {tagSuggestions.map(t => (
                      <button key={t} onMouseDown={() => { setTagInput(t); setNewTag(t); setShowTagSuggestions(false); }} style={{ width: '100%', textAlign: 'left', padding: '7px 10px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--text-body)' }}
                        onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-surface)')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
                        {t}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', paddingBottom: 0, marginTop: 20 }}>
                <button onClick={createRoom} disabled={saving || !newName.trim() || !newTag.trim()} style={{ height: 34, padding: '0 16px', background: newName.trim() && newTag.trim() ? '#c8102e' : 'var(--border-input)', color: newName.trim() && newTag.trim() ? '#fff' : 'var(--text-subtle)', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: newName.trim() && newTag.trim() ? 'pointer' : 'not-allowed' }}>
                  {saving ? 'Saving…' : 'Save Room'}
                </button>
                <button onClick={() => { setAdding(false); setNewName(''); setNewTag(''); setTagInput(''); }} style={{ height: 34, padding: '0 12px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13, cursor: 'pointer', color: 'var(--text-muted)' }}>Cancel</button>
              </div>
            </div>
          </div>
        ) : (
          <button onClick={() => setAdding(true)} style={{ display: 'flex', alignItems: 'center', gap: 6, height: 34, padding: '0 16px', background: '#c8102e', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            <Plus size={14} /> Add Room
          </button>
        )}
      </div>

      {loading ? (
        <div style={{ fontSize: 13.5, color: 'var(--text-subtle)', padding: 24 }}>Loading…</div>
      ) : rooms.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px 24px', background: 'var(--bg-surface)', borderRadius: 12, border: '1px dashed var(--border)' }}>
          <DoorOpen size={28} color="var(--text-subtle)" style={{ marginBottom: 10 }} />
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-heading)', marginBottom: 6 }}>No rooms yet</div>
          <div style={{ fontSize: 13, color: 'var(--text-subtle)' }}>Add rooms like "Triage Room 1" and group them with tags.</div>
        </div>
      ) : (
        <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)' }}>
                {['Room Name', 'Tag', 'Queue', 'Active', 'Actions'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '10px 16px', fontSize: 10.5, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rooms.map(room => (
                <tr key={room.id} style={{ borderBottom: '1px solid var(--border-light)' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-surface)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                  {editId === room.id ? (
                    <>
                      <td style={{ padding: '8px 16px' }}>
                        <input value={editName} onChange={e => setEditName(e.target.value)} style={{ ...inp, width: '100%', boxSizing: 'border-box' }} autoFocus />
                      </td>
                      <td style={{ padding: '8px 16px' }}>
                        <input value={editTag} onChange={e => setEditTag(e.target.value)} style={{ ...inp, width: 120 }} />
                      </td>
                      <td style={{ padding: '8px 16px', fontSize: 12, color: 'var(--text-muted)' }}>{room.waitingCount} waiting</td>
                      <td style={{ padding: '8px 16px' }} />
                      <td style={{ padding: '8px 16px' }}>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button onClick={() => saveEdit(room.id)} disabled={saving} style={{ display: 'flex', alignItems: 'center', gap: 4, height: 28, padding: '0 10px', background: '#16a34a', color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                            <Check size={11} /> Save
                          </button>
                          <button onClick={() => setEditId(null)} style={{ height: 28, padding: '0 10px', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, cursor: 'pointer', color: 'var(--text-muted)' }}>Cancel</button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td style={{ padding: '12px 16px', fontSize: 13.5, fontWeight: 600, color: 'var(--text-heading)' }}>{room.name}</td>
                      <td style={{ padding: '12px 16px' }}>
                        <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: 'var(--badge-blue-bg)', color: 'var(--badge-blue-text)' }}>{room.tag}</span>
                      </td>
                      <td style={{ padding: '12px 16px', fontSize: 12.5, color: room.waitingCount > 0 ? 'var(--badge-amber-text)' : 'var(--text-muted)' }}>
                        {room.waitingCount > 0 ? `${room.waitingCount} waiting` : '—'}
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <button onClick={() => toggleActive(room)} title={room.active ? 'Deactivate room' : 'Activate room'} style={{
                          width: 36, height: 20, borderRadius: 10, border: 'none', cursor: 'pointer', transition: 'background 0.2s',
                          background: room.active ? '#16a34a' : 'var(--border-input)', position: 'relative',
                        }}>
                          <span style={{ position: 'absolute', top: 2, left: room.active ? 18 : 2, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left 0.2s', display: 'block' }} />
                        </button>
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button onClick={() => { setEditId(room.id); setEditName(room.name); setEditTag(room.tag); }} style={{ width: 28, height: 28, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-surface)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
                            <Pencil size={12} />
                          </button>
                          <button onClick={() => removeRoom(room.id)} title="Remove room" style={{ width: 28, height: 28, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-surface)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--badge-red-text)' }}>
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AdminUsersPage() {
  const [tab, setTab] = useState<'pending' | 'all' | 'rooms'>('pending');
  const [pending, setPending] = useState<AdminUser[]>([]);
  const [allUsers, setAllUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');

  async function loadData() {
    setLoading(true);
    setError('');
    try {
      const [pendingRes, allRes] = await Promise.all([
        api.get('/auth/users?status=pending'),
        api.get('/auth/users'),
      ]);
      setPending(pendingRes.data);
      setAllUsers(allRes.data);
    } catch (err: any) {
      setError(err?.response?.data?.error ?? 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadData(); }, []);

  const filteredAll = allUsers.filter(u => {
    const q = search.toLowerCase();
    return (
      u.name?.toLowerCase().includes(q) ||
      u.email?.toLowerCase().includes(q) ||
      u.username?.toLowerCase().includes(q) ||
      u.designation?.toLowerCase().includes(q)
    );
  });

  return (
    <div className="page-container">

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10, background: '#1e3a5f',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Shield size={20} color="#fff" />
          </div>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-heading)', margin: 0 }}>User Management</h1>
            <p style={{ fontSize: 12.5, color: 'var(--text-subtle)', margin: 0 }}>Approve, reject, and manage system users</p>
          </div>
        </div>
        <button
          onClick={loadData}
          disabled={loading}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px',
            background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8,
            fontSize: 13, color: 'var(--text-body2)', cursor: 'pointer',
          }}
        >
          <RefreshCw size={13} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
          Refresh
        </button>
      </div>

      {error && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px',
          background: 'var(--badge-red-bg)', border: '1px solid var(--border)', borderRadius: 8, marginBottom: 20,
          fontSize: 13, color: 'var(--badge-red-text)',
        }}>
          <AlertCircle size={15} />
          {error}
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 24, gap: 0 }}>
        {([
          { key: 'pending', label: 'Pending Approvals', icon: <Clock size={14} />,    count: pending.length },
          { key: 'all',     label: 'All Users',          icon: <Users size={14} />,    count: allUsers.length },
          { key: 'rooms',   label: 'Rooms',              icon: <DoorOpen size={14} />, count: null },
        ] as const).map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '10px 20px',
              background: 'none', border: 'none', cursor: 'pointer', fontSize: 13.5, fontWeight: 600,
              color: tab === t.key ? '#c8102e' : 'var(--text-muted)',
              borderBottom: `2px solid ${tab === t.key ? '#c8102e' : 'transparent'}`,
              marginBottom: -1, transition: 'color 0.15s',
            }}
          >
            {t.icon}
            {t.label}
            {t.count !== null && (
              <span style={{
                fontSize: 11, fontWeight: 700, padding: '1px 7px', borderRadius: 20,
                background: tab === t.key ? 'var(--badge-red-bg)' : 'var(--badge-gray-bg)',
                color: tab === t.key ? '#c8102e' : 'var(--text-muted)',
              }}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Pending tab ───────────────────────────────────────────────────── */}
      {tab === 'pending' && (
        <div>
          {loading ? (
            <div style={{ fontSize: 13.5, color: 'var(--text-subtle)', padding: 24 }}>Loading…</div>
          ) : pending.length === 0 ? (
            <div style={{
              textAlign: 'center', padding: '48px 24px',
              background: 'var(--bg-surface)', borderRadius: 12, border: '1px dashed var(--border)',
            }}>
              <CheckCircle size={32} color="#16a34a" style={{ marginBottom: 12 }} />
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-heading)', marginBottom: 6 }}>
                No pending approvals
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-subtle)' }}>
                All account requests have been reviewed.
              </div>
            </div>
          ) : (
            pending.map(u => <PendingRow key={u.id} user={u} onRefresh={loadData} />)
          )}
        </div>
      )}

      {/* ── Rooms tab ─────────────────────────────────────────────────────── */}
      {tab === 'rooms' && <RoomsTab />}

      {/* ── All users tab ─────────────────────────────────────────────────── */}
      {tab === 'all' && (
        <div>
          <div style={{ marginBottom: 16, position: 'relative', maxWidth: 340 }}>
            <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-subtle)', pointerEvents: 'none' }} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by name, email, or username…"
              className="field-input"
              style={{
                width: '100%', height: 38, paddingLeft: 36, paddingRight: 12,
                fontSize: 13.5, boxSizing: 'border-box',
              }}
            />
          </div>

          {loading ? (
            <div style={{ fontSize: 13.5, color: 'var(--text-subtle)', padding: 24 }}>Loading…</div>
          ) : (
            <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)' }}>
                    {['Name', 'Email', 'Designation', 'Role', 'Status', 'Joined', 'Actions'].map(h => (
                      <th key={h} style={{
                        textAlign: 'left', padding: '10px 16px',
                        fontSize: 10.5, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em',
                      }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredAll.length === 0 ? (
                    <tr>
                      <td colSpan={7} style={{ padding: '32px 16px', textAlign: 'center', fontSize: 13.5, color: 'var(--text-subtle)' }}>
                        {search ? 'No users match your search.' : 'No users found.'}
                      </td>
                    </tr>
                  ) : (
                    filteredAll.map(u => <UserRow key={u.id} user={u} onRefresh={loadData} />)
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
