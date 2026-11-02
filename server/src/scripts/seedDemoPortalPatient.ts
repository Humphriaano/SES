import prisma from '../lib/prisma';

const DEMO_EMAIL = 'demo.patient@ses.local';

function monthsAgo(n: number, day = 15): Date {
  const d = new Date();
  d.setMonth(d.getMonth() - n, day);
  d.setHours(9, 0, 0, 0);
  return d;
}

async function main() {
  const htn = await prisma.iCD11Code.findUnique({ where: { code: 'BA80' } });
  const dm2 = await prisma.iCD11Code.findUnique({ where: { code: '5A11' } });
  if (!htn || !dm2) throw new Error('Run seedPortalContent.ts first to seed ICD-11 codes.');

  const existing = await prisma.patient.findFirst({ where: { email: DEMO_EMAIL } });
  const patient = existing
    ? await prisma.patient.update({ where: { id: existing.id }, data: { portalEnabled: true, email: DEMO_EMAIL } })
    : await prisma.patient.create({
        data: {
          firstName: 'Chanda', lastName: 'Mwansa', preferredName: 'Chanda',
          dateOfBirth: new Date('1975-03-12'), gender: 'FEMALE',
          phone: '+260971234567', email: DEMO_EMAIL,
          portalEnabled: true, emailOptedIn: true,
        },
      });

  await prisma.patientDiagnosis.createMany({
    data: [
      { patientId: patient.id, icd11Id: htn.id, createdAt: monthsAgo(8) },
      { patientId: patient.id, icd11Id: dm2.id, createdAt: monthsAgo(8) },
    ],
    skipDuplicates: true,
  });

  const existingVitals = await prisma.vital.count({ where: { patientId: patient.id } });
  if (existingVitals === 0) {
    const vitalsHistory = [
      { m: 5, sys: 152, dia: 96, weight: 84.2, glucose: 9.8 },
      { m: 4, sys: 148, dia: 94, weight: 83.5, glucose: 9.1 },
      { m: 3, sys: 142, dia: 90, weight: 82.9, glucose: 8.4 },
      { m: 2, sys: 136, dia: 88, weight: 82.0, glucose: 7.6 },
      { m: 1, sys: 130, dia: 84, weight: 81.1, glucose: 7.0 },
      { m: 0, sys: 128, dia: 82, weight: 80.6, glucose: 6.8 },
    ];
    await prisma.vital.createMany({
      data: vitalsHistory.map((v) => ({
        patientId: patient.id,
        bloodPressureSystolic: v.sys,
        bloodPressureDiastolic: v.dia,
        weight: v.weight,
        glucose: v.glucose,
        heartRate: 76,
        oxygenSat: 97,
        temperature: 36.6,
        recordedAt: monthsAgo(v.m),
      })),
    });

    await prisma.labResult.createMany({
      data: [
        { patientId: patient.id, testName: 'HbA1c', result: '8.9', unit: '%', recordedAt: monthsAgo(5) },
        { patientId: patient.id, testName: 'HbA1c', result: '7.6', unit: '%', recordedAt: monthsAgo(2) },
      ],
    });
  }

  const existingAppointments = await prisma.appointment.count({ where: { patientId: patient.id } });
  if (existingAppointments === 0) {
    const upcoming = new Date();
    upcoming.setDate(upcoming.getDate() + 5);
    upcoming.setHours(10, 30, 0, 0);

    await prisma.appointment.createMany({
      data: [
        {
          patientId: patient.id, clinicianName: 'Dr. Banda', clinicName: 'SES Chilenje Clinic',
          scheduledAt: upcoming, status: 'SCHEDULED',
        },
        {
          patientId: patient.id, clinicianName: 'Dr. Banda', clinicName: 'SES Chilenje Clinic',
          scheduledAt: monthsAgo(1), status: 'COMPLETED', confirmedAt: monthsAgo(1), confirmedVia: 'EMAIL',
        },
      ],
    });
  }

  console.log(`Demo portal patient ready: ${DEMO_EMAIL} (id: ${patient.id})`);
  console.log('Portal access is enabled. Sign in at the portal login screen with this email —');
  console.log('the magic sign-in link will print to this server console (no Brevo key set).');
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
