import { describe, expect, it } from 'vitest';
import { parseDoc } from './backup';
import { mergeDocs } from './merge';
import { emptyDoc } from './types';

describe('format pliku', () => {
  it('wczytuje stary plik (schema 1) i uzupełnia nowe sekcje', () => {
    const d = parseDoc(JSON.stringify({ schema: 1, categories: {}, accounts: {}, positions: {}, entries: {} }));
    expect(d.schema).toBe(3);
    expect(d.transactions).toEqual({});
    expect(d.emergency).toEqual({});
  });

  it('odrzuca plik z nowszej wersji aplikacji', () => {
    expect(() => parseDoc(JSON.stringify({ schema: 4, categories: {}, accounts: {}, positions: {}, entries: {} }))).toThrow(/nowsza wersja/);
  });

  it('scalanie zachowuje transakcje, reguły i dane „Na wypadek”', () => {
    const m = { updatedAt: '2026-11-11T10:00:00Z', updatedBy: 'Ewa' };
    const remote = {
      ...emptyDoc(),
      rules: { r: { id: 'r', pattern: 'ALDI', positionId: 'p', ...m } },
      emergency: { e: { id: 'e', kind: 'ubezpieczenie' as const, name: 'Polisa', order: 0, ...m } },
    };
    const merged = mergeDocs(emptyDoc(), remote);
    expect(merged.rules.r.pattern).toBe('ALDI');
    expect(merged.emergency.e.name).toBe('Polisa');
    expect(merged.schema).toBe(3);
  });
});

describe('zgodność w przód', () => {
  it('scalanie nie gubi kolekcji nieznanych tej wersji', () => {
    const m = { updatedAt: '2026-11-11T10:00:00Z', updatedBy: 'x' };
    const remote = { ...emptyDoc(), budgets: { b: { id: 'b', ...m } } } as unknown as ReturnType<typeof emptyDoc>;
    const merged = mergeDocs(emptyDoc(), remote) as unknown as Record<string, Record<string, unknown>>;
    expect(merged.budgets.b).toBeTruthy();
  });
});
