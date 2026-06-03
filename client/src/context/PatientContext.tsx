import { createContext, useContext, useState, ReactNode } from 'react';
import { Patient } from '../types';

interface PatientContextType {
  activePatient: Patient | null;
  setActivePatient: (p: Patient | null) => void;
  activeEncounterId: string | null;
  setActiveEncounterId: (id: string | null) => void;
}

const PatientContext = createContext<PatientContextType | null>(null);

export function PatientProvider({ children }: { children: ReactNode }) {
  const [activePatient, setActivePatient] = useState<Patient | null>(null);
  const [activeEncounterId, setActiveEncounterId] = useState<string | null>(null);

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
