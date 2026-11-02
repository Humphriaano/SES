// Shared helpers for matching the tests listed in a consultation note to the real lab orders
// (the note only stores a label; the lab's status and results live on the order).

export interface ServerResult { id: string; resultedAt: string; amendedAt?: string | null; resultsJson: string }

export interface ServerOrderItem {
  id: string;
  type: string;
  catalogueId: string;
  name: string;
  specimen?: string | null;
  status: 'Pending' | 'In Progress' | 'Resulted' | 'Amended';
  results?: ServerResult[];            // newest first
}

export interface ResultRow {
  componentId?: string;
  componentName: string;
  value: string;
  units?: string;
  dataType?: string;
  status?: string;                     // Normal | High | Low | Critical | Abnormal | Positive | Negative …
  referenceRange?: string;
}

export const isDone = (s: string) => s === 'Resulted' || s === 'Amended';

// Orders come back newest-first; flatten to items oldest-first so repeats of one test pair up in order.
export function flattenOrders(orders: { items: ServerOrderItem[] }[]): ServerOrderItem[] {
  return orders.slice().reverse().flatMap((o) => o.items);
}

// For each note entry, the order item it refers to. Entries ordered through the app carry `orderItemId`;
// older ones are paired by test type + code, each order item used at most once.
export function pairWithOrders<T extends { orderItemId?: string; catalogCode?: string }>(
  entries: T[],
  server: ServerOrderItem[],
): (ServerOrderItem | undefined)[] {
  const byId = new Map(server.map((s) => [s.id, s]));
  const used = new Set<string>();
  return entries.map((e) => {
    let s = e.orderItemId ? byId.get(e.orderItemId) : undefined;
    if (!s && e.catalogCode) s = server.find((x) => !used.has(x.id) && `${x.type}_${x.catalogueId}` === e.catalogCode);
    if (s) used.add(s.id);
    return s;
  });
}

export function parseRows(resultsJson?: string): ResultRow[] {
  if (!resultsJson) return [];
  try {
    const rows = JSON.parse(resultsJson);
    return Array.isArray(rows) ? rows : [];
  } catch { return []; }
}

// How a result should be flagged on paper: words and arrows, not only colour, so a black-and-white print still reads.
export function flagFor(status?: string): { text: string; level: 'normal' | 'abnormal' | 'critical' | 'none' } {
  switch (status) {
    case 'High':     return { text: '▲ HIGH', level: 'abnormal' };
    case 'Low':      return { text: '▼ LOW', level: 'abnormal' };
    case 'Abnormal': return { text: '! ABNORMAL', level: 'abnormal' };
    case 'Positive': return { text: 'POSITIVE', level: 'abnormal' };
    case 'Critical': return { text: '‼ CRITICAL', level: 'critical' };
    case 'Normal':
    case 'Negative': return { text: '', level: 'normal' };
    default:         return { text: status ?? '', level: 'none' };
  }
}
