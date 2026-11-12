import { describe, expect, it } from 'vitest';
import { isMine, knownPeople } from './people';
import { emptyDoc } from './types';

describe('kto płaci', () => {
  it('zbiera osoby z pozycji i zaznaczeń, bez wpisów technicznych', () => {
    const m = { updatedAt: '2026-11-11T10:00:00Z' };
    const doc = {
      ...emptyDoc(),
      positions: { a: { id: 'a', name: 'przedszkole', categoryId: 'c', activeFrom: '2026-01', rules: [], payer: 'Ola', ...m, updatedBy: 'Jan' } },
      entries: {
        x: { positionId: 'a', month: '2026-11', paid: true, ...m, updatedBy: 'Ola' },
        y: { positionId: 'a', month: '2026-10', paid: true, ...m, updatedBy: 'import-flow4' },
      },
    };
    expect(knownPeople(doc, 'Jan')).toEqual(['Jan', 'Ola']);
  });

  it('pozycja wspólna albo moja jest „moja”', () => {
    expect(isMine(undefined, 'Jan')).toBe(true);
    expect(isMine('Jan', 'Jan')).toBe(true);
    expect(isMine('Ola', 'Jan')).toBe(false);
  });
});
