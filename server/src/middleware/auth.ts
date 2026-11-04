import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma';

export interface AuthRequest extends Request {
  userId?: string;
  userRole?: string;
}

// No fallback: a guessable default secret would let anyone mint admin tokens.
export function jwtSecret(): string {
  const s = process.env['JWT_SECRET'];
  if (!s) throw new Error('JWT_SECRET is not set');
  return s;
}

export async function authenticate(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const token = header.slice(7);
  let userId: string;
  try {
    const payload = jwt.verify(token, jwtSecret()) as { userId?: unknown };
    if (typeof payload.userId !== 'string' || !payload.userId) throw new Error('Invalid identity');
    userId = payload.userId;
  } catch {
    res.status(401).json({ error: 'Invalid token' });
    return;
  }
  try {
    // The signed token authenticates the identity. Assigned roles and account
    // status remain authoritative in the database, including after revocation.
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, status: true } });
    if (!user || user.status !== 'active') { res.status(401).json({ error: 'This account is not active.' }); return; }
    if (!user.role) { res.status(403).json({ error: 'No access has been assigned to this account.' }); return; }
    req.userId = userId;
    req.userRole = user.role;
    next();
  } catch {
    res.status(503).json({ error: 'Could not verify access. Try again.' });
  }
}

// Allows the request only if the signed-in user holds at least one of the listed roles
// (a user can hold several, stored comma-separated, e.g. "clinician,billing").
export function requireRoles(...allowed: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    const roles = (req.userRole ?? '').split(',').map((r) => r.trim());
    if (roles.some((r) => allowed.includes(r))) { next(); return; }
    res.status(403).json({ error: 'You don’t have permission to do this.' });
  };
}
