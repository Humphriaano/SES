import { useCallback, useState } from 'react';
import api from '../api/client';
import { useVisiblePolling } from './useVisiblePolling';

// How many procedures are waiting in the treatment room (and how many are urgent), for the badge in the navigation bar.
// Asks for the numbers only, once a minute while the tab is visible; if it cannot be read the badge simply stays as it was.
export function useTreatmentCount(enabled: boolean): { waiting: number; urgent: number } {
  const [counts, setCounts] = useState({ waiting: 0, urgent: 0 });
  const load = useCallback(() => {
    api.get('/treatment-room/procedures', { params: { view: 'count' } })
      .then(r => setCounts({ waiting: Number(r.data?.counts?.waiting) || 0, urgent: Number(r.data?.counts?.urgent) || 0 }))
      .catch(() => {});
  }, []);
  useVisiblePolling(load, 60000, enabled);
  return enabled ? counts : { waiting: 0, urgent: 0 };
}
