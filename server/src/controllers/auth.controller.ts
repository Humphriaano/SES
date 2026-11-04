import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth';
import { validateRegistrationPhone } from '../lib/registrationPhone';

import { jwtSecret } from '../middleware/auth';

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

    const noNrc = hasNoNrc === true;
    const normalizedNrc = typeof nrc === 'string' ? nrc.trim() : '';
    if (!noNrc && !/^\d{6}\/\d{2}\/\d$/.test(normalizedNrc)) {
      res.status(400).json({ field: 'nrc', error: 'NRC must be 9 digits: 123456/78/9' }); return;
    }

    const phone = validateRegistrationPhone(countryCode || '+260', cellphone);
    if (phone.error) {
      res.status(400).json({ field: 'cellphone', error: phone.error }); return;
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
        nrc: noNrc ? null : normalizedNrc,
        hasNoNrc: noNrc,
        address: address || null,
        countryCode: phone.countryCode,
        cellphone: phone.number,
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
    const { login: rawCredential, password } = req.body ?? {};
    if (typeof rawCredential !== 'string' || !rawCredential.trim() || typeof password !== 'string' || !password) {
      res.status(400).json({ error: 'Enter your email or username and password.' }); return;
    }
    const credential = rawCredential.trim();
    const field = credential.includes('@') ? 'email' : 'username';
    // Preserve exact matches for existing accounts; accept case variations only
    // when they identify one account unambiguously.
    let user = field === 'email'
      ? await prisma.user.findUnique({ where: { email: credential } })
      : await prisma.user.findUnique({ where: { username: credential } });
    if (!user) {
      const matches = await prisma.user.findMany({
        where: { [field]: { equals: credential, mode: 'insensitive' } }, take: 2,
      });
      if (matches.length === 1) user = matches[0]!;
    }
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
    const token = jwt.sign({ userId: user.id, role: user.role }, jwtSecret(), { expiresIn: '8h' });
    res.json({ token, user: { id: user.id, name: user.name, firstName: user.firstName, designation: user.designation, email: user.email, role: user.role } });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function getCurrentUser(req: AuthRequest, res: Response): Promise<void> {
  if (!req.userId) { res.status(401).json({ error: 'Authentication required' }); return; }
  const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, name: true, firstName: true, designation: true, role: true } });
  if (!user) { res.status(404).json({ error: 'User not found' }); return; }
  res.json(user);
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
      // Never let administration lock itself out.
      if (id === req.userId) { res.status(400).json({ error: 'You can’t deactivate your own account' }); return; }
      const target = await prisma.user.findUnique({ where: { id }, select: { role: true } });
      if (target?.role?.split(',').map((r) => r.trim()).includes('admin')) {
        const activeAdmins = await prisma.user.count({ where: { status: 'active', role: { contains: 'admin' } } });
        if (activeAdmins <= 1) { res.status(400).json({ error: 'At least one active admin is required' }); return; }
      }
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
