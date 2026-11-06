import { Router } from 'express';
import stockRoutes from './stock.routes';
import prescribingStockRoutes from './prescribingStock.routes';
import { recordProcedure, removeProcedure, listProcedures } from '../controllers/procedures.controller';
import { listTreatmentProcedures, completeTreatmentProcedure, returnTreatmentProcedure } from '../controllers/treatmentRoom.controller';
import { staffLoginRateLimit } from '../middleware/staffRateLimit';
import { register, login, checkUsername, getRoles, listUsers, updateUser, getCurrentUser } from '../controllers/auth.controller';
import { listPatients, getPatient, createPatient, updatePatient, resolveDiagnosis, addPatientDiagnosis, sendPortalInvitation } from '../controllers/patient.controller';
import {
  listEncounters, getEncounter, createEncounter, updateEncounter,
  addDiagnosis, closeEncounter,
} from '../controllers/encounter.controller';
import { getVitals, createVital } from '../controllers/vitals.controller';
import {
  getMedications, createMedication, updateMedication,
  getPrescriptions, createPrescription, dispensePrescription,
  listGlobalPrescriptions, getInventory, searchDrugs,
  createDispensing, getDispensing, getPatientDispensing, updateDispensing,
} from '../controllers/pharmacy.controller';
import {
  getLabOrders, createLabOrder, getLabResults, createLabResult,
} from '../controllers/investigations.controller';
import {
  createInvestigationOrder,
  getInvestigationOrders,
  updateInvestigationItem,
  createInvestigationResult,
  amendInvestigationResult,
  getInvestigationResultHistory,
} from '../controllers/investigationsV2.controller';
import { listPrices, exportPrices, createPrice, updatePrice, syncCatalogue, importPrices, priceHistory, lookupPrices } from '../controllers/price.controller';
import { setMissingPrice, savePointOfCarePrice } from '../controllers/pointOfCarePrice.controller';
import { getBillingItems, createBillingItem, updateBillingStatus, getPatientBalance } from '../controllers/billing.controller';
import { searchICD11, seedICD11 } from '../controllers/icd11.controller';
import { importDocumentData } from '../controllers/documentImport.controller';
import { getPatientQueue } from '../controllers/queue.controller';
import { getActiveRooms, getAllRooms, createRoom, updateRoom, deleteRoom } from '../controllers/facility.room.controller';
import { getEntries, getQueueSummary, getPatientEntry, callNext, checkin, updateStatus, rerouteEntry, startEntry } from '../controllers/queue.entry.controller';
import { recordPreference, getPreferences } from '../controllers/user.room.preference.controller';
import { populationDiagnoses, populationVitals, populationMedications, populationInvestigations, populationPatients, populationKpis, populationChronic, populationOverview, populationExport } from '../controllers/reports.controller';
import { getRiskPrediction } from '../controllers/risk.controller';
import { buildCdsPayload, getCdsSignature } from '../controllers/cdsContext.controller';
import { listCustom, createDrug, updateDrug, createTest, updateTest, createDiagnosis, updateDiagnosis } from '../controllers/catalogue.controller';
import {
  listPatientInvoices, patientBillingSummary, patientVisitHistory, getInvoice, getReceipt, addManualLine, editLine, voidLine, takePayment, voidPayment,
  setDiscount, waiveInvoice, voidInvoice, releaseWithBalance, invoiceAudit, setPrescriptionAvailability,
} from '../controllers/invoice.controller';
import { mySession, openSession, closeSession, listSessions, deskOverview } from '../controllers/cashier.controller';
import { runReport, reportCashiers } from '../controllers/billingReports.controller';
import { authenticate, requireRoles } from '../middleware/auth';
import { CLINICAL_ROLES, REPORT_ROLES } from '../lib/clinicalAccess';
import { listRegisteredReports, runRegisteredLines, runRegisteredReport } from '../controllers/reportRegistry.controller';
import { CONDITION_EDITORS, createChronicCondition, listChronicConditions, updateChronicCondition } from '../controllers/chronicConditions.controller';

const router = Router();
router.use('/pharmacy-stock', stockRoutes);
router.use('/prescribing-stock', prescribingStockRoutes);

// Auth
router.post('/auth/register', register);
router.post('/auth/login', staffLoginRateLimit, login);
router.get('/auth/check-username', checkUsername);
router.get('/auth/me', authenticate, getCurrentUser);
router.get('/auth/roles', authenticate, getRoles);
router.get('/auth/users', authenticate, listUsers);
router.patch('/auth/users/:id', authenticate, updateUser);

// Clinical records require a clinical role even when a URL is entered directly.
// Keep this boundary before the individual handlers so denied requests never read or write a chart.
router.use([
  '/patients/:patientId/encounters', '/encounters',
  '/patients/:patientId/diagnoses', '/patients/:patientId/vitals',
  '/patients/:patientId/medications', '/medications', '/prescriptions',
  '/inventory', '/dispensing', '/patients/:patientId/dispensing',
  '/patients/:patientId/documents', '/patients/:patientId/lab-results',
  '/investigations', '/patients/:patientId/risk-predict',
  '/patients/:patientId/cds-payload', '/patients/:patientId/cds-signature',
], authenticate, requireRoles(...CLINICAL_ROLES));

// ICD-11
router.get('/icd11/search', authenticate, searchICD11);
router.post('/icd11/seed', authenticate, seedICD11);

// Patients
router.get('/patients', authenticate, listPatients);
router.post('/patients', authenticate, requireRoles(...CLINICAL_ROLES, 'receptionist'), createPatient);
router.get('/patients/:id', authenticate, getPatient);
router.patch('/patients/:id', authenticate, requireRoles(...CLINICAL_ROLES, 'receptionist'), updatePatient);
router.post('/patients/:patientId/diagnoses', authenticate, addPatientDiagnosis);
router.patch('/patients/:patientId/diagnoses/:diagnosisId/resolve', authenticate, resolveDiagnosis);
router.post('/patients/:id/portal-invite', authenticate, requireRoles(...CLINICAL_ROLES, 'receptionist'), sendPortalInvitation);

// Encounters
router.get('/patients/:patientId/encounters', authenticate, listEncounters);
router.post('/patients/:patientId/encounters', authenticate, createEncounter);
router.get('/encounters/:id', authenticate, getEncounter);
router.patch('/encounters/:id', authenticate, updateEncounter);
router.post('/encounters/:id/diagnoses', authenticate, addDiagnosis);
router.post('/encounters/:id/close', authenticate, closeEncounter);

// Vitals
router.get('/patients/:patientId/vitals', authenticate, getVitals);
router.post('/patients/:patientId/vitals', authenticate, createVital);

// Pharmacy
router.get('/patients/:patientId/medications', authenticate, getMedications);
router.post('/patients/:patientId/medications', authenticate, createMedication);
router.patch('/medications/:id', authenticate, updateMedication);
router.get('/encounters/:encounterId/procedures', authenticate, listProcedures);
router.post('/encounters/:encounterId/procedures', authenticate, recordProcedure);
router.delete('/encounters/:encounterId/procedures/:id', authenticate, removeProcedure);
router.get('/encounters/:encounterId/prescriptions', authenticate, getPrescriptions);
router.post('/encounters/:encounterId/prescriptions', authenticate, createPrescription);
router.post('/prescriptions/:id/dispense', authenticate, requireRoles('admin', 'pharmacist'), dispensePrescription);
router.get('/prescriptions', authenticate, listGlobalPrescriptions);
router.get('/inventory', authenticate, getInventory);
router.get('/drugs', authenticate, searchDrugs);
router.post('/dispensing', authenticate, requireRoles('admin', 'pharmacist'), createDispensing);
router.get('/dispensing', authenticate, getDispensing);
router.patch('/dispensing/:id', authenticate, updateDispensing);
router.get('/patients/:patientId/dispensing', authenticate, getPatientDispensing);

// Document AI-extraction write-back (investigations + diagnoses + narrative notes)
router.post('/patients/:patientId/documents/import', authenticate, importDocumentData);

// Investigations (legacy)
router.get('/encounters/:encounterId/lab-orders', authenticate, getLabOrders);
router.post('/encounters/:encounterId/lab-orders', authenticate, createLabOrder);
router.get('/patients/:patientId/lab-results', authenticate, getLabResults);
router.post('/patients/:patientId/lab-results', authenticate, createLabResult);

// Investigations V2
router.post('/investigations/orders', authenticate, createInvestigationOrder);
router.get('/investigations/orders', authenticate, getInvestigationOrders);
router.patch('/investigations/items/:itemId', authenticate, updateInvestigationItem);
router.post('/investigations/results', authenticate, createInvestigationResult);
router.patch('/investigations/results/:resultId', authenticate, amendInvestigationResult);
router.get('/investigations/results', authenticate, getInvestigationResultHistory);

// Billing
// Earlier hand-entered billing records (kept readable; new billing runs through invoices below)
router.get('/patients/:patientId/billing', authenticate, requireRoles('admin', 'billing', 'receptionist', 'clinician', 'pharmacist'), getBillingItems);
router.post('/patients/:patientId/billing', authenticate, requireRoles('admin', 'billing', 'receptionist'), createBillingItem);
router.patch('/billing/:id/status', authenticate, requireRoles('admin', 'billing', 'receptionist'), updateBillingStatus);
router.get('/patients/:patientId/billing/balance', authenticate, requireRoles('admin', 'billing', 'receptionist', 'clinician', 'pharmacist'), getPatientBalance);

// Billing — price list. Anyone signed in can read prices (clinicians see them while ordering);
// only admin / billing can change them.
const priceAdmin = requireRoles('admin', 'billing');

// Invoices and charge lines (charges are created automatically as care happens)
const billingViewers = requireRoles('admin', 'billing', 'receptionist', 'clinician', 'pharmacist');
const billingStaff = requireRoles('admin', 'billing', 'receptionist');   // take payments, add missed charges
const billingAdmin = requireRoles('admin');                                // approvals: adjustments, discounts, waivers, voids
router.get('/patients/:patientId/invoices', authenticate, billingViewers, listPatientInvoices);
router.get('/patients/:patientId/billing-summary', authenticate, billingViewers, patientBillingSummary);
router.get('/patients/:patientId/visit-history', authenticate, billingViewers, patientVisitHistory);
router.get('/invoices/:id', authenticate, billingViewers, getInvoice);
router.get('/invoices/:id/audit', authenticate, billingAdmin, invoiceAudit);
router.post('/patients/:patientId/invoice-lines', authenticate, billingStaff, addManualLine);
router.patch('/charge-lines/:id', authenticate, billingStaff, editLine);
router.post('/charge-lines/:id/void', authenticate, billingStaff, voidLine);
router.post('/invoices/:id/payments', authenticate, billingStaff, takePayment);
router.get('/payments/:id/receipt', authenticate, billingViewers, getReceipt);
router.post('/payments/:id/void', authenticate, billingAdmin, voidPayment);
router.post('/invoices/:id/discount', authenticate, billingAdmin, setDiscount);
router.post('/invoices/:id/waive', authenticate, billingAdmin, waiveInvoice);
router.post('/invoices/:id/void', authenticate, billingAdmin, voidInvoice);
router.post('/invoices/:id/release', authenticate, billingAdmin, releaseWithBalance);
router.patch('/prescriptions/:id/availability', authenticate, requireRoles('admin', 'pharmacist', 'clinician'), setPrescriptionAvailability);

// Cashier sessions, the billing desk and billing reports (login + billing role required)
router.get('/cashier/session', authenticate, billingStaff, mySession);
router.post('/cashier/session/open', authenticate, billingStaff, openSession);
router.post('/cashier/session/close', authenticate, billingStaff, closeSession);
router.get('/cashier/sessions', authenticate, requireRoles('admin', 'billing'), listSessions);
router.get('/billing/desk', authenticate, billingStaff, deskOverview);
router.get('/billing/reports/cashiers', authenticate, requireRoles('admin', 'billing'), reportCashiers);
router.get('/billing/reports/:name', authenticate, requireRoles('admin', 'billing'), runReport);

// Items staff add to the built-in drug, test and diagnosis catalogues
router.get('/catalogue/custom', authenticate, listCustom);
router.post('/catalogue/drugs', authenticate, requireRoles('admin', 'pharmacist'), createDrug);
router.patch('/catalogue/drugs/:id', authenticate, requireRoles('admin', 'pharmacist'), updateDrug);
router.post('/catalogue/tests', authenticate, requireRoles('admin', 'lab_tech'), createTest);
router.patch('/catalogue/tests/:id', authenticate, requireRoles('admin', 'lab_tech'), updateTest);
router.post('/catalogue/diagnoses', authenticate, requireRoles('admin', 'clinician'), createDiagnosis);
router.patch('/catalogue/diagnoses/:id', authenticate, requireRoles('admin', 'clinician'), updateDiagnosis);
// The treatment room: procedures doctors sent for a nurse to do. Nurses, clinicians and admins only.
const treatmentRoom = requireRoles('admin', 'clinician', 'doctor', 'nurse', 'paramedic');
router.get('/treatment-room/procedures', authenticate, treatmentRoom, listTreatmentProcedures);
router.post('/treatment-room/procedures/:id/complete', authenticate, treatmentRoom, completeTreatmentProcedure);
router.post('/treatment-room/procedures/:id/return', authenticate, treatmentRoom, returnTreatmentProcedure);

router.get('/price-list', authenticate, listPrices);
router.get('/price-list/lookup', authenticate, lookupPrices);
router.post('/price-list/set-missing', authenticate, requireRoles('admin', 'billing', 'clinician', 'pharmacist'), setMissingPrice);
router.patch('/price-list/point-of-care', authenticate, requireRoles('admin', 'billing', 'clinician', 'pharmacist'), savePointOfCarePrice);
router.get('/price-list/export', authenticate, priceAdmin, exportPrices);
router.post('/price-list', authenticate, priceAdmin, createPrice);
router.post('/price-list/sync', authenticate, priceAdmin, syncCatalogue);
router.post('/price-list/import', authenticate, priceAdmin, importPrices);
router.get('/price-list/:id/history', authenticate, priceAdmin, priceHistory);
router.patch('/price-list/:id', authenticate, priceAdmin, updatePrice);


// Queue — rooms (specific paths before param routes)
router.get('/queue/rooms', authenticate, getActiveRooms);
router.get('/queue/admin/rooms', authenticate, getAllRooms);
router.post('/queue/admin/rooms', authenticate, createRoom);
router.patch('/queue/admin/rooms/:id', authenticate, updateRoom);
router.delete('/queue/admin/rooms/:id', authenticate, deleteRoom);

// Queue — user room preferences
router.get('/queue/user-room-preferences', authenticate, getPreferences);
router.post('/queue/user-room-preference', authenticate, recordPreference);

// Queue — entries
router.get('/queue', authenticate, getEntries);
router.get('/queue/patient/:patientId', authenticate, getPatientEntry);
router.get('/queue/summary', authenticate, getQueueSummary);
router.post('/queue/rooms/:roomId/next', authenticate, callNext);
router.post('/queue/checkin', authenticate, checkin);
router.patch('/queue/:entryId/status', authenticate, updateStatus);
router.patch('/queue/:entryId/reroute', authenticate, rerouteEntry);
router.patch('/queue/:entryId/start', authenticate, startEntry);

// Patient queue lookup
router.get('/patients/:patientId/queue', authenticate, getPatientQueue);

// Risk prediction — assembles patient feature vector and forwards to FastAPI CDS service
router.get('/patients/:patientId/risk-predict', authenticate, getRiskPrediction);

// Guideline CDS — server-side payload assembly (full committed record + canvas merge)
router.post('/patients/:patientId/cds-payload', authenticate, buildCdsPayload);
router.get('/patients/:patientId/cds-signature', authenticate, getCdsSignature);

// Reports — population analytics (aggregate only). A login and a reports role are required; the CDS chat service
// forwards the asker's own login, so what it can read matches what that person can see on the Reports page.
router.use('/reports/population', authenticate, requireRoles(...REPORT_ROLES));
router.get('/reports/population/overview', populationOverview);
router.get('/reports/population/export', populationExport);
router.get('/reports/population/chronic', populationChronic);
router.get('/reports/population/kpis', populationKpis);
router.get('/reports/population/diagnoses', populationDiagnoses);
router.get('/reports/population/vitals', populationVitals);
router.get('/reports/population/medications', populationMedications);
router.get('/reports/population/investigations', populationInvestigations);
router.get('/reports/population/patients', populationPatients);
// Registered reports (billing, stock, and the hub's own as they are added) come after the population routes so those keep their own paths.
// Each report declares its own roles, so the login is the only guard here.
router.get('/reports/registry', authenticate, listRegisteredReports);
router.get('/reports/:area/:name', authenticate, runRegisteredReport);
router.get('/reports/:area/:name/lines', authenticate, runRegisteredLines);

// The chronic condition list the reports count: clinical roles read it, only an admin changes it.
router.get('/chronic-conditions', authenticate, requireRoles(...CLINICAL_ROLES), listChronicConditions);
router.post('/chronic-conditions', authenticate, requireRoles(...CONDITION_EDITORS), createChronicCondition);
router.patch('/chronic-conditions/:id', authenticate, requireRoles(...CONDITION_EDITORS), updateChronicCondition);

export default router;
