import type { BudgetDoc } from './types';

const TECHNICAL = new Set(['', 'to urządzenie', 'import-flow4', 'test']);

/** Osoby znane z danych: płacący przy pozycjach, autorzy zmian i bieżący użytkownik. */
export const knownPeople = (doc: BudgetDoc, user: string): string[] => {
  const names = new Set<string>();
  if (user.trim()) names.add(user.trim());
  for (const p of Object.values(doc.positions)) if (!p.deleted && p.payer) names.add(p.payer);
  for (const e of Object.values(doc.entries)) if (e.updatedBy && !e.updatedBy.includes('@')) names.add(e.updatedBy);
  return [...names].filter((n) => !TECHNICAL.has(n)).sort((a, b) => a.localeCompare(b));
};

/** Czy pozycja jest „moja”: wspólna albo przypisana do bieżącego użytkownika. */
export const isMine = (payer: string | undefined, user: string) => !payer || !user || payer === user;
