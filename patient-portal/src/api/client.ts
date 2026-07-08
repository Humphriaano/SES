import axios from 'axios';

const api = axios.create({
  baseURL: '/api/portal',
  withCredentials: true, // httpOnly session cookie, never a token in localStorage
});

// True when the browser has no network path at all — distinct from a 4xx/5xx.
export function isOfflineError(err: unknown): boolean {
  return axios.isAxiosError(err) && !err.response;
}

export default api;
