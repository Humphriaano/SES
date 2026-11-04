import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

// Staff sign-in: max 10 attempts per 15 minutes per IP + login name, so
// password guessing is slowed without locking out a whole shared clinic IP.
export const staffLoginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip ?? '')}:${String(req.body?.login ?? '').trim().toLowerCase()}`,
  message: { error: 'Too many sign-in attempts. Please wait 15 minutes and try again.' },
});
