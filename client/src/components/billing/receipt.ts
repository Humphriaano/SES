import api from '../../api/client';
import { METHOD_LABEL, plain } from '../../lib/money';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const when = (d: string) => new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

const STATUS_LABEL: Record<string, string> = { OPEN: 'Not paid yet', PART_PAID: 'Part paid', PAID: 'Paid', VOID: 'Void', WAIVED: 'Waived (free / exempt)' };
const SOURCE_LABEL: Record<string, string> = { CONSULTATION: 'Consultation', PRESCRIPTION: 'Drug', INVESTIGATION: 'Investigation', PROCEDURE: 'Procedure', MANUAL: 'Other' };
const day = (d: string) => new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

// Use an image rather than a CSS background so the mark also prints when the
// browser's background-graphics option is off. Fixed positioning repeats it on long invoices.
const WATERMARK_CSS = `
  body{isolation:isolate}
  .billing-watermark{position:fixed;top:50%;left:50%;width:340px;max-width:70vw;height:auto;transform:translate(-50%,-50%);filter:brightness(0);opacity:.055;pointer-events:none;z-index:0;print-color-adjust:exact;-webkit-print-color-adjust:exact}
  .print-content{position:relative;z-index:1}
`;
const watermark = () => `<img class="billing-watermark" src="${esc(window.location.origin)}/ses-mark.svg" alt="" aria-hidden="true">`;

// Opens a print-ready A4 invoice in a new window: every charge, the discount, what has been paid and what is still owing.
// Void and waived invoices are stamped; removed charges are left off, voided receipts are shown struck through.
export async function printInvoice(invoiceId: string, generatedBy = ''): Promise<boolean> {
  const { data: inv } = await api.get(`/invoices/${invoiceId}`);
  const patient = inv.patient ?? { firstName: '', lastName: '' };
  const lines = inv.lines.filter((l: any) => l.status === 'ACTIVE');
  const payments = inv.payments;
  const stamp = inv.status === 'VOID' ? 'VOID' : inv.status === 'WAIVED' ? 'WAIVED' : inv.status === 'PAID' ? 'PAID' : '';
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Invoice ${esc(inv.number)}</title>
<style>
  ${WATERMARK_CSS}
  *{box-sizing:border-box} @page{size:A4;margin:16mm}
  body{font-family:Segoe UI,Arial,sans-serif;color:#1b1f23;margin:0;padding:24px;max-width:780px;margin:auto;font-size:13px}
  header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #1F5F96;padding-bottom:12px;margin-bottom:16px}
  h1{font-size:22px;margin:0;color:#1F5F96} h2{font-size:13px;margin:18px 0 6px;text-transform:uppercase;letter-spacing:.06em;color:#5b6670}
  .m{color:#5b6670} .r{text-align:right;white-space:nowrap} .meta td{padding:2px 0;vertical-align:top}
  table{width:100%;border-collapse:collapse} .lines th{background:#eef3f8;text-align:left;padding:7px 8px;font-size:12px;border-bottom:1px solid #cbd5df}
  .lines td{padding:7px 8px;border-bottom:1px solid #e3e8ee;vertical-align:top} .lines th.r,.lines td.r{text-align:right}
  .sum{width:300px;margin-left:auto;margin-top:12px} .sum td{padding:3px 0} .sum .tot td{font-weight:700;font-size:14px;border-top:1px solid #1b1f23;padding-top:6px}
  .bal td{font-weight:800;font-size:15px;color:#C41E25} .pay td{padding:4px 8px;border-bottom:1px solid #e3e8ee} .struck{text-decoration:line-through;color:#8a949e}
  .stamp{position:fixed;top:38%;left:0;right:0;text-align:center;font-size:96px;font-weight:800;color:rgba(196,30,37,.14);transform:rotate(-18deg);pointer-events:none}
  .stamp.paid{color:rgba(31,122,60,.14)} .em{display:inline-block;background:#C41E25;color:#fff;border-radius:4px;padding:1px 8px;font-size:11px;font-weight:700;margin-left:8px}
  footer{margin-top:28px;border-top:1px dashed #9aa4ad;padding-top:10px;text-align:center}
  @media print{body{padding:0}}
</style></head><body>
${watermark()}<div class="print-content">
${stamp ? `<div class="stamp${stamp === 'PAID' ? ' paid' : ''}">${stamp}</div>` : ''}
<header>
  <div><h1>SES EHR</h1><div class="m">Invoice</div></div>
  <table class="meta" style="width:auto">
    <tr><td class="m">Invoice no.</td><td class="r"><b>${esc(inv.number)}</b>${inv.emergency ? '<span class="em">EMERGENCY</span>' : ''}</td></tr>
    <tr><td class="m">Date</td><td class="r">${esc(day(inv.createdAt))}</td></tr>
    <tr><td class="m">Status</td><td class="r">${esc(STATUS_LABEL[inv.status] ?? inv.status)}</td></tr>
    ${inv.dueDate && inv.balance > 0 && inv.status !== 'VOID' && inv.status !== 'WAIVED' ? `<tr><td class="m">Balance due by</td><td class="r">${esc(day(inv.dueDate))}</td></tr>` : ''}
  </table>
</header>
<h2>Patient</h2>
<div><b>${esc(patient.firstName)} ${esc(patient.lastName)}</b>${patient.nationalId ? ` <span class="m">· NRC ${esc(patient.nationalId)}</span>` : ''}${patient.phone ? ` <span class="m">· ${esc(patient.phone)}</span>` : ''}</div>
<h2>Charges</h2>
<table class="lines">
  <thead><tr><th>Description</th><th class="r">Qty</th><th class="r">Unit price</th><th class="r">Amount</th></tr></thead>
  <tbody>
  ${lines.map((l: any) => `<tr><td>${esc(l.description)}<div class="m" style="font-size:11.5px">${esc(SOURCE_LABEL[l.sourceType] ?? l.sourceType)}${l.detail ? ' · ' + esc(l.detail) : ''}</div></td><td class="r">${esc(l.quantity)}</td><td class="r">${l.unitPrice === null ? '—' : plain(l.unitPrice)}</td><td class="r">${l.lineTotal === null ? '—' : plain(l.lineTotal)}</td></tr>`).join('') || '<tr><td colspan="4" class="m">No charges.</td></tr>'}
  </tbody>
</table>
<table class="sum">
  <tr><td class="m">Charges</td><td class="r">ZMW ${plain(inv.total)}</td></tr>
  ${inv.discount > 0 ? `<tr><td class="m">Discount${inv.discountReason ? ' (' + esc(inv.discountReason) + ')' : ''}</td><td class="r">− ZMW ${plain(inv.discount)}</td></tr>` : ''}
  <tr class="tot"><td>Total to pay</td><td class="r">ZMW ${plain(inv.payable)}</td></tr>
  <tr><td class="m">Paid</td><td class="r">ZMW ${plain(inv.paid)}</td></tr>
  <tr class="bal"><td>${inv.balance < 0 ? 'Overpaid (kept as credit)' : 'Balance'}</td><td class="r">ZMW ${plain(Math.abs(inv.balance))}</td></tr>
</table>
${inv.status === 'WAIVED' && inv.waivedReason ? `<p class="m">Free / exempt: ${esc(inv.waivedReason)}</p>` : ''}
${inv.status === 'VOID' && inv.voidReason ? `<p class="m">Voided: ${esc(inv.voidReason)}</p>` : ''}
${payments.length ? `<h2>Payments</h2>
<table class="pay">
  ${payments.map((p: any) => `<tr class="${p.status === 'VOID' ? 'struck' : ''}"><td>${esc(p.receiptNumber)}${p.status === 'VOID' ? ' (void)' : ''}</td><td>${esc(when(p.createdAt))}</td><td>${esc(METHOD_LABEL[p.method] ?? p.method)}${p.reference ? ' · ' + esc(p.reference) : ''}</td><td>${esc(p.payerName ?? '')}</td><td class="r">ZMW ${plain(p.amount)}</td></tr>`).join('')}
</table>` : ''}
<footer class="m">${generatedBy ? `Generated by ${esc(generatedBy)}<br>` : ''}Printed ${esc(when(new Date().toISOString()))} · Thank you</footer>
</div>
<script>window.onload=function(){window.focus();window.print();}</script>
</body></html>`;
  const w = window.open('', '_blank', 'width=900,height=800');
  if (!w) return false;           // pop-up blocked
  w.document.open(); w.document.write(html); w.document.close();
  return true;
}

// Opens a print-ready receipt (or the invoice) in a new window. Money is in kwacha; a voided receipt is marked VOID.
export async function printReceipt(paymentId: string, generatedBy = ''): Promise<boolean> {
  const { data } = await api.get(`/payments/${paymentId}/receipt`);
  const { payment: p, invoice: inv, patient } = data;
  const lines = inv.lines.filter((l: any) => l.status === 'ACTIVE');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Receipt ${esc(p.receiptNumber)}</title>
<style>
  ${WATERMARK_CSS}
  .billing-watermark{width:220px}
  *{box-sizing:border-box} body{font-family:Segoe UI,Arial,sans-serif;color:#1b1f23;margin:0;padding:24px;max-width:380px;margin:auto;font-size:13px}
  h1{font-size:18px;margin:0} .c{text-align:center} .m{color:#5b6670} hr{border:0;border-top:1px dashed #9aa4ad;margin:12px 0}
  table{width:100%;border-collapse:collapse} td{padding:3px 0;vertical-align:top} td.r{text-align:right;white-space:nowrap}
  .tot td{font-weight:700;font-size:14px} .void{position:fixed;top:40%;left:0;right:0;text-align:center;font-size:72px;font-weight:800;color:rgba(196,30,37,.25);transform:rotate(-18deg)}
  @media print{body{padding:0}}
</style></head><body>
${watermark()}<div class="print-content">
${p.status === 'VOID' ? '<div class="void">VOID</div>' : ''}
<div class="c"><h1>SES EHR</h1><div class="m">Payment receipt</div></div><hr>
<table>
<tr><td class="m">Receipt</td><td class="r"><b>${esc(p.receiptNumber)}</b></td></tr>
<tr><td class="m">Date</td><td class="r">${esc(when(p.createdAt))}</td></tr>
<tr><td class="m">Invoice</td><td class="r">${esc(inv.number)}</td></tr>
<tr><td class="m">Patient</td><td class="r">${esc(patient.firstName)} ${esc(patient.lastName)}</td></tr>
${p.payerName ? `<tr><td class="m">Paid by</td><td class="r">${esc(p.payerName)}${p.payerPhone ? ' · ' + esc(p.payerPhone) : ''}</td></tr>` : ''}
</table><hr>
<table>${lines.map((l: any) => `<tr><td>${esc(l.description)}${l.quantity !== 1 ? ` <span class="m">× ${l.quantity}</span>` : ''}</td><td class="r">${l.lineTotal === null ? '—' : plain(l.lineTotal)}</td></tr>`).join('')}</table><hr>
<table>
<tr><td class="m">Invoice total</td><td class="r">ZMW ${plain(inv.total)}</td></tr>
${inv.discount > 0 ? `<tr><td class="m">Discount</td><td class="r">− ZMW ${plain(inv.discount)}</td></tr>` : ''}
<tr class="tot"><td>Paid now (${esc(METHOD_LABEL[p.method] ?? p.method)})</td><td class="r">ZMW ${plain(p.amount)}</td></tr>
${p.reference ? `<tr><td class="m">Reference</td><td class="r">${esc(p.reference)}</td></tr>` : ''}
<tr><td class="m">Total paid to date</td><td class="r">ZMW ${plain(inv.paid)}</td></tr>
<tr><td class="m">Balance</td><td class="r"><b>ZMW ${plain(Math.max(inv.balance, 0))}</b></td></tr>
</table><hr>
<div class="c m">Received by ${esc(p.receivedByName ?? '')}${generatedBy ? `<br>Generated by ${esc(generatedBy)}` : ''}<br>Thank you</div>
</div>
<script>window.onload=function(){window.focus();window.print();}</script>
</body></html>`;
  const w = window.open('', '_blank', 'width=460,height=700');
  if (!w) return false;           // pop-up blocked
  w.document.open(); w.document.write(html); w.document.close();
  return true;
}
