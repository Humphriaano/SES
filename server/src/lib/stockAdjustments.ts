import { Prisma, PrismaClient } from '@prisma/client';
import { audit } from './billingOps';
import { todayInput } from './prescriptionCourse';
import { StockActor, StockError, stockPrimitives as s } from './stock';

type Tx = Prisma.TransactionClient;
export const ADJUSTMENT_REASONS: Record<string, Record<string,string>> = {
  LOSS: { DAMAGE: 'Damaged stock', BREAKAGE: 'Breakage', SPILLAGE: 'Spillage', THEFT: 'Theft', MISSING: 'Missing stock', OTHER: 'Other loss' },
  WRITE_OFF: { EXPIRED: 'Expired stock write-off' },
  COUNT: { ROUTINE_COUNT: 'Physical stock count', COUNT_CORRECTION: 'Count correction', OTHER: 'Other count variance' },
};
function choice(value: unknown, values: string[], label: string): string {
  if (typeof value !== 'string' || !values.includes(value)) throw new StockError(400, `Choose a valid ${label}.`);
  return value;
}
function version(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{1,19}$/.test(value) || BigInt(value) > 9223372036854775807n) throw new StockError(400, 'Refresh the stock balance before submitting.');
  return BigInt(value).toString();
}
function page(value: unknown, fallback: number, max: number) {
  if (value === undefined || value === '') return fallback;
  if (typeof value !== 'string' || !/^\d+$/.test(value) || Number(value)<1 || Number(value)>max) throw new StockError(400, 'Choose a valid page.');
  return Number(value);
}
async function currentStaff(tx: Tx, id: string, admin = false) {
  const user = await tx.user.findUnique({ where: { id }, select: { name: true, status: true, role: true } });
  const roles = (user?.role ?? '').split(',').map(role => role.trim());
  if (!user || user.status !== 'active' || !(admin ? roles.includes('admin') : roles.some(role => ['admin','pharmacist'].includes(role)))) throw new StockError(403, admin ? 'An active administrator must review stock requests.' : 'Active pharmacy access is required.');
  return user;
}
async function balances(tx: Tx, ids: string[]) {
  if (!ids.length) return new Map<string,{ quantity: Prisma.Decimal; postingOrder: bigint }>();
  const rows = await tx.$queryRaw<{ batchId: string; quantity: Prisma.Decimal; postingOrder: bigint }[]>(Prisma.sql`SELECT "batchId",SUM("quantity") AS quantity,MAX("postingOrder") AS "postingOrder" FROM "StockMovement" WHERE "batchId" IN (${Prisma.join(ids)}) GROUP BY "batchId"`);
  return new Map(rows.map(row => [row.batchId,{ quantity: row.quantity, postingOrder: row.postingOrder }]));
}
function currentFor(current: Awaited<ReturnType<typeof balances>>, id: string) { return current.get(id) ?? { quantity: new Prisma.Decimal(0), postingOrder: 0n }; }
function fresh(line: { expectedQuantity: Prisma.Decimal | string; expectedPostingOrder: bigint | string }, current: { quantity: Prisma.Decimal; postingOrder: bigint }) { return current.quantity.eq(line.expectedQuantity) && current.postingOrder.toString() === line.expectedPostingOrder.toString(); }
function reasonText(request: { kind: string; reasonCode: string; reason: string | null }) { return ADJUSTMENT_REASONS[request.kind][request.reasonCode] + (request.reason ? ' · ' + request.reason : ''); }

export async function adjustmentBatches(db: PrismaClient, actor: StockActor, query: Record<string,unknown>) {
  s.authorize(actor);
  const kind = choice(query.kind ?? 'COUNT',Object.keys(ADJUSTMENT_REASONS),'request type'), q = query.q ? s.text(query.q,'batch search',160) : '', number=page(query.page,1,100000), size=page(query.pageSize,20,100), today=todayInput();
  let ids: string[] | null = null;
  if (query.ids !== undefined) { if (typeof query.ids !== 'string') throw new StockError(400,'Choose valid batches.'); ids=[...new Set(query.ids.split(',').map(id=>s.text(id,'batch ID',80)))]; if (ids.length>50) throw new StockError(400,'Refresh no more than 50 batches.'); }
  const words=q.split(/\s+/).filter(Boolean).slice(0,8);
  const search=words.length ? Prisma.sql`AND ${Prisma.join(words.map(word => Prisma.sql`concat_ws(' ',c."name",c."detail",p."catalogueRef",p."brand",p."manufacturer",b."lotNumber") ILIKE ${'%' + word.replace(/[\\%_]/g,'\\$&') + '%'}`),' AND ')}` : Prisma.empty;
  const prefix=Prisma.sql`WITH batches AS (SELECT b."id" AS "batchId",b."productId",b."lotNumber",b."expiryDate",p."catalogueRef",c."name",c."detail",p."brand",p."manufacturer",p."baseUnit",
    COALESCE(SUM(m."quantity"),0) AS physical,COALESCE(MAX(m."postingOrder"),0) AS "postingOrder",
    CASE WHEN b."expiryDate"<${today}::date THEN 'EXPIRED' WHEN b."status"='QUARANTINED' THEN 'QUARANTINED' WHEN NOT p."active" OR NOT c."active" THEN 'INACTIVE' ELSE 'USABLE' END AS state
    FROM "StockBatch" b JOIN "PharmacyProduct" p ON p."id"=b."productId" JOIN "PriceListItem" c ON c."itemType"=p."catalogueType" AND c."catalogueRef"=p."catalogueRef" LEFT JOIN "StockMovement" m ON m."batchId"=b."id"
    WHERE TRUE ${ids ? Prisma.sql`AND b."id" IN (${Prisma.join(ids)})` : Prisma.empty} ${search}
    GROUP BY b."id",p."id",c."id"), filtered AS (SELECT * FROM batches WHERE TRUE ${kind==='COUNT' ? Prisma.empty : Prisma.sql`AND physical>0`} ${kind==='WRITE_OFF' ? Prisma.sql`AND "expiryDate"<${today}::date` : Prisma.empty})`;
  return db.$transaction(async tx => {
    const [count]=await tx.$queryRaw<{total:number}[]>(Prisma.sql`${prefix} SELECT COUNT(*)::integer AS total FROM filtered`);
    const rows=await tx.$queryRaw<{ physical: Prisma.Decimal; postingOrder: bigint; expiryDate: Date }[]>(Prisma.sql`${prefix} SELECT * FROM filtered ORDER BY lower("name"),lower("brand"),"expiryDate","batchId" LIMIT ${size} OFFSET ${(number-1)*size}`);
    return {page:number,pageSize:size,total:count.total,rows:rows.map(row=>({...row,physical:row.physical.toFixed(2),postingOrder:row.postingOrder.toString(),expiryDate:row.expiryDate.toISOString().slice(0,10)}))};
  },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead});
}
const identity = { select: { id:true,name:true,designation:true } } as const;
export async function adjustmentDto(tx: Tx, id: string) {
  const request=await tx.stockAdjustment.findUnique({where:{id},include:{preparedBy:identity,reviewedBy:identity,lines:{include:{batch:{include:{product:{include:{catalogueItem:{select:{name:true,detail:true}}}}}},movement:{select:{id:true,type:true,quantity:true,postingOrder:true,actorId:true,approvedById:true,createdAt:true,reason:true}}},orderBy:{id:'asc'}}}});
  if (!request) throw new StockError(404,'Stock request not found.');
  const current=await balances(tx,request.lines.map(line=>line.batchId));
  const lines=request.lines.map(line=>{const now=currentFor(current,line.batchId),{batch,movement,...values}=line;return{...values,expectedQuantity:line.expectedQuantity.toFixed(2),expectedPostingOrder:line.expectedPostingOrder.toString(),countedQuantity:line.countedQuantity?.toFixed(2) ?? null,changeQuantity:line.changeQuantity.toFixed(2),resultingQuantity:line.expectedQuantity.plus(line.changeQuantity).toFixed(2),currentQuantity:now.quantity.toFixed(2),currentPostingOrder:now.postingOrder.toString(),stale:request.status==='PENDING'&&!fresh(line,now),batch:{id:batch.id,lotNumber:batch.lotNumber,expiryDate:batch.expiryDate.toISOString().slice(0,10),status:batch.status,product:{id:batch.product.id,catalogueRef:batch.product.catalogueRef,brand:batch.product.brand,manufacturer:batch.product.manufacturer,active:batch.product.active,...batch.product.catalogueItem}},movement:movement?s.snapshot(movement):null}});
  return {...request,lines,stale:lines.some(line=>line.stale)};
}
export async function getAdjustment(db: PrismaClient, actor: StockActor, id: unknown) {
  s.authorize(actor);const requestId=s.text(id,'request ID',80);
  return db.$transaction(tx=>adjustmentDto(tx,requestId),{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead});
}
export async function listAdjustments(db: PrismaClient, actor: StockActor, query: Record<string,unknown>) {
  s.authorize(actor);const status=choice(query.status ?? 'PENDING',['ALL','PENDING','POSTED','REJECTED','CANCELLED'],'request status'),number=page(query.page,1,100000),size=page(query.pageSize,20,50),where=status==='ALL'?{}:{status};
  return db.$transaction(async tx=>({page:number,pageSize:size,total:await tx.stockAdjustment.count({where}),rows:await tx.stockAdjustment.findMany({where,skip:(number-1)*size,take:size,orderBy:[{preparedAt:'desc'},{id:'asc'}],include:{preparedBy:identity,reviewedBy:identity,_count:{select:{lines:true}}}})}),{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead});
}

export function submitAdjustment(db: PrismaClient, actor: StockActor, key: unknown, body: unknown) {
  const b=s.input(body,['kind','reference','reasonCode','reason','lines']),kind=choice(b.kind,Object.keys(ADJUSTMENT_REASONS),'request type'),reasonCode=choice(b.reasonCode,Object.keys(ADJUSTMENT_REASONS[kind]),'reason'),reason=s.optionalText(b.reason,'reason notes',1000);
  if(reasonCode==='OTHER'&&!reason)throw new StockError(400,'Describe the other loss or count reason.');
  if(!Array.isArray(b.lines)||!b.lines.length||b.lines.length>50)throw new StockError(400,'A stock request needs 1–50 batch lines.');
  const lines=b.lines.map(value=>{const line=s.input(value,['batchId','baseUnit','expectedQuantity','expectedPostingOrder','quantity','countedQuantity']),expected=s.quantity(line.expectedQuantity,'recorded quantity',true),counted=kind==='COUNT'?s.quantity(line.countedQuantity,'physical count',true):null;
    if(kind==='COUNT'?line.quantity!==undefined:line.countedQuantity!==undefined)throw new StockError(400,'Choose a loss quantity or a physical count, not both.');
    const delta=counted?counted.minus(expected):s.quantity(line.quantity,'loss quantity').negated(),baseUnit=s.unit(line.baseUnit);
    if(expected.plus(delta).lt(0))throw new StockError(400,'The loss cannot exceed the recorded physical stock.');
    if(baseUnit==='bottle'&&(counted?!counted.isInteger():!delta.isInteger()))throw new StockError(400,'Count or remove whole bottles; use mL-tracked stock for volume.');
    return{batchId:s.text(line.batchId,'batch ID',80),baseUnit,expectedQuantity:expected.toFixed(2),expectedPostingOrder:version(line.expectedPostingOrder),countedQuantity:counted?.toFixed(2)??null,changeQuantity:delta.toFixed(2)};
  });
  if(new Set(lines.map(line=>line.batchId)).size!==lines.length)throw new StockError(400,'Use one line per batch.');
  const data={kind,reference:s.text(b.reference,'request reference'),reasonCode,reason,lines};
  return s.write(db,actor,key,'SUBMIT_ADJUSTMENT',data,async(tx,operationId,actorId)=>{
    await currentStaff(tx,actorId);await s.lockBatches(tx,lines.map(line=>line.batchId));const current=await balances(tx,lines.map(line=>line.batchId));
    for(const line of lines){const batch=await tx.stockBatch.findUniqueOrThrow({where:{id:line.batchId},include:{product:{select:{baseUnit:true}}}});if(batch.product.baseUnit!==line.baseUnit)throw new StockError(409,'The stock unit changed. Refresh the batch.');if(!fresh(line,currentFor(current,line.batchId)))throw new StockError(409,'Stock changed since this balance was loaded. Refresh and enter a fresh count or loss.');if(kind==='WRITE_OFF'&&batch.expiryDate.toISOString().slice(0,10)>=todayInput())throw new StockError(400,'Only stock past its expiry date can be written off as expired.');}
    const request=await tx.stockAdjustment.create({data:{kind,reference:data.reference,reasonCode,reason,preparedById:actorId,submittedOperationId:operationId,lines:{create:lines.map(line=>({...line,expectedPostingOrder:BigInt(line.expectedPostingOrder)}))}}});
    const result=await adjustmentDto(tx,request.id);await audit(tx,{userId:actorId,action:'STOCK_ADJUSTMENT_SUBMITTED',entity:'StockAdjustment',entityId:request.id,after:s.snapshot(result),reason:reasonText(data)});return result;
  });
}
export function reviewAdjustment(db: PrismaClient, actor: StockActor, key: unknown, id: unknown, decision: 'APPROVE'|'REJECT'|'CANCEL', body: unknown) {
  const b=s.input(body,['reviewNote']),requestId=s.text(id,'request ID',80),reviewNote=s.optionalText(b.reviewNote,'review note',1000);
  if(decision==='REJECT'&&!reviewNote)throw new StockError(400,'Enter a rejection reason.');
  return s.write(db,actor,key,decision+'_ADJUSTMENT',{requestId,reviewNote},async(tx,operationId,actorId)=>{
    const staff=await currentStaff(tx,actorId,decision!=='CANCEL');const found=await tx.$queryRaw<{id:string}[]>`SELECT "id" FROM "StockAdjustment" WHERE "id"=${requestId} FOR UPDATE`;if(!found.length)throw new StockError(404,'Stock request not found.');
    const request=await tx.stockAdjustment.findUniqueOrThrow({where:{id:requestId},include:{lines:true}});
    if(request.status!=='PENDING')throw new StockError(409,'This stock request has already been reviewed.');
    if(decision!=='CANCEL'&&request.preparedById===actorId)throw new StockError(403,'A different administrator must review this request.');
    if(decision==='CANCEL'&&request.preparedById!==actorId&&!(staff.role??'').split(',').some(role=>role.trim()==='admin'))throw new StockError(403,'Only its preparer or an administrator can cancel this request.');
    if(decision==='APPROVE'){
      await s.lockBatches(tx,request.lines.map(line=>line.batchId));const current=await balances(tx,request.lines.map(line=>line.batchId));
      for(const line of request.lines){if(!fresh(line,currentFor(current,line.batchId)))throw new StockError(409,'Stock changed while this request was awaiting review. Cancel or reject it and submit a fresh count or loss.');const batch=await tx.stockBatch.findUniqueOrThrow({where:{id:line.batchId},include:{product:{select:{baseUnit:true}}}});if(batch.product.baseUnit!==line.baseUnit)throw new StockError(409,'The stock unit changed. Submit a new request.');if(request.kind==='WRITE_OFF'&&batch.expiryDate.toISOString().slice(0,10)>=todayInput())throw new StockError(409,'This batch is not expired.');}
    }
    await tx.stockAdjustment.update({where:{id:requestId},data:{status:decision==='APPROVE'?'POSTED':decision==='REJECT'?'REJECTED':'CANCELLED',reviewedById:actorId,reviewedAt:new Date(),reviewNote,postedOperationId:decision==='APPROVE'?operationId:null}});
    if(decision==='APPROVE')for(const line of request.lines){if(line.changeQuantity.isZero())continue;const movement=await tx.stockMovement.create({data:{operationId,batchId:line.batchId,type:request.kind==='COUNT'?'ADJUSTMENT':'LOSS',quantity:line.changeQuantity,baseUnit:line.baseUnit,reference:request.reference,reason:reasonText(request),actorId,approvedById:actorId}});await tx.stockAdjustmentLine.update({where:{id:line.id},data:{movementId:movement.id}});}
    const result=await adjustmentDto(tx,requestId);await audit(tx,{userId:actorId,action:'STOCK_ADJUSTMENT_'+(decision==='APPROVE'?'POSTED':decision==='REJECT'?'REJECTED':'CANCELLED'),entity:'StockAdjustment',entityId:requestId,before:s.snapshot(request),after:s.snapshot(result),reason:reviewNote??reasonText(request)});return result;
  });
}
