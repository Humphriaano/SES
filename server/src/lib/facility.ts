import prisma from './prisma';
import { audit } from './billingOps';

// The facility this installation serves (its name and district, for the header of every report and export) and its reporting policy.
// There is one row. If it cannot be read the reports still work: they just carry no facility name and keep names allowed as before.

export interface Facility { name: string; district: string; lineListNames: boolean }
const DEFAULT: Facility = { name: '', district: '', lineListNames: true };

export async function getFacility(): Promise<Facility> {
  try {
    const row = await prisma.facilitySetting.findUnique({ where: { id: 1 } });
    return row ? { name: row.name, district: row.district, lineListNames: row.lineListNames } : DEFAULT;
  } catch (e) {
    console.error('[facility] could not read the facility settings:', e);
    return DEFAULT;
  }
}

// "Mtendere Clinic · Lusaka", or an empty string when nothing is set.
export const facilityLabel = (f: Facility): string => [f.name, f.district].map(s => s.trim()).filter(Boolean).join(' · ');

export class FacilityError extends Error { constructor(message: string) { super(message); } }

// Only an admin changes it. Every change is written to the audit log with what it was before and after.
export async function updateFacility(input: Record<string, unknown>, userId: string | undefined): Promise<Facility> {
  const patch: Partial<Facility> = {};
  if ('name' in input) {
    if (typeof input['name'] !== 'string') throw new FacilityError('The facility name must be text.');
    const name = input['name'].trim().replace(/\s+/g, ' ');
    if (name.length > 120) throw new FacilityError('Keep the facility name to 120 characters.');
    patch.name = name;
  }
  if ('district' in input) {
    if (typeof input['district'] !== 'string') throw new FacilityError('The district must be text.');
    const district = input['district'].trim().replace(/\s+/g, ' ');
    if (district.length > 80) throw new FacilityError('Keep the district to 80 characters.');
    patch.district = district;
  }
  if ('lineListNames' in input) {
    if (typeof input['lineListNames'] !== 'boolean') throw new FacilityError('Say yes or no to names on line lists.');
    patch.lineListNames = input['lineListNames'];
  }
  if (Object.keys(patch).length === 0) throw new FacilityError('Nothing to change.');
  return prisma.$transaction(async tx => {
    const before = await tx.facilitySetting.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
    const after = await tx.facilitySetting.update({ where: { id: 1 }, data: { ...patch, updatedById: userId ?? null } });
    const pick = (f: Facility) => ({ name: f.name, district: f.district, lineListNames: f.lineListNames });
    await audit(tx, { userId, action: 'FACILITY_SETTINGS_CHANGED', entity: 'FacilitySetting', entityId: '1', before: pick(before), after: pick(after) });
    return pick(after);
  });
}
