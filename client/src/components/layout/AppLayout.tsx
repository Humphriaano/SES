import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import TopNav from './TopNav';
import PatientBanner from './PatientBanner';
import QueuePanel from '../QueuePanel';
import { useQueueDrawerToggle } from '../../lib/queue';
import { loadCustomCatalogue } from '../../lib/customCatalogue';
import { useAuth } from '../../context/AuthContext';
import { canAccessModule } from '../../lib/moduleAccess';

export default function AppLayout() {
  const { user } = useAuth();
  const location = useLocation();
  const isPatientPage = location.pathname.startsWith('/patient/');
  const [queueOpen, setQueueOpen] = useState(false);
  useQueueDrawerToggle(() => setQueueOpen(v => !v));
  useEffect(() => { loadCustomCatalogue(); }, []);   // drugs, tests and diagnoses staff have added

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <TopNav />
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <main style={{ flex: 1, minWidth: 0, overflowY: 'auto', background: 'var(--bg-page)', transition: 'background-color 0.2s' }}>
          {isPatientPage && <PatientBanner />}
          <Outlet />
        </main>
      </div>

      {/* Queue slide-out panel */}
      {canAccessModule(user?.role, 'home') && <QueuePanel open={queueOpen} onClose={() => setQueueOpen(false)} />}
    </div>
  );
}
