import { useOnlineStatus } from '../hooks/useOnlineStatus';

function formatTime(iso: string | null): string {
  if (!iso) return 'earlier';
  return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
}

export default function OfflineBanner({ lastUpdated }: { lastUpdated: string | null }) {
  const online = useOnlineStatus();
  if (online) return null;
  return (
    <div className="offline-banner">
      Last updated {formatTime(lastUpdated)} — offline
    </div>
  );
}
