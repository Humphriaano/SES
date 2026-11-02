import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

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

export function authenticate(req: AuthRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, jwtSecret()) as { userId: string; role: string };
    req.userId = payload.userId;
    req.userRole = payload.role;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}
