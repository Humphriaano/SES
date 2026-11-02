import { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from 'react';
import api from '../api/client';
import { useAuth } from './AuthContext';
import { useVisiblePolling } from '../hooks/useVisiblePolling';
import { useQueueChanged } from '../lib/queue';

export interface ServiceRoom { id: string; name: string; tag: string; active: boolean; waitingCount: number }

interface ServicePointValue {
  rooms: ServiceRoom[];
  room: ServiceRoom | null;            // the room this staff member is working in
  setRoomId: (id: string | null) => void;
  refresh: () => void;
}

const Ctx = createContext<ServicePointValue>({ rooms: [], room: null, setRoomId: () => {}, refresh: () => {} });

// Which room/department each staff member is working in. Remembered per user on this device,
// so the same login on a shared workstation keeps its own choice.
export function ServicePointProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const key = user ? `ses-service-point:${user.id}` : null;
  const [rooms, setRooms] = useState<ServiceRoom[]>([]);
  const [roomId, setRoomIdState] = useState<string | null>(null);

  useEffect(() => {
    try { setRoomIdState(key ? localStorage.getItem(key) : null); } catch { setRoomIdState(null); }
  }, [key]);

  const refresh = useCallback(() => {
    if (!user) return;
    api.get('/queue/rooms').then((r) => setRooms(r.data)).catch(() => {});
  }, [user]);

  useVisiblePolling(refresh, 30000, !!user);
  useQueueChanged(refresh);

  const setRoomId = useCallback((id: string | null) => {
    setRoomIdState(id);
    try { if (key) { if (id) localStorage.setItem(key, id); else localStorage.removeItem(key); } } catch { /* ignore */ }
  }, [key]);

  // An admin switching the room off (or deleting it) must not leave staff pointed at it.
  const room = useMemo(() => rooms.find((r) => r.id === roomId) ?? null, [rooms, roomId]);

  return <Ctx.Provider value={{ rooms, room, setRoomId, refresh }}>{children}</Ctx.Provider>;
}

export function useServicePoint() {
  return useContext(Ctx);
}
