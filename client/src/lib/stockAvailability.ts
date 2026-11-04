import api from '../api/client';
import { newStockRequest, PendingStockRequest, stockRequestRejected } from './stockReceiving';

export interface StockAvailabilityResult { id:string; state:'UNTRACKED'|'UNKNOWN'|'REVIEW'|'UNAVAILABLE'|'PARTIAL'|'AVAILABLE'; tracked:boolean; available:string|null; required:string|null; baseUnit:string|null; notAvailable:boolean; billingChange:'VOIDED'|'RESTORED'|'UNCHANGED'|'PROTECTED' }
export const STOCK_REVIEW_EVENT='ses-stock-availability-pending';
const scope=(userId:string)=>'ses.stock-availability.pending:'+userId;
export function readStockReview(userId:string):PendingStockRequest|null {
  const raw=localStorage.getItem(scope(userId));if(!raw)return null;
  let saved;try{saved=JSON.parse(raw)}catch{throw new Error('The pending stock review could not be read. Keep browser data and contact support.')}
  if(!saved||typeof saved.key!=='string'||saved.url!=='/pharmacy-stock/prescription-availability'||typeof saved.body?.prescriptionId!=='string'||Object.keys(saved.body).length!==1)throw new Error('The pending stock review could not be read. Keep browser data and contact support.');
  return saved;
}
function changed(){window.dispatchEvent(new Event(STOCK_REVIEW_EVENT))}
async function send(userId:string,pending:PendingStockRequest) {
  try {
    const result=await api.post<StockAvailabilityResult>(pending.url,pending.body,{headers:{'Idempotency-Key':pending.key}});
    if(readStockReview(userId)?.key===pending.key)localStorage.removeItem(scope(userId));changed();return result;
  }catch(error){if(stockRequestRejected(error)){if(readStockReview(userId)?.key===pending.key)localStorage.removeItem(scope(userId));changed()}throw error}
}
export function reviewStock(userId:string,prescriptionId:string) {
  if(readStockReview(userId))throw new Error('Resolve the pending stock review first.');
  const pending=newStockRequest('/pharmacy-stock/prescription-availability',{prescriptionId});
  localStorage.setItem(scope(userId),JSON.stringify(pending));changed();return send(userId,pending);
}
export function retryStockReview(userId:string) {const pending=readStockReview(userId);if(!pending)throw new Error('There is no pending stock review.');return send(userId,pending)}
export function stockReviewMessage(result:StockAvailabilityResult) {
  if(result.billingChange==='PROTECTED')return 'Stock checked; the void or waived invoice was left unchanged.';
  if(result.billingChange==='VOIDED')return 'No usable stock. The prescription charge was removed.';
  if(result.billingChange==='RESTORED')return 'Stock is available. The original prescription charge was restored.';
  if(result.state==='PARTIAL')return 'Partial stock. Availability and the charge stay unchanged for pharmacist review.';
  if(result.state==='UNTRACKED')return 'Untracked medicine. Use the existing availability controls.';
  if(result.state==='UNKNOWN'||result.state==='REVIEW')return 'Check the physical supply unit or quantity. The charge is unchanged.';
  return result.notAvailable?'No usable stock; marked unavailable.':'Stock checked. The charge is unchanged.';
}
export const pharmacyStockKey=(medication:{catalogueCode?:string|null;name:string;quantityUnit?:string|null})=>medication.catalogueCode?medication.catalogueCode+':'+(medication.quantityUnit??'unknown'):medication.name;
