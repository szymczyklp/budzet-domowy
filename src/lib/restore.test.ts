import { describe, expect, it } from 'vitest';
import { restoreDoc } from './restore';
import { mergeDocs } from './merge';
import { emptyDoc } from './types';
import type { BudgetDoc } from './types';
import { parseMoney, today } from './format';

const at = (t: string) => ({ updatedAt: t, updatedBy: 'x' });

describe('przywracanie kopii', () => {
  it('kopia wygrywa przy scalaniu z innym urządzeniem, a rekordy spoza kopii znikają', () => {
    const backup: BudgetDoc = { ...emptyDoc(), categories: { a: { id: 'a', name: 'A z kopii', order: 0, ...at('2026-01-01T00:00:00Z') } } };
    const other: BudgetDoc = {
      ...emptyDoc(),
      categories: {
        a: { id: 'a', name: 'A nowsze', order: 0, ...at('2026-10-01T00:00:00Z') },
        b: { id: 'b', name: 'B spoza kopii', order: 1, ...at('2026-10-01T00:00:00Z') },
      },
    };
    const restored = restoreDoc(other, backup, () => at('2026-11-11T12:00:00Z'));
    const merged = mergeDocs(other, restored);
    expect(merged.categories.a.name).toBe('A z kopii');
    expect(merged.categories.b.deleted).toBe(true);
  });
});

describe('formaty', () => {
  it('kwoty z polskim formatowaniem', () => {
    expect(parseMoney('1 234,50')).toBe(1234.5);
    expect(parseMoney('1 234,50')).toBe(1234.5);
    expect(parseMoney('−45,90')).toBe(-45.9);
    expect(parseMoney('+12')).toBe(12);
    expect(parseMoney('12,345')).toBeNull();
  });
  it('dzisiejsza data lokalna', () => {
    expect(today(new Date(2026, 0, 1, 0, 30))).toBe('2026-01-01');
  });
});
