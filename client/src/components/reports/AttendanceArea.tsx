import { useState } from 'react';
import AttendancePanel from './AttendancePanel';
import { DiagnosesView, WorkloadView, type ViewAccess } from './AttendanceExtras';

type View = 'attendance' | 'workload' | 'diagnoses';
const VIEWS: { key: View; label: string }[] = [{ key: 'attendance', label: 'Attendance' }, { key: 'workload', label: 'Workload' }, { key: 'diagnoses', label: 'OPD diagnoses' }];
const VIEW_KEY = 'ses.reports.attendanceView';
function savedView(): View {
  try { const v = localStorage.getItem(VIEW_KEY); if (v === 'workload' || v === 'diagnoses') return v; } catch { /* storage unavailable: start on attendance */ }
  return 'attendance';
}

// The Attendance tab: attendance by age and sex, workload by service point and staff, and the diagnoses recorded at consultations. A role sees only
// the reports the server says it may open.
export default function AttendanceArea({ period, access }: { period: { from: string; to: string }; access: Partial<Record<View, ViewAccess>> }) {
  const [chosen, setChosen] = useState<View>(savedView);
  const views = VIEWS.filter(v => access[v.key]);
  const view: View = access[chosen] ? chosen : views[0]?.key ?? 'attendance';
  const pick = (next: View) => { setChosen(next); try { localStorage.setItem(VIEW_KEY, next); } catch { /* not remembered */ } };
  const a = access[view];
  return (
    <div className="rp-att">
      {views.length > 1 && (
        <div className="rp-subtabs rp-noprint" role="tablist" aria-label="Attendance reports">
          {views.map(v => <button key={v.key} type="button" role="tab" aria-selected={view === v.key} onClick={() => pick(v.key)}>{v.label}</button>)}
        </div>
      )}
      {a && view === 'attendance' && <AttendancePanel period={period} canLines={a.lineList} canSeeNames={a.canSeeNames} />}
      {a && view === 'workload' && <WorkloadView key="workload" period={period} access={a} />}
      {a && view === 'diagnoses' && <DiagnosesView key="diagnoses" period={period} access={a} />}
    </div>
  );
}
