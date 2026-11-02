import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Pencil, DoorOpen, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/client';
import { usePatient } from '../../context/PatientContext';
import { Patient } from '../../types';
import RegisterModal from '../RegisterModal';
import AssignRoomModal, { QueueEntryInfo } from '../AssignRoomModal';
import { useAuth } from '../../context/AuthContext';
import { PRIORITIES, ordinal, queueNo, useQueueChanged, arrivedAt, waitMinutes, formatWait, useNow } from '../../lib/queue';
import { useVisiblePolling } from '../../hooks/useVisiblePolling';

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
  const [inviting, setInviting] = useState(false);
  const { user } = useAuth();
  const navigate = useNavigate();
  const [entry, setEntry] = useState<QueueEntryInfo | null>(null);
  const [assigning, setAssigning] = useState(false);
  const patientId = activePatient?.id;
  const now = useNow();
  const canAssign = (user?.role ?? '').split(',').some((r) => ['admin', 'clinician', 'nurse', 'receptionist'].includes(r.trim()));

  // The patient's place in today's queue — refreshed on change, on a slow poll, and whenever it's edited elsewhere.
  const loadEntry = () => {
    if (!patientId) { setEntry(null); return; }
    api.get(`/queue/patient/${patientId}`).then((r) => setEntry(r.data)).catch(() => {});
  };
  useEffect(() => { setEntry(null); loadEntry(); }, [patientId]); // eslint-disable-line react-hooks/exhaustive-deps
  useQueueChanged(loadEntry);
  useVisiblePolling(loadEntry, 30000, !!patientId);

  useEffect(() => {
    if (!activePatient) { setPatient(null); return; }
    let live = true;
    api.get(`/patients/${activePatient.id}`).then((r) => { if (live) setPatient(r.data); }).catch(() => {});
    return () => { live = false; };
  }, [activePatient?.id]);

  // Ends work on this patient and returns to Home.
  function closePatient() {
    setActivePatient(null);
    navigate('/');
  }

  if (!activePatient) return null;
  const p = patient ?? activePatient;
  const openEncounter = patient?.encounters?.find((e) => e.status === 'OPEN');
  const gender = p.gender === 'MALE' ? 'Male' : p.gender === 'FEMALE' ? 'Female' : 'Other';
  const details = [gender, `${age(p.dateOfBirth)} yrs`, p.nationalId && `NRC ${p.nationalId}`, prettyPhone(p.phone)].filter(Boolean).join(' · ');

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
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
          <span aria-hidden="true" className="pb-av">{p.firstName.charAt(0)}{p.lastName.charAt(0)}</span>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <h2 className="pb-name">{p.firstName} {p.lastName}</h2>
              <button type="button" className="pb-ib" aria-label="Edit patient details" title="Edit patient details"
                onClick={() => setEditing(true)} disabled={!patient}>
                <Pencil size={14} strokeWidth={2} />
              </button>
              <button type="button" className="pb-ib" aria-label={`Close ${p.firstName} ${p.lastName}`} title="Close this patient and go back to Home"
                onClick={closePatient}>
                <X size={15} strokeWidth={2} />
              </button>
            </div>
            <p className="pb-sub">{details}</p>
          </div>
        </div>

        <div className="pb-right">
        <dl className="pb-dl">
          <div><dt>HIV status</dt><dd>{HIV_LABEL[p.hivStatus] ?? 'Unknown'}</dd></div>
          <div>
            <dt>Encounter</dt>
            <dd>{openEncounter
              ? `Open · ${new Date(openEncounter.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`
              : 'None open'}</dd>
          </div>
          <div>
            <dt>Queue</dt>
            <dd>
              {entry ? (
                <>
                  {entry.priority !== 'Normal' && (
                    <span style={{ color: PRIORITIES.find((x) => x.value === entry.priority)?.color, fontWeight: 700 }}>
                      {PRIORITIES.find((x) => x.value === entry.priority)?.label} ·{' '}
                    </span>
                  )}
                  {queueNo(entry.queueNumber)} · {entry.room.name}
                  <span style={{ fontWeight: 500, color: 'var(--text-muted)' }}>
                    {' · '}{entry.status === 'In Progress' ? (entry.startedBy ? `being seen by ${entry.startedBy.name}` : 'being seen') : entry.position === 1 ? 'next up' : `${ordinal(entry.position ?? 1)} in line`}
                    {' · '}arrived {arrivedAt(entry.checkedInAt)}
                    {entry.status === 'Waiting' ? ` · waiting ${formatWait(waitMinutes(entry, now))}` : ''}
                  </span>
                </>
              ) : 'Not in queue'}
            </dd>
          </div>
          <div>
            <dt>Patient portal</dt>
            <dd>
              {p.portalEnabled
                ? (p.portalLastSeenAt ? `Active · seen ${new Date(p.portalLastSeenAt).toLocaleDateString('en-GB')}` : 'Invited · not signed in yet')
                : 'Not invited'}
              {' · '}
              <button type="button" className="pb-link" onClick={invite} disabled={inviting || !patient}>
                {inviting ? 'Sending…' : p.portalEnabled ? 'Resend invite' : 'Send invite'}
              </button>
            </dd>
          </div>
        </dl>
        {canAssign && (
          <div className="pb-act">
            <button type="button" className="pb-assign" onClick={() => setAssigning(true)}>
              <DoorOpen size={15} aria-hidden="true" /> {entry ? 'Change room' : 'Assign to room'}
            </button>
          </div>
        )}
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
        .pb { background: var(--bg-card); border-bottom: 1px solid var(--border); }
        .pb-in { max-width: 1600px; margin: 0 auto; padding: 14px 24px; display: flex; align-items: center; justify-content: space-between; gap: 20px; flex-wrap: wrap; }
        .pb-av { flex: none; width: 44px; height: 44px; border-radius: 50%; background: var(--ws-chip); color: var(--text-heading);
          font-family: var(--font-heading); font-weight: 700; font-size: 15px; display: flex; align-items: center; justify-content: center; }
        .pb-name { margin: 0; font-family: var(--font-heading); font-size: 18px; font-weight: 700; color: var(--text-heading); }
        .pb-sub { margin: 2px 0 0; font-size: 13px; color: var(--text-muted); }
        .pb-ib { width: 28px; height: 28px; border: 0; border-radius: 6px; background: transparent; color: var(--text-subtle); display: flex; align-items: center; justify-content: center; cursor: pointer; }
        .pb-ib:hover { background: var(--ws-chip); color: var(--text-heading); }
        .pb-dl { display: flex; gap: 28px; margin: 0; flex-wrap: wrap; }
        .pb-dl dt { font-size: 11px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: var(--text-subtle); }
        .pb-dl dd { margin: 2px 0 0; font-size: 13px; font-weight: 600; color: var(--text-heading); }
        .pb-qchip { display: inline-flex; align-items: center; height: 24px; padding: 0 10px; border-radius: 12px; font-size: 12px; font-weight: 700; white-space: nowrap; }
        .pb-right { display: flex; align-items: center; gap: 24px; flex-wrap: wrap; }
        .pb-act { display: flex; align-items: center; padding-left: 24px; border-left: 1px solid var(--border); }
        .pb-assign { height: 38px; padding: 0 14px; border: 1px solid var(--btn2-line); border-radius: 10px; background: var(--btn2); color: var(--text-heading); font: inherit;
          font-size: 13px; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 8px; white-space: nowrap; transition: background .15s; }
        .pb-assign:hover { background: var(--ws-chip); }
        .pb-link { border: 0; background: none; padding: 0; font: inherit; font-size: 13px; font-weight: 600; color: var(--ws-link); cursor: pointer; }
        .pb-link:hover:not(:disabled) { text-decoration: underline; }
        .pb-link:disabled { opacity: .6; cursor: default; }
        @media (max-width: 700px) { .pb-in { padding: 12px 14px; } .pb-dl { gap: 18px; } }
      `}</style>
    </section>
  );
}
