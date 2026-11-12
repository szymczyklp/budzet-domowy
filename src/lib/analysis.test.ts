import { describe, expect, it } from 'vitest';
import { categoryTrends, change, netWorthSeries, withHistory, yearSummary } from './analysis';
import type { BudgetDoc, EmergencyItem } from './types';
import { emptyDoc } from './types';
import { monthRange } from './month';

const meta = { updatedAt: '2026-01-01T00:00:00Z', updatedBy: 't' };
const doc = (): BudgetDoc => ({
  ...emptyDoc(),
  categories: {
    rach: { id: 'rach', name: 'RACHUNKI', order: 1, section: 'prywatne', ...meta },
    przych: { id: 'przych', name: 'PRZYCHODY', order: 0, section: 'przychody', ...meta },
  },
  positions: {
    prad: { id: 'prad', name: 'prąd', categoryId: 'rach', activeFrom: '2025-01', rules: [{ from: '2025-01', amount: -300 }, { from: '2026-01', amount: -400 }], ...meta },
    pensja: { id: 'pensja', name: 'pensja', categoryId: 'przych', activeFrom: '2025-01', rules: [{ from: '2025-01', amount: 10000 }], ...meta },
  },
});

describe('analiza', () => {
  it('trendy kategorii miesiąc po miesiącu i zmiana r/r', () => {
    const months = monthRange('2025-01', 24);
    const t = categoryTrends(doc(), months, '2027-01');
    const rach = t.find((c) => c.id === 'rach')!;
    expect(rach.values[0]).toBe(-300);
    expect(rach.values[12]).toBe(-400);
    expect(change(-4800, -3600)).toBeCloseTo(33.3, 1);
    expect(change(100, 0)).toBeNull();
  });

  it('podsumowanie roku: sekcje, wynik, prognoza', () => {
    const s = yearSummary(doc(), '2026', '2026-11');
    expect(s.closed).toBe(10);
    expect(s.bySection.prywatne[0]).toBe(-400);
    expect(s.net.reduce((a, b) => a + b, 0)).toBe(12 * 9600);
    expect(s.top[0].id).toBe('prad');
  });

  it('majątek netto z historii oszczędności i zobowiązań', () => {
    const d = doc();
    let ike: EmergencyItem = { id: 'ike', kind: 'oszczednosci', name: 'IKE', order: 0, ...meta };
    ike = withHistory(ike, '2026-09-10', 10000);
    ike = withHistory(ike, '2026-11-02', 12000);
    const kredyt = withHistory({ id: 'k', kind: 'zobowiazanie', name: 'hipoteka', order: 1, ...meta }, '2026-10-01', 300000);
    d.emergency = { ike, k: kredyt };
    const s = netWorthSeries(d, '2026-11');
    expect(s.map((x) => x.month)).toEqual(['2026-09', '2026-10', '2026-11']);
    expect(s.map((x) => x.net)).toEqual([10000, -290000, -288000]);
    // ten sam dzień zastępuje punkt
    expect(withHistory(ike, '2026-11-02', 12500).history).toHaveLength(2);
  });
});
