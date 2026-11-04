// Creates (or resets) the first administrator on a fresh install. Self-registered
// accounts start "pending" with no role, so without this nobody can approve anyone.
//
//   ADMIN_USERNAME=admin ADMIN_PASSWORD='choose-a-long-one' npm run create-admin
//
// ADMIN_EMAIL, ADMIN_FIRST_NAME and ADMIN_SURNAME are optional.
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import prisma from '../src/lib/prisma';

async function main() {
  const username = process.env['ADMIN_USERNAME']?.trim();
  const password = process.env['ADMIN_PASSWORD'];
  if (!username || !password) throw new Error('Set ADMIN_USERNAME and ADMIN_PASSWORD.');
  if (password.length < 8) throw new Error('ADMIN_PASSWORD must be at least 8 characters.');

  const firstName = process.env['ADMIN_FIRST_NAME']?.trim() || 'System';
  const surname = process.env['ADMIN_SURNAME']?.trim() || 'Administrator';
  const email = process.env['ADMIN_EMAIL']?.trim() || `${username}@ses.local`;
  const hashed = await bcrypt.hash(password, 10);

  const user = await prisma.user.upsert({
    where: { username },
    update: { password: hashed, role: 'admin', status: 'active' },
    create: {
      name: `${firstName} ${surname}`, firstName, surname, email, username,
      password: hashed, role: 'admin', status: 'active', hasNoNrc: true,
    },
  });
  console.log(`Administrator "${user.username}" is ready. Sign in with that username and password.`);
}

main().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
