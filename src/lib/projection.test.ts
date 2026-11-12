import { describe, expect, it } from 'vitest';
import type { BudgetDoc, Position } from './types';
import { emptyDoc } from './types';
import { linesForMonth, overdue, plannedAmount, summarize } from './projection';
import { addMonths, forecastEnd, monthDiff, monthsBetween } from './month';

const meta = { updatedAt: '2026-01-01T00:00:00Z', updatedBy: 'test' };
const pos = (p: Partial<Position> & Pick<Position, 'id' | 'rules'>): Position => ({
  name: p.id, categoryId: 'c', activeFrom: '2026-01', ...meta, ...p,
});

describe('month', () => {
  it('dodaje miesiące przez granicę roku', () => {
    expect(addMonths('2026-11', 3)).toBe('2027-02');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(monthDiff('2026-11', '2027-02')).toBe(3);
  });

  it('horyzont prognozy: do końca roku i dwóch kolejnych lat', () => {
    expect(forecastEnd('2026-11')).toBe('2028-12');
    expect(monthsBetween('2026-11', forecastEnd('2026-11'))).toHaveLength(26);
  });
});

describe('plannedAmount', () => {
  it('kwota obowiązuje do następnej reguły', () => {
    const p = pos({ id: 'kredyt', rules: [{ from: '2026-01', amount: -100 }, { from: '2026-06', amount: -90 }] });
    expect(plannedAmount(p, '2026-05')).toBe(-100);
    expect(plannedAmount(p, '2026-06')).toBe(-90);
    expect(plannedAmount(p, '2030-01')).toBe(-90);
  });

  it('respektuje okres aktywności', () => {
    const p = pos({ id: 'x', activeFrom: '2026-03', activeTo: '2026-04', rules: [{ from: '2026-01', amount: -5 }] });
    expect(plannedAmount(p, '2026-02')).toBe(0);
    expect(plannedAmount(p, '2026-04')).toBe(-5);
    expect(plannedAmount(p, '2026-05')).toBe(0);
  });

  it('plan zmieniony dla jednego miesiąca ma pierwszeństwo przed regułą', () => {
    const p = pos({ id: 'gaz', rules: [{ from: '2026-01', amount: -900 }], monthly: { '2026-12': -1400 } });
    expect(plannedAmount(p, '2026-11')).toBe(-900);
    expect(plannedAmount(p, '2026-12')).toBe(-1400);
    expect(plannedAmount(p, '2027-01')).toBe(-900);
  });

  it('kwota do miesiąca: potem 0 aż do następnej reguły', () => {
    const p = pos({ id: 'kredyt', rules: [{ from: '2026-01', amount: -500, until: '2026-06' }, { from: '2026-10', amount: -200 }] });
    expect(plannedAmount(p, '2026-06')).toBe(-500);
    expect(plannedAmount(p, '2026-07')).toBe(0);
    expect(plannedAmount(p, '2026-10')).toBe(-200);
  });

  it('sezonowość: schemat 12 miesięcy powtarzany co roku', () => {
    const pattern = [-900, 0, -700, 0, -300, 0, 0, 0, 0, -400, 0, -800];
    const p = pos({ id: 'gaz', rules: [{ from: '2026-12', amount: 0, pattern }] });
    expect(plannedAmount(p, '2026-11')).toBe(0);
    expect(plannedAmount(p, '2026-12')).toBe(-800);
    expect(plannedAmount(p, '2027-01')).toBe(-900);
    expect(plannedAmount(p, '2028-03')).toBe(-700);
  });

  it('indeksacja: +x% od każdego kolejnego stycznia', () => {
    const p = pos({ id: 'czynsz', rules: [{ from: '2026-11', amount: -1000, indexation: 5 }] });
    expect(plannedAmount(p, '2026-12')).toBe(-1000);
    expect(plannedAmount(p, '2027-01')).toBe(-1050);
    expect(plannedAmount(p, '2028-06')).toBe(-1102.5);
  });

  it('płatność co N miesięcy', () => {
    const p = pos({ id: 'prad', rules: [{ from: '2026-12', amount: -134.94, everyMonths: 2 }] });
    expect(plannedAmount(p, '2026-12')).toBe(-134.94);
    expect(plannedAmount(p, '2027-01')).toBe(0);
    expect(plannedAmount(p, '2027-02')).toBe(-134.94);
  });
});

describe('linesForMonth i podsumowanie', () => {
  const doc: BudgetDoc = {
    ...emptyDoc(),
    positions: {
      pensja: pos({ id: 'pensja', rules: [{ from: '2026-01', amount: 10000 }] }),
      prad: pos({ id: 'prad', rules: [{ from: '2026-01', amount: -200 }] }),
      netflix: pos({ id: 'netflix', rules: [{ from: '2026-01', amount: 0 }] }),
    },
    entries: {
      'prad|2026-03': { positionId: 'prad', month: '2026-03', amount: -250, paid: true, ...meta },
    },
  };

  it('pomija zerowe pozycje bez wpisu i bierze kwotę rzeczywistą z wpisu', () => {
    const lines = linesForMonth(doc, '2026-03');
    expect(lines.map((l) => l.position.id).sort()).toEqual(['pensja', 'prad']);
    expect(lines.find((l) => l.position.id === 'prad')?.amount).toBe(-250);
  });

  it('liczy wynik i kwotę do zapłaty', () => {
    const s = summarize('2026-03', linesForMonth(doc, '2026-03'));
    expect(s.net).toBe(9750);
    expect(s.outstanding).toBe(0);
    expect(s.pendingIncome).toBe(10000);
    const april = summarize('2026-04', linesForMonth(doc, '2026-04'));
    expect(april.outstanding).toBe(-200);
  });

  it('wykrywa zaległości z poprzednich miesięcy', () => {
    const late = overdue(doc, '2026-04', 2);
    expect(late.map((l) => `${l.position.id}|${l.month}`)).toEqual(['prad|2026-02']);
  });
});
