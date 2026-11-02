import { Prisma } from '@prisma/client';

// An amended lab result is saved as a NEW record that keeps the original result time (so "when was it
// resulted" stays truthful), which means the original and its amendments tie on resultedAt.
// Break the tie with amendedAt so the latest correction is always the one treated as current.
export const LATEST_RESULT_FIRST: Prisma.InvestigationResultOrderByWithRelationInput[] = [
  { resultedAt: 'desc' },
  { amendedAt: { sort: 'desc', nulls: 'last' } },
];

// Oldest → newest, so the last entry is the current value.
export const LATEST_RESULT_LAST: Prisma.InvestigationResultOrderByWithRelationInput[] = [
  { resultedAt: 'asc' },
  { amendedAt: { sort: 'asc', nulls: 'first' } },
];
