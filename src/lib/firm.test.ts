import { describe, expect, it } from 'vitest';
import { firmMonth, healthRyczalt, planFor } from './firm';
import { balanceAt, loanPayment, loanSchedule, loanStats } from './loan';
import { linesForMonth } from './projection';
import type { BudgetDoc, FirmSettings, LoanPlan, Position } from './types';
import { emptyDoc } from './types';

const meta = { updatedAt: '2026-01-01T00:00:00Z', updatedBy: 't' };
const pos = (id: string, amount: number, extra: Partial<Position> = {}): Position => ({
  id, name: id, categoryId: 'c', activeFrom: '2026-01', rules: [{ from: '2026-01', amount }], ...meta, ...extra,
});

describe('harmonogram kredytu', () => {
  const loan: LoanPlan = { from: '2026-12', balance: 300000, rate: 7.2, months: 300, kind: 'rowne' };

  it('raty równe spłacają kapitał w zadanym okresie', () => {
    const rows = loanSchedule(loan);
    const r = 0.006;
    const rata = (300000 * r) / (1 - (1 + r) ** -300);
    expect(rows).toHaveLength(300);
    expect(rows[0].installment).toBeCloseTo(rata, 1);
    expect(rows[0].interest).toBe(1800);
    expect(rows.at(-1)!.balance).toBe(0);
    expect(loanPayment(loan, '2026-11')).toBe(0);
    expect(loanPayment(loan, '2026-12')).toBeCloseTo(-rata, 1);
  });

  it('raty malejące: stała część kapitałowa', () => {
    const rows = loanSchedule({ ...loan, kind: 'malejace' });
    expect(rows[0].principal).toBe(1000);
    expect(rows[0].installment).toBe(2800);
    expect(rows[1].installment).toBe(2794);
  });

  it('nadpłata skraca okres albo zmniejsza ratę', () => {
    const base = loanStats(loanSchedule(loan));
    const shorter = loanStats(loanSchedule({ ...loan, overpayments: [{ month: '2027-01', amount: 50000, mode: 'okres' }] }));
    const lower = loanSchedule({ ...loan, overpayments: [{ month: '2027-01', amount: 50000, mode: 'rata' }] });
    expect(shorter.count).toBeLessThan(base.count);
    expect(shorter.interest).toBeLessThan(base.interest);
    expect(lower).toHaveLength(300);
    expect(lower[2].installment).toBeLessThan(lower[0].installment);
    expect(loanPayment({ ...loan, overpayments: [{ month: '2027-01', amount: 50000, mode: 'okres' }] }, '2027-01')).toBeLessThan(-50000);
    expect(balanceAt(loan, '2026-12')).toBeCloseTo(300000 - (loanSchedule(loan)[0].principal), 2);
  });

  it('plan pozycji kredytu bierze ratę z harmonogramu', () => {
    const p = pos('kredyt', -3653.29, { loan });
    const doc: BudgetDoc = { ...emptyDoc(), positions: { kredyt: p } };
    expect(planFor(doc, p, '2026-11')).toBe(-3653.29);
    expect(planFor(doc, p, '2026-12')).toBe(loanPayment(loan, '2026-12'));
  });
});

describe('firma: ryczałt, VAT, ZUS', () => {
  const firm: FirmSettings = {
    from: '2026-11', vatRate: 23, socialZus: 1926.76,
    incomes: [{ positionId: 'n12', lumpRate: 12 }, { positionId: 'n15', lumpRate: 15 }],
    vatIncomePositionId: 'vatin', vatPositionId: 'vat', pitPositionId: 'pit', zusPositionId: 'zus',
  };
  const doc = (): BudgetDoc => ({
    ...emptyDoc(),
    categories: {
      c: { id: 'c', name: 'PRZYCHODY', order: 0, section: 'przychody', ...meta },
      f: { id: 'f', name: 'KOSZTY FIRMOWE', order: 1, section: 'firmowe', ...meta },
    },
    positions: {
      n12: pos('n12', 50000),
      n15: pos('n15', 12400),
      vatin: pos('vatin', 14000),
      vat: pos('vat', -13000, { categoryId: 'f' }),
      pit: pos('pit', -7000, { categoryId: 'f' }),
      zus: pos('zus', -3000, { categoryId: 'f' }),
      leasing: pos('leasing', -5993.08, { categoryId: 'f', vat: { rate: 23, deductible: 50 } }),
    },
    settings: { main: { id: 'main', firm, ...meta } },
  });

  it('progi składki zdrowotnej 2026', () => {
    expect(healthRyczalt(50000, 2026).amount).toBe(498.35);
    expect(healthRyczalt(200000, 2026).amount).toBe(830.58);
    expect(healthRyczalt(700000, 2026).amount).toBe(1495.04);
    expect(healthRyczalt(700000, 2030).amount).toBe(1495.04);
  });

  it('liczy VAT, zaliczkę ryczałtu z dwiema stawkami i składki', () => {
    const f = firmMonth(doc(), firm, '2026-11');
    expect(f.outputVat).toBe(14352);
    expect(f.inputVat).toBe(560.33);
    expect(f.vatDue).toBe(13792);
    expect(f.health).toBe(1495.04);
    // odliczenia (ZUS + 50% zdrowotnej) najpierw z linii 15%
    expect(f.incomes.find((x) => x.lumpRate === 15)!.base).toBe(9726);
    expect(f.pit).toBe(7459);
  });

  it('plan pozycji podatków jest wyliczany od miesiąca startu', () => {
    const d = doc();
    const lines = linesForMonth(d, '2026-11', '2026-11');
    const amount = (id: string) => lines.find((l) => l.position.id === id)!.amount;
    expect(amount('vat')).toBe(-13792);
    expect(amount('pit')).toBe(-7459);
    expect(amount('zus')).toBe(-3421.8);
    expect(amount('vatin')).toBe(14352);
    // wcześniej – plan z reguł
    expect(planFor(d, d.positions.vat, '2026-10')).toBe(-13000);
    // z przesunięciem: podatek za październik płacony w listopadzie
    d.settings.main!.firm = { ...firm, lag: 1, from: '2026-11' };
    expect(planFor(d, d.positions.pit, '2026-11')).toBe(-firmMonth(d, d.settings.main!.firm!, '2026-10').pit);
  });
});
