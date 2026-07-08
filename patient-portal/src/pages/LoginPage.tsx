import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Mail, HeartPulse } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

export default function LoginPage() {
  const { patient, loading, requestLink } = useAuth();
  const online = useOnlineStatus();
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!loading && patient) return <Navigate to="/" replace />;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!online) { setError("You're offline — signing in needs a connection."); return; }
    setSubmitting(true);
    setError(null);
    try {
      await requestLink(email.trim());
      setSent(true);
    } catch {
      setError('Something went wrong. Please try again in a moment.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '32px 24px', maxWidth: 420, margin: '0 auto' }}>
      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <div style={{ width: 56, height: 56, borderRadius: 16, background: 'var(--navy)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
          <HeartPulse size={26} color="var(--orange)" />
        </div>
        <h1 style={{ fontSize: 24, marginBottom: 6 }}>SES Health</h1>
        <p style={{ fontSize: 14, color: 'var(--text-subtle)' }}>Your health, between visits.</p>
      </div>

      {sent ? (
        <div className="card" style={{ textAlign: 'center' }}>
          <Mail size={28} color="var(--orange)" style={{ marginBottom: 10 }} />
          <h3 style={{ fontSize: 16, marginBottom: 8 }}>Check your email</h3>
          <p style={{ fontSize: 13.5, color: 'var(--text-subtle)', lineHeight: 1.5 }}>
            If <strong>{email.trim()}</strong> is registered for portal access, we've sent a sign-in link. It works once and expires in 15 minutes.
          </p>
          <button className="btn-ghost" style={{ marginTop: 14 }} onClick={() => setSent(false)}>Use a different email</button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-heading)' }}>
            Email address
            <input
              type="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="field-input"
              style={{ marginTop: 6 }}
            />
          </label>
          {error && <p style={{ fontSize: 12.5, color: 'var(--red-text)' }}>{error}</p>}
          <button type="submit" className="btn-primary" disabled={submitting || !email.trim()}>
            {submitting ? 'Sending…' : 'Send sign-in link'}
          </button>
          <p style={{ fontSize: 11.5, color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.5 }}>
            No password needed. Portal access is set up by your care team — ask your clinic if you don't have it yet.
          </p>
        </form>
      )}
    </div>
  );
}
