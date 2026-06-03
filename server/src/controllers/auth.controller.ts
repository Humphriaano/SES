import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth';

const JWT_SECRET = process.env['JWT_SECRET'] ?? 'secret';

const AVAILABLE_ROLES = [
  'admin', 'clinician', 'nurse', 'pharmacist', 'lab_tech', 'receptionist', 'billing',
];

export async function register(req: Request, res: Response): Promise<void> {
  try {
    const {
      firstName, surname, dateOfBirth, sex, designation,
      nrc, hasNoNrc, address, countryCode, cellphone,
      email, username, password,
    } = req.body;

    if (!firstName || !surname || !email || !username || !password) {
      res.status(400).json({ error: 'Required fields missing' }); return;
    }

    const [existingEmail, existingUsername] = await Promise.all([
      prisma.user.findUnique({ where: { email } }),
      prisma.user.findUnique({ where: { username } }),
    ]);
    if (existingEmail) { res.status(409).json({ field: 'email', error: 'Email already in use' }); return; }
    if (existingUsername) { res.status(409).json({ field: 'username', error: 'Username already taken' }); return; }

    const hashed = await bcrypt.hash(password, 10);
    await prisma.user.create({
      data: {
        name: `${firstName} ${surname}`,
        firstName,
        surname,
        dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
        sex,
        designation,
        nrc: hasNoNrc ? null : (nrc || null),
        hasNoNrc: !!hasNoNrc,
        address: address || null,
        countryCode: countryCode || '+260',
        cellphone: cellphone || null,
        email,
        username,
        password: hashed,
        role: null,
        status: 'pending',
      },
    });
    res.status(201).json({ message: 'Registration submitted. Your account is pending approval.' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function login(req: Request, res: Response): Promise<void> {
  try {
    const { login: credential, password } = req.body as { login: string; password: string };
    const user = credential.includes('@')
      ? await prisma.user.findUnique({ where: { email: credential } })
      : await prisma.user.findUnique({ where: { username: credential } });
    if (!user) { res.status(401).json({ error: 'Invalid credentials' }); return; }
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) { res.status(401).json({ error: 'Invalid credentials' }); return; }
    if (user.status === 'pending') {
      res.status(403).json({ error: 'Your account is pending approval by an administrator.' }); return;
    }
    if (user.status === 'rejected') {
      res.status(403).json({ error: 'Your account registration was not approved.' }); return;
    }
    if (user.status === 'deactivated') {
      res.status(403).json({ error: 'Your account has been deactivated. Contact an administrator.' }); return;
    }
    const token = jwt.sign({ userId: user.id, role: user.role }, JWT_SECRET, { expiresIn: '8h' });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function checkUsername(req: Request, res: Response): Promise<void> {
  try {
    const { username } = req.query as { username?: string };
    if (!username || username.trim().length < 2) {
      res.status(400).json({ error: 'username is required' }); return;
    }
    const existing = await prisma.user.findUnique({ where: { username: username.trim() } });
    res.json({ available: !existing });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function getRoles(_req: Request, res: Response): Promise<void> {
  res.json(AVAILABLE_ROLES);
}

export async function listUsers(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (req.userRole !== 'admin') { res.status(403).json({ error: 'Admin access required' }); return; }
    const { status } = req.query as { status?: string };
    const where: any = {};
    if (status) where.status = status;
    const users = await prisma.user.findMany({
      where,
      select: {
        id: true, name: true, firstName: true, surname: true,
        email: true, username: true, role: true, status: true,
        designation: true, createdAt: true, rejectionReason: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(users);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function updateUser(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (req.userRole !== 'admin') { res.status(403).json({ error: 'Admin access required' }); return; }
    const id = String(req.params.id);
    const { action, role, rejectionReason } = req.body;

    let data: any = {};
    if (action === 'approve') {
      const roles: string[] = Array.isArray(req.body.roles) ? req.body.roles : (role ? [role] : []);
      if (roles.length === 0) { res.status(400).json({ error: 'At least one role is required to approve' }); return; }
      data = { status: 'active', role: roles.join(','), rejectionReason: null };
    } else if (action === 'reject') {
      if (!rejectionReason) { res.status(400).json({ error: 'rejectionReason is required' }); return; }
      data = { status: 'rejected', rejectionReason };
    } else if (action === 'deactivate') {
      data = { status: 'deactivated' };
    } else if (action === 'reactivate') {
      data = { status: 'active' };
    } else {
      res.status(400).json({ error: 'Invalid action' }); return;
    }

    const user = await prisma.user.update({
      where: { id },
      data,
      select: { id: true, status: true, role: true },
    });
    res.json(user);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}
