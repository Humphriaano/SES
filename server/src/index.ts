import express from 'express';
import { staffJsonReplacer } from './lib/staffNames';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import compression from 'compression';
import { idempotency } from './middleware/idempotency';
import dotenv from 'dotenv';
import routes from './routes/index';
import portalRoutes from './routes/portal.routes';
import { startScheduledJobs } from './jobs';
import { isTrustedOrigin } from './lib/trustedOrigins';
import { ensureIcd11Seeded } from './lib/icd11Seed';
import { ensureBuiltinPrices } from './lib/builtinPrices';

dotenv.config();

if (!process.env['JWT_SECRET']) {
  console.error('JWT_SECRET is not set in server/.env — refusing to start.');
  process.exit(1);
}

const app = express();
app.set('json replacer', staffJsonReplacer);
app.disable('x-powered-by');
const PORT = process.env['PORT'] ?? 5000;

// Static dev origins, plus any LAN IP or Cloudflare quick-tunnel origin
// (see trustedOrigins.ts) — so the staff client and patient portal both
// stay reachable when accessed from another device, not just localhost.
const staticAllowedOrigins = [
  process.env['CLIENT_URL'] ?? 'http://localhost:5173',
  process.env['PORTAL_URL'] ?? 'http://localhost:5175',
];
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || isTrustedOrigin(origin, staticAllowedOrigins)) callback(null, true);
    else callback(new Error(`Origin not allowed by CORS: ${origin}`));
  },
  credentials: true,
}));
// Gzip responses: patient lists and records shrink ~5-10x on slow links.
app.use(compression());
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());
app.use(idempotency);

// Portal namespace first — its own session auth, rate limiting, and audit
// logging, entirely separate from staff /api routes.
app.use('/api/portal', portalRoutes);
app.use('/api', routes);

app.get('/health', (_req, res) => res.json({ status: 'ok', version: 4 }));

app.listen(PORT, () => {
  console.log(`SES EHR API running on port ${PORT}`);
  startScheduledJobs();
  void ensureIcd11Seeded();
  void ensureBuiltinPrices();
});
