import { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import TopNav from './TopNav';
import SidePanel from './SidePanel';
import QueuePanel from '../QueuePanel';
import { usePatient } from '../../context/PatientContext';
import { useWindowSize } from '../../hooks/useWindowSize';
import { Users } from 'lucide-react';

export default function AppLayout() {
  const { activePatient } = usePatient();
  const { isMobile } = useWindowSize();
  const location = useLocation();
  const isConsultation = location.pathname.endsWith('/consultation');
  const [queueOpen, setQueueOpen] = useState(false);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <TopNav />
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <main style={{ flex: 1, overflowY: 'auto', background: 'var(--bg-page)', transition: 'background-color 0.2s' }}>
          <Outlet />
        </main>
        {/* SidePanel only shown on desktop — consultation has its own sidebar */}
        {activePatient && !isConsultation && !isMobile && <SidePanel />}
      </div>

      {/* Queue tab button — left edge, vertically centred */}
      <button
        onClick={() => setQueueOpen(v => !v)}
        title="Patient Queue"
        style={{
          position: 'fixed',
          left: 0,
          top: '50%',
          transform: 'translateY(-50%)',
          zIndex: 46,
          background: queueOpen ? 'var(--ses-red)' : 'var(--bg-nav)',
          color: '#fff',
          border: 'none',
          borderRadius: '0 8px 8px 0',
          padding: isMobile ? '16px 9px' : '14px 7px',
          cursor: 'pointer',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 6,
          boxShadow: '2px 0 12px rgba(0,0,0,0.18)',
          transition: 'background 0.2s',
          touchAction: 'manipulation',
        }}
      >
        <Users size={isMobile ? 16 : 14} color="#fff" />
        <span style={{
          fontSize: 10.5,
          fontWeight: 700,
          writingMode: 'vertical-rl',
          transform: 'rotate(180deg)',
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
        }}>
          Queue
        </span>
      </button>

      {/* Queue slide-out panel */}
      <QueuePanel open={queueOpen} onClose={() => setQueueOpen(false)} />
    </div>
  );
}
