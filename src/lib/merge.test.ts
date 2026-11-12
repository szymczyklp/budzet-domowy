import { describe, expect, it } from 'vitest';
import { emptyDoc } from './types';
import type { BudgetDoc } from './types';
import { countDifferences, mergeDocs } from './merge';

const e = (paid: boolean, at: string, by: string, deleted?: boolean) => ({
  positionId: 'p', month: '2026-11', paid, updatedAt: at, updatedBy: by, ...(deleted ? { deleted } : {}),
});

describe('mergeDocs', () => {
  it('dla każdego rekordu wygrywa nowsza zmiana, niezależne zmiany się sumują', () => {
    const jan: BudgetDoc = { ...emptyDoc(), entries: { a: e(true, '2026-11-07T10:00:00Z', 'Jan'), b: e(false, '2026-11-01T00:00:00Z', 'Jan') } };
    const ewa: BudgetDoc = { ...emptyDoc(), entries: { b: e(true, '2026-11-07T11:00:00Z', 'Ewa'), c: e(true, '2026-11-07T12:00:00Z', 'Ewa') } };
    const m = mergeDocs(jan, ewa);
    expect(Object.keys(m.entries).sort()).toEqual(['a', 'b', 'c']);
    expect(m.entries.b.updatedBy).toBe('Ewa');
    expect(m.entries.a.updatedBy).toBe('Jan');
  });

  it('usunięcie nie wraca po scaleniu ze starszą kopią', () => {
    const now: BudgetDoc = { ...emptyDoc(), entries: { a: e(true, '2026-11-07T12:00:00Z', 'Ewa', true) } };
    const old: BudgetDoc = { ...emptyDoc(), entries: { a: e(true, '2026-11-01T00:00:00Z', 'Jan') } };
    expect(mergeDocs(old, now).entries.a.deleted).toBe(true);
    expect(mergeDocs(now, old).entries.a.deleted).toBe(true);
  });

  it('liczy różnice', () => {
    const a: BudgetDoc = { ...emptyDoc(), entries: { a: e(true, '1', 'x') } };
    expect(countDifferences(a, a)).toBe(0);
    expect(countDifferences(a, emptyDoc())).toBe(1);
  });
});

describe('bezpieczeństwo plików z zewnątrz', () => {
  it('złośliwy plik nie nadpisuje prototypu obiektów', async () => {
    const { parseDoc } = await import('./backup');
    const { positionsCsv } = await import('./exportCsv');
    const evil = '{"schema":3,"categories":{"__proto__":{"polluted":1,"updatedAt":"2099"}},"accounts":{},"positions":{},"entries":{},"__proto__":{"x":{"polluted":2,"updatedAt":"2099"}},"constructor":{"prototype":{"polluted":3}}}';
    const doc = parseDoc(evil);
    const merged = mergeDocs(emptyDoc(), doc);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.keys(merged.categories)).toEqual([]);
    // formuła w nazwie nie trafia do Excela jako formuła
    const d = emptyDoc();
    d.categories.c = { id: 'c', name: '=HYPERLINK("http://zly")', order: 0, updatedAt: '2026', updatedBy: 't' };
    d.positions.p = { id: 'p', name: '@SUM(1)', categoryId: 'c', activeFrom: '2026-01', rules: [], updatedAt: '2026', updatedBy: 't' };
    const csv = positionsCsv(d);
    expect(csv).toContain(`"'=HYPERLINK(""http://zly"")"`);
    expect(csv).toContain(`'@SUM(1)`);
  });
});
