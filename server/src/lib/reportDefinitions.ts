import { registerReport } from './reportRegistry';
import { buildReport } from '../controllers/billingReports.controller';
import { buildStockReport } from '../controllers/stockReports.controller';
import { StockError } from './stock';
import { CLINICAL_ROLES, REPORT_ROLES } from './clinicalAccess';
import { ATTENDANCE_DEFINITIONS, attendanceLines, attendanceReport } from './attendanceReports';
import { LAB_DEFINITIONS, labAbnormal, labAbnormalLines, labTestLines, labTests, labTurnaround, labTurnaroundLines } from './labReports';
import { PHARMACY_DEFINITIONS, pharmacyDispensed, pharmacyDispensedLines, pharmacyPrescriptionLines, pharmacyPrescriptions } from './pharmacyReports';
import { BUSY_DEFINITIONS, busyTimes, busyTimesLines } from './busyTimes';
import { CHRONIC_DEFINITIONS, chronicLines, chronicOverdue, chronicRegister } from './chronicReports';

// Every report the Reports hub can open, with who may see it. Importing this file registers them.
// The billing and stock reports are wrapped as they are: the same queries, the same figures, the same roles as their own screens.

const BILLING = ['admin', 'billing'], PHARMACY = ['admin', 'pharmacist'];
const billing = (name: string) => (q: Record<string, unknown>) => buildReport(name, q);
const stock = (name: string) => async (q: Record<string, unknown>) => {
  try { return await buildStockReport(name, q as Record<string, string>); }
  catch (error) { if (error instanceof StockError && error.status < 500) return { error: error.message }; throw error; }
};

registerReport({
  area: 'billing', name: 'daybook', title: 'Day book', description: 'Every payment taken and every invoice raised in the period.',
  definitions: [
    'Money in is cash, mobile money and card actually received. Account credit used is shown but is not new money.',
    'Every invoice raised in the period appears as a billed line, paid or not. Filtering by payment type or cashier shows money taken only.',
    'Voided receipts are listed and not counted. Voided and waived invoices are not counted as billed.',
    'Shows at most the first 5,000 payments and 5,000 invoices of the period.',
  ],
  filters: ['from', 'to', 'method', 'service', 'cashier'], roles: { aggregate: BILLING, export: BILLING }, run: billing('daybook'),
});
registerReport({
  area: 'billing', name: 'revenue', title: 'Revenue by service', description: 'What was charged in the period, by kind of service.',
  definitions: [
    'Charged is the value of active charge lines created in the period, on invoices that are not void or waived.',
    'Discounts are those on invoices raised in the period. Waived is the value of waived invoices raised in the period.',
    'Money collected is payments received in the period, other than account credit.',
  ],
  filters: ['from', 'to', 'service'], roles: { aggregate: BILLING, export: BILLING }, run: billing('revenue'),
});
registerReport({
  area: 'billing', name: 'fast-moving', title: 'Fast-moving items and services', description: 'The items and services charged most often in the period.',
  definitions: [
    'Active charge lines created in the period on invoices that are not void or waived, grouped by catalogue item. Items typed in by hand are grouped by their own wording.',
    'Ranked by number of charges. The sort filter ranks by quantity or by value instead.',
  ],
  filters: ['from', 'to', 'service', 'sort'], roles: { aggregate: BILLING, export: BILLING }, run: billing('fast-moving'),
});
registerReport({
  area: 'billing', name: 'outstanding', title: 'Outstanding balances', description: 'Invoices that still have a balance to pay, as at now.',
  definitions: [
    'Invoices that are open or part paid with a balance above zero. The period does not apply: it is always as at now.',
    'Age is the days since the invoice was raised. Overdue means past the invoice\'s due date.',
    'Shows at most 2,000 invoices.',
  ],
  filters: [], roles: { aggregate: BILLING, export: BILLING }, run: billing('outstanding'),
});
registerReport({
  area: 'billing', name: 'collections', title: 'Collections by staff member', description: 'Money received in the period, by the staff member who took it.',
  definitions: [
    'Payments received in the period, grouped by the staff member who took them.',
    'Total is cash, mobile money and card. Account credit used is shown separately and is not new money.',
    'Voided receipts are counted separately and are not in the totals.',
  ],
  filters: ['from', 'to'], roles: { aggregate: BILLING, export: BILLING }, run: billing('collections'),
});

registerReport({
  area: 'stock', name: 'on-hand', title: 'Stock on hand', description: 'What the pharmacy holds now, by item.',
  definitions: ['Quantity on hand is the sum of the stock ledger for each batch, as at now. The ledger is never edited; a correction is a new entry.'],
  filters: ['q', 'level'], roles: { aggregate: PHARMACY, export: PHARMACY }, run: stock('on-hand'),
});
registerReport({
  area: 'stock', name: 'expiry', title: 'Batches by expiry', description: 'Batches that still hold stock, by expiry date.',
  definitions: [
    'Batches that still hold stock, as at now. The within filter keeps only those expiring in that many days; the state filter chooses usable or expired.',
  ],
  filters: ['q', 'state', 'within'], roles: { aggregate: PHARMACY, export: PHARMACY }, run: stock('expiry'),
});
registerReport({
  area: 'stock', name: 'movements', title: 'Stock movements', description: 'Everything received, issued, lost, adjusted or reversed in the period.',
  definitions: ['Every stock movement recorded in the period: received, issued, loss, adjustment and reversal. A mistake is corrected by a reversal, never by editing a row.'],
  filters: ['from', 'to', 'type', 'q'], roles: { aggregate: PHARMACY, export: PHARMACY }, run: stock('movements'),
});
registerReport({
  area: 'stock', name: 'adjustments', title: 'Adjustments, losses and write-offs', description: 'Stock adjustments submitted in the period and their review status.',
  definitions: ['Adjustments, losses and write-offs submitted in the period, with whether they have been reviewed.'],
  filters: ['from', 'to', 'status', 'q'], roles: { aggregate: PHARMACY, export: PHARMACY }, run: stock('adjustments'),
});
registerReport({
  area: 'stock', name: 'reorder', title: 'Reorder suggestions', description: 'What to order, from recent use and delivery time.',
  definitions: [
    'Use is the quantity issued less issues reversed over the last days (default 90), per day it was in stock.',
    'Suggested order is the quantity that covers the delivery time plus the cover days at that rate of use, less what is available now.',
  ],
  filters: ['days', 'lead', 'cover', 'status', 'q'], roles: { aggregate: PHARMACY, export: PHARMACY }, run: stock('reorder'),
});

// Attendance (Reports Hub stage 3). Counts are open to everyone who may open the Reports page. The records behind them name real people,
// so they are limited to the clinical roles, and names (as opposed to a patient code and a masked NRC) must be asked for, by those roles only.
registerReport({
  area: 'attendance', name: 'attendance', title: 'Attendance', description: 'Who came, split into new and returning, by age and sex, with the records behind every number.',
  definitions: ATTENDANCE_DEFINITIONS,
  filters: ['from', 'to', 'servicePoint', 'sex', 'ageBand', 'groupBy', 'visit', 'names'],
  roles: { aggregate: REPORT_ROLES, lineList: CLINICAL_ROLES, names: CLINICAL_ROLES, export: REPORT_ROLES },
  run: attendanceReport, lineList: { run: attendanceLines },
});

// Chronic disease (Reports Hub stage 4). Counts are open to everyone who may open the Reports page; the patients behind them are for the clinical roles.
const CHRONIC_FILTERS = ['from', 'to', 'condition', 'measure', 'status', 'seen', 'control', 'names'];
registerReport({
  area: 'chronic', name: 'register', title: 'Chronic disease register', description: 'Active, new, resolved, seen and overdue patients per condition, with blood pressure control for hypertension.',
  definitions: CHRONIC_DEFINITIONS, filters: CHRONIC_FILTERS,
  roles: { aggregate: REPORT_ROLES, lineList: CLINICAL_ROLES, names: CLINICAL_ROLES, export: REPORT_ROLES },
  run: chronicRegister, lineList: { run: (q, o) => chronicLines('register', q, o) },
});
registerReport({
  area: 'chronic', name: 'overdue', title: 'Overdue and defaulters', description: 'Patients with a chronic condition who have not been seen in 90 days, and how long it has been.',
  definitions: CHRONIC_DEFINITIONS, filters: CHRONIC_FILTERS,
  roles: { aggregate: REPORT_ROLES, lineList: CLINICAL_ROLES, names: CLINICAL_ROLES, export: REPORT_ROLES },
  run: chronicOverdue, lineList: { run: (q, o) => chronicLines('overdue', q, o) },
});

// Laboratory (Reports Hub stage 5). How long tests take and how many are done are operational counts, open to everyone who may open the Reports page.
// Abnormal and positive results say something about patients' health (an HIV or malaria result, for example), so they are for the clinical roles only.
const LAB_FILTERS = ['from', 'to', 'test', 'specimen', 'groupBy', 'names'];
registerReport({
  area: 'lab', name: 'tests', title: 'Tests ordered and done', description: 'Tests ordered in the period by test or specimen, and how many are pending, in progress or completed.',
  definitions: LAB_DEFINITIONS, filters: [...LAB_FILTERS, 'status'],
  roles: { aggregate: REPORT_ROLES, lineList: CLINICAL_ROLES, names: CLINICAL_ROLES, export: REPORT_ROLES },
  run: labTests, lineList: { run: labTestLines },
});
registerReport({
  area: 'lab', name: 'turnaround', title: 'Turnaround', description: 'Median and longest time from order to result, slowest tests first.',
  definitions: LAB_DEFINITIONS, filters: LAB_FILTERS,
  roles: { aggregate: REPORT_ROLES, lineList: CLINICAL_ROLES, names: CLINICAL_ROLES, export: REPORT_ROLES },
  run: labTurnaround, lineList: { run: labTurnaroundLines },
});
registerReport({
  area: 'lab', name: 'abnormal', title: 'Abnormal and positive results', description: 'Results the lab flagged as abnormal, positive or critical, by test, and the patients they belong to.',
  definitions: LAB_DEFINITIONS, filters: [...LAB_FILTERS, 'flag'],
  roles: { aggregate: CLINICAL_ROLES, lineList: CLINICAL_ROLES, names: CLINICAL_ROLES, export: CLINICAL_ROLES },
  run: labAbnormal, lineList: { run: labAbnormalLines },
});

// Pharmacy (Reports Hub stage 6): what was dispensed and what was prescribed against it. Counts are open to everyone who may open the Reports page;
// the patients behind them are for the clinical roles. The stock reports keep their own area and screens.
registerReport({
  area: 'pharmacy', name: 'dispensed', title: 'Medicines dispensed', description: 'What was dispensed in the period, by item or by brand, with the dispensings behind every number.',
  definitions: PHARMACY_DEFINITIONS, filters: ['from', 'to', 'groupBy', 'item', 'brand', 'type', 'names'],
  roles: { aggregate: REPORT_ROLES, lineList: CLINICAL_ROLES, names: CLINICAL_ROLES, export: REPORT_ROLES },
  run: pharmacyDispensed, lineList: { run: pharmacyDispensedLines },
});
registerReport({
  area: 'pharmacy', name: 'prescriptions', title: 'Prescriptions and dispensed', description: 'Prescriptions written in the period against what was dispensed, not available or still waiting, by item.',
  definitions: PHARMACY_DEFINITIONS, filters: ['from', 'to', 'item', 'status', 'names'],
  roles: { aggregate: REPORT_ROLES, lineList: CLINICAL_ROLES, names: CLINICAL_ROLES, export: REPORT_ROLES },
  run: pharmacyPrescriptions, lineList: { run: pharmacyPrescriptionLines },
});

// Busy times (weekday by hour of check-in): the picture behind the staffing chart. Counts are open to everyone who may open the Reports page; the attendances
// behind each cell are for the clinical roles, like the Attendance report it is built from.
registerReport({
  area: 'attendance', name: 'busy-times', title: 'Busy times', description: 'Attendances by weekday and hour of check-in, to plan staffing.',
  definitions: BUSY_DEFINITIONS, filters: ['from', 'to', 'servicePoint', 'weekday', 'hour', 'names'],
  roles: { aggregate: REPORT_ROLES, lineList: CLINICAL_ROLES, names: CLINICAL_ROLES, export: REPORT_ROLES },
  run: busyTimes, lineList: { run: busyTimesLines },
});
