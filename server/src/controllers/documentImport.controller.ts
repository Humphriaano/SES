import { Response } from 'express';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth';

interface ImportLabResult {
  testName: string;
  value: string;
  unit?: string | null;
  referenceRange?: string | null;
  flag?: string | null;
}

interface ImportPendingInvestigation {
  testName: string;
  status?: string | null;
  notes?: string | null;
}

interface ImportDiagnosis {
  text: string;
  category?: string | null;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 40) || 'test';
}

function normalizeStatus(flag: string | null | undefined): string {
  const f = (flag ?? '').trim().toLowerCase();
  if (!f) return 'Normal';
  return f.charAt(0).toUpperCase() + f.slice(1);
}

// POST /api/patients/:patientId/documents/import
// Writes AI-extracted document data (investigations, diagnoses, narrative notes)
// into the tables their respective UI tabs actually read from. Medications and
// vitals are handled by the existing endpoints and are not touched here.
export async function importDocumentData(req: AuthRequest, res: Response): Promise<void> {
  const { patientId } = req.params;
  const body = req.body as {
    filename: string;
    labResults?: ImportLabResult[];
    pendingInvestigations?: ImportPendingInvestigation[];
    diagnoses?: ImportDiagnosis[];
    otherNotes?: string;
  };
  const userId = req.userId!;
  const sourceLabel = `Imported from document: ${body.filename}`;

  const result = {
    investigations: { resulted: 0, pending: 0, error: undefined as string | undefined },
    diagnoses: { created: 0, items: [] as { text: string; code: string; description: string; isNew: boolean }[], error: undefined as string | undefined },
    note: { created: false, encounterId: undefined as string | undefined, error: undefined as string | undefined },
  };

  // Each category is independent: a failure here must not prevent the others
  // from being attempted or from being reported back to the caller.
  const hasLabResults = body.labResults && body.labResults.length > 0;
  const hasPending = body.pendingInvestigations && body.pendingInvestigations.length > 0;
  if (hasLabResults || hasPending) {
    try {
      const order = await prisma.investigationOrder.create({ data: { patientId, orderedById: userId } });

      for (const lr of body.labResults ?? []) {
        const item = await prisma.investigationOrderItem.create({
          data: {
            orderId: order.id,
            type: 'single',
            catalogueId: `imported:${slugify(lr.testName)}`,
            name: lr.testName,
            status: 'Resulted',
          },
        });
        await prisma.investigationResult.create({
          data: {
            itemId: item.id,
            resultedById: userId,
            resultsJson: JSON.stringify([{
              componentName: lr.testName,
              value: lr.value,
              units: lr.unit || null,
              referenceRange: lr.referenceRange || null,
              status: normalizeStatus(lr.flag),
            }]),
          },
        });
        result.investigations.resulted += 1;
      }

      // Ordered/requested but not yet resulted — these surface as pending on
      // the Investigations tab (and the lab worklist) rather than being
      // dropped or conflated with a resulted lab value.
      for (const pi of body.pendingInvestigations ?? []) {
        await prisma.investigationOrderItem.create({
          data: {
            orderId: order.id,
            type: 'single',
            catalogueId: `imported:${slugify(pi.testName)}`,
            name: pi.testName,
            status: 'Pending',
            componentsJson: pi.notes ? JSON.stringify({ notes: pi.notes }) : null,
          },
        });
        result.investigations.pending += 1;
      }
    } catch (err: any) {
      console.error(`[documents/import] investigations write-back failed for patient ${patientId}:`, err);
      result.investigations.error = err.message ?? 'Failed to save investigations';
    }
  }

  if (body.diagnoses && body.diagnoses.length > 0) {
    try {
      const knownCodes = await prisma.iCD11Code.findMany();
      for (const d of body.diagnoses) {
        const text = (d.text ?? '').trim();
        if (!text) continue;
        const category = (d.category ?? '').trim() || null;

        let icd = knownCodes.find(c => c.description.toLowerCase() === text.toLowerCase())
          ?? knownCodes.find(c => text.toLowerCase().includes(c.description.toLowerCase()) || c.description.toLowerCase().includes(text.toLowerCase()))
          ?? null;

        let isNew = false;
        if (!icd) {
          icd = await prisma.iCD11Code.create({
            data: { code: `IMPORTED-${slugify(text).toUpperCase()}`, description: text, category: category ?? 'Imported from document' },
          });
          knownCodes.push(icd);
          isNew = true;
        }

        const existing = await prisma.patientDiagnosis.findFirst({ where: { patientId, icd11Id: icd.id } });
        if (!existing) {
          await prisma.patientDiagnosis.create({ data: { patientId, icd11Id: icd.id, notes: sourceLabel } });
          result.diagnoses.created += 1;
        }
        result.diagnoses.items.push({ text, code: icd.code, description: icd.description, isNew });
      }
    } catch (err: any) {
      console.error(`[documents/import] diagnosis write-back failed for patient ${patientId}:`, err);
      result.diagnoses.error = err.message ?? 'Failed to save diagnoses';
    }
  }

  if (body.otherNotes && body.otherNotes.trim()) {
    try {
      const encounter = await prisma.encounter.create({
        data: {
          patientId,
          clinicianId: userId,
          status: 'CLOSED',
          chiefComplaint: sourceLabel,
          notes: body.otherNotes.trim(),
        },
      });
      result.note = { created: true, encounterId: encounter.id, error: undefined };
    } catch (err: any) {
      console.error(`[documents/import] note write-back failed for patient ${patientId}:`, err);
      result.note.error = err.message ?? 'Failed to save notes';
    }
  }

  res.status(201).json(result);
}
