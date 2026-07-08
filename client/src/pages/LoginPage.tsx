import { useState, FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';
import { HeartPulse, Mail, Lock, LogIn, Eye, EyeOff } from 'lucide-react';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [credential, setCredential] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await login(credential, password);
      navigate('/');
    } catch {
      toast.error('Invalid credentials');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex',
      background: 'linear-gradient(135deg, #252B2D 0%, #3D1F1F 50%, #252B2D 100%)',
    }}>
      {/* Left branding panel */}
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center',
        alignItems: 'center', padding: 48, color: '#fff',
      }}>
        <div style={{
          width: 64, height: 64, borderRadius: 16, background: 'var(--ses-red)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 8px 24px rgba(215,29,36,0.4)', marginBottom: 24,
        }}>
          <HeartPulse size={32} color="#fff" />
        </div>
        <h1 style={{ fontSize: 32, fontWeight: 800, letterSpacing: '-0.5px', marginBottom: 8 }}>SES EHR</h1>
        <p style={{ fontSize: 14, color: '#94a3b8', textAlign: 'center', maxWidth: 280, lineHeight: 1.6 }}>
          Specialty Emergency Services<br />Chronic Disease Management System
        </p>

        <div style={{ marginTop: 48, display: 'flex', flexDirection: 'column', gap: 16, width: '100%', maxWidth: 280 }}>
          {[
            { label: 'Longitudinal patient care', desc: 'Track disease progression over time' },
            { label: 'Integrated workflows', desc: 'Labs, pharmacy, billing in one place' },
            { label: 'ICD-11 coded diagnoses', desc: 'Structured clinical documentation' },
          ].map((f) => (
            <div key={f.label} style={{ display: 'flex', gap: 12 }}>
              <div style={{
                width: 8, height: 8, borderRadius: '50%', background: 'var(--ses-red)',
                flexShrink: 0, marginTop: 5,
              }} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>{f.label}</div>
                <div style={{ fontSize: 12, color: '#64748b', marginTop: 1 }}>{f.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Right login panel */}
      <div style={{
        width: 420, background: 'var(--bg-card)', display: 'flex', flexDirection: 'column',
        justifyContent: 'center', padding: '48px 40px',
        boxShadow: '-4px 0 40px rgba(0,0,0,0.3)',
        transition: 'background-color 0.2s',
      }}>
        <div style={{ marginBottom: 32 }}>
          <h2 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-heading)', marginBottom: 6 }}>Welcome back</h2>
          <p style={{ fontSize: 13.5, color: 'var(--text-subtle)' }}>Sign in to your clinician account</p>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-body)', marginBottom: 6 }}>
              Email or Username
            </label>
            <div style={{ position: 'relative' }}>
              <Mail size={14} style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-subtle)' }} />
              <input
                type="text"
                value={credential}
                onChange={(e) => setCredential(e.target.value)}
                required
                className="field-input"
                style={{ paddingLeft: 38 }}
                placeholder="Enter your email or username"
              />
            </div>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-body)', marginBottom: 6 }}>
              Password
            </label>
            <div style={{ position: 'relative' }}>
              <Lock size={14} style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-subtle)' }} />
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="field-input"
                style={{ paddingLeft: 38, paddingRight: 40 }}
                placeholder="••••••••"
              />
              <button
                type="button"
                onClick={() => setShowPassword(v => !v)}
                style={{
                  position: 'absolute', right: 11, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer', padding: 2,
                  color: 'var(--text-subtle)', display: 'flex', alignItems: 'center',
                }}
                tabIndex={-1}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>

          <button type="submit" disabled={loading} className="btn-primary" style={{ width: '100%', justifyContent: 'center', height: 42, fontSize: 14, marginTop: 4 }}>
            <LogIn size={15} />
            {loading ? 'Signing in…' : 'Sign In'}
          </button>

          <div style={{ textAlign: 'center', paddingTop: 4 }}>
            <span style={{ fontSize: 12.5, color: 'var(--text-subtle)' }}>Don't have an account? </span>
            <Link to="/signup" style={{ fontSize: 12.5, color: 'var(--ses-red)', fontWeight: 600, textDecoration: 'none' }}>
              Sign up here
            </Link>
          </div>
        </form>

        <div style={{ marginTop: 'auto', paddingTop: 40, borderTop: '1px solid var(--border-light)', textAlign: 'center' }}>
          <p style={{ fontSize: 11.5, color: 'var(--text-subtle)' }}>
            SES Chronic Disease Management EHR · v1.0
          </p>
        </div>
      </div>
    </div>
  );
}
