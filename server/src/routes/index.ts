import { Router } from 'express';
import { register, login, checkUsername, getRoles, listUsers, updateUser } from '../controllers/auth.controller';
import { listPatients, getPatient, createPatient, updatePatient, resolveDiagnosis, sendPortalInvitation } from '../controllers/patient.controller';
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
import { getBillingItems, createBillingItem, updateBillingStatus, getPatientBalance } from '../controllers/billing.controller';
import { searchICD11, seedICD11 } from '../controllers/icd11.controller';
import { importDocumentData } from '../controllers/documentImport.controller';
import { getPatientQueue } from '../controllers/queue.controller';
import { getActiveRooms, getAllRooms, createRoom, updateRoom, deleteRoom } from '../controllers/facility.room.controller';
import { getEntries, checkin, updateStatus, rerouteEntry, startEntry } from '../controllers/queue.entry.controller';
import { recordPreference, getPreferences } from '../controllers/user.room.preference.controller';
import { populationDiagnoses, populationVitals, populationMedications, populationInvestigations, populationPatients, populationKpis } from '../controllers/reports.controller';
import { getRiskPrediction } from '../controllers/risk.controller';
import { buildCdsPayload, getCdsSignature } from '../controllers/cdsContext.controller';
import { authenticate } from '../middleware/auth';

const router = Router();

// Auth
router.post('/auth/register', register);
router.post('/auth/login', login);
router.get('/auth/check-username', checkUsername);
router.get('/auth/roles', authenticate, getRoles);
router.get('/auth/users', authenticate, listUsers);
router.patch('/auth/users/:id', authenticate, updateUser);

// ICD-11
router.get('/icd11/search', authenticate, searchICD11);
router.post('/icd11/seed', seedICD11);

// Patients
router.get('/patients', authenticate, listPatients);
router.post('/patients', authenticate, createPatient);
router.get('/patients/:id', authenticate, getPatient);
router.patch('/patients/:id', authenticate, updatePatient);
router.patch('/patients/:patientId/diagnoses/:diagnosisId/resolve', authenticate, resolveDiagnosis);
router.post('/patients/:id/portal-invite', authenticate, sendPortalInvitation);

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
router.get('/encounters/:encounterId/prescriptions', authenticate, getPrescriptions);
router.post('/encounters/:encounterId/prescriptions', authenticate, createPrescription);
router.post('/prescriptions/:id/dispense', authenticate, dispensePrescription);
router.get('/prescriptions', authenticate, listGlobalPrescriptions);
router.get('/inventory', authenticate, getInventory);
router.get('/drugs', authenticate, searchDrugs);
router.post('/dispensing', authenticate, createDispensing);
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
router.get('/patients/:patientId/billing', authenticate, getBillingItems);
router.post('/patients/:patientId/billing', authenticate, createBillingItem);
router.patch('/billing/:id/status', authenticate, updateBillingStatus);
router.get('/patients/:patientId/billing/balance', authenticate, getPatientBalance);

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

// Reports — population analytics (aggregate only, called internally by CDS service)
router.get('/reports/population/kpis', populationKpis);
router.get('/reports/population/diagnoses', populationDiagnoses);
router.get('/reports/population/vitals', populationVitals);
router.get('/reports/population/medications', populationMedications);
router.get('/reports/population/investigations', populationInvestigations);
router.get('/reports/population/patients', populationPatients);

export default router;
