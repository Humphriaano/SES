import { Router } from 'express';
import { authenticate, requireRoles, AuthRequest } from '../middleware/auth';
import prisma from '../lib/prisma';
import { createStockProduct, createStockBatch, listStockProducts, listStockBatches, stockBalances, stockPrimitives, StockError } from '../lib/stock';
import { receiveStock, listStockReceipts, reverseStockReceipt, createReceivingDrug } from '../lib/stockReceiving';
import { stockOnHand, stockProductRows, stockExpiryBatches, stockCard } from '../lib/stockViews';
import { dispenseStockPlan } from '../lib/stockDispensing';
import { adjustmentBatches, getAdjustment, listAdjustments, submitAdjustment, reviewAdjustment } from '../lib/stockAdjustments';
import { runStockReport } from '../controllers/stockReports.controller';
import { reviewPrescriptionStock } from '../lib/stockAvailability';

const router = Router();
router.use(authenticate, requireRoles('admin', 'pharmacist'));
const actor = (req: AuthRequest) => ({ userId: req.userId, role: req.userRole });
// Express 5 forwards rejected promises; expected validation errors stay readable.
function handler(action: (req: AuthRequest) => Promise<unknown>, write = false) {
  return async (req: AuthRequest, res: import('express').Response) => {
    try {
      const result = await action(req);
      if (write) {
        const saved = result as { replayed: boolean; result: unknown };
        if (saved.replayed) res.setHeader('Idempotent-Replay', 'true');
        res.status(saved.replayed ? 200 : 201).json(saved.result);
      } else res.json(stockPrimitives.snapshot(result));
    } catch (error) {
      if (error instanceof StockError) { res.status(error.status).json({ error: error.message }); return; }
      throw error;
    }
  };
}
router.get('/products', handler(req => listStockProducts(prisma, actor(req), req.query.catalogueRef)));
router.post('/products', handler(req => createStockProduct(prisma, actor(req), req.header('Idempotency-Key'), req.body), true));
router.get('/batches', handler(req => listStockBatches(prisma, actor(req), req.query.productId)));
router.post('/batches', handler(req => createStockBatch(prisma, actor(req), req.header('Idempotency-Key'), req.body), true));
router.get('/balances', handler(req => stockBalances(prisma, actor(req), req.query.catalogueRef)));
router.get('/dispense-plan', handler(req => dispenseStockPlan(prisma, actor(req), req.query)));
router.post('/prescription-availability', handler(req => reviewPrescriptionStock(prisma, actor(req), req.header('Idempotency-Key'), req.body), true));
router.get('/receipts', handler(req => listStockReceipts(prisma, actor(req))));
router.post('/receipts', handler(req => receiveStock(prisma, actor(req), req.header('Idempotency-Key'), req.body), true));
router.post('/receipts/:id/reverse', handler(req => reverseStockReceipt(prisma, actor(req), req.header('Idempotency-Key'), { receiptId: req.params.id, reason: req.body?.reason }), true));
router.post('/catalogue-drugs', handler(req => createReceivingDrug(prisma, actor(req), req.header('Idempotency-Key'), req.body), true));
router.get('/on-hand', handler(req => stockOnHand(prisma, actor(req), req.query)));
router.get('/product-stock', handler(req => stockProductRows(prisma, actor(req), req.query)));
router.get('/expiry-batches', handler(req => stockExpiryBatches(prisma, actor(req), req.query)));
router.get('/products/:id/card', handler(req => stockCard(prisma, actor(req), req.params.id, req.query)));
router.get('/adjustment-batches', handler(req => adjustmentBatches(prisma, actor(req), req.query)));
router.get('/adjustments', handler(req => listAdjustments(prisma, actor(req), req.query)));
router.get('/adjustments/:id', handler(req => getAdjustment(prisma, actor(req), req.params.id)));
router.post('/adjustments', handler(req => submitAdjustment(prisma, actor(req), req.header('Idempotency-Key'), req.body), true));
router.post('/adjustments/:id/approve', requireRoles('admin'), handler(req => reviewAdjustment(prisma, actor(req), req.header('Idempotency-Key'), req.params.id, 'APPROVE', req.body), true));
router.post('/adjustments/:id/reject', requireRoles('admin'), handler(req => reviewAdjustment(prisma, actor(req), req.header('Idempotency-Key'), req.params.id, 'REJECT', req.body), true));
router.post('/adjustments/:id/cancel', handler(req => reviewAdjustment(prisma, actor(req), req.header('Idempotency-Key'), req.params.id, 'CANCEL', req.body), true));
router.get('/reports/:name', runStockReport);
export default router;
