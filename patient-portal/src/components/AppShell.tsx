import { Outlet } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { Toaster } from 'react-hot-toast';
import BottomNav from './BottomNav';
import UpdateToast from './UpdateToast';
import OnboardingPrompts from './OnboardingPrompts';
import { initServiceWorker } from '../pwa';

export default function AppShell() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [applyUpdate, setApplyUpdate] = useState<(() => void) | null>(null);

  useEffect(() => {
    const apply = initServiceWorker(() => setUpdateAvailable(true));
    setApplyUpdate(() => apply);
  }, []);

  return (
    <div className="app-shell">
      <Toaster position="top-center" toastOptions={{ style: { fontFamily: 'Inter, sans-serif', fontSize: 13.5 } }} />
      <div className="screen">
        <Outlet />
      </div>
      {updateAvailable && applyUpdate && <UpdateToast onRefresh={applyUpdate} />}
      {!updateAvailable && <OnboardingPrompts />}
      <BottomNav />
    </div>
  );
}
