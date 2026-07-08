import { useEffect, useState } from 'react';
import { Download, Share, Bell, X } from 'lucide-react';
import {
  getDeferredInstallPrompt, onInstallPromptCaptured, isRunningStandalone, isIOS,
} from '../lib/installPrompt';
import { enablePush, pushSupported } from '../lib/push';

const ONBOARDING_KEY = 'portal:onboardingDone';

type Stage = 'install' | 'notifications' | 'done';

/**
 * Runs once after first successful login: a friendly install card (Android
 * gets the real install prompt; iOS gets Share → Add to Home Screen
 * instructions), then a soft ask explaining push before the real permission
 * prompt fires — a bare browser prompt with no context tends to get denied
 * and can't easily be re-asked.
 */
export default function OnboardingPrompts() {
  const [stage, setStage] = useState<Stage>(() => (localStorage.getItem(ONBOARDING_KEY) ? 'done' : 'install'));
  const [installReady, setInstallReady] = useState(!!getDeferredInstallPrompt());

  useEffect(() => onInstallPromptCaptured(() => setInstallReady(true)), []);

  function finishOnboarding() {
    localStorage.setItem(ONBOARDING_KEY, '1');
    setStage('done');
  }

  function skipToNotifications() {
    setStage((prev) => (prev === 'install' ? 'notifications' : prev));
  }

  if (stage === 'done') return null;

  if (stage === 'install') {
    if (isRunningStandalone()) { skipToNotifications(); return null; }
    if (isIOS()) {
      return (
        <div className="toast-banner" style={{ bottom: 84, alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', gap: 10 }}>
            <Share size={16} style={{ flexShrink: 0, marginTop: 2 }} />
            <div>
              <div style={{ fontWeight: 600, marginBottom: 2 }}>Add SES Health to your home screen</div>
              <div style={{ fontSize: 12, opacity: 0.85 }}>Tap Share, then "Add to Home Screen" for one-tap access next time.</div>
            </div>
          </div>
          <button onClick={skipToNotifications} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', flexShrink: 0 }}>
            <X size={16} />
          </button>
        </div>
      );
    }
    if (installReady) {
      return (
        <div className="toast-banner">
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <Download size={16} style={{ flexShrink: 0 }} />
            <div>
              <div style={{ fontWeight: 600 }}>Add SES Health to your home screen</div>
              <div style={{ fontSize: 12, opacity: 0.85 }}>Quick access to your numbers, anytime.</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <button
              onClick={async () => {
                const prompt = getDeferredInstallPrompt();
                await prompt?.prompt();
                skipToNotifications();
              }}
              style={{ background: 'var(--orange)', color: '#fff', border: 'none', borderRadius: 8, padding: '7px 14px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}
            >
              Add
            </button>
            <button onClick={skipToNotifications} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer' }}>
              <X size={16} />
            </button>
          </div>
        </div>
      );
    }
    // No install prompt available on this browser — move on.
    skipToNotifications();
    return null;
  }

  if (stage === 'notifications') {
    if (!pushSupported() || Notification.permission !== 'default') { finishOnboarding(); return null; }
    return (
      <div className="toast-banner" style={{ alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', gap: 10 }}>
          <Bell size={16} style={{ flexShrink: 0, marginTop: 2 }} />
          <div>
            <div style={{ fontWeight: 600, marginBottom: 2 }}>Get appointment reminders</div>
            <div style={{ fontSize: 12, opacity: 0.85 }}>We'll notify you before visits and when your monthly check-in is ready.</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <button
            onClick={async () => { await enablePush().catch(() => {}); finishOnboarding(); }}
            style={{ background: 'var(--orange)', color: '#fff', border: 'none', borderRadius: 8, padding: '7px 14px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}
          >
            Enable
          </button>
          <button onClick={finishOnboarding} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer' }}>
            <X size={16} />
          </button>
        </div>
      </div>
    );
  }

  return null;
}
