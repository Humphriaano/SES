import { Routes, Route } from 'react-router-dom';
import LoginPage from './pages/LoginPage';
import AuthCallbackPage from './pages/AuthCallbackPage';
import HomePage from './pages/HomePage';
import TrendsPage from './pages/TrendsPage';
import ConditionsPage from './pages/ConditionsPage';
import AppointmentsPage from './pages/AppointmentsPage';
import CheckInsPage from './pages/CheckInsPage';
import CheckInDetailPage from './pages/CheckInDetailPage';
import SettingsPage from './pages/SettingsPage';
import ProtectedRoute from './components/ProtectedRoute';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/auth/callback" element={<AuthCallbackPage />} />

      <Route element={<ProtectedRoute />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/trends" element={<TrendsPage />} />
        <Route path="/conditions" element={<ConditionsPage />} />
        <Route path="/appointments" element={<AppointmentsPage />} />
        <Route path="/check-ins" element={<CheckInsPage />} />
        <Route path="/check-ins/:id" element={<CheckInDetailPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  );
}
