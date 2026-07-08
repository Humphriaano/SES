import { Response } from 'express';
import prisma from '../../lib/prisma';
import { PortalRequest } from '../../middleware/portalAuth';
import { matchConditions } from '../../services/conditionContent.service';

export async function getConditions(req: PortalRequest, res: Response): Promise<void> {
  const diagnoses = await prisma.patientDiagnosis.findMany({
    where: { patientId: req.patientId, resolvedAt: null },
    include: { icd11: true },
    orderBy: { createdAt: 'asc' },
  });
  const matched = await matchConditions(diagnoses);
  res.json(matched.map((c) => ({
    plainName: c.plainName,
    plainDescription: c.plainDescription,
    patientStatus: c.patientStatus,
    firstRecordedAt: c.firstRecordedAt,
    tip: c.tip,
    mythBuster: c.mythBuster,
  })));
}
