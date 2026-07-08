import prisma from '../lib/prisma';
import { runMonthlyCheckIn } from '../jobs/monthlyCheckIn.job';

runMonthlyCheckIn()
  .then(() => console.log('Monthly check-in run complete.'))
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
