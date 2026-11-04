// Kwacha, always two decimals (ngwee), with thousands separators.
export const zmw = (n: number | null | undefined): string =>
  n === null || n === undefined ? '—' : `ZMW ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const plain = (n: number | null | undefined): string =>
  n === null || n === undefined ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const METHOD_LABEL: Record<string, string> = { CASH: 'Cash', MOBILE_MONEY: 'Mobile money', CARD: 'Card', CREDIT: 'Account credit' };

export const apiError = (e: any, fallback = 'Something went wrong. Try again.'): string =>
  e?.response ? e.response.data?.error ?? `${fallback} (${e.response.status})` : 'Can’t reach the server. Check your connection.';

export const hasRole = (role: string | undefined | null, ...wanted: string[]): boolean =>
  (role ?? '').split(',').map((r) => r.trim()).some((r) => wanted.includes(r));
