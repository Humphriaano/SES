import type { ReactNode } from 'react';
import { WifiOff } from 'lucide-react';

export default function EmptyState({ icon, title, body }: { icon?: ReactNode; title: string; body: string }) {
  return (
    <div className="empty-state">
      <div style={{ marginBottom: 10, display: 'flex', justifyContent: 'center' }}>{icon}</div>
      <h3 style={{ fontSize: 16, marginBottom: 6 }}>{title}</h3>
      <p style={{ fontSize: 13.5, lineHeight: 1.5 }}>{body}</p>
    </div>
  );
}

export function OfflineNoDataState() {
  return (
    <EmptyState
      icon={<WifiOff size={28} color="var(--text-muted)" />}
      title="You're offline"
      body="We don't have this saved on your device yet. Connect to the internet once to load it, and it'll be here next time you're offline."
    />
  );
}
