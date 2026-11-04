import { useState, FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { isAxiosError } from 'axios';
import { Eye, EyeOff } from 'lucide-react';
import AuthLayout from '../components/auth/AuthLayout';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [credential, setCredential] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(credential.trim(), password);
      navigate('/');
    } catch (err) {
      if (isAxiosError(err)) {
        const status = err.response?.status;
        const message = err.response?.data?.error;
        if (status && [400, 401, 403, 429].includes(status) && typeof message === 'string' && message.trim()) {
          setError(message);
        } else if (!err.response) {
          setError(err.code === 'ECONNABORTED'
            ? 'The server is taking too long to respond. Please try again.'
            : 'Cannot reach the server. Check your connection and try again.');
        } else {
          setError('Unable to sign in right now. Please try again.');
        }
      } else {
        setError('Unable to sign in right now. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout>
            <h2 style={{ margin: '0 0 10px', fontFamily: 'var(--font-heading)', fontWeight: 500, fontSize: 32, letterSpacing: -0.4, color: 'var(--heading)' }}>Sign in</h2>
            <p style={{ margin: '0 0 40px', fontSize: 15, color: 'var(--muted)' }}>Welcome back. Use your staff account to continue.</p>

            {error && (
              <div role="alert" style={{ marginBottom: 20, padding: '12px 16px', borderRadius: 12, background: 'var(--badge-red-bg)', color: 'var(--badge-red-text)', fontSize: 13, lineHeight: 1.6 }}>
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label htmlFor="ses-user" style={{ fontSize: 13, fontWeight: 500, color: 'var(--label)' }}>Email or username</label>
                <input id="ses-user" className="sl-field" type="text" autoComplete="username" required
                  value={credential} onChange={(e) => setCredential(e.target.value)} />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label htmlFor="ses-pass" style={{ fontSize: 13, fontWeight: 500, color: 'var(--label)' }}>Password</label>
                <div style={{ position: 'relative' }}>
                  <input id="ses-pass" className="sl-field" type={showPassword ? 'text' : 'password'} autoComplete="current-password" required
                    value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter your password" style={{ paddingRight: 52 }} />
                  <button type="button" className="sl-eye" onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}>
                    {showPassword ? <EyeOff size={18} strokeWidth={1.8} /> : <Eye size={18} strokeWidth={1.8} />}
                  </button>
                </div>
              </div>

              <button type="submit" disabled={loading} className="sl-btn">{loading ? 'Signing in…' : 'Sign in'}</button>
            </form>

            <p style={{ margin: '36px 0 0', fontSize: 14, color: 'var(--muted)', textAlign: 'center' }}>
              New to SES EHR? <Link to="/signup">Request access</Link>
            </p>
    </AuthLayout>
  );
}
