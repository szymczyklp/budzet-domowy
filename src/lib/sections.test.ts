import { describe, expect, it } from 'vitest';
import type { BudgetDoc, Category, Position } from './types';
import { emptyDoc, entryKey } from './types';
import { guessSection, sectionOf } from './sections';
import { linesForMonth, sectionTotals } from './projection';
import { addManualTxn } from '../import/match';

const meta = { updatedAt: '2026-01-01T00:00:00Z', updatedBy: 'test' };
const cat = (id: string, name: string, extra: Partial<Category> = {}): Category => ({ id, name, order: 0, ...meta, ...extra });
const pos = (id: string, categoryId: string, amount: number): Position => ({
  id, name: id, categoryId, activeFrom: '2026-01', rules: [{ from: '2026-01', amount }], ...meta,
});

const doc = (): BudgetDoc => ({
  ...emptyDoc(),
  categories: {
    in: cat('in', 'PRZYCHODY'),
    zus: cat('zus', 'PODATKI i SKŁADKI ZUS'),
    bills: cat('bills', 'RACHUNKI'),
    shop: cat('shop', 'WYDATKI'),
  },
  positions: {
    pensja: pos('pensja', 'in', 10000),
    zus: pos('zus', 'zus', -1500),
    prad: pos('prad', 'bills', -200),
    spozywka: pos('spozywka', 'shop', -1500),
    restauracje: pos('restauracje', 'shop', 0),
  },
});
let n = 0;
const stamp = () => ({ updatedAt: `2026-11-11T10:00:${String(n++ % 60).padStart(2, '0')}Z`, updatedBy: 'test' });

describe('sekcje', () => {
  it('zgaduje sekcję z nazwy, a ręczny wybór ma pierwszeństwo', () => {
    expect(guessSection('PRZYCHODY')).toBe('przychody');
    expect(guessSection('PODATKI i SKŁADKI ZUS')).toBe('firmowe');
    expect(guessSection('WYDATKI')).toBe('wydatki');
    expect(guessSection('SUBSKRYPCJE')).toBe('prywatne');
    expect(sectionOf(cat('x', 'SUBSKRYPCJE', { section: 'firmowe' }))).toBe('firmowe');
  });

  it('wydatki: w bieżącym miesiącu co najmniej budżet, po przekroczeniu – faktyczna suma', () => {
    let d = doc();
    d = addManualTxn(d, { positionId: 'spozywka', date: '2026-11-05', amount: -300, description: 'targ' }, stamp, 't1');
    let line = linesForMonth(d, '2026-11', '2026-11').find((l) => l.position.id === 'spozywka')!;
    expect(line).toMatchObject({ expense: true, spent: -300, amount: -1500, paid: false });

    d = addManualTxn(d, { positionId: 'spozywka', date: '2026-11-20', amount: -1400, description: '' }, stamp, 't2');
    line = linesForMonth(d, '2026-11', '2026-11').find((l) => l.position.id === 'spozywka')!;
    expect(line.amount).toBe(-1700);
    // miesiąc zamknięty: liczy się suma wydana
    expect(linesForMonth(d, '2026-11', '2026-12').find((l) => l.position.id === 'spozywka')!.amount).toBe(-1700);
    expect(d.entries[entryKey('spozywka', '2026-11')].paid).toBe(false);
  });

  it('rodzaj wydatku bez budżetu jest widoczny', () => {
    expect(linesForMonth(doc(), '2026-11', '2026-11').some((l) => l.position.id === 'restauracje')).toBe(true);
  });

  it('sumy sekcji i balans: planowany oraz dotychczasowy', () => {
    let d = doc();
    d = { ...d, entries: { [entryKey('pensja', '2026-11')]: { positionId: 'pensja', month: '2026-11', paid: true, amount: 10000, ...meta } } };
    d = addManualTxn(d, { positionId: 'spozywka', date: '2026-11-05', amount: -300, description: '' }, stamp, 't1');
    const { totals, balance, balanceNow } = sectionTotals(linesForMonth(d, '2026-11', '2026-11'));
    expect(totals.przychody).toMatchObject({ amount: 10000, done: 10000, doneCount: 1, count: 1 });
    expect(totals.firmowe).toMatchObject({ amount: -1500, done: 0 });
    expect(totals.wydatki).toMatchObject({ planned: -1500, done: -300, amount: -1500 });
    expect(balance).toBe(10000 - 1500 - 200 - 1500);
    expect(balanceNow).toBe(10000 - 300);
  });
});
