import { Request, Response, NextFunction } from 'express';

// Replays the first response for a repeated write that carries the same
// Idempotency-Key header (sent by the staff client on every POST/PATCH/PUT/
// DELETE). A double-click or a retry after a dropped connection therefore
// creates one record, not two. In-memory, so keys reset on restart — enough
// for retries, which happen within seconds.
const TTL_MS = 10 * 60 * 1000;
const MAX_KEYS = 5000;

interface Entry { status: number; body: unknown; expires: number; pending?: Promise<void> }
const store = new Map<string, Entry>();

function sweep() {
  const now = Date.now();
  for (const [k, v] of store) if (v.expires < now) store.delete(k);
  while (store.size > MAX_KEYS) store.delete(store.keys().next().value as string);
}

export function idempotency(req: Request, res: Response, next: NextFunction): void {
  const key = req.header('Idempotency-Key');
  if (!key || req.method === 'GET') { next(); return; }

  // Scope by caller so one user's key can never replay another user's response.
  const scoped = `${req.header('Authorization') ?? req.ip}:${req.method}:${req.originalUrl}:${key}`;
  const hit = store.get(scoped);

  if (hit && hit.expires > Date.now()) {
    if (hit.pending) {
      hit.pending.then(() => {
        const done = store.get(scoped);
        if (done) res.status(done.status).json(done.body);
        else next();
      });
      return;
    }
    res.setHeader('Idempotent-Replay', 'true');
    res.status(hit.status).json(hit.body);
    return;
  }

  let finish!: () => void;
  const entry: Entry = { status: 0, body: null, expires: Date.now() + TTL_MS, pending: new Promise((r) => { finish = r; }) };
  store.set(scoped, entry);

  const json = res.json.bind(res);
  res.json = (body: unknown) => {
    if (res.statusCode < 500) {
      entry.status = res.statusCode;
      entry.body = body;
      delete entry.pending;
    } else {
      store.delete(scoped); // let a retry try again after a server error
    }
    finish();
    return json(body);
  };
  res.on('close', () => {
    if (entry.pending) { store.delete(scoped); finish(); }
  });

  if (store.size > MAX_KEYS) sweep();
  next();
}

setInterval(sweep, TTL_MS).unref();
