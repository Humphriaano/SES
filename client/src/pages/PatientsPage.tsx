import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import { Patient } from '../types';
import { usePatient } from '../context/PatientContext';
import { Search, Plus, Users, ChevronRight, Calendar, Phone, CreditCard } from 'lucide-react';
import RegisterModal from '../components/RegisterModal';
import toast from 'react-hot-toast';

export default function PatientsPage() {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const { setActivePatient, setActiveEncounterId } = usePatient();
  const navigate = useNavigate();

  useEffect(() => {
    const timer = setTimeout(() => {
      api.get('/patients', { params: { search } }).then((r) => setPatients(r.data));
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  function openPatient(p: Patient) {
    setActivePatient(p);
    setActiveEncounterId(null);
    navigate(`/patient/${p.id}/consultation`);
  }

  function calcAge(dob: string) {
    return Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * 24 * 3600 * 1000));
  }

  function hivBadge(status: string) {
    if (status === 'POSITIVE') return <span className="badge badge-red">HIV+</span>;
    if (status === 'NEGATIVE') return <span className="badge badge-green">HIV−</span>;
    return <span className="badge badge-gray">Unknown</span>;
  }

  function genderIcon(gender: string) {
    return gender === 'MALE' ? '♂' : gender === 'FEMALE' ? '♀' : '⚥';
  }

  return (
    <div className="page-container">
      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-heading)', lineHeight: 1.2 }}>Patient Registry</h1>
          <p style={{ fontSize: 13, color: 'var(--text-subtle)', marginTop: 4 }}>
            {patients.length} {patients.length === 1 ? 'patient' : 'patients'} on record
          </p>
        </div>
        <button className="btn-primary" onClick={() => setShowModal(true)}>
          <Plus size={15} />
          Register Patient
        </button>
      </div>

      {/* Search bar */}
      <div style={{ position: 'relative', marginBottom: 20 }}>
        <Search size={15} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-subtle)', pointerEvents: 'none' }} />
        <input
          type="text"
          placeholder="Search by name or national ID…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="field-input"
          style={{ paddingLeft: 40, height: 42, fontSize: 13.5, borderRadius: 10 }}
        />
      </div>

      {/* Table */}
      <div className="card table-scroll" style={{ overflow: 'hidden' }}>
        {patients.length === 0 ? (
          <div style={{ padding: '60px 24px', textAlign: 'center' }}>
            <div style={{
              width: 56, height: 56, borderRadius: '50%', background: 'var(--bg-surface-2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px',
            }}>
              <Users size={24} color="var(--text-subtle)" />
            </div>
            <p style={{ fontWeight: 600, color: 'var(--text-body)', marginBottom: 4 }}>No patients found</p>
            <p style={{ fontSize: 13, color: 'var(--text-subtle)' }}>
              {search ? `No results for "${search}"` : 'Register your first patient to get started'}
            </p>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)' }}>
                {['Patient', 'Age / Gender', 'National ID', 'Phone', 'HIV Status', ''].map((h) => (
                  <th key={h} style={{
                    textAlign: 'left', padding: '11px 16px',
                    fontSize: 11, fontWeight: 700, color: 'var(--text-subtle)',
                    letterSpacing: '0.06em', textTransform: 'uppercase',
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {patients.map((p, i) => (
                <tr
                  key={p.id}
                  onClick={() => openPatient(p)}
                  style={{
                    borderBottom: i < patients.length - 1 ? '1px solid var(--border-light)' : 'none',
                    cursor: 'pointer',
                    transition: 'background 0.12s',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-surface)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <td style={{ padding: '13px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                      <div style={{
                        width: 36, height: 36, borderRadius: '50%',
                        background: `hsl(${(p.firstName.charCodeAt(0) * 13) % 360}, 60%, 90%)`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 13, fontWeight: 700,
                        color: `hsl(${(p.firstName.charCodeAt(0) * 13) % 360}, 55%, 38%)`,
                        flexShrink: 0,
                      }}>
                        {p.firstName.charAt(0)}{p.lastName.charAt(0)}
                      </div>
                      <div>
                        <div style={{ fontWeight: 600, color: 'var(--text-heading)', fontSize: 13.5 }}>
                          {p.firstName} {p.lastName}
                        </div>
                        <div style={{ fontSize: 11.5, color: 'var(--text-subtle)', marginTop: 1, display: 'flex', alignItems: 'center', gap: 4 }}>
                          <Calendar size={10} />
                          DOB: {new Date(p.dateOfBirth).toLocaleDateString()}
                        </div>
                      </div>
                    </div>
                  </td>

                  <td style={{ padding: '13px 16px' }}>
                    <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-body)' }}>{calcAge(p.dateOfBirth)}</span>
                    <span style={{ fontSize: 12, color: 'var(--text-subtle)', marginLeft: 4 }}>yrs</span>
                    <span style={{ marginLeft: 8, fontSize: 13, color: 'var(--text-muted)' }}>{genderIcon(p.gender)}</span>
                  </td>

                  <td style={{ padding: '13px 16px' }}>
                    {p.nationalId ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <CreditCard size={12} color="var(--text-subtle)" />
                        <span style={{ fontSize: 13, color: 'var(--text-body)', fontFamily: 'monospace', letterSpacing: '0.03em' }}>{p.nationalId}</span>
                      </div>
                    ) : (
                      <span style={{ color: 'var(--text-faint)', fontSize: 13 }}>—</span>
                    )}
                  </td>

                  <td style={{ padding: '13px 16px' }}>
                    {p.phone ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <Phone size={12} color="var(--text-subtle)" />
                        <span style={{ fontSize: 13, color: 'var(--text-body)' }}>{p.phone}</span>
                      </div>
                    ) : (
                      <span style={{ color: 'var(--text-faint)', fontSize: 13 }}>—</span>
                    )}
                  </td>

                  <td style={{ padding: '13px 16px' }}>{hivBadge(p.hivStatus)}</td>

                  <td style={{ padding: '13px 16px', textAlign: 'right' }}>
                    <div style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      fontSize: 12, color: 'var(--ses-red)', fontWeight: 600,
                    }}>
                      Open <ChevronRight size={13} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showModal && (
        <RegisterModal
          onClose={() => setShowModal(false)}
          onCreated={(p) => {
            toast.success('Patient registered successfully');
            setShowModal(false);
            openPatient(p);
          }}
        />
      )}
    </div>
  );
}
