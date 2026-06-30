import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import routes from './routes/index';

dotenv.config();

const app = express();
const PORT = process.env['PORT'] ?? 5001;

app.use(cors({ origin: process.env['CLIENT_URL'] ?? 'http://localhost:5174', credentials: true }));
app.use(express.json());

app.use('/api', routes);

app.get('/health', (_req, res) => res.json({ status: 'ok', version: 2 }));

app.listen(PORT, () => {
  console.log(`Demo EHR API running on port ${PORT}`);
});
