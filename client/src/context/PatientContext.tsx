import { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { useAuth } from './AuthContext';
import { Patient } from '../types';
import { addRecent } from '../lib/recentPatients';

interface PatientContextType {
  activePatient: Patient | null;
  setActivePatient: (p: Patient | null) => void;
  activeEncounterId: string | null;
  setActiveEncounterId: (id: string | null) => void;
}

const PatientContext = createContext<PatientContextType | null>(null);

export function PatientProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const identity = user ? `${user.id}|${user.role}` : null;
  const previousIdentity = useRef(identity);
  const [activePatient, setActivePatientState] = useState<Patient | null>(null);
  const [activeEncounterId, setActiveEncounterId] = useState<string | null>(null);
  useEffect(() => {
    if (previousIdentity.current !== identity) {
      setActivePatientState(null);
      setActiveEncounterId(null);
      previousIdentity.current = identity;
    }
  }, [identity]);

  function setActivePatient(p: Patient | null) {
    setActivePatientState(p);
    if (p) addRecent(p);
  }

  return (
    <PatientContext.Provider value={{ activePatient, setActivePatient, activeEncounterId, setActiveEncounterId }}>
      {children}
    </PatientContext.Provider>
  );
}

export function usePatient() {
  const ctx = useContext(PatientContext);
  if (!ctx) throw new Error('usePatient must be used within PatientProvider');
  return ctx;
}
