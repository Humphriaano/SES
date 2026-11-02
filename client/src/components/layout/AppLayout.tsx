import { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import TopNav from './TopNav';
import SidePanel from './SidePanel';
import PatientBanner from './PatientBanner';
import QueuePanel from '../QueuePanel';
import { usePatient } from '../../context/PatientContext';
import { useWindowSize } from '../../hooks/useWindowSize';
import { useQueueDrawerToggle } from '../../lib/queue';

export default function AppLayout() {
  const { activePatient } = usePatient();
  const { isMobile } = useWindowSize();
  const location = useLocation();
  const isConsultation = location.pathname.endsWith('/consultation');
  const isVitals = location.pathname.endsWith('/vitals');
  const isPatientPage = location.pathname.startsWith('/patient/');
  const [queueOpen, setQueueOpen] = useState(false);
  useQueueDrawerToggle(() => setQueueOpen(v => !v));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <TopNav />
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <main style={{ flex: 1, overflowY: 'auto', background: 'var(--bg-page)', transition: 'background-color 0.2s' }}>
          {isPatientPage && <PatientBanner />}
          <Outlet />
        </main>
        {/* SidePanel only shown on desktop — consultation has its own sidebar,
            and the redesigned Vitals page is full-width under the patient banner */}
        {activePatient && isPatientPage && !isConsultation && !isVitals && !isMobile && <SidePanel />}
      </div>

      {/* Queue slide-out panel */}
      <QueuePanel open={queueOpen} onClose={() => setQueueOpen(false)} />
    </div>
  );
}
