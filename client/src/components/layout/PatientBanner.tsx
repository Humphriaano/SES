import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Pencil, DoorOpen, X, ChevronDown } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/client';
import { usePatient } from '../../context/PatientContext';
import { Patient } from '../../types';
import RegisterModal from '../RegisterModal';
import AssignRoomModal, { QueueEntryInfo } from '../AssignRoomModal';
import { useAuth } from '../../context/AuthContext';
import { PRIORITIES, ordinal, queueNo, useQueueChanged, arrivedAt, waitMinutes, formatWait, useNow } from '../../lib/queue';
import { useVisiblePolling } from '../../hooks/useVisiblePolling';
import { hasRole, zmw } from '../../lib/money';
import { canAccessModule } from '../../lib/moduleAccess';

const HIV_LABEL: Record<string, string> = { POSITIVE: 'Positive', NEGATIVE: 'Negative', UNKNOWN: 'Unknown' };

function age(dob: string) {
  return Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * 24 * 3600 * 1000));
}

// "+260971234567" → "+260 97 123 4567" for display.
function prettyPhone(p?: string) {
  if (!p) return '';
  return /^\+260\d{9}$/.test(p) ? `+260 ${p.slice(4, 6)} ${p.slice(6, 9)} ${p.slice(9)}` : p;
}

// Patient identity strip shown under the module nav on every patient page.
export default function PatientBanner() {
  const { activePatient, setActivePatient } = usePatient();
  const [patient, setPatient] = useState<Patient | null>(null);
  const [editing, setEditing] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [inviting, setInviting] = useState(false);
  const { user } = useAuth();
  const navigate = useNavigate();
  const [entry, setEntry] = useState<QueueEntryInfo | null>(null);
  const [assigning, setAssigning] = useState(false);
  const patientId = activePatient?.id;
  const now = useNow();
  useEffect(() => { setDetailsOpen(false); }, [patientId]);
  const canAssign = (user?.role ?? '').split(',').some((r) => ['admin', 'clinician', 'nurse', 'receptionist'].includes(r.trim()));
  const canSeeClinical = canAccessModule(user?.role, 'documents');
  const canManagePatient = canSeeClinical || hasRole(user?.role, 'receptionist');
  const canSeeQueue = canSeeClinical || canAssign;

  // The patient's place in today's queue — refreshed on change, on a slow poll, and whenever it's edited elsewhere.
  const loadEntry = () => {
    if (!patientId || !canSeeQueue) { setEntry(null); return; }
    api.get(`/queue/patient/${patientId}`).then((r) => setEntry(r.data)).catch(() => {});
  };
  useEffect(() => { setEntry(null); loadEntry(); }, [patientId]); // eslint-disable-line react-hooks/exhaustive-deps
  useQueueChanged(loadEntry);
  useVisiblePolling(loadEntry, 30000, !!patientId && canSeeQueue);

  // What the patient owes (red) and any credit on account. Quietly absent for roles that can't see billing.
  const [bill, setBill] = useState<{ outstanding: number; overdue: number; credit: number } | null>(null);
  const canSeeBilling = hasRole(user?.role, 'admin', 'billing', 'receptionist', 'clinician', 'pharmacist');
  const loadBill = () => {
    if (!patientId || !canSeeBilling) { setBill(null); return; }
    api.get(`/patients/${patientId}/billing-summary`).then((r) => setBill(r.data)).catch(() => setBill(null));
  };
  useEffect(() => { setBill(null); loadBill(); }, [patientId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { window.addEventListener('billing-changed', loadBill); return () => window.removeEventListener('billing-changed', loadBill); }); // eslint-disable-line react-hooks/exhaustive-deps
  useVisiblePolling(loadBill, 60000, !!patientId && canSeeBilling);

  useEffect(() => {
    if (!activePatient) { setPatient(null); return; }
    let live = true;
    api.get(`/patients/${activePatient.id}`).then((r) => { if (live) setPatient(r.data); }).catch(() => {});
    return () => { live = false; };
  }, [activePatient?.id, user?.role]);

  // Ends work on this patient and returns to Home.
  function closePatient() {
    setActivePatient(null);
    navigate('/');
  }

  if (!activePatient) return null;
  const p = patient ?? activePatient;
  const openEncounter = patient?.encounters?.find((e) => e.status === 'OPEN');
  const gender = p.gender === 'MALE' ? 'Male' : p.gender === 'FEMALE' ? 'Female' : 'Other';
  const details = [gender, `${age(p.dateOfBirth)} yrs`, p.nationalId && `NRC ${p.nationalId}`, prettyPhone(p.phone)].filter(Boolean);
  const hasBalance = !!bill && (bill.outstanding > 0 || bill.credit > 0);

  async function invite() {
    if (!patient?.email) { toast.error('Add an email address first (edit patient details).'); return; }
    setInviting(true);
    try {
      await api.post(`/patients/${patient.id}/portal-invite`);
      setPatient((x) => (x ? { ...x, portalEnabled: true } : x));
      toast.success('Portal invitation sent');
    } catch (err: any) {
      if (err?.response) toast.error(err.response.data?.error ?? "Couldn't send invitation");
    } finally {
      setInviting(false);
    }
  }

  return (
    <section aria-label="Patient" className="pb">
      <div className="pb-in">
          <div className="pb-identity">
            <span aria-hidden="true" className="pb-av">{p.firstName.charAt(0).toUpperCase()}{p.lastName.charAt(0).toUpperCase()}</span>
            <div className="pb-person">
              <div className="pb-name-row">
                <h2 className="pb-name">{p.firstName} {p.lastName}</h2>
                <div className="pb-name-actions">
                  {canAssign && (
                    <button type="button" className="pb-ib" onClick={() => setAssigning(true)} aria-label={entry ? 'Change room' : 'Assign to room'} title={entry ? 'Change room' : 'Assign to room'}>
                      <DoorOpen size={14} aria-hidden="true" />
                    </button>
                  )}
                  {canManagePatient && <button type="button" className="pb-ib" aria-label="Edit patient details" title="Edit patient details"
                    onClick={() => setEditing(true)} disabled={!patient}>
                    <Pencil size={14} strokeWidth={2} />
                  </button>}
                  <button type="button" className="pb-ib" aria-label={`Close ${p.firstName} ${p.lastName}`} title="Close this patient and go back to Home"
                    onClick={closePatient}>
                    <X size={15} strokeWidth={2} />
                  </button>
                </div>
              </div>
              <p className="pb-sub">{details.map((detail, i) => <span key={i}>{detail}</span>)}</p>
            </div>
          </div>
        {(canManagePatient || hasBalance) && <button type="button" className="pb-toggle" aria-expanded={detailsOpen} aria-controls="patient-status" onClick={() => setDetailsOpen(v => !v)}>
          Details <ChevronDown size={13} aria-hidden="true" />
        </button>}
        <div id="patient-status" className={detailsOpen ? 'pb-status is-open' : 'pb-status'}>

        <dl className={hasBalance ? 'pb-dl pb-with-balance' : 'pb-dl'}>
          {canSeeClinical && <><div>
            <dt>HIV status</dt>
            <dd>{HIV_LABEL[p.hivStatus] ?? 'Unknown'}</dd>
          </div>
          <div>
            <dt>Encounter</dt>
            <dd>
              {openEncounter ? (
                <>
                  <span className="pb-value">Open</span>
                  <span className="pb-detail">{new Date(openEncounter.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                </>
              ) : 'None open'}
            </dd>
          </div></>}
          {hasBalance && bill && (
            <div>
              <dt>Balance</dt>
              <dd>
                {bill.outstanding > 0 && <span className="pb-value" style={{ color: 'var(--badge-red-text)' }}>{zmw(bill.outstanding)} owing{bill.overdue > 0 ? ' · overdue' : ''}</span>}
                {bill.credit > 0 && <span className="pb-value" style={{ color: 'var(--badge-green-text)' }}>{zmw(bill.credit)} credit</span>}
              </dd>
            </div>
          )}
          {canSeeQueue && <div>
            <dt>Queue</dt>
            <dd>
              {entry ? (
                <>
                  <span className="pb-value">
                    {entry.priority !== 'Normal' && (
                      <span style={{ color: PRIORITIES.find((x) => x.value === entry.priority)?.color }}>
                        {PRIORITIES.find((x) => x.value === entry.priority)?.label} ·{' '}
                      </span>
                    )}
                    {queueNo(entry.queueNumber)} · {entry.room.name}
                  </span>
                  <span className="pb-detail">
                    {entry.status === 'In Progress' ? (entry.startedBy ? `Being seen by ${entry.startedBy.name}` : 'Being seen') : entry.position === 1 ? 'Next up' : `${ordinal(entry.position ?? 1)} in line`}
                    {' · '}arrived {arrivedAt(entry.checkedInAt)}
                    {entry.status === 'Waiting' ? ` · waiting ${formatWait(waitMinutes(entry, now))}` : ''}
                  </span>
                </>
              ) : 'Not in queue'}
            </dd>
          </div>}
          {canManagePatient && <div>
            <dt>Patient portal</dt>
            <dd>
              <span className="pb-value">{p.portalEnabled ? (p.portalLastSeenAt ? 'Active' : 'Invited') : 'Not invited'}</span>
              {p.portalEnabled && (
                <span className="pb-detail">{p.portalLastSeenAt ? `Seen ${new Date(p.portalLastSeenAt).toLocaleDateString('en-GB')}` : 'Not signed in yet'}</span>
              )}
              <button type="button" className="pb-link" onClick={invite} disabled={inviting || !patient}>
                {inviting ? 'Sending…' : p.portalEnabled ? 'Resend invite' : 'Send invite'}
              </button>
            </dd>
          </div>}
        </dl>
        </div>
      </div>

      {assigning && (
        <AssignRoomModal
          patientId={p.id}
          patientName={`${p.firstName} ${p.lastName}`}
          patientMeta={`${gender} · ${age(p.dateOfBirth)} yrs`}
          current={entry}
          onClose={() => setAssigning(false)}
          onDone={(e) => { setEntry(e); setAssigning(false); }}
          onRemoved={() => setEntry(null)}
        />
      )}

      {editing && patient && (
        <RegisterModal
          patient={patient}
          onClose={() => setEditing(false)}
          onCreated={(updated) => {
            setPatient((x) => (x ? { ...x, ...updated } : updated));
            setActivePatient({ ...patient, ...updated });
            setEditing(false);
            toast.success('Patient details updated');
          }}
        />
      )}

      <style>{`
        .pb { container-type: inline-size; background: var(--bg-card); border-bottom: 1px solid var(--border); }
        .pb-in { max-width: 1600px; margin: 0 auto; padding: 6px 24px; display: grid; grid-template-columns: minmax(280px, .9fr) minmax(0, 1.4fr); align-items: center; gap: 16px; }
        .pb-identity { display: flex; align-items: center; gap: 12px; min-width: 0; }
        .pb-person { min-width: 0; }
        .pb-av { flex: none; width: 30px; height: 30px; border-radius: 50%; background: var(--ws-chip); color: var(--text-heading); font-family: var(--font-heading); font-weight:500; font-size: 13px; display: flex; align-items: center; justify-content: center; }
        .pb-name-row { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
        .pb-name { margin: 0; font-family: var(--font-heading); font-size: 16px; line-height: 1.4; font-weight:500; color: var(--text-heading); overflow-wrap: anywhere; }
        .pb-name-actions { display: inline-flex; align-items: center; gap: 2px; }
        .pb-sub { margin: 1px 0 0; display: flex; align-items: baseline; flex-wrap: wrap; gap: 2px 10px; font-size: 11px; line-height: 1.4; color: var(--text-muted); }
        .pb-sub > span { overflow-wrap: anywhere; }
        .pb-ib { width: 22px; height: 22px; flex-shrink: 0; border: 0; border-radius: 6px; background: transparent; color: var(--text-subtle); display: flex; align-items: center; justify-content: center; cursor: pointer; }
        .pb-ib:hover { background: var(--ws-chip); color: var(--text-heading); }
        .pb-status { min-width: 0; }
        .pb-dl { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); margin: 0; }
        .pb-dl.pb-with-balance { grid-template-columns: repeat(5, minmax(0, 1fr)); }
        .pb-dl > div { min-width: 0; padding: 0 12px; border-left: 1px solid var(--border-light); }
        .pb-dl > div:first-child { padding-left: 0; border-left: 0; }
        .pb-dl dt { font-size: 10px; line-height: 1.4; font-weight:500; letter-spacing: .5px; text-transform: uppercase; color: var(--text-subtle); }
        .pb-dl dd { margin: 3px 0 0; font-size: 12px; line-height: 1.45; font-weight:500; color: var(--text-heading); overflow-wrap: anywhere; }
        .pb-value { display: inline; }
        .pb-value + .pb-value { margin-left: 6px; }
        .pb-detail { display: inline; color: var(--text-muted); font-size: 11px; font-weight: 400; }
        .pb-value + .pb-detail::before { content: ' · '; }
        .pb-link { display: inline; margin-left: 6px; border: 0; background: none; padding: 0; font: inherit; font-size: 11px; font-weight:500; color: var(--selection-text); cursor: pointer; }
        .pb-link:hover:not(:disabled) { text-decoration: underline; }
        .pb-toggle { display: none; align-items: center; gap: 5px; padding: 6px 8px; border: 1px solid var(--btn2-line); border-radius: 8px; background: var(--btn2); color: var(--text-muted); font: inherit; font-size: 12px; cursor: pointer; }
        .pb-toggle[aria-expanded="true"] svg { transform: rotate(180deg); }
        .pb-ib:focus-visible, .pb-toggle:focus-visible, .pb-link:focus-visible { outline: 2px solid var(--ring); outline-offset: 3px; }
        .pb-ib:disabled, .pb-link:disabled { opacity: .6; cursor: default; }
        @container (max-width: 1000px) {
          .pb-in { grid-template-columns: minmax(0, 1fr) auto; gap: 10px 12px; }
          .pb-toggle { display: inline-flex; }
          .pb-status { display: none; grid-column: 1 / -1; }
          .pb-status.is-open { display: block; border-top: 1px solid var(--border-light); padding-top: 10px; }
        }
        @container (max-width: 600px) {
          .pb-in { padding: 10px 14px; }
          .pb-identity { gap: 8px; }
          .pb-av { width: 30px; height: 30px; font-size: 11px; }
          .pb-name { font-size: 16px; }
          .pb-sub { font-size: 11px; gap: 2px 8px; }
          .pb-dl, .pb-dl.pb-with-balance { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
          .pb-dl > div { padding: 0; border-left: 0; }
        }

      `}</style>
    </section>
  );
}
