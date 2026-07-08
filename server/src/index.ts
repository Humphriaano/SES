import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import routes from './routes/index';
import portalRoutes from './routes/portal.routes';
import { startScheduledJobs } from './jobs';

dotenv.config();

const app = express();
const PORT = process.env['PORT'] ?? 5000;

const allowedOrigins = [
  process.env['CLIENT_URL'] ?? 'http://localhost:5173',
  process.env['PORTAL_URL'] ?? 'http://localhost:5174',
];
app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json());
app.use(cookieParser());

// Portal namespace first — its own session auth, rate limiting, and audit
// logging, entirely separate from staff /api routes.
app.use('/api/portal', portalRoutes);
app.use('/api', routes);

app.get('/health', (_req, res) => res.json({ status: 'ok', version: 2 }));

app.listen(PORT, () => {
  console.log(`SES EHR API running on port ${PORT}`);
  startScheduledJobs();
});
