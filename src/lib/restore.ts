import type { BudgetDoc, Meta } from './types';
import { normalizeDoc } from './types';

type Stamp = () => { updatedAt: string; updatedBy: string };

/**
 * Przywrócenie kopii tak, żeby wygrało także na innych urządzeniach i na Dysku:
 * każdy rekord z kopii dostaje bieżący znacznik czasu, a rekordy, których w kopii nie ma, są usuwane (tombstone).
 * Zwykła podmiana nie wystarczy – przy scalaniu nowsze rekordy z innych urządzeń wróciłyby.
 */
export const restoreDoc = (current: BudgetDoc, backup: BudgetDoc, stamp: Stamp): BudgetDoc => {
  const out = normalizeDoc(backup) as unknown as Record<string, Record<string, Meta> | number>;
  const cur = current as unknown as Record<string, Record<string, Meta> | number>;
  const names = new Set([...Object.keys(out), ...Object.keys(cur)].filter((k) => k !== 'schema'));
  for (const c of names) {
    const target: Record<string, Meta> = {};
    const from = (out[c] ?? {}) as Record<string, Meta>;
    for (const [id, rec] of Object.entries(from)) target[id] = { ...rec, ...stamp(), ...(rec.deleted ? { deleted: true } : {}) };
    for (const [id, rec] of Object.entries((cur[c] ?? {}) as Record<string, Meta>)) {
      if (!(id in target) && !rec.deleted) target[id] = { ...rec, deleted: true, ...stamp() };
    }
    out[c] = target;
  }
  return out as unknown as BudgetDoc;
};
