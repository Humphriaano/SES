import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

// Magic-link requests: max 3 per 15 minutes, keyed by email + IP so one
// abusive IP can't exhaust the limit for every address it tries.
export const magicLinkRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip ?? '')}:${(req.body?.email ?? '').toLowerCase()}`,
  message: { error: 'Too many sign-in requests. Please try again in a few minutes.' },
});

// General portal API traffic.
export const portalRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});
