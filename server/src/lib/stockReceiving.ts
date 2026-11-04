import fs from 'fs';
import path from 'path';
import { PharmacyProduct, StockBatch, Prisma, PrismaClient } from '@prisma/client';
import { StockActor, StockError, stockPrimitives as s } from './stock';
import { audit } from './billingOps';
import { todayInput } from './prescriptionCourse';
import { readDrug, readDrugIngredients } from './drugCatalogueInput';

const receiptInclude = {
  lines: { include: {
    batch: { include: { product: { include: { catalogueItem: { select: { name: true, detail: true } } } } } },
    movement: { include: { reversal: true } },
  } },
} as const;
async function receiptDto(tx: Prisma.TransactionClient, id: string) {
  const receipt = await tx.stockReceipt.findUniqueOrThrow({ where: { id }, include: receiptInclude });
  const receiver = await tx.user.findUnique({ where: { id: receipt.receivedById }, select: { id: true, name: true, designation: true } });
  const reversed = receipt.lines.filter(line => line.movement?.reversal).length;
  return { ...receipt, receivedBy: receiver, status: reversed === receipt.lines.length ? 'REVERSED' : reversed ? 'PARTLY_REVERSED' : 'POSTED' };
}

// New product/batch identities and the received quantity are one transaction.
// A failed receipt cannot leave partially created setup records behind.
export function receiveStock(db: PrismaClient, actor: StockActor, key: unknown, body: unknown) {
  const b = s.input(body, ['kind', 'receivedDate', 'reference', 'source', 'lines']);
  const kind = b.kind ?? 'DELIVERY';
  if (kind !== 'DELIVERY' && kind !== 'OPENING') throw new StockError(400, 'Choose delivery or opening stock.');
  const receivedDate = b.receivedDate == null ? null : s.date(b.receivedDate, 'received date');
  if (!Array.isArray(b.lines) || !b.lines.length || b.lines.length > 50) throw new StockError(400, 'Enter 1–50 stock lines.');
  const lines = b.lines.map(raw => {
    const line = s.input(raw, ['productId', 'newProduct', 'lotNumber', 'expiryDate', 'packCount', 'costPerPack']);
    if (Boolean(line.productId) === Boolean(line.newProduct)) throw new StockError(400, 'Choose an existing product or enter a new product.');
    return {
      productId: line.productId ? s.text(line.productId, 'product ID', 80) : null,
      newProduct: line.newProduct ? s.productInput(line.newProduct) : null,
      lotNumber: s.text(line.lotNumber, 'batch number', 100).toUpperCase(),
      expiryDate: s.date(line.expiryDate, 'expiry date'),
      packCount: s.quantity(line.packCount, 'pack count').toFixed(2),
      costPerPack: line.costPerPack == null || line.costPerPack === '' ? null : s.quantity(line.costPerPack, 'cost per pack', true).toFixed(2),
    };
  });
  const data = { kind, receivedDate, reference: s.text(b.reference, 'receipt or count reference'), source: s.text(b.source, 'supplier or count source'), lines };
  return s.write(db, actor, key, 'RECEIVE_STOCK', data, async (tx, operationId, actorId) => {
    const effectiveDate = receivedDate ?? todayInput();
    if (effectiveDate > todayInput()) throw new StockError(400, 'Received date cannot be in the future.');
    const savedProducts = await tx.pharmacyProduct.findMany({ where: { id: { in: lines.flatMap(line => line.productId ? [line.productId] : []) } }, select: { catalogueRef: true } });
    for (const code of [...new Set([...savedProducts.map(p => p.catalogueRef), ...lines.flatMap(line => line.newProduct ? [line.newProduct.catalogueRef] : [])])].sort()) await s.lockCatalogue(tx, code);
    // Lock shared identity keys in a fixed order before resolving new products.
    const identities = lines.filter(line => line.newProduct).map(line => {
      const p = line.newProduct!;
      return s.canonical([p.catalogueRef, p.brand.toLowerCase(), (p.manufacturer ?? '').toLowerCase(), p.baseUnit, p.packSize]);
    });
    for (const identity of [...new Set(identities)].sort()) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'stock-product:' + identity}))`;
    const products: PharmacyProduct[] = [];
    for (const line of lines) {
      let product = line.productId ? await tx.pharmacyProduct.findUnique({ where: { id: line.productId } }) : null;
      if (line.newProduct) {
        const p = line.newProduct;
        await s.requireCatalogue(tx, p.catalogueRef);
        product = await tx.pharmacyProduct.findFirst({ where: { catalogueRef: p.catalogueRef, brandKey: p.brand.toLowerCase(), manufacturerKey: (p.manufacturer ?? '').toLowerCase(), baseUnit: p.baseUnit, packSize: p.packSize } });
        if (!product) {
          product = await tx.pharmacyProduct.create({ data: { ...p, brandKey: p.brand.toLowerCase(), manufacturerKey: (p.manufacturer ?? '').toLowerCase(), createdById: actorId } });
          await audit(tx, { userId: actorId, action: 'STOCK_PRODUCT_CREATED', entity: 'PharmacyProduct', entityId: product.id, after: s.snapshot(product) });
        } else if (product.packLabel.toLowerCase() !== p.packLabel.toLowerCase()) throw new StockError(409, 'That product already exists with a different pack label. Choose the saved product.');
      }
      if (!product?.active) throw new StockError(409, 'Choose an active stock product.');
      await s.requireCatalogue(tx, product.catalogueRef);
      products.push(product);
    }
    const batchIdentities = lines.map((line, index) => products[index].id + ':' + line.lotNumber);
    if (new Set(batchIdentities).size !== lines.length) throw new StockError(400, 'Combine repeated product and batch lines.');
    for (const identity of [...batchIdentities].sort()) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'stock-batch:' + identity}))`;
    const batches: StockBatch[] = [];
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index], product = products[index];
      if (line.expiryDate < todayInput()) throw new StockError(400, 'Do not receive an expired batch.');
      let batch = await tx.stockBatch.findUnique({ where: { productId_lotNumber: { productId: product.id, lotNumber: line.lotNumber } } });
      if (batch && batch.expiryDate.toISOString().slice(0, 10) !== line.expiryDate) throw new StockError(409, 'This lot already has a different expiry date. Check the batch label.');
      if (!batch) {
        batch = await tx.stockBatch.create({ data: { productId: product.id, lotNumber: line.lotNumber, expiryDate: new Date(line.expiryDate + 'T00:00:00Z'), createdById: actorId } });
        await audit(tx, { userId: actorId, action: 'STOCK_BATCH_CREATED', entity: 'StockBatch', entityId: batch.id, after: s.snapshot(batch) });
      }
      batches.push(batch);
    }
    await s.lockBatches(tx, batches.map(batch => batch.id));
    if (kind === 'OPENING') {
      for (const batch of batches) {
        const posted = await tx.stockMovement.count({ where: { batchId: batch.id, type: { not: 'REVERSAL' }, reversal: null } });
        if (posted) throw new StockError(409, 'This batch already has posted stock. Receive a delivery or correct its opening receipt.');
      }
    }
    const receipt = await tx.stockReceipt.create({ data: { operationId, kind, receivedDate: new Date(effectiveDate + 'T00:00:00Z'), reference: data.reference, source: data.source, receivedById: actorId } });
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index], product = products[index], batch = batches[index];
      const converted = new Prisma.Decimal(line.packCount).mul(product.packSize);
      if (converted.decimalPlaces() > 2 || converted.gt('10000000000')) throw new StockError(400, 'The pack conversion exceeds the supported quantity or two decimal places.');
      const saved = await tx.stockReceiptLine.create({ data: { receiptId: receipt.id, batchId: batch.id, packCount: line.packCount, packSize: product.packSize, packLabel: product.packLabel, baseQuantity: converted, baseUnit: product.baseUnit, costPerPack: line.costPerPack } });
      await tx.stockMovement.create({ data: { operationId, batchId: batch.id, type: 'RECEIVED', quantity: converted, baseUnit: product.baseUnit, reference: data.reference, actorId, receiptLineId: saved.id } });
    }
    const result = await receiptDto(tx, receipt.id);
    await audit(tx, { userId: actorId, action: kind === 'OPENING' ? 'STOCK_OPENING_RECORDED' : 'STOCK_RECEIVED', entity: 'StockReceipt', entityId: receipt.id, after: s.snapshot(result) });
    return result;
  });
}

export async function listStockReceipts(db: PrismaClient, actor: StockActor) {
  s.authorize(actor);
  const receipts = await db.stockReceipt.findMany({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 20, select: { id: true } });
  return Promise.all(receipts.map(receipt => receiptDto(db, receipt.id)));
}

export function reverseStockReceipt(db: PrismaClient, actor: StockActor, key: unknown, body: unknown) {
  const b = s.input(body, ['receiptId', 'reason']);
  const data = { receiptId: s.text(b.receiptId, 'receipt ID', 80), reason: s.text(b.reason, 'correction reason', 1000) };
  return s.write(db, actor, key, 'REVERSE_RECEIPT', data, async (tx, operationId, actorId) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'stock-receipt:' + data.receiptId}))`;
    const receipt = await tx.stockReceipt.findUnique({ where: { id: data.receiptId }, include: { lines: { include: { movement: { include: { reversal: true, allocation: true } } } } } });
    if (!receipt) throw new StockError(404, 'Stock receipt not found.');
    await s.lockBatches(tx, receipt.lines.map(line => line.batchId));
    const pending = receipt.lines.map(line => line.movement).filter(movement => movement && !movement.reversal);
    if (!pending.length) throw new StockError(409, 'This receipt has already been reversed.');
    for (const movement of pending) {
      if (!movement || movement.allocation) throw new StockError(409, 'This receipt needs a coordinated pharmacy correction.');
      if ((await s.balance(tx, movement.batchId)).lt(movement.quantity)) throw new StockError(409, 'The receipt cannot be reversed because its stock is no longer available.');
      await tx.stockMovement.create({ data: { operationId, batchId: movement.batchId, type: 'REVERSAL', quantity: movement.quantity.negated(), baseUnit: movement.baseUnit, reference: movement.reference, reason: data.reason, actorId, reversalOfId: movement.id } });
    }
    const result = await receiptDto(tx, receipt.id);
    await audit(tx, { userId: actorId, action: 'STOCK_RECEIPT_REVERSED', entity: 'StockReceipt', entityId: receipt.id, after: s.snapshot(result), reason: data.reason });
    return result;
  });
}

const clinicalKey = (value: string) => value.toLowerCase().replace(/[\s.,+()/–-]/g, '');
export function createReceivingDrug(db: PrismaClient, actor: StockActor, key: unknown, body: unknown) {
  const b = s.input(body, ['generic', 'form', 'route', 'atcCode', 'ingredients']);
  const ingredientResult = readDrugIngredients(b.ingredients);
  if (ingredientResult.error) throw new StockError(400, ingredientResult.error);
  const ingredients = ingredientResult.data!, strength = ingredientResult.strength!;
  const parsed = readDrug({ generic: b.generic, strength, form: b.form, route: b.route, atcCode: b.atcCode });
  if (!parsed.data) throw new StockError(400, parsed.error!);
  const data = { ...parsed.data, ingredients };
  return s.write(db, actor, key, 'CREATE_RECEIVING_DRUG', data, async (tx, _operationId, actorId) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'stock-catalogue-drug:' + clinicalKey(data.generic)}))`;
    const builtins = JSON.parse(fs.readFileSync(path.join(__dirname, '../../data/builtin-price-items.json'), 'utf8')) as { itemType: string; name: string; detail: string; catalogueRef: string }[];
    const matchesBuiltin = builtins.find(row => row.itemType === 'DRUG' && clinicalKey(row.name) === clinicalKey(data.generic) && clinicalKey(row.detail) === clinicalKey([data.strength, data.form, data.route].join(' · ')));
    const custom = await tx.catalogueDrug.findMany({ where: { generic: { equals: data.generic, mode: 'insensitive' } } });
    const duplicate = custom.find(row => clinicalKey(row.strength) === clinicalKey(data.strength) && clinicalKey(row.form) === clinicalKey(data.form) && clinicalKey(row.route) === clinicalKey(data.route));
    if (matchesBuiltin || duplicate) throw new StockError(409, `This clinical item already exists (${matchesBuiltin?.catalogueRef ?? duplicate!.code}). Select it from the catalogue.`);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'stock-catalogue-code'}))`;
    const codes = new Set((await tx.catalogueDrug.findMany({ select: { code: true } })).map(row => row.code));
    let next = codes.size + 1; while (codes.has(`CUS${String(next).padStart(4, '0')}`)) next++;
    const drug = await tx.catalogueDrug.create({ data: { ...data, code: `CUS${String(next).padStart(4, '0')}`, pendingReview: true, createdById: actorId } });
    await tx.priceListItem.create({ data: { itemType: 'DRUG', catalogueRef: drug.code, name: drug.generic, detail: [drug.strength, drug.form, drug.route].join(' · '), unit: 'per unit', updatedById: actorId } });
    await audit(tx, { userId: actorId, action: 'CATALOGUE_DRUG_ADDED_FROM_RECEIVING', entity: 'CatalogueDrug', entityId: drug.id, after: s.snapshot(drug) });
    return drug;
  });
}
