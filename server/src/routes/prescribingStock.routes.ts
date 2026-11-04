import { Router } from 'express';
import { authenticate, requireRoles, AuthRequest } from '../middleware/auth';
import prisma from '../lib/prisma';
import { prescribingAvailability, PRESCRIBING_STOCK_ROLES } from '../lib/prescribingStock';
import { StockError } from '../lib/stock';
const router = Router();
router.get('/availability', authenticate, requireRoles(...PRESCRIBING_STOCK_ROLES), async (req: AuthRequest, res) => {
  try { res.json(await prescribingAvailability(prisma, { userId: req.userId, role: req.userRole }, req.query.refs)); }
  catch (error) { if (error instanceof StockError) { res.status(error.status).json({ error: error.message }); return; } throw error; }
});
export default router;
