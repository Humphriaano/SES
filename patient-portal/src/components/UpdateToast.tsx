import { RefreshCw } from 'lucide-react';

export default function UpdateToast({ onRefresh }: { onRefresh: () => void }) {
  return (
    <div className="toast-banner">
      <span>A new version is ready.</span>
      <button
        onClick={onRefresh}
        style={{ background: 'var(--orange)', color: '#fff', border: 'none', borderRadius: 8, padding: '7px 14px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}
      >
        <RefreshCw size={13} /> Refresh
      </button>
    </div>
  );
}
