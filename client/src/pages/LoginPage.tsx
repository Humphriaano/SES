import { useState, FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';
import { Eye, EyeOff } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import ThemeSwatches from '../components/ThemeSwatches';

const CSS = `
.sl{--accent:#C41E25;--accent-glow:rgba(196,30,37,.32);--accent-shadow:rgba(196,30,37,.22);
  display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);min-height:100vh;
  font-family:'Open Sans',system-ui,sans-serif;color:var(--fg);background:var(--page)}
.sl[data-t="light"]{--page:#FFFFFF;--panel:#1E2124;--panel-border:transparent;--fg:#16181A;--heading:#16181A;--muted:#5A6066;--label:#2A2E32;
  --field:#F5F6F8;--field-border:#E3E6EA;--field-focus:#FFFFFF;--ph:#6B7178;--link:#1F5F96;--link-hover:#174A75;--ring:#2671AE;--ring-glow:rgba(38,113,174,.12);
  --eye:#6B7178;--eye-hover:rgba(0,0,0,.05);--footer:#6B7178;--eyebrow:#F08A8F;--panel-sub:#A3AAB1;--mark-op:.05;--mark-line:rgba(255,255,255,.18);--scheme:light}
.sl[data-t="charcoal"]{--page:#111315;--panel:#181B1E;--panel-border:#23272B;--fg:#F2F3F4;--heading:#FFFFFF;--muted:#A3AAB1;--label:#E4E6E8;
  --field:#1A1D20;--field-border:#2A2F33;--field-focus:#1A1D20;--ph:#858C93;--link:#7DB4E6;--link-hover:#A9CDEF;--ring:#4A92D0;--ring-glow:rgba(74,146,208,.18);
  --eye:#858C93;--eye-hover:rgba(255,255,255,.06);--footer:#858C93;--eyebrow:#7DB4E6;--panel-sub:#A3AAB1;--mark-op:.05;--mark-line:rgba(255,255,255,.15);--scheme:dark;
  --accent-glow:rgba(196,30,37,.4);--accent-shadow:rgba(196,30,37,.3)}
.sl[data-t="blue"]{--page:#121416;--panel:#1F5F96;--panel-border:transparent;--fg:#F2F3F4;--heading:#FFFFFF;--muted:#A3AAB1;--label:#E4E6E8;
  --field:#1B1E21;--field-border:#2C3135;--field-focus:#1B1E21;--ph:#858C93;--link:#7DB4E6;--link-hover:#A9CDEF;--ring:#4A92D0;--ring-glow:rgba(74,146,208,.18);
  --eye:#858C93;--eye-hover:rgba(255,255,255,.06);--footer:#858C93;--eyebrow:#CFE0F0;--panel-sub:#CFE0F0;--mark-op:.08;--mark-line:rgba(255,255,255,.25);--scheme:dark;
  --accent-glow:rgba(196,30,37,.4);--accent-shadow:rgba(196,30,37,.3)}
.sl *{box-sizing:border-box}
.sl a{color:var(--link);text-decoration:none;font-weight:600}.sl a:hover{color:var(--link-hover)}
.sl-brand{position:relative;overflow:hidden;background:var(--panel);color:#fff;padding:56px 72px 64px;display:flex;flex-direction:column;justify-content:space-between;min-height:100vh;border-right:1px solid var(--panel-border)}
.sl-field{width:100%;height:52px;padding:0 16px;border:1px solid var(--field-border);border-radius:12px;background:var(--field);font:inherit;font-size:15px;color:var(--fg);outline:0;color-scheme:var(--scheme);transition:border-color .15s,background .15s,box-shadow .15s}
.sl-field::placeholder{color:var(--ph)}
.sl-field:focus{background:var(--field-focus);border-color:var(--ring);box-shadow:0 0 0 4px var(--ring-glow)}
.sl-btn{height:52px;margin-top:8px;border:0;border-radius:12px;background:var(--accent);color:#fff;font-family:Montserrat,sans-serif;font-size:15px;font-weight:700;letter-spacing:.3px;cursor:pointer;box-shadow:0 6px 16px var(--accent-shadow);transition:transform .15s,box-shadow .15s,filter .15s}
.sl-btn:hover:not(:disabled){filter:brightness(1.06);box-shadow:0 10px 24px var(--accent-glow)}
.sl-btn:active:not(:disabled){transform:translateY(1px)}
.sl-btn:disabled{opacity:.7;cursor:default}
.sl-eye{position:absolute;right:6px;top:6px;width:40px;height:40px;border:0;border-radius:8px;background:transparent;display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--eye)}
.sl-eye:hover{background:var(--eye-hover)}
@media (max-width:900px){
.sl{grid-template-columns:1fr}
.sl-brand{min-height:auto;padding:28px 24px;border-right:0}
.sl-copy,.sl-mark-bg{display:none}
.sl-form-wrap{padding:32px 24px !important}
}`;

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [credential, setCredential] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const { theme } = useTheme();

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
    <div className="sl" data-t={theme}>
      <style>{CSS}</style>

      <section className="sl-brand">
        <img className="sl-mark-bg" src="/ses-mark.svg" alt="" aria-hidden="true"
          style={{ position: 'absolute', right: -170, top: 150, width: 540, height: 'auto', opacity: 'var(--mark-op)' as unknown as number, pointerEvents: 'none' }} />

        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 16 }}>
          <img src="/ses-mark.svg" alt="SES" style={{ width: 72, height: 'auto', display: 'block' }} />
          <div style={{ paddingLeft: 16, borderLeft: '1px solid var(--mark-line)' }}>
            <div style={{ fontFamily: 'Montserrat, sans-serif', fontWeight: 800, fontSize: 28, lineHeight: 1, letterSpacing: 1 }}>SES</div>
            <div style={{ fontSize: 11, color: 'var(--panel-sub)', marginTop: 6, letterSpacing: 0.4 }}>Protecting Health · Securing Lives</div>
          </div>
        </div>

        <div className="sl-copy" style={{ position: 'relative', maxWidth: 480 }}>
          <p style={{ margin: '0 0 20px', fontFamily: 'Montserrat, sans-serif', fontSize: 12, fontWeight: 700, letterSpacing: 2.4, textTransform: 'uppercase', color: 'var(--eyebrow)' }}>
            SES EHR · Chronic Care
          </p>
          <h1 style={{ margin: '0 0 20px', fontFamily: 'Montserrat, sans-serif', fontWeight: 700, fontSize: 48, lineHeight: 1.1, letterSpacing: -0.8, color: '#fff' }}>
            Chronic disease care, in one record.
          </h1>
          <p style={{ margin: 0, fontSize: 16, lineHeight: 1.65, color: 'var(--panel-sub)', maxWidth: 400 }}>
            Every visit, result and prescription — together, for every patient.
          </p>
        </div>
      </section>

      <main className="sl-form-wrap" style={{ display: 'flex', flexDirection: 'column', padding: '40px 72px', background: 'var(--page)' }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}><ThemeSwatches size={22} /></div>

        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '48px 0' }}>
          <div style={{ width: '100%', maxWidth: 380 }}>
            <h2 style={{ margin: '0 0 10px', fontFamily: 'Montserrat, sans-serif', fontWeight: 700, fontSize: 32, letterSpacing: -0.4, color: 'var(--heading)' }}>Sign in</h2>
            <p style={{ margin: '0 0 40px', fontSize: 15, color: 'var(--muted)' }}>Welcome back. Use your staff account to continue.</p>

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label htmlFor="ses-user" style={{ fontSize: 13, fontWeight: 600, color: 'var(--label)' }}>Email or username</label>
                <input id="ses-user" className="sl-field" type="text" autoComplete="username" required
                  value={credential} onChange={(e) => setCredential(e.target.value)} />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label htmlFor="ses-pass" style={{ fontSize: 13, fontWeight: 600, color: 'var(--label)' }}>Password</label>
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
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, fontSize: 12, color: 'var(--footer)' }}>
          <span>© Specialty Emergency Services</span>
          <span>Authorised staff only · v1.0</span>
        </div>
      </main>
    </div>
  );
}
