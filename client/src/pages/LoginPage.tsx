import { useState, FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import toast from 'react-hot-toast';
import { Mail, Lock, LogIn, Eye, EyeOff } from 'lucide-react';
import EyeLogo from '../components/EyeLogo';

export default function LoginPage() {
  const { login } = useAuth();
  const { isDark } = useTheme();
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

  /* Polarity: right panel mirrors the header/sidebar rule */
  const panelBg   = isDark ? '#FFFFFF' : '#000000';
  const panelText = isDark ? '#000000' : '#FFFFFF';
  const panelMuted = isDark ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.55)';
  const inputBorder = isDark ? '1px solid #000000' : '1px solid #FFFFFF';
  const inputBg     = isDark ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.08)';
  const inputFocusBg = isDark ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.12)';

  return (
    <div style={{ minHeight: '100vh', display: 'flex' }}>

      {/* Left branding panel — always deep AMOLED black */}
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center',
        alignItems: 'center', padding: 48, color: '#fff',
        background: '#05050A',
      }}>
        {/* Eye logo — white structural lines on AMOLED black, accent iris */}
        <EyeLogo width={140} color="#FFFFFF" style={{ marginBottom: 20 }} />

        <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.3px', marginBottom: 28, color: '#FFFFFF' }}>
          Demo EHR
        </h1>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, width: '100%', maxWidth: 280 }}>
          {[
            { label: 'Longitudinal patient care', desc: 'Track disease progression over time' },
            { label: 'Integrated workflows',       desc: 'Labs, pharmacy, billing in one place' },
            { label: 'ICD-11 coded diagnoses',     desc: 'Structured clinical documentation' },
          ].map((f) => (
            <div key={f.label} style={{ display: 'flex', gap: 12 }}>
              <div style={{
                width: 2, background: 'var(--accent)',
                flexShrink: 0, alignSelf: 'stretch',
              }} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>{f.label}</div>
                <div style={{ fontSize: 12, color: '#64748b', marginTop: 1 }}>{f.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Right login panel — polarity: white in dark mode, black in light mode */}
      <div style={{
        width: 420, background: panelBg, display: 'flex', flexDirection: 'column',
        justifyContent: 'center', padding: '48px 40px',
        boxShadow: '-4px 0 40px rgba(0,0,0,0.3)',
        transition: 'background-color 0.2s',
      }}>
        <div style={{ marginBottom: 32 }}>
          <h2 style={{ fontSize: 22, fontWeight: 700, color: panelText, marginBottom: 6 }}>Welcome back</h2>
          <p style={{ fontSize: 13.5, color: panelMuted }}>Sign in to your clinician account</p>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* Email / username */}
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: panelText, marginBottom: 6 }}>
              Email or Username
            </label>
            <div style={{ position: 'relative' }}>
              <Mail size={14} style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', color: panelMuted, pointerEvents: 'none' }} />
              <input
                type="text"
                value={credential}
                onChange={(e) => setCredential(e.target.value)}
                required
                placeholder="Enter your email or username"
                style={{
                  width: '100%', paddingLeft: 38, paddingRight: 14,
                  padding: '10px 14px 10px 38px',
                  border: inputBorder,
                  background: inputBg,
                  color: panelText,
                  fontSize: 13.5, outline: 'none',
                  transition: 'background 0.15s',
                }}
                onFocus={e => { e.currentTarget.style.background = inputFocusBg; }}
                onBlur={e => { e.currentTarget.style.background = inputBg; }}
              />
            </div>
          </div>

          {/* Password */}
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: panelText, marginBottom: 6 }}>
              Password
            </label>
            <div style={{ position: 'relative' }}>
              <Lock size={14} style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', color: panelMuted, pointerEvents: 'none' }} />
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                placeholder="••••••••"
                style={{
                  width: '100%',
                  padding: '10px 40px 10px 38px',
                  border: inputBorder,
                  background: inputBg,
                  color: panelText,
                  fontSize: 13.5, outline: 'none',
                  transition: 'background 0.15s',
                }}
                onFocus={e => { e.currentTarget.style.background = inputFocusBg; }}
                onBlur={e => { e.currentTarget.style.background = inputBg; }}
              />
              <button
                type="button"
                onClick={() => setShowPassword(v => !v)}
                style={{
                  position: 'absolute', right: 11, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer', padding: 2,
                  color: panelMuted, display: 'flex', alignItems: 'center',
                }}
                tabIndex={-1}
              >
                {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>

          {/* Sign In button — solid accent, sharp */}
          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%', height: 44,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              background: '#2979FF', color: '#fff',
              border: 'none', fontSize: 14, fontWeight: 700,
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.7 : 1,
              marginTop: 4,
              transition: 'background 0.15s',
            }}
            onMouseEnter={e => { if (!loading) e.currentTarget.style.background = '#1565C0'; }}
            onMouseLeave={e => { e.currentTarget.style.background = '#2979FF'; }}
          >
            <LogIn size={15} />
            {loading ? 'Signing in…' : 'Sign In'}
          </button>

          <div style={{ textAlign: 'center', paddingTop: 4 }}>
            <span style={{ fontSize: 12.5, color: panelMuted }}>Don't have an account? </span>
            <Link to="/signup" style={{ fontSize: 12.5, color: '#2979FF', fontWeight: 600, textDecoration: 'none' }}>
              Sign up here
            </Link>
          </div>
        </form>

        <div style={{ marginTop: 'auto', paddingTop: 40, borderTop: `1px solid ${isDark ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.12)'}`, textAlign: 'center' }}>
          <p style={{ fontSize: 11.5, color: panelMuted }}>
            Demo EHR · v1.0
          </p>
        </div>
      </div>
    </div>
  );
}
