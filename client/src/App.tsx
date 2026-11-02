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
import InvestigationsPage from './pages/InvestigationsPage';
import ReportsPage from './pages/ReportsPage';
import BillingPage from './pages/BillingPage';
import DashboardPage from './pages/DashboardPage';
import DocumentsPage from './pages/DocumentsPage';

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
              <Route index element={<DashboardPage />} />
              <Route path="patients" element={<PatientsPage />} />
              <Route path="patient/:patientId/consultation" element={<ConsultationPage />} />
              <Route path="patient/:patientId/vitals" element={<VitalsPage />} />
              <Route path="patient/:patientId/pharmacy" element={<PharmacyPage />} />
              <Route path="patient/:patientId/investigations" element={<InvestigationsPage />} />
              <Route path="patient/:patientId/reports" element={<ReportsPage />} />
              <Route path="patient/:patientId/billing" element={<BillingPage />} />
              <Route path="patient/:patientId/documents" element={<DocumentsPage />} />
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
