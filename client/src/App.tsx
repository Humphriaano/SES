import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './context/AuthContext';
import { PatientProvider } from './context/PatientContext';
import { ThemeProvider } from './context/ThemeContext';
import { ServicePointProvider } from './context/ServicePointContext';
import AppLayout from './components/layout/AppLayout';
import LoginPage from './pages/LoginPage';
import SignupPage from './pages/SignupPage';
import AdminUsersPage from './pages/AdminUsersPage';
import PatientsPage from './pages/PatientsPage';
import ConsultationPage from './pages/ConsultationPage';
import VitalsPage from './pages/VitalsPage';
import PharmacyPage from './pages/PharmacyPage';
import TreatmentRoomPage from './pages/TreatmentRoomPage';
import InvestigationsPage from './pages/InvestigationsPage';
import ReportsPage from './pages/ReportsPage';
import BillingPage from './pages/BillingPage';
import BillingDeskPage from './pages/BillingDeskPage';
import BillingReportsPage from './pages/BillingReportsPage';
import DashboardPage from './pages/DashboardPage';
import DocumentsPage from './pages/DocumentsPage';
import { canAccessModule, moduleLanding, ModuleId } from './lib/moduleAccess';

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  return user ? <>{children}</> : <Navigate to="/login" replace />;
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== 'admin') return <Navigate to="/" replace />;
  return <>{children}</>;
}

export function ModuleRoute({ module, children }: { module: ModuleId; children: React.ReactNode }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return canAccessModule(user.role, module) ? <>{children}</> : <Navigate to={moduleLanding(user.role)} replace />;
}

export default function App() {
  return (
    <ThemeProvider>
    <AuthProvider>
      <PatientProvider>
      <ServicePointProvider>
        <BrowserRouter>
          <Toaster position="top-right" toastOptions={{ duration: 3000 }} />
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignupPage />} />
            <Route
              path="/"
              element={
                <PrivateRoute>
                  <AppLayout />
                </PrivateRoute>
              }
            >
              <Route index element={<ModuleRoute module="home"><DashboardPage /></ModuleRoute>} />
              <Route path="patients" element={<ModuleRoute module="home"><PatientsPage /></ModuleRoute>} />
              <Route path="patient/:patientId/consultation" element={<ModuleRoute module="consultation"><ConsultationPage /></ModuleRoute>} />
              <Route path="patient/:patientId/vitals" element={<ModuleRoute module="vitals"><VitalsPage /></ModuleRoute>} />
              <Route path="patient/:patientId/pharmacy" element={<ModuleRoute module="pharmacy"><PharmacyPage /></ModuleRoute>} />
              <Route path="pharmacy" element={<ModuleRoute module="pharmacy"><PharmacyPage /></ModuleRoute>} />
              <Route path="treatment-room" element={<ModuleRoute module="treatment"><TreatmentRoomPage /></ModuleRoute>} />
              <Route path="patient/:patientId/investigations" element={<ModuleRoute module="investigations"><InvestigationsPage /></ModuleRoute>} />
              <Route path="reports" element={<ModuleRoute module="reports"><ReportsPage /></ModuleRoute>} />
              <Route path="patient/:patientId/reports" element={<Navigate to="/reports" replace />} />
              <Route path="patient/:patientId/billing" element={<ModuleRoute module="billing"><BillingPage /></ModuleRoute>} />
              <Route path="patient/:patientId/documents" element={<ModuleRoute module="documents"><DocumentsPage /></ModuleRoute>} />
              <Route path="billing" element={<ModuleRoute module="billingDesk"><BillingDeskPage /></ModuleRoute>} />
              <Route path="billing/reports" element={<ModuleRoute module="billingReports"><BillingReportsPage /></ModuleRoute>} />
              <Route
                path="admin/users"
                element={
                  <AdminRoute>
                    <AdminUsersPage />
                  </AdminRoute>
                }
              />
            </Route>
          </Routes>
        </BrowserRouter>
      </ServicePointProvider>
      </PatientProvider>
    </AuthProvider>
    </ThemeProvider>
  );
}
