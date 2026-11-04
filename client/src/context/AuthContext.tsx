import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { User } from '../types';
import api from '../api/client';
import { staffDisplayName } from '../lib/staffNames';

interface AuthContextType {
  user: User | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => {
    try {
      const stored = localStorage.getItem('user');
      if (!stored) return null;
      const saved = JSON.parse(stored) as User;
      return { ...saved, name: staffDisplayName(saved.name, saved.designation) };
    } catch {
      localStorage.removeItem('user');
      localStorage.removeItem('token');
      return null;
    }
  });

  // Refresh the profile and current assigned roles independently of the token.
  useEffect(() => {
    if (!user) return;
    let live = true;
    let requestId = 0;
    const refresh = () => {
      if (document.hidden || !navigator.onLine) return;
      const id = ++requestId;
      api.get<Pick<User, 'id' | 'name' | 'firstName' | 'designation' | 'role'>>('/auth/me').then(({ data }) => {
        if (!live || id !== requestId) return;
        setUser(current => {
          if (!current || current.id !== data.id) return current;
          const updated = { ...current, name: staffDisplayName(data.name, data.designation), firstName: data.firstName, designation: data.designation ?? null, role: data.role ?? current.role };
          localStorage.setItem('user', JSON.stringify(updated));
          return updated;
        });
      }).catch(() => { /* Keep the session; focus, online and the next interval retry. */ });
    };
    refresh();
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', refresh);
    const timer = window.setInterval(refresh, 60000);
    return () => {
      live = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [user?.id]);

  async function login(email: string, password: string) {
    const { data } = await api.post('/auth/login', { login: email, password });
    const identity = { ...data.user, name: staffDisplayName(data.user.name, data.user.designation) };
    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(identity));
    setUser(identity);
  }

  function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
  }

  return <AuthContext.Provider value={{ user, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
