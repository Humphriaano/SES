import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Users, Activity, FlaskConical, CheckCircle, Package, Pill, Wallet } from 'lucide-react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { hasRole } from '../lib/money';
import ReportsAIPanel from '../components/reports/ReportsAIPanel';
import InsightPanel from '../components/reports/InsightPanel';
import './ReportsPage.css';

const T = {
  pageBg: 'var(--bg-page)',
  cardBg: 'var(--bg-card)',
  cardBorder: '1px solid var(--border)',
  title: 'var(--text-heading)',
  muted: 'var(--text-muted)',
  font: 'var(--font-body)',
};

interface KpiData {
  totalPatients: number;
  bySex: { gender: string; count: number }[];
  activeDiagnoses: number;
  mostCommonDiagnosis: string;
  pendingInvestigations: number;
  inProgressInvestigations: number;
  resultedInvestigations: number;
  dispensedToday: number;
  dispensedThisMonth: number;
  prescriptionsThisMonth: number;
}

function KpiCard({
  icon, value, label, subtitle, loading,
}: {
  icon: React.ReactNode;
  value: string | number;
  label: string;
  subtitle?: string;
  loading?: boolean;
}) {
  return (
    <div style={{
      background: T.cardBg, borderRadius: 14, border: T.cardBorder,
      padding: '14px 16px', flex: 1, minWidth: 0,
      boxShadow: '0 1px 3px var(--shadow-sm)',
    }}>
      <div style={{ color: 'var(--ses-red)', marginBottom: 6 }}>{icon}</div>
      {loading ? (
        <div style={{ height: 28, width: 48, borderRadius: 6, background: 'var(--bg-surface-2)', marginBottom: 6 }} />
      ) : (
        <div style={{ fontSize: 26, fontWeight: 500, color: 'var(--ses-red)', lineHeight: 1, marginBottom: 4 }}>{value}</div>
      )}
      <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-body)' }}>{label}</div>
      {subtitle && (
        <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{subtitle}</div>
      )}
    </div>
  );
}

export default function ReportsPage() {
  const { user } = useAuth();
  const [kpi, setKpi] = useState<KpiData | null>(null);
  const [kpiLoading, setKpiLoading] = useState(true);

  useEffect(() => {
    api.get('/reports/population/kpis')
      .then((r) => setKpi(r.data))
      .catch(() => {})
      .finally(() => setKpiLoading(false));
  }, []);

  const sexSummary = kpi
    ? kpi.bySex.map((s) => `${s.count} ${s.gender.charAt(0) + s.gender.slice(1).toLowerCase()}`).join(' · ')
    : '';

  return (
    <div className="reports-page clinical-module">

      {/* ── Page header ── */}
      <div className="reports-header">
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 500, color: T.title, margin: '0 0 2px' }}>Reports & Analytics</h1>
          <p style={{ fontSize: 13, color: T.muted, margin: 0 }}>Population level insights across all patients</p>
        </div>
        {hasRole(user?.role, 'admin', 'billing') && (
          <Link to="/billing/reports" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 36, padding: '0 14px', borderRadius: 8, border: '1px solid var(--border)', background: T.cardBg, color: T.title, fontSize: 13, fontWeight: 500, textDecoration: 'none' }}>
            <Wallet size={15} /> Billing reports
          </Link>
        )}
      </div>

      {/* ── KPI cards row ── */}
      <div className="reports-kpis">
        <KpiCard
          icon={<Users size={18} />}
          value={kpi?.totalPatients ?? '—'}
          label="Total Patients"
          subtitle={sexSummary || undefined}
          loading={kpiLoading}
        />
        <KpiCard
          icon={<Activity size={18} />}
          value={kpi?.activeDiagnoses ?? '—'}
          label="Active Diagnoses"
          subtitle={kpi?.mostCommonDiagnosis}
          loading={kpiLoading}
        />
        <KpiCard
          icon={<Pill size={18} />}
          value={kpi?.prescriptionsThisMonth ?? '—'}
          label="Prescriptions"
          subtitle="This month"
          loading={kpiLoading}
        />
        <KpiCard
          icon={<FlaskConical size={18} />}
          value={kpi?.pendingInvestigations ?? '—'}
          label="Pending Labs"
          subtitle={kpi ? `${kpi.inProgressInvestigations} in progress` : undefined}
          loading={kpiLoading}
        />
        <KpiCard
          icon={<CheckCircle size={18} />}
          value={kpi?.resultedInvestigations ?? '—'}
          label="Resulted Labs"
          loading={kpiLoading}
        />
        <KpiCard
          icon={<Package size={18} />}
          value={kpi?.dispensedToday ?? '—'}
          label="Dispensed Today"
          subtitle={kpi ? `${kpi.dispensedThisMonth} this month` : undefined}
          loading={kpiLoading}
        />
      </div>

      {/* ── Two-column area ── */}
      <div className="reports-columns">

        {/* Left: auto-generated insight panels (60%) */}
        <div className="reports-insights">
          <p style={{ fontSize: 11, fontWeight: 500, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>
            AI-Generated Insights
          </p>
          <InsightPanel
            title="Top Diagnoses"
            question="What are the top 5 most common diagnoses across all patients?"
            renderAs="bar"
          />
          <InsightPanel
            title="Medication Summary"
            question="What are the most frequently prescribed medications?"
            renderAs="table"
          />
          <InsightPanel
            title="Investigation Status"
            question="What is the breakdown of investigation statuses?"
            renderAs="pie"
          />
        </div>

        {/* Vertical divider */}


        {/* Right: AI chatbot (40%) */}
        <div className="reports-chat">
          <div style={{
            flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden',
            background: T.cardBg, borderRadius: 14, border: T.cardBorder,
            boxShadow: '0 1px 4px var(--shadow-sm)',
          }}>
            <ReportsAIPanel />
          </div>
        </div>

      </div>
    </div>
  );
}
