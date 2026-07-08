import { Router } from 'express';
import { requestLink, exchangeLink, logout, me } from '../controllers/portal/auth.controller';
import { getDashboard } from '../controllers/portal/dashboard.controller';
import { getVitalsHistory } from '../controllers/portal/vitals.controller';
import { getConditions } from '../controllers/portal/conditions.controller';
import { listAppointments, confirmAppointment } from '../controllers/portal/appointments.controller';
import { listCheckIns, getCheckIn } from '../controllers/portal/checkins.controller';
import { getPreferences, updatePreferences } from '../controllers/portal/preferences.controller';
import { listSessions } from '../controllers/portal/sessions.controller';
import { getVapidPublicKey, subscribe, unsubscribe } from '../controllers/portal/push.controller';
import { requirePortalSession, auditPortalAccess } from '../middleware/portalAuth';
import { magicLinkRateLimit, portalRateLimit } from '../middleware/portalRateLimit';

const router = Router();

router.use(portalRateLimit);

// Auth — public, never cached by the service worker.
router.post('/auth/request-link', magicLinkRateLimit, requestLink);
router.post('/auth/exchange', exchangeLink);
router.post('/auth/logout', requirePortalSession, logout);
router.get('/auth/me', requirePortalSession, me);

// Everything below resolves the patient exclusively from the session cookie.
router.use(requirePortalSession, auditPortalAccess);

router.get('/dashboard', getDashboard);
router.get('/vitals/history', getVitalsHistory);
router.get('/conditions', getConditions);

router.get('/appointments', listAppointments);
router.post('/appointments/:id/confirm', confirmAppointment);

router.get('/check-ins', listCheckIns);
router.get('/check-ins/:id', getCheckIn);

router.get('/preferences', getPreferences);
router.put('/preferences', updatePreferences);

router.get('/sessions', listSessions);

router.get('/push/vapid-public-key', getVapidPublicKey);
router.post('/push/subscribe', subscribe);
router.post('/push/unsubscribe', unsubscribe);

export default router;
