import type { ReactNode } from 'react';
import { useTheme } from '../../context/ThemeContext';
import ThemeSwatches from '../ThemeSwatches';
import './AuthLayout.css';

export default function AuthLayout({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  const { theme } = useTheme();
  return (
    <div className="sl" data-t={theme}>
      <section className="sl-brand">
        <img className="sl-mark-bg" src="/ses-mark.svg" alt="" aria-hidden="true"
          style={{ position: 'absolute', right: -170, top: 150, width: 540, height: 'auto', opacity: 'var(--mark-op)' as unknown as number, pointerEvents: 'none' }} />

        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 16 }}>
          <img src="/ses-mark.svg" alt="SES" style={{ width: 72, height: 'auto', display: 'block' }} />
          <div style={{ paddingLeft: 16, borderLeft: '1px solid var(--mark-line)' }}>
            <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 500, fontSize: 28, lineHeight: 1, letterSpacing: 1 }}>SES</div>
            <div style={{ fontSize: 11, color: 'var(--panel-sub)', marginTop: 6, letterSpacing: 0.4 }}>Protecting Health · Securing Lives</div>
          </div>
        </div>

        <div className="sl-copy" style={{ position: 'relative', maxWidth: 480 }}>
          <p style={{ margin: '0 0 20px', fontFamily: 'var(--font-heading)', fontSize: 12, fontWeight: 500, letterSpacing: 2.4, textTransform: 'uppercase', color: 'var(--eyebrow)' }}>
            SES EHR · Chronic Care
          </p>
          <h1 style={{ margin: '0 0 20px', fontFamily: 'var(--font-heading)', fontWeight: 500, fontSize: 48, lineHeight: 1.1, letterSpacing: -0.8, color: '#fff' }}>
            Chronic disease care, in one record.
          </h1>
          <p style={{ margin: 0, fontSize: 16, lineHeight: 1.65, color: 'var(--panel-sub)', maxWidth: 400 }}>
            Every visit, result and prescription — together, for every patient.
          </p>
        </div>
      </section>
      <main className="sl-form-wrap">
        <div className="sl-toolbar"><ThemeSwatches size={22} /></div>
        <div className={wide ? 'sl-content sl-content-wide' : 'sl-content'}>{children}</div>
        <footer className="sl-footer"><span>© Specialty Emergency Services</span><span>Authorised staff only · v1.0</span></footer>
      </main>
    </div>
  );
}
