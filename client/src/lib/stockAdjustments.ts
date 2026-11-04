import { todayInput } from './prescriptionCourse';
import { PendingStockRequest, readStockRequest } from './stockReceiving';

export type AdjustmentKind = 'LOSS'|'WRITE_OFF'|'COUNT';
export const ADJUSTMENT_KINDS: Record<AdjustmentKind,string> = { LOSS:'Loss or damage', WRITE_OFF:'Expiry write-off', COUNT:'Physical count' };
export const ADJUSTMENT_REASONS: Record<AdjustmentKind,Record<string,string>> = {
  LOSS:{DAMAGE:'Damaged stock',BREAKAGE:'Breakage',SPILLAGE:'Spillage',THEFT:'Theft',MISSING:'Missing stock',OTHER:'Other loss'},
  WRITE_OFF:{EXPIRED:'Expired stock'},COUNT:{ROUTINE_COUNT:'Routine physical count',COUNT_CORRECTION:'Count correction',OTHER:'Other count variance'},
};
export interface AdjustmentBatch { batchId:string; productId:string; catalogueRef:string; name:string; detail:string|null; brand:string; manufacturer:string|null; baseUnit:string; lotNumber:string; expiryDate:string; physical:string; postingOrder:string; state:string }
export interface AdjustmentDraftLine { batch:AdjustmentBatch; value:string; changed?:boolean }
export interface AdjustmentDraft { kind:AdjustmentKind; reference:string; reasonCode:string; reason:string; lines:AdjustmentDraftLine[] }
export function freshAdjustment(kind:AdjustmentKind='COUNT'):AdjustmentDraft { return{kind,reference:kind+'-'+todayInput(),reasonCode:kind==='WRITE_OFF'?'EXPIRED':kind==='COUNT'?'ROUTINE_COUNT':'',reason:'',lines:[]}; }
export function readAdjustmentDraft(scope:string):AdjustmentDraft {
  try {
    const saved=JSON.parse(localStorage.getItem(scope)??'null');
    if(!saved||!Object.prototype.hasOwnProperty.call(ADJUSTMENT_KINDS,saved.kind)||typeof saved.reference!=='string'||typeof saved.reasonCode!=='string'||typeof saved.reason!=='string'||!Array.isArray(saved.lines)||saved.lines.length>50)return freshAdjustment();
    if(!saved.lines.every((line:AdjustmentDraftLine)=>line&&typeof line.value==='string'&&line.batch&&['batchId','productId','catalogueRef','name','brand','baseUnit','lotNumber','expiryDate','physical','postingOrder','state'].every(key=>typeof (line.batch as unknown as Record<string,unknown>)[key]==='string')&&cents(line.batch.physical)!==null&&/^\d{1,19}$/.test(line.batch.postingOrder)))return freshAdjustment();
    return saved;
  }catch{return freshAdjustment()}
}
function cents(value:string):bigint|null { if(!/^\d{1,11}(?:\.\d{1,2})?$/.test(value))return null;const[w,f='']=value.split('.'),n=BigInt(w)*100n+BigInt(f.padEnd(2,'0'));return n<=1000000000000n?n:null; }
function decimal(n:bigint) { const negative=n<0n,value=negative?-n:n;return(negative?'-':'')+value/100n+'.'+String(value%100n).padStart(2,'0'); }
export function adjustmentDelta(kind:AdjustmentKind,batch:Pick<AdjustmentBatch,'physical'|'baseUnit'>,value:string):string|null {
  const expected=cents(batch.physical),entered=cents(value);if(expected===null||entered===null||(batch.baseUnit==='bottle'&&entered%100n!==0n))return null;
  if(kind!=='COUNT'&&(entered<=0n||entered>expected))return null;
  return decimal(kind==='COUNT'?entered-expected:-entered);
}
export function refreshedAdjustmentLine(line:AdjustmentDraftLine,batch:AdjustmentBatch|undefined):AdjustmentDraftLine {
  if(!batch)return{...line,value:'',changed:true};
  const changed=batch.postingOrder!==line.batch.postingOrder||batch.physical!==line.batch.physical||batch.baseUnit!==line.batch.baseUnit;
  return{batch,value:changed?'':line.value,changed:changed||line.changed};
}
export function adjustmentBody(draft:AdjustmentDraft) {
  if(!draft.reference.trim()||!draft.reasonCode||!ADJUSTMENT_REASONS[draft.kind][draft.reasonCode]||(draft.reasonCode==='OTHER'&&!draft.reason.trim())||!draft.lines.length||draft.lines.length>50)return null;
  if(draft.lines.some(line=>adjustmentDelta(draft.kind,line.batch,line.value)===null))return null;
  return{kind:draft.kind,reference:draft.reference.trim(),reasonCode:draft.reasonCode,reason:draft.reason.trim(),lines:draft.lines.map(line=>({batchId:line.batch.batchId,baseUnit:line.batch.baseUnit,expectedQuantity:line.batch.physical,expectedPostingOrder:line.batch.postingOrder,...(draft.kind==='COUNT'?{countedQuantity:line.value}:{quantity:line.value})}))};
}
export function readAdjustmentPending(scope:string):PendingStockRequest|null {
  if(!localStorage.getItem(scope))return null;
  const pending=readStockRequest(scope);
  if(!pending||!/^\/pharmacy-stock\/adjustments(?:\/[^/]+\/(?:approve|reject|cancel))?$/.test(pending.url))throw new Error('The pending stock request could not be read. Keep this browser data and contact support.');
  return pending;
}
