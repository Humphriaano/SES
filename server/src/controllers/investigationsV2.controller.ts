import { Request, Response } from 'express';
import prisma from '../lib/prisma';

// POST /api/investigations/orders
// Body: { patientId, encounterId, items: [{type, catalogueId, name, specimen, componentsJson}] }
export async function createInvestigationOrder(req: Request, res: Response) {
  try {
    const orderedById = (req as any).userId as string;
    const { patientId, encounterId, items } = req.body;
    const order = await prisma.investigationOrder.create({
      data: {
        patientId,
        encounterId,
        orderedById,
        items: {
          create: items.map((item: any) => ({
            type: item.type,
            catalogueId: item.catalogueId,
            name: item.name,
            specimen: item.specimen,
            componentsJson: item.componentsJson ? JSON.stringify(item.componentsJson) : null,
          })),
        },
      },
      include: { items: true },
    });
    res.status(201).json(order);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

// GET /api/investigations/orders
// Query: patientId (optional), encounterId (optional), worklist=true (lab tech - all pending/in-progress)
export async function getInvestigationOrders(req: Request, res: Response) {
  try {
    const { patientId, encounterId, worklist, limit } = req.query as any;

    if (worklist === 'true') {
      // Lab tech worklist - all pending/in-progress items across patients
      const items = await prisma.investigationOrderItem.findMany({
        where: { status: { in: ['Pending', 'In Progress'] } },
        include: {
          order: {
            include: {
              patient: { select: { id: true, firstName: true, lastName: true } },
              orderedBy: { select: { id: true, name: true } },
            },
          },
          results: { orderBy: { resultedAt: 'desc' }, take: 1 },
        },
        orderBy: { order: { orderedAt: 'asc' } },
      });
      res.json(items);
      return;
    }

    const where: any = {};
    if (patientId) where.patientId = patientId;
    if (encounterId) where.encounterId = encounterId;

    const orders = await prisma.investigationOrder.findMany({
      where,
      include: {
        orderedBy: { select: { id: true, name: true } },
        items: {
          include: {
            results: { orderBy: { resultedAt: 'desc' } },
          },
        },
      },
      orderBy: { orderedAt: 'desc' },
      take: limit ? parseInt(limit) : undefined,
    });
    res.json(orders);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

// PATCH /api/investigations/items/:itemId  — sample confirmation or status update
export async function updateInvestigationItem(req: Request, res: Response) {
  try {
    const { itemId } = req.params;
    const userId = (req as any).userId as string;
    const { status, sampleReceivedAt } = req.body;
    const data: any = {};
    if (status) data.status = status;
    if (sampleReceivedAt) {
      data.sampleReceivedAt = new Date(sampleReceivedAt);
      data.sampleReceivedById = userId;
    }
    const item = await prisma.investigationOrderItem.update({ where: { id: itemId as string }, data });
    res.json(item);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

// POST /api/investigations/results
// Body: { itemId, results: [{componentId, componentName, value, units, dataType, status, referenceRange}] }
export async function createInvestigationResult(req: Request, res: Response) {
  try {
    const userId = (req as any).userId as string;
    const { itemId, results } = req.body;
    const result = await prisma.investigationResult.create({
      data: {
        itemId,
        resultedById: userId,
        resultsJson: JSON.stringify(results),
      },
    });
    await prisma.investigationOrderItem.update({ where: { id: itemId }, data: { status: 'Resulted' } });
    res.status(201).json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

// PATCH /api/investigations/results/:resultId — amend
export async function amendInvestigationResult(req: Request, res: Response) {
  try {
    const resultId = String(req.params.resultId);
    const userId = (req as any).userId as string;
    const { results } = req.body;

    // Get item id from existing result
    const existing = await prisma.investigationResult.findUnique({ where: { id: resultId } });
    if (!existing) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    // Create new amendment result
    const amended = await prisma.investigationResult.create({
      data: {
        itemId: existing.itemId,
        resultedById: existing.resultedById,
        resultedAt: existing.resultedAt,
        amendedById: userId,
        amendedAt: new Date(),
        resultsJson: JSON.stringify(results),
      },
    });
    await prisma.investigationOrderItem.update({
      where: { id: existing.itemId },
      data: { status: 'Amended' },
    });
    res.json(amended);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

// GET /api/investigations/results?patientId=:id&testName=:name
// Returns all resulted/amended order items for a patient + test name, newest first.
// Used for the result history trend view in the sidebar panel.
export async function getInvestigationResultHistory(req: Request, res: Response) {
  try {
    const { patientId, testName } = req.query as { patientId?: string; testName?: string };
    if (!patientId || !testName) {
      res.status(400).json({ error: 'patientId and testName are required' });
      return;
    }
    const items = await prisma.investigationOrderItem.findMany({
      where: {
        name: { equals: testName, mode: 'insensitive' },
        order: { patientId },
        status: { in: ['Resulted', 'Amended'] },
      },
      include: {
        results: { orderBy: { resultedAt: 'desc' } },
        order: { select: { orderedAt: true, encounterId: true } },
      },
      orderBy: { order: { orderedAt: 'desc' } },
    });
    res.json(items);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}
