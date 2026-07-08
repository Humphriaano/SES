import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import AppShell from './AppShell';

export default function ProtectedRoute() {
  const { patient, loading } = useAuth();

  if (loading) return null; // avoid a login-page flash while /auth/me resolves
  if (!patient) return <Navigate to="/login" replace />;

  return <AppShell />;
}
