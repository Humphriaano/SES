import { useSyncExternalStore } from 'react';
import api from '../api/client';

// Drugs, tests and diagnoses that staff added in Administration. They sit on top of the built-in catalogues:
// the search helpers in data/ merge them in, so ordering and prescribing treat them like any other entry.
export interface CustomDrug {
  id: string; code: string; generic: string; brand: string | null; strength: string; form: string; route: string;
  atcCode: string | null; manufacturer: string | null; active: boolean;
  ingredients?: { name: string; amount: string; unit: string }[] | null; pendingReview?: boolean;
}
export interface CustomTest {
  id: number; rowId: string; seq: number; kind: 'SINGLE' | 'PANEL'; name: string; abbr: string | null; loinc: string | null;
  specimen: string; subType: string | null; dataType: string; units: string | null; referenceRange: string | null;
  options: string[]; searchNames: string[]; componentIds: number[]; panelId: string | null; active: boolean;
}
export interface CustomDiagnosis { id: string; code: string; description: string; category: string | null }

interface Store { drugs: CustomDrug[]; tests: CustomTest[]; diagnoses: CustomDiagnosis[]; loaded: boolean }

let store: Store = { drugs: [], tests: [], diagnoses: [], loaded: false };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const getCustomCatalogue = () => store;

export async function loadCustomCatalogue(): Promise<void> {
  try {
    const { data } = await api.get('/catalogue/custom');
    store = { drugs: data.drugs, tests: data.tests, diagnoses: data.diagnoses, loaded: true };
    emit();
  } catch { /* built-in catalogues keep working without the extras */ }
}

export function useCustomCatalogue(): Store {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; }, () => store);
}
