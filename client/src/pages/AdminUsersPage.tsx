import { useState, useEffect, useCallback, useMemo, FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Search, Plus, Pencil, Trash2 } from 'lucide-react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { staffDisplayName, staffInitials } from '../lib/staffNames';
import PriceListSection from './PriceListSection';
import CatalogueSection from './CatalogueSection';

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

interface FacilityRoom { id: string; name: string; tag: string; active: boolean; waitingCount: number; }

type Section = 'pending' | 'users' | 'rooms' | 'prices' | 'catalogue' | 'facility';

// ── Helpers ───────────────────────────────────────────────────────────────────

const ROLES: { value: string; label: string }[] = [
  { value: 'admin', label: 'Admin' },
  { value: 'clinician', label: 'Clinician' },
  { value: 'nurse', label: 'Nurse' },
  { value: 'pharmacist', label: 'Pharmacist' },
  { value: 'lab_tech', label: 'Lab technician' },
  { value: 'receptionist', label: 'Receptionist' },
  { value: 'billing', label: 'Billing officer' },
];

const STATUS: Record<string, { label: string; dot: string }> = {
  active:      { label: 'Active',      dot: 'var(--st-ok)' },
  pending:     { label: 'Pending',     dot: 'var(--st-warn)' },
  rejected:    { label: 'Rejected',    dot: 'var(--st-bad)' },
  deactivated: { label: 'Deactivated', dot: 'var(--text-subtle)' },
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function displayName(u: AdminUser) {
  return staffDisplayName(u.firstName ? `${u.firstName} ${u.surname ?? ''}`.trim() : u.name, u.designation);
}

function initials(u: AdminUser) {
  return staffInitials(displayName(u));
}

function roleLabels(role: string | null) {
  if (!role) return '—';
  return role.split(',').map((r) => r.trim()).filter(Boolean).map((r) => ROLES.find((x) => x.value === r)?.label ?? r).join(', ');
}

function apiError(err: any, fallback: string) {
  return err?.response?.data?.error ?? (err?.response ? fallback : null);
}

function Person({ u }: { u: AdminUser }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <span aria-hidden="true" className="a-av">{initials(u)}</span>
      <div>
        <div style={{ fontWeight: 500, color: 'var(--text-heading)' }}>{displayName(u)}</div>
        {u.username && <div className="a-faint" style={{ fontSize: 12 }}>@{u.username}</div>}
      </div>
    </div>
  );
}

// ── Pending approvals ─────────────────────────────────────────────────────────

function PendingRow({ user, onDone }: { user: AdminUser; onDone: () => void }) {
  const [mode, setMode] = useState<'idle' | 'approve' | 'reject'>('idle');
  const [roles, setRoles] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(action: 'approve' | 'reject') {
    if (action === 'approve' && roles.length === 0) { setError('Choose at least one role'); return; }
    if (action === 'reject' && !reason.trim()) { setError('Give a reason so the applicant knows why'); return; }
    setBusy(true);
    setError('');
    try {
      await api.patch(`/auth/users/${user.id}`, action === 'approve'
        ? { action, roles }
        : { action, rejectionReason: reason.trim() });
      toast.success(action === 'approve' ? `${displayName(user)} approved` : `${displayName(user)} rejected`);
      onDone();
    } catch (err: any) {
      const msg = apiError(err, 'Could not save. Try again.');
      if (msg) setError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <tr>
        <td style={{ paddingLeft: 20 }}><Person u={user} /></td>
        <td>{user.email}</td>
        <td className={user.designation ? '' : 'a-faint'}>{user.designation ?? '—'}</td>
        <td className="a-muted a-num">{fmtDate(user.createdAt)}</td>
        <td style={{ textAlign: 'right', paddingRight: 20, whiteSpace: 'nowrap' }}>
          {mode === 'idle' ? (
            <div style={{ display: 'inline-flex', gap: 6 }}>
              <button type="button" className="a-q a-q-pri" onClick={() => setMode('approve')}>Approve</button>
              <button type="button" className="a-q" onClick={() => setMode('reject')}>Reject</button>
            </div>
          ) : (
            <button type="button" className="a-q" onClick={() => { setMode('idle'); setError(''); }} disabled={busy}>Cancel</button>
          )}
        </td>
      </tr>
      {mode !== 'idle' && (
        <tr className="a-expand">
          <td colSpan={5} style={{ padding: '4px 20px 18px' }}>
            {mode === 'approve' ? (
              <div>
                <p className="a-k" style={{ margin: '0 0 10px' }}>Assign roles</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
                  {ROLES.map((r) => {
                    const on = roles.includes(r.value);
                    return (
                      <button key={r.value} type="button" aria-pressed={on} className={`a-chip${on ? ' on' : ''}`}
                        onClick={() => { setRoles((p) => (on ? p.filter((x) => x !== r.value) : [...p, r.value])); setError(''); }}>
                        {r.label}
                      </button>
                    );
                  })}
                </div>
                <button type="button" className="a-btn" onClick={() => submit('approve')} disabled={busy || roles.length === 0}>
                  {busy ? 'Approving…' : `Approve as ${roles.length ? roleLabels(roles.join(',')) : '…'}`}
                </button>
              </div>
            ) : (
              <div style={{ maxWidth: 560 }}>
                <label className="a-k" htmlFor={`rej-${user.id}`} style={{ display: 'block', marginBottom: 8 }}>Reason for rejection</label>
                <textarea id={`rej-${user.id}`} className="a-field" rows={2} value={reason}
                  onChange={(e) => { setReason(e.target.value); setError(''); }}
                  placeholder="e.g. Not a member of SES staff" />
                <button type="button" className="a-btn a-btn-bad" style={{ marginTop: 10 }} onClick={() => submit('reject')} disabled={busy}>
                  {busy ? 'Rejecting…' : 'Reject application'}
                </button>
              </div>
            )}
            {error && <p role="alert" className="a-err">{error}</p>}
          </td>
        </tr>
      )}
    </>
  );
}

function PendingSection({ users, loading, onChange }: { users: AdminUser[]; loading: boolean; onChange: () => void }) {
  return (
    <section aria-labelledby="a-p" className="a-card">
      <div className="a-head">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <h2 id="a-p" className="a-h2">Pending approvals</h2>
          <span className="a-faint" style={{ fontSize: 13 }}>{users.length} waiting</span>
        </div>
      </div>
      {loading && users.length === 0 ? <Skeleton /> : users.length === 0 ? (
        <Empty title="No accounts waiting" text="New sign-ups appear here for you to approve or reject." />
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="a-tbl" style={{ minWidth: 760 }}>
            <thead><tr>
              <th style={{ paddingLeft: 20 }}>Name</th><th>Email</th><th>Designation</th><th>Applied</th>
              <th style={{ textAlign: 'right', paddingRight: 20 }}><span className="sr-only">Actions</span></th>
            </tr></thead>
            <tbody>{users.map((u) => <PendingRow key={u.id} user={u} onDone={onChange} />)}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ── Users ─────────────────────────────────────────────────────────────────────

function UserRow({ user, isSelf, onDone }: { user: AdminUser; isSelf: boolean; onDone: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const st = STATUS[user.status] ?? { label: user.status, dot: 'var(--text-subtle)' };
  const deactivating = user.status === 'active';

  async function toggle() {
    if (deactivating && !confirming) { setConfirming(true); return; }
    setBusy(true);
    try {
      await api.patch(`/auth/users/${user.id}`, { action: deactivating ? 'deactivate' : 'reactivate' });
      toast.success(`${displayName(user)} ${deactivating ? 'deactivated' : 'reactivated'}`);
      onDone();
    } catch (err: any) {
      const msg = apiError(err, 'Could not update the account');
      if (msg) toast.error(msg);
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <tr>
      <td style={{ paddingLeft: 20 }}><Person u={user} /></td>
      <td>{user.email}</td>
      <td className={user.designation ? '' : 'a-faint'}>{user.designation ?? '—'}</td>
      <td className={user.role ? '' : 'a-faint'}>{roleLabels(user.role)}</td>
      <td>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 500, color: 'var(--text-heading)' }} title={user.rejectionReason ?? undefined}>
          <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: '50%', background: st.dot }} />{st.label}
        </span>
      </td>
      <td className="a-muted a-num">{fmtDate(user.createdAt)}</td>
      <td style={{ textAlign: 'right', paddingRight: 20, whiteSpace: 'nowrap' }}>
        {isSelf ? <span className="a-faint" style={{ fontSize: 12 }}>You</span>
          : (user.status === 'active' || user.status === 'deactivated') && (
            <div style={{ display: 'inline-flex', gap: 6 }}>
              {confirming && <button type="button" className="a-q" onClick={() => setConfirming(false)} disabled={busy}>Cancel</button>}
              <button type="button" className={`a-q${confirming ? ' a-q-bad' : ''}`} onClick={toggle} disabled={busy}
                onBlur={() => !busy && setTimeout(() => setConfirming(false), 150)}>
                {busy ? 'Saving…' : confirming ? 'Confirm deactivate' : deactivating ? 'Deactivate' : 'Reactivate'}
              </button>
            </div>
          )}
      </td>
    </tr>
  );
}

function UsersSection({ users, loading, onChange }: { users: AdminUser[]; loading: boolean; onChange: () => void }) {
  const { user: me } = useAuth();
  const [q, setQ] = useState('');
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? users.filter((u) => [displayName(u), u.email, u.username ?? ''].some((v) => v.toLowerCase().includes(t))) : users;
  }, [users, q]);

  return (
    <section aria-labelledby="a-u" className="a-card">
      <div className="a-head" style={{ padding: '14px 16px 14px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <h2 id="a-u" className="a-h2">Users</h2>
          <span className="a-faint" style={{ fontSize: 13 }}>{users.length} user{users.length === 1 ? '' : 's'}</span>
        </div>
        <label className="a-search">
          <Search size={16} color="var(--text-subtle)" aria-hidden="true" />
          <span className="sr-only">Search users</span>
          <input type="search" placeholder="Search name, email or username" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      </div>
      {loading && users.length === 0 ? <Skeleton /> : shown.length === 0 ? (
        <Empty title={q ? 'No matching users' : 'No users yet'} text={q ? `Nothing matches “${q}”.` : 'Approved staff accounts appear here.'} />
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="a-tbl" style={{ minWidth: 860 }}>
            <thead><tr>
              <th style={{ paddingLeft: 20 }}>Name</th><th>Email</th><th>Designation</th><th>Role</th><th>Status</th><th>Joined</th>
              <th style={{ textAlign: 'right', paddingRight: 20 }}><span className="sr-only">Actions</span></th>
            </tr></thead>
            <tbody>{shown.map((u) => <UserRow key={u.id} user={u} isSelf={u.id === me?.id} onDone={onChange} />)}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ── Rooms ─────────────────────────────────────────────────────────────────────

function RoomForm({ initial, tags, onCancel, onSaved }: {
  initial?: FacilityRoom; tags: string[]; onCancel: () => void; onSaved: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [tag, setTag] = useState(initial?.tag ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !tag.trim()) { setError('Enter a room name and a tag'); return; }
    setBusy(true);
    setError('');
    try {
      if (initial) await api.patch(`/queue/admin/rooms/${initial.id}`, { name: name.trim(), tag: tag.trim() });
      else await api.post('/queue/admin/rooms', { name: name.trim(), tag: tag.trim() });
      toast.success(initial ? 'Room updated' : 'Room added');
      onSaved();
    } catch (err: any) {
      const msg = apiError(err, 'Could not save the room');
      if (err?.response?.status === 404) { toast.error(msg ?? 'This room no longer exists.'); onSaved(); return; } // reload the list
      if (msg) setError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr className="a-expand">
      <td colSpan={5} style={{ padding: '14px 20px' }}>
        <form onSubmit={save} style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: '2 1 220px' }}>
            <label className="a-k" htmlFor="room-name" style={{ display: 'block', marginBottom: 6 }}>Room name</label>
            <input id="room-name" className="a-field" value={name} onChange={(e) => { setName(e.target.value); setError(''); }}
              placeholder="e.g. Consultation Room 2" autoFocus maxLength={60} />
          </div>
          <div style={{ flex: '1 1 180px' }}>
            <label className="a-k" htmlFor="room-tag" style={{ display: 'block', marginBottom: 6 }}>Tag</label>
            <input id="room-tag" className="a-field" list="room-tags" value={tag} onChange={(e) => { setTag(e.target.value); setError(''); }}
              placeholder="e.g. Consultation" maxLength={30} />
            <datalist id="room-tags">{tags.map((t) => <option key={t} value={t} />)}</datalist>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" className="a-q" style={{ height: 40 }} onClick={onCancel} disabled={busy}>Cancel</button>
            <button type="submit" className="a-btn" disabled={busy}>{busy ? 'Saving…' : initial ? 'Save' : 'Add room'}</button>
          </div>
        </form>
        {error && <p role="alert" className="a-err">{error}</p>}
      </td>
    </tr>
  );
}

function RoomRow({ room, tags, onChange }: { room: FacilityRoom; tags: string[]; onChange: () => void }) {
  const [editing, setEditing] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [busy, setBusy] = useState(false);

  async function toggleActive() {
    setBusy(true);
    try {
      await api.patch(`/queue/admin/rooms/${room.id}`, { active: !room.active });
      onChange();
    } catch (err: any) {
      const msg = apiError(err, 'Could not update the room');
      if (msg) toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirmDel) { setConfirmDel(true); return; }
    setBusy(true);
    try {
      await api.delete(`/queue/admin/rooms/${room.id}`);
      toast.success(`${room.name} deleted`);
      onChange();
    } catch (err: any) {
      const msg = apiError(err, 'Could not delete the room');
      if (msg) toast.error(msg);
      setConfirmDel(false);
    } finally {
      setBusy(false);
    }
  }

  if (editing) return <RoomForm initial={room} tags={tags} onCancel={() => setEditing(false)} onSaved={() => { setEditing(false); onChange(); }} />;

  return (
    <tr>
      <td style={{ paddingLeft: 20, fontWeight: 500, color: 'var(--text-heading)' }}>{room.name}</td>
      <td><span className="a-tag">{room.tag}</span></td>
      <td className="a-num">{room.waitingCount}</td>
      <td>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
          <button type="button" role="switch" aria-checked={room.active} aria-label={`${room.name} active`}
            className={`a-sw${room.active ? ' on' : ''}`} onClick={toggleActive} disabled={busy} />
          <span style={{ fontWeight: 500, color: room.active ? 'var(--text-heading)' : 'var(--text-muted)' }}>{room.active ? 'Active' : 'Off'}</span>
        </label>
      </td>
      <td style={{ textAlign: 'right', paddingRight: 20, whiteSpace: 'nowrap' }}>
        <div style={{ display: 'inline-flex', gap: 6 }}>
          {confirmDel ? (
            <>
              <button type="button" className="a-q" onClick={() => setConfirmDel(false)} disabled={busy}>Cancel</button>
              <button type="button" className="a-q a-q-bad" onClick={remove} disabled={busy}>{busy ? 'Deleting…' : 'Confirm delete'}</button>
            </>
          ) : (
            <>
              <button type="button" className="a-icon" aria-label={`Edit ${room.name}`} title="Edit" onClick={() => setEditing(true)}><Pencil size={15} /></button>
              <button type="button" className="a-icon a-del" aria-label={`Delete ${room.name}`} title="Delete" onClick={remove}><Trash2 size={15} /></button>
            </>
          )}
        </div>
      </td>
    </tr>
  );
}

function RoomsSection({ rooms, loading, onChange }: { rooms: FacilityRoom[]; loading: boolean; onChange: () => void }) {
  const [adding, setAdding] = useState(false);
  const tags = useMemo(() => [...new Set(rooms.map((r) => r.tag))].sort(), [rooms]);

  return (
    <section aria-labelledby="a-r" className="a-card">
      <div className="a-head" style={{ padding: '14px 16px 14px 20px' }}>
        <div>
          <h2 id="a-r" className="a-h2" style={{ marginBottom: 2 }}>Rooms</h2>
          <p className="a-muted" style={{ margin: 0, fontSize: 13 }}>Service points patients can be routed to. Group them with tags like Triage or Consultation.</p>
        </div>
        <button type="button" className="a-btn" onClick={() => setAdding(true)} disabled={adding}>
          <Plus size={15} strokeWidth={2.2} /> Add room
        </button>
      </div>
      {loading && rooms.length === 0 && !adding ? <Skeleton /> : (
        <div style={{ overflowX: 'auto' }}>
          <table className="a-tbl" style={{ minWidth: 760 }}>
            <thead><tr>
              <th style={{ paddingLeft: 20 }}>Room</th><th>Tag</th><th>In queue</th><th>Status</th>
              <th style={{ textAlign: 'right', paddingRight: 20 }}><span className="sr-only">Actions</span></th>
            </tr></thead>
            <tbody>
              {adding && <RoomForm tags={tags} onCancel={() => setAdding(false)} onSaved={() => { setAdding(false); onChange(); }} />}
              {rooms.map((r) => <RoomRow key={r.id} room={r} tags={tags} onChange={onChange} />)}
              {rooms.length === 0 && !adding && (
                <tr><td colSpan={5} style={{ padding: 0, border: 0 }}>
                  <Empty title="No rooms yet" text="Add rooms so patients can be checked in and routed." />
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ── Facility ──────────────────────────────────────────────────────────────────

interface Facility { name: string; district: string; lineListNames: boolean }

// The facility's name and district (they head every report and Excel file) and whether report line lists may show patient names.
function FacilitySection() {
  const [saved, setSaved] = useState<Facility | null>(null);
  const [draft, setDraft] = useState<Facility>({ name: '', district: '', lineListNames: true });
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {   // the state is set only once the answer is in, and not after the section has closed
    let alive = true;
    api.get<Facility>('/facility-settings')
      .then((r) => { if (alive) { setSaved(r.data); setDraft(r.data); setState('ready'); } })
      .catch(() => { if (alive) setState('failed'); });
    return () => { alive = false; };
  }, [reload]);
  const retry = () => { setState('loading'); setReload((n) => n + 1); };

  const changed = !!saved && (draft.name.trim() !== saved.name || draft.district.trim() !== saved.district || draft.lineListNames !== saved.lineListNames);
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!changed || busy) return;
    setBusy(true); setError('');
    try {
      const r = await api.patch<Facility>('/facility-settings', { name: draft.name, district: draft.district, lineListNames: draft.lineListNames });
      setSaved(r.data); setDraft(r.data); toast.success('Facility details saved');
    } catch (err) { setError(apiError(err, 'Could not save the facility details. Try again.') ?? 'Could not save the facility details. Try again.'); }
    finally { setBusy(false); }
  }

  return (
    <section aria-labelledby="a-f" className="a-card">
      <div className="a-head" style={{ padding: '14px 16px 14px 20px' }}>
        <div>
          <h2 id="a-f" className="a-h2" style={{ marginBottom: 2 }}>Facility</h2>
          <p className="a-muted" style={{ margin: 0, fontSize: 13 }}>The name and district head every report and Excel file. Changes are recorded in the audit log.</p>
        </div>
      </div>
      {state === 'loading' && <Skeleton />}
      {state === 'failed' && (<>
        <Empty title="Couldn’t load the facility details" text="Check your connection, then try again." />
        <div style={{ textAlign: 'center', paddingBottom: 28 }}><button type="button" className="a-q" onClick={retry}>Try again</button></div>
      </>)}
      {state === 'ready' && (
        <form onSubmit={save} style={{ padding: '6px 20px 22px', display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 620 }}>
          <div>
            <label className="a-k" htmlFor="fac-name" style={{ display: 'block', marginBottom: 6 }}>Facility name</label>
            <input id="fac-name" className="a-field" value={draft.name} maxLength={120} placeholder="e.g. Mtendere Clinic" onChange={(e) => { setDraft({ ...draft, name: e.target.value }); setError(''); }} />
          </div>
          <div>
            <label className="a-k" htmlFor="fac-district" style={{ display: 'block', marginBottom: 6 }}>District</label>
            <input id="fac-district" className="a-field" value={draft.district} maxLength={80} placeholder="e.g. Lusaka" onChange={(e) => { setDraft({ ...draft, district: e.target.value }); setError(''); }} />
          </div>
          <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13.5, color: 'var(--text-body)', cursor: 'pointer' }}>
            <input type="checkbox" checked={draft.lineListNames} onChange={(e) => { setDraft({ ...draft, lineListNames: e.target.checked }); setError(''); }} style={{ marginTop: 3 }} />
            <span><b style={{ fontWeight: 500, color: 'var(--text-heading)' }}>Allow patient names on report line lists</b><br />
              <span className="a-muted">Clinical staff can then choose to show names. Switched off, every line list shows only the patient ID and a masked NRC, for everyone.</span></span>
          </label>
          {error && <p role="alert" className="a-err" style={{ margin: 0 }}>{error}</p>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" className="a-btn" disabled={!changed || busy}>{busy ? 'Saving…' : 'Save'}</button>
            {changed && !busy && <button type="button" className="a-q" style={{ height: 40 }} onClick={() => { setDraft(saved!); setError(''); }}>Undo changes</button>}
          </div>
        </form>
      )}
    </section>
  );
}

// ── Shared bits ───────────────────────────────────────────────────────────────

function Skeleton() {
  return (
    <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {[0, 1, 2].map((i) => <div key={i} className="a-skel" />)}
    </div>
  );
}

function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div style={{ padding: '48px 20px 52px', textAlign: 'center' }}>
      <p style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 500, color: 'var(--text-heading)' }}>{title}</p>
      <p className="a-muted" style={{ margin: 0 }}>{text}</p>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AdminUsersPage() {
  const [params, setParams] = useSearchParams();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [rooms, setRooms] = useState<FacilityRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const pending = useMemo(() => users.filter((u) => u.status === 'pending'), [users]);
  const staff = useMemo(() => users.filter((u) => u.status !== 'pending'), [users]);

  const requested = params.get('section') as Section | null;
  const section: Section = requested && ['pending', 'users', 'rooms', 'prices', 'catalogue', 'facility'].includes(requested)
    ? requested
    : pending.length > 0 ? 'pending' : 'users';

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      const [u, r] = await Promise.all([api.get('/auth/users'), api.get('/queue/admin/rooms')]);
      setUsers(u.data);
      setRooms(r.data);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const NAV: { id: Section; label: string; count?: number }[] = [
    { id: 'pending', label: 'Pending approvals', count: pending.length },
    { id: 'users', label: 'Users', count: staff.length },
    { id: 'rooms', label: 'Rooms', count: rooms.length },
    { id: 'catalogue', label: 'Catalogue' },
    { id: 'prices', label: 'Price list' },
    { id: 'facility', label: 'Facility' },
  ];

  return (
    <div className="adm">
      <div style={{ marginBottom: 22 }}>
        <h1 className="a-h1">Administration</h1>
        <p className="a-muted" style={{ margin: 0, fontSize: 13 }}>Approve accounts, manage users and set up rooms.</p>
      </div>

      <div className="a-layout">
        <nav className="a-side" aria-label="Administration">
          {NAV.map((n) => (
            <a key={n.id} href={`?section=${n.id}`} aria-current={section === n.id ? 'page' : undefined}
              onClick={(e) => { e.preventDefault(); setParams({ section: n.id }); }}>
              <span>{n.label}</span>
              {n.count !== undefined && <span className={`a-n${n.id === 'pending' && n.count > 0 ? ' a-n-hot' : ''}`}>{loading ? '–' : n.count}</span>}
            </a>
          ))}
        </nav>

        <div>
          {loadError ? (
            <section className="a-card">
              <Empty title="Couldn’t load administration data" text="Check your connection, then try again." />
              <div style={{ textAlign: 'center', paddingBottom: 28 }}><button type="button" className="a-q" onClick={load}>Try again</button></div>
            </section>
          ) : section === 'prices' ? <PriceListSection />
            : section === 'facility' ? <FacilitySection />
            : section === 'catalogue' ? <CatalogueSection />
            : section === 'pending' ? <PendingSection users={pending} loading={loading} onChange={load} />
            : section === 'users' ? <UsersSection users={staff} loading={loading} onChange={load} />
              : <RoomsSection rooms={rooms} loading={loading} onChange={load} />}
        </div>
      </div>

      <style>{CSS}</style>
    </div>
  );
}

const CSS = `
.adm { padding: 24px 24px 40px; max-width: 1600px; margin: 0 auto; font-size: 14px; color: var(--text-body); }
.a-h1 { margin: 0 0 4px; font-weight:500; font-size: 22px; letter-spacing: -0.2px; color: var(--text-heading); }
.a-h2 { margin: 0; font-family: var(--font-heading); font-size: 16px; font-weight:500; color: var(--text-heading); }
.a-muted { color: var(--text-muted); }
.a-faint { color: var(--text-subtle); }
.a-num { font-variant-numeric: tabular-nums; }
.a-k { font-size: 11px; font-weight:500; letter-spacing: 1px; text-transform: uppercase; color: var(--text-subtle); }
.a-layout { display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: 28px; align-items: start; }
.a-side { display: flex; flex-direction: column; gap: 4px; }
.a-side a { display: flex; align-items: center; justify-content: space-between; height: 40px; padding: 0 12px; border-radius: 10px;
  color: var(--text-muted); font-weight:500; text-decoration: none; transition: background .15s, color .15s; }
.a-side a:hover { background: var(--ws-chip); color: var(--text-heading); }
.a-side a[aria-current="page"] { background: var(--selection-bg); color: var(--selection-text); box-shadow: inset 3px 0 0 var(--selection-accent), 0 0 0 1px var(--selection-border); }
.a-n { font-size: 12px; font-weight:500; color: var(--text-subtle); font-variant-numeric: tabular-nums; }
.a-n-hot { min-width: 20px; height: 20px; padding: 0 6px; border-radius: 10px; background: var(--st-warn-bg); color: var(--st-warn); font-weight:500;
  display: inline-flex; align-items: center; justify-content: center; }
.a-card { background: var(--bg-card); border: 1px solid var(--border); border-radius: 14px; overflow: hidden; }
.a-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; padding: 14px 16px 14px 20px; border-bottom: 1px solid var(--border-light); }
.a-search { display: flex; align-items: center; gap: 10px; height: 40px; padding: 0 12px; width: 320px; max-width: 100%;
  border: 1px solid var(--btn2-line); border-radius: 10px; background: var(--btn2); }
.a-search:focus-within { border-color: var(--ring); box-shadow: 0 0 0 4px var(--ring-glow); }
.a-search input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; font: inherit; font-size: 14px; color: var(--text-heading); }
.a-search input::placeholder { color: var(--text-subtle); }
.a-tbl { width: 100%; border-collapse: collapse; font-size: 14px; }
.a-tbl th { text-align: left; padding: 10px 16px; background: var(--ws-head); font-size: 11px; font-weight:500; letter-spacing: 1px;
  text-transform: uppercase; color: var(--text-subtle); white-space: nowrap; }
.a-tbl td { padding: 14px 16px; border-top: 1px solid var(--border-light); vertical-align: middle; color: var(--text-heading); }
.a-tbl tr.a-expand td { border-top: 0; background: var(--ws-head); }
.a-av { flex: none; width: 34px; height: 34px; border-radius: 50%; background: var(--ws-chip); color: var(--text-heading);
  font-weight:500; font-size: 13px; display: flex; align-items: center; justify-content: center; }
.a-q { height: 32px; padding: 0 12px; border: 1px solid var(--btn2-line); border-radius: 8px; background: transparent; color: var(--text-heading);
  font: inherit; font-size: 13px; font-weight:500; cursor: pointer; transition: background .15s, border-color .15s, color .15s; }
.a-q:hover:not(:disabled) { background: var(--ws-chip); }
.a-q:disabled { opacity: .55; cursor: not-allowed; }
.a-q-pri { background: var(--btn-accent); border-color: var(--btn-accent); color: #fff; }
.a-q-pri:hover:not(:disabled) { background: var(--btn-accent-hover); filter: brightness(1.06); }
.a-q-bad { color: var(--st-bad); border-color: var(--st-bad); }
.a-q-bad:hover:not(:disabled) { background: var(--st-bad-bg); }
.a-btn { height: 38px; padding: 0 16px; border: 0; border-radius: 10px; background: var(--btn-accent); color: #fff; font: inherit; font-size: 13px; font-weight:500;
  cursor: pointer; display: inline-flex; align-items: center; gap: 8px; transition: filter .15s, opacity .15s; }
.a-btn:hover:not(:disabled) { filter: brightness(1.06); }
.a-btn:disabled { opacity: .5; cursor: not-allowed; }
.a-btn-bad { background: transparent; color: var(--st-bad); border: 1px solid var(--st-bad); }
.a-btn-bad:hover:not(:disabled) { background: var(--st-bad-bg); filter: none; }
.a-icon { width: 34px; height: 34px; border: 1px solid var(--btn2-line); border-radius: 8px; background: transparent; color: var(--text-muted);
  display: inline-flex; align-items: center; justify-content: center; cursor: pointer; transition: background .15s, color .15s, border-color .15s; }
.a-icon:hover { background: var(--ws-chip); color: var(--text-heading); }
.a-del:hover { color: var(--st-bad); border-color: var(--st-bad); }
.a-tag { display: inline-block; padding: 2px 10px; border: 1px solid var(--border); border-radius: 999px; font-size: 12px; font-weight:500; color: var(--text-muted); }
.a-sw { position: relative; width: 38px; height: 22px; border-radius: 11px; border: 0; padding: 0; cursor: pointer; background: var(--btn2-line); transition: background .2s; }
.a-sw::after { content: ""; position: absolute; top: 3px; left: 3px; width: 16px; height: 16px; border-radius: 50%; background: #fff;
  box-shadow: 0 1px 2px rgba(0,0,0,.2); transition: left .2s; }
.a-sw.on { background: var(--st-ok); }
.a-sw.on::after { left: 19px; }
.a-sw:disabled { opacity: .6; cursor: wait; }
.a-sw:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
.a-chip { height: 32px; padding: 0 14px; border-radius: 999px; border: 1px solid var(--btn2-line); background: var(--btn2); color: var(--text-heading);
  font: inherit; font-size: 13px; font-weight:500; cursor: pointer; transition: background .15s, color .15s, border-color .15s; }
.a-chip.on { background: var(--ws-chip-on); border-color: var(--selection-border); color: var(--ws-chip-on-text); }
.a-field { width: 100%; min-height: 40px; padding: 9px 12px; border: 1px solid var(--btn2-line); border-radius: 10px; background: var(--btn2);
  font: inherit; font-size: 14px; color: var(--text-heading); outline: 0; resize: vertical; }
.a-field:focus { border-color: var(--ring); box-shadow: 0 0 0 4px var(--ring-glow); }
.a-err { margin: 10px 0 0; font-size: 13px; font-weight:500; color: var(--st-bad); }
.a-skel { height: 18px; border-radius: 6px; background: var(--ws-chip); animation: a-pulse 1.2s ease-in-out infinite; }
@keyframes a-pulse { 50% { opacity: .5; } }
@media (max-width: 900px) { .a-layout { grid-template-columns: 1fr; } .a-side { flex-direction: row; overflow-x: auto; } .a-side a { flex: none; gap: 10px; } }
@media (max-width: 560px) { .adm { padding: 16px 14px 32px; } }
`;
