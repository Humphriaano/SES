import axios, { AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import toast from 'react-hot-toast';

// 30s: long enough for a slow 3G round trip, short enough that a dead
// connection surfaces as an error instead of a button that "does nothing".
const api = axios.create({ baseURL: '/api', timeout: 30000 });

const WRITE = new Set(['post', 'put', 'patch', 'delete']);

function newKey() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  // The server replays the first response for a repeated key (see
  // server/src/middleware/idempotency.ts), so a retry never double-saves.
  if (WRITE.has((config.method ?? '').toLowerCase()) && !config.headers['Idempotency-Key']) {
    config.headers['Idempotency-Key'] = newKey();
  }
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    // Sign-in owns its error message. A rejected attempt must leave the form
    // intact and must not discard any existing session in this browser.
    if (err.config?.url === '/auth/login') return Promise.reject(err);
    if (err.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    } else if (!err.response) {
      toast.error(
        err.code === 'ECONNABORTED'
          ? 'The server is taking too long to respond. Check your connection and try again.'
          : 'Cannot reach the server. Check your internet connection and try again.',
        { id: 'api-network' },
      );
    } else if (err.response.status === 429) {
      toast.error(err.response.data?.error ?? 'Too many requests. Please wait a moment and try again.', { id: 'api-429' });
    } else if (err.response.status >= 500) {
      toast.error('Something went wrong on the server. Your last action may not have been saved — please try again.', { id: 'api-500' });
    }
    return Promise.reject(err);
  }
);

// Double-clicks: an identical write already in flight shares the first
// request's network call instead of sending a second one.
const inFlight = new Map<string, Promise<AxiosResponse>>();
const send = axios.getAdapter(axios.defaults.adapter);
api.defaults.adapter = (config: InternalAxiosRequestConfig) => {
  const method = (config.method ?? 'get').toLowerCase();
  if (!WRITE.has(method) || config.data instanceof FormData) return send(config);
  const sig = `${method} ${config.url} ${typeof config.data === 'string' ? config.data : JSON.stringify(config.data ?? null)}`;
  const existing = inFlight.get(sig);
  if (existing) return existing;
  const p = send(config).finally(() => inFlight.delete(sig));
  inFlight.set(sig, p);
  return p;
};

export default api;
