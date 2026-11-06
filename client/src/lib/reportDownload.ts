import api from '../api/client';
import { apiError } from './money';

// An error answer sent as a file arrives as a Blob: read the server's own message out of it.
export async function downloadError(e: unknown): Promise<string> {
  const data = (e as { response?: { data?: unknown } })?.response?.data;
  if (data instanceof Blob) { try { const msg = (JSON.parse(await data.text()) as { error?: string }).error; if (msg) return msg; } catch { /* not JSON */ } }
  return apiError(e, 'Could not build the Excel file. Check your connection and try again.');
}

// Asks the server for an Excel workbook and saves it under the name the server gives it.
export async function downloadWorkbook(path: string, params: Record<string, string>, fallbackName: string): Promise<void> {
  const res = await api.get(path, { params: { ...params, format: 'xlsx' }, responseType: 'blob' });
  const named = /filename="([^"]+)"/.exec(String(res.headers['content-disposition'] ?? ''))?.[1] ?? fallbackName;
  const url = URL.createObjectURL(res.data as Blob), a = document.createElement('a');
  a.href = url; a.download = named;
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}
