import { Response } from 'express';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth';

export async function populationDiagnoses(_req: AuthRequest, res: Response): Promise<void> {
  try {
    const grouped = await prisma.patientDiagnosis.groupBy({
      by: ['icd11Id'],
      _count: { id: true },
      where: { resolvedAt: null },
      orderBy: { _count: { id: 'desc' } },
    });

    const codes = await prisma.iCD11Code.findMany({
      where: { id: { in: grouped.map((g) => g.icd11Id) } },
      select: { id: true, code: true, description: true },
    });
    const codeMap = new Map(codes.map((c) => [c.id, c]));

    res.json(
      grouped.map((g) => ({
        description: codeMap.get(g.icd11Id)?.description ?? 'Unknown',
        code: codeMap.get(g.icd11Id)?.code ?? '',
        count: g._count.id,
      })),
    );
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function populationVitals(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { period = 'month' } = req.query as { period?: string };

    const now = new Date();
    let since: Date;
    if (period === 'week') since = new Date(now.getTime() - 7 * 86400000);
    else if (period === 'year') since = new Date(now.getTime() - 365 * 86400000);
    else if (period === 'all') since = new Date('2000-01-01');
    else since = new Date(now.getTime() - 30 * 86400000); // month default

    const [vitals, timeSeries] = await Promise.all([
      prisma.vital.findMany({
        where: { recordedAt: { gte: since } },
        select: {
          bloodPressureSystolic: true, bloodPressureDiastolic: true,
          heartRate: true, temperature: true, weight: true, glucose: true,
        },
      }),
      prisma.$queryRaw<{ date: string; systolic: string | null; diastolic: string | null; glucose: string | null }[]>`
        SELECT
          TO_CHAR(DATE("recordedAt"), 'YYYY-MM-DD') AS date,
          ROUND(AVG("bloodPressureSystolic")::numeric, 1)::text AS systolic,
          ROUND(AVG("bloodPressureDiastolic")::numeric, 1)::text AS diastolic,
          ROUND(AVG(glucose)::numeric, 2)::text AS glucose
        FROM "Vital"
        WHERE "recordedAt" >= ${since}
        GROUP BY DATE("recordedAt")
        ORDER BY date
      `,
    ]);

    const calcStats = (vals: (number | null | undefined)[]) => {
      const nums = vals.filter((v): v is number => v != null);
      if (!nums.length) return null;
      const sum = nums.reduce((a, b) => a + b, 0);
      return { avg: Math.round((sum / nums.length) * 10) / 10, min: Math.min(...nums), max: Math.max(...nums), count: nums.length };
    };

    res.json({
      period,
      totalReadings: vitals.length,
      bloodPressureSystolic: calcStats(vitals.map((v) => v.bloodPressureSystolic)),
      bloodPressureDiastolic: calcStats(vitals.map((v) => v.bloodPressureDiastolic)),
      heartRate: calcStats(vitals.map((v) => v.heartRate)),
      temperature: calcStats(vitals.map((v) => v.temperature)),
      weight: calcStats(vitals.map((v) => v.weight)),
      glucose: calcStats(vitals.map((v) => v.glucose)),
      timeSeries: timeSeries.map((r) => ({
        date: r.date,
        Systolic: r.systolic ? parseFloat(r.systolic) : null,
        Diastolic: r.diastolic ? parseFloat(r.diastolic) : null,
        Glucose: r.glucose ? parseFloat(r.glucose) : null,
      })),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function populationMedications(_req: AuthRequest, res: Response): Promise<void> {
  try {
    const dispensings = await prisma.dispensing.groupBy({
      by: ['dispensedDrug'],
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
      take: 20,
    });
    res.json(dispensings.map((d) => ({ name: d.dispensedDrug, count: d._count.id })));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function populationInvestigations(_req: AuthRequest, res: Response): Promise<void> {
  try {
    const [byStatus, byType] = await Promise.all([
      prisma.investigationOrderItem.groupBy({ by: ['status'], _count: { id: true } }),
      prisma.investigationOrderItem.groupBy({
        by: ['type'], _count: { id: true }, orderBy: { _count: { id: 'desc' } }, take: 10,
      }),
    ]);
    res.json({
      byStatus: byStatus.map((s) => ({ status: s.status, count: s._count.id })),
      byType: byType.map((t) => ({ type: t.type, count: t._count.id })),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function populationKpis(_req: AuthRequest, res: Response): Promise<void> {
  try {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      totalPatients, bySex,
      activeDiagnoses, topDiagnosis,
      investigations,
      dispensedToday, dispensedThisMonth, prescriptionsThisMonth,
    ] = await Promise.all([
      prisma.patient.count(),
      prisma.patient.groupBy({ by: ['gender'], _count: { id: true } }),
      prisma.patientDiagnosis.count({ where: { resolvedAt: null } }),
      prisma.patientDiagnosis.groupBy({
        by: ['icd11Id'],
        _count: { id: true },
        where: { resolvedAt: null },
        orderBy: { _count: { id: 'desc' } },
        take: 1,
      }),
      prisma.investigationOrderItem.groupBy({ by: ['status'], _count: { id: true } }),
      prisma.dispensing.count({ where: { dispensedAt: { gte: startOfToday } } }),
      prisma.dispensing.count({ where: { dispensedAt: { gte: startOfMonth } } }),
      prisma.prescription.count({ where: { createdAt: { gte: startOfMonth } } }),
    ]);

    let mostCommonDiagnosis = '—';
    if (topDiagnosis.length > 0) {
      const icd = await prisma.iCD11Code.findUnique({
        where: { id: topDiagnosis[0].icd11Id },
        select: { description: true },
      });
      mostCommonDiagnosis = icd?.description ?? '—';
    }

    const invMap = Object.fromEntries(
      investigations.map((s) => [s.status.toLowerCase().replace(/\s+/g, '_'), s._count.id]),
    );

    res.json({
      totalPatients,
      bySex: bySex.map((s) => ({ gender: s.gender, count: s._count.id })),
      activeDiagnoses,
      mostCommonDiagnosis,
      pendingInvestigations: invMap['pending'] ?? 0,
      inProgressInvestigations: invMap['in_progress'] ?? 0,
      resultedInvestigations: invMap['resulted'] ?? 0,
      amendedInvestigations: invMap['amended'] ?? 0,
      dispensedToday,
      dispensedThisMonth,
      prescriptionsThisMonth,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function populationPatients(_req: AuthRequest, res: Response): Promise<void> {
  try {
    const [total, bySex, patients] = await Promise.all([
      prisma.patient.count(),
      prisma.patient.groupBy({ by: ['gender'], _count: { id: true } }),
      prisma.patient.findMany({ select: { dateOfBirth: true } }),
    ]);

    const now = new Date();
    const ageGroups: Record<string, number> = { '0-17': 0, '18-35': 0, '36-50': 0, '51-65': 0, '65+': 0 };
    patients.forEach((p) => {
      const age = Math.floor((now.getTime() - p.dateOfBirth.getTime()) / (365.25 * 86400000));
      if (age < 18) ageGroups['0-17']++;
      else if (age <= 35) ageGroups['18-35']++;
      else if (age <= 50) ageGroups['36-50']++;
      else if (age <= 65) ageGroups['51-65']++;
      else ageGroups['65+']++;
    });

    res.json({
      total,
      bySex: bySex.map((s) => ({ gender: s.gender, count: s._count.id })),
      byAgeGroup: Object.entries(ageGroups).map(([group, count]) => ({ group, count })),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}
