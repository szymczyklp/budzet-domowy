import type { BudgetDoc, EmergencyItem, MonthKey, Section } from './types';
import { linesForMonth } from './projection';
import type { Line } from './projection';
import { sectionOf, sortedCategories } from './sections';
import { addMonths, monthsBetween } from './month';

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Linie wielu miesięcy naraz (jedno przejście na miesiąc). */
export const linesByMonth = (doc: BudgetDoc, months: MonthKey[], now?: MonthKey) =>
  new Map<MonthKey, Line[]>(months.map((m) => [m, linesForMonth(doc, m, now)]));

export interface Series {
  id: string;
  name: string;
  section: Section;
  /** Kwota w kolejnych miesiącach (ze znakiem, jak w budżecie). */
  values: number[];
}

export interface CategoryTrend extends Series {
  positions: Series[];
}

/**
 * Kwoty kategorii i ich pozycji miesiąc po miesiącu (rzeczywiste, a bez nich – plan).
 * Kategorie bez żadnej kwoty w okresie są pomijane.
 */
export const categoryTrends = (doc: BudgetDoc, months: MonthKey[], now?: MonthKey): CategoryTrend[] => {
  const byMonth = linesByMonth(doc, months, now);
  const out: CategoryTrend[] = [];
  for (const c of sortedCategories(doc)) {
    const section = sectionOf(c);
    const pos = new Map<string, Series>();
    months.forEach((m, i) => {
      for (const l of byMonth.get(m)!) {
        if (l.position.categoryId !== c.id) continue;
        let s = pos.get(l.position.id);
        if (!s) pos.set(l.position.id, (s = { id: l.position.id, name: l.position.name, section, values: months.map(() => 0) }));
        s.values[i] = r2(s.values[i] + l.amount);
      }
    });
    const positions = [...pos.values()].filter((s) => s.values.some((v) => v !== 0));
    if (positions.length === 0) continue;
    const values = months.map((_, i) => r2(positions.reduce((a, s) => a + s.values[i], 0)));
    positions.sort((a, b) => sum(a.values) - sum(b.values));
    out.push({ id: c.id, name: c.name, section, values, positions });
  }
  return out;
};

export const sum = (xs: number[]) => r2(xs.reduce((a, b) => a + b, 0));

/** Zmiana w % (dla wydatków: wzrost wydatku = dodatnia zmiana). null, gdy brak bazy. */
export const change = (now: number, before: number): number | null =>
  before === 0 ? null : Math.round(((Math.abs(now) - Math.abs(before)) / Math.abs(before)) * 1000) / 10;

/* ---------- podsumowanie roku ---------- */

export interface YearSummary {
  year: string;
  months: MonthKey[];
  /** Miesiące zamknięte (rzeczywiste); pozostałe to prognoza. */
  closed: number;
  bySection: Record<Section, number[]>;
  net: number[];
  top: { id: string; name: string; section: Section; amount: number }[];
}

export const yearSummary = (doc: BudgetDoc, year: string, now: MonthKey): YearSummary => {
  const months = monthsBetween(`${year}-01`, `${year}-12`);
  const byMonth = linesByMonth(doc, months, now);
  const ids: Section[] = ['przychody', 'firmowe', 'prywatne', 'wydatki'];
  const bySection = Object.fromEntries(ids.map((s) => [s, months.map(() => 0)])) as Record<Section, number[]>;
  const perPos = new Map<string, { id: string; name: string; section: Section; amount: number }>();
  months.forEach((m, i) => {
    for (const l of byMonth.get(m)!) {
      bySection[l.section][i] = r2(bySection[l.section][i] + l.amount);
      const p = perPos.get(l.position.id) ?? { id: l.position.id, name: l.position.name, section: l.section, amount: 0 };
      p.amount = r2(p.amount + l.amount);
      perPos.set(l.position.id, p);
    }
  });
  const net = months.map((_, i) => r2(ids.reduce((a, s) => a + bySection[s][i], 0)));
  const top = [...perPos.values()].filter((p) => p.amount < 0).sort((a, b) => a.amount - b.amount).slice(0, 10);
  const closed = months.filter((m) => m < now).length;
  return { year, months, closed, bySection, net, top };
};

/* ---------- majątek netto ---------- */

export const isAsset = (e: EmergencyItem) => e.kind === 'oszczednosci';
export const isLiability = (e: EmergencyItem) => e.kind === 'zobowiazanie';

/** Punkty historii wpisu: zapisana historia + bieżąca kwota (gdy jej tam nie ma). */
export const valuePoints = (e: EmergencyItem): { date: string; value: number }[] => {
  const pts = [...(e.history ?? [])];
  if (e.value !== undefined) {
    const date = e.valueDate ?? e.updatedAt.slice(0, 10);
    if (!pts.some((p) => p.date === date)) pts.push({ date, value: e.value });
  }
  return pts.sort((a, b) => a.date.localeCompare(b.date));
};

/** Dopisuje (albo zastępuje z tego samego dnia) punkt historii. */
export const withHistory = (e: EmergencyItem, date: string, value: number): EmergencyItem => ({
  ...e,
  value,
  valueDate: date,
  history: [...(e.history ?? []).filter((p) => p.date !== date), { date, value }].sort((a, b) => a.date.localeCompare(b.date)),
});

const valueAt = (pts: { date: string; value: number }[], date: string) => {
  let v: number | undefined;
  for (const p of pts) if (p.date <= date) v = p.value;
  return v;
};

export interface NetWorthPoint { month: MonthKey; assets: number; liabilities: number; net: number }

/**
 * Majątek netto na koniec kolejnych miesięcy: oszczędności minus zobowiązania
 * (z „Na wypadek”), ostatnia znana kwota każdego wpisu przed końcem miesiąca.
 */
export const netWorthSeries = (doc: BudgetDoc, now: MonthKey, count = 24): NetWorthPoint[] => {
  const items = Object.values(doc.emergency).filter((e) => !e.deleted && (isAsset(e) || isLiability(e)));
  const pts = items.map((e) => ({ e, pts: valuePoints(e) })).filter((x) => x.pts.length);
  if (pts.length === 0) return [];
  const first = pts.map((x) => x.pts[0].date.slice(0, 7)).sort()[0];
  const from = first > addMonths(now, -(count - 1)) ? first : addMonths(now, -(count - 1));
  return monthsBetween(from, now).map((m) => {
    const end = `${m}-31`;
    let assets = 0;
    let liabilities = 0;
    for (const { e, pts: p } of pts) {
      const v = valueAt(p, end);
      if (v === undefined) continue;
      if (isAsset(e)) assets += v;
      else liabilities += v;
    }
    return { month: m, assets: r2(assets), liabilities: r2(liabilities), net: r2(assets - liabilities) };
  });
};
