import bcrypt from 'bcryptjs';
import prisma from '../lib/prisma';

async function main() {
  const username = 'Danty';
  const email = 'danty@ses.local';
  const password = await bcrypt.hash('12345678', 10);
  const user = await prisma.user.upsert({
    where: { username },
    update: { password, role: 'admin', status: 'active' },
    create: { name: 'Danty', firstName: 'Danty', surname: 'Admin', email, username, password, role: 'admin', status: 'active' },
  });
  console.log(`Admin ready: ${user.username} (${user.email})`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
