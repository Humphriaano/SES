import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AlertCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function AuthCallbackPage() {
  const [params] = useSearchParams();
  const { exchangeToken } = useAuth();
  const navigate = useNavigate();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const token = params.get('token');
    if (!token) { setFailed(true); return; }
    exchangeToken(token).then((ok) => {
      if (ok) navigate('/', { replace: true });
      else setFailed(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (failed) {
    return (
      <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center' }}>
        <AlertCircle size={32} color="var(--red-text)" style={{ marginBottom: 12 }} />
        <h3 style={{ fontSize: 16, marginBottom: 6 }}>This link isn't working</h3>
        <p style={{ fontSize: 13.5, color: 'var(--text-subtle)', marginBottom: 18, maxWidth: 280 }}>
          It may have expired or already been used. Sign-in links work once and last 15 minutes.
        </p>
        <button className="btn-primary" onClick={() => navigate('/login', { replace: true })}>Request a new link</button>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ fontSize: 13.5, color: 'var(--text-subtle)' }}>Signing you in…</p>
    </div>
  );
}
