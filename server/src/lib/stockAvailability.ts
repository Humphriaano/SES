import { Prisma, PrismaClient } from '@prisma/client';
import { audit } from './billingOps';
import { applyPrescriptionAvailability } from './prescriptionAvailability';
import { prescriptionStockAvailability } from './stockDispensing';
import { StockActor, StockError, stockPrimitives as s } from './stock';

type Tx = Prisma.TransactionClient;
type Rx = { id:string; notAvailable:boolean; dispensed:boolean; medication:{catalogueCode:string|null;quantityUnit:string|null;quantity:Prisma.Decimal|null}; encounter:{patientId:string} };

async function applyVerifiedStock(tx:Tx, rx:Rx, userId:string|undefined, initial:boolean) {
  const stock = await prescriptionStockAvailability(tx, rx.medication, true);
  // A partial course is a pharmacist decision. An unknown unit or untracked
  // medicine keeps its existing manual availability and financial state.
  let result:{notAvailable:boolean;billingChange:string} = { notAvailable:rx.notAvailable, billingChange:'UNCHANGED' };
  if (stock.state === 'UNAVAILABLE' || (!initial && stock.state === 'AVAILABLE')) result = await applyPrescriptionAvailability(tx, rx, stock.state === 'UNAVAILABLE', userId, true);
  if (stock.tracked) await audit(tx, {userId,action:'STOCK_PRESCRIPTION_AVAILABILITY',entity:'Prescription',entityId:rx.id,patientId:rx.encounter.patientId,before:{notAvailable:rx.notAvailable},after:{...stock,...result},reason:initial?'Verified stock at prescription charge creation':'Individual pharmacy stock review'});
  return {id:rx.id,...stock,...result};
}

// Only called for a newly created charge, never as a retry over an existing
// invoice line. Billing failures must not undo the clinical prescription.
export async function initialPrescriptionStock(tx:Tx, rx:Rx, userId?:string) {
  if (rx.dispensed) return;
  // Honour a manual unavailability decision that raced delayed billing.
  if (rx.notAvailable) return applyPrescriptionAvailability(tx,rx,true,userId,true);
  return applyVerifiedStock(tx,rx,userId,true);
}

export function reviewPrescriptionStock(db:PrismaClient,actor:StockActor,key:unknown,body:unknown) {
  const input=s.input(body,['prescriptionId']),prescriptionId=s.text(input.prescriptionId,'prescription ID',80);
  return s.write(db,actor,key,'CHECK_PRESCRIPTION_STOCK',{prescriptionId},async(tx,_operationId,userId)=>{
    const staff=await tx.user.findUnique({where:{id:userId},select:{status:true,role:true}});
    if(staff?.status!=='active'||!(staff.role??'').split(',').some(role=>['admin','pharmacist'].includes(role.trim())))throw new StockError(403,'Active pharmacy access is required.');
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'dispense:'+prescriptionId}))`;
    const rx=await tx.prescription.findUnique({where:{id:prescriptionId},include:{medication:true,encounter:{select:{patientId:true}}}});
    if(!rx)throw new StockError(404,'Prescription not found.');
    if(rx.dispensed)throw new StockError(409,'This prescription has already been dispensed.');
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'invoice:'+rx.encounter.patientId}))`;
    return applyVerifiedStock(tx,rx,userId,false);
  });
}
