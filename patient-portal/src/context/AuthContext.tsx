import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import api, { isOfflineError } from '../api/client';

interface PatientIdentity {
  id: string;
  name: string;
  email: string;
}

interface AuthContextValue {
  patient: PatientIdentity | null;
  loading: boolean;
  requestLink: (email: string) => Promise<void>;
  exchangeToken: (token: string) => Promise<boolean>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [patient, setPatient] = useState<PatientIdentity | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshMe = useCallback(async () => {
    try {
      const { data } = await api.get<PatientIdentity>('/auth/me');
      setPatient(data);
    } catch {
      setPatient(null);
    }
  }, []);

  useEffect(() => {
    refreshMe().finally(() => setLoading(false));
  }, [refreshMe]);

  async function requestLink(email: string): Promise<void> {
    await api.post('/auth/request-link', { email });
  }

  async function exchangeToken(token: string): Promise<boolean> {
    try {
      await api.post('/auth/exchange', { token });
      await refreshMe();
      return true;
    } catch {
      return false;
    }
  }

  async function logout(): Promise<void> {
    try {
      await api.post('/auth/logout');
    } catch (err) {
      if (!isOfflineError(err)) throw err;
    } finally {
      setPatient(null);
    }
  }

  return (
    <AuthContext.Provider value={{ patient, loading, requestLink, exchangeToken, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
