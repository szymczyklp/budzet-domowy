import type { BudgetDoc, FirmSettings, MonthKey, Position } from './types';
import { entryKey } from './types';
import { addMonths, monthsBetween } from './month';
import { isActive, plannedAmount } from './plan';

const r2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Podstawa składki zdrowotnej na ryczałcie = przeciętne wynagrodzenie z IV kwartału poprzedniego roku.
 * Składka: 9% z 60% / 100% / 180% podstawy przy rocznym przychodzie do 60 tys. / do 300 tys. / powyżej.
 * Lata bez ogłoszonej wartości używają ostatniej znanej.
 */
export const HEALTH_BASE: Record<number, number> = { 2025: 8549.18, 2026: 9228.64 };

export const healthBase = (year: number) => {
  const known = Object.keys(HEALTH_BASE).map(Number).sort((a, b) => a - b);
  const y = known.filter((k) => k <= year).at(-1) ?? known[0];
  return HEALTH_BASE[y];
};

export type HealthBracket = 'do 60 tys.' | '60–300 tys.' | 'ponad 300 tys.';

export const healthRyczalt = (annualRevenue: number, year: number): { amount: number; bracket: HealthBracket } => {
  const [pct, bracket]: [number, HealthBracket] =
    annualRevenue <= 60000 ? [0.6, 'do 60 tys.'] : annualRevenue <= 300000 ? [1, '60–300 tys.'] : [1.8, 'ponad 300 tys.'];
  return { amount: r2(healthBase(year) * pct * 0.09), bracket };
};

/** Kwota pozycji w miesiącu: rzeczywista z wpisu, a bez niej plan z reguł / harmonogramu. */
const amountOf = (doc: BudgetDoc, p: Position, m: MonthKey) => {
  const e = doc.entries[entryKey(p.id, m)];
  if (e && !e.deleted && e.amount !== undefined) return e.amount;
  return plannedAmount(p, m);
};

export interface FirmMonth {
  month: MonthKey;
  incomes: { positionId: string; name: string; lumpRate: number; revenue: number; base: number; tax: number }[];
  revenue: number;
  outputVat: number;
  inputVat: number;
  inputLines: { positionId: string; name: string; gross: number; rate: number; deductible: number; vat: number }[];
  /** VAT do zapłaty (ujemny = nadwyżka do przeniesienia / zwrotu). */
  vatDue: number;
  social: number;
  health: number;
  bracket: HealthBracket;
  annualRevenue: number;
  /** Zaliczka ryczałtu (pełne złote). */
  pit: number;
}

const yearCache = new WeakMap<BudgetDoc, Map<string, number>>();

/** Roczny przychód z faktur pomniejszony o składki społeczne – do progu składki zdrowotnej. */
const annualRevenue = (doc: BudgetDoc, firm: FirmSettings, year: string) => {
  let map = yearCache.get(doc);
  if (!map) yearCache.set(doc, (map = new Map()));
  const hit = map.get(year);
  if (hit !== undefined) return hit;
  let total = 0;
  for (const m of monthsBetween(`${year}-01`, `${year}-12`)) {
    for (const i of firm.incomes) {
      const p = doc.positions[i.positionId];
      if (p && !p.deleted) total += amountOf(doc, p, m);
    }
  }
  const v = r2(total - 12 * firm.socialZus);
  map.set(year, v);
  return v;
};

/** Rozliczenie firmy za miesiąc (przychód z tego miesiąca budżetu). */
export const firmMonth = (doc: BudgetDoc, firm: FirmSettings, m: MonthKey): FirmMonth => {
  const incomes = firm.incomes
    .map((i) => ({ i, p: doc.positions[i.positionId] }))
    .filter((x): x is { i: FirmSettings['incomes'][number]; p: Position } => !!x.p && !x.p.deleted)
    .map(({ i, p }) => ({ positionId: p.id, name: p.name, lumpRate: i.lumpRate, revenue: amountOf(doc, p, m), base: 0, tax: 0 }));
  const revenue = r2(incomes.reduce((s, x) => s + x.revenue, 0));

  // VAT należny: rzeczywisty wpływ VAT od klienta albo netto × stawka
  const vatIncome = firm.vatIncomePositionId ? doc.entries[entryKey(firm.vatIncomePositionId, m)] : undefined;
  const outputVat = vatIncome && !vatIncome.deleted && vatIncome.amount !== undefined ? vatIncome.amount : r2((revenue * firm.vatRate) / 100);

  // VAT naliczony z kosztów firmowych z zaznaczonym VAT (kwoty brutto)
  const inputLines = Object.values(doc.positions)
    .filter((p) => !p.deleted && p.vat && p.vat.rate > 0 && isActive(p, m))
    .map((p) => {
      const gross = amountOf(doc, p, m);
      const vat = gross < 0 ? r2(((-gross * p.vat!.rate) / (100 + p.vat!.rate)) * (p.vat!.deductible / 100)) : 0;
      return { positionId: p.id, name: p.name, gross, rate: p.vat!.rate, deductible: p.vat!.deductible, vat };
    })
    .filter((x) => x.vat > 0);
  const inputVat = r2(inputLines.reduce((s, x) => s + x.vat, 0));
  const vatDue = Math.round(outputVat - inputVat);

  const year = Number(m.slice(0, 4));
  const annual = annualRevenue(doc, firm, m.slice(0, 4));
  const { amount: health, bracket } = healthRyczalt(annual, year);

  // ryczałt: od przychodu odliczamy składki społeczne i 50% zdrowotnej – najpierw z linii o najwyższej stawce
  let deduct = firm.socialZus + health / 2;
  for (const x of [...incomes].sort((a, b) => b.lumpRate - a.lumpRate)) {
    const used = Math.min(Math.max(0, x.revenue), deduct);
    deduct -= used;
    x.base = Math.round(Math.max(0, x.revenue - used));
    x.tax = r2((x.base * x.lumpRate) / 100);
  }
  const pit = Math.round(incomes.reduce((s, x) => s + x.tax, 0));

  return { month: m, incomes, revenue, outputVat, inputVat, inputLines, vatDue, social: firm.socialZus, health, bracket, annualRevenue: annual, pit };
};

const monthCache = new WeakMap<BudgetDoc, Map<MonthKey, FirmMonth>>();
const firmMonthCached = (doc: BudgetDoc, firm: FirmSettings, m: MonthKey) => {
  let map = monthCache.get(doc);
  if (!map) monthCache.set(doc, (map = new Map()));
  let v = map.get(m);
  if (!v) map.set(m, (v = firmMonth(doc, firm, m)));
  return v;
};

/** Która pozycja jest wyliczana przez moduł firmowy (i jak). */
export const firmRole = (doc: BudgetDoc, positionId: string): 'vat' | 'pit' | 'zus' | 'vatIncome' | undefined => {
  const f = doc.settings.main?.firm;
  if (!f) return undefined;
  if (positionId === f.vatPositionId) return 'vat';
  if (positionId === f.pitPositionId) return 'pit';
  if (positionId === f.zusPositionId) return 'zus';
  if (positionId === f.vatIncomePositionId) return 'vatIncome';
  return undefined;
};

/**
 * Plan pozycji w miesiącu: dla podatków i składek firmy – wyliczony z przychodów i kosztów,
 * dla pozostałych – z reguł / harmonogramu kredytu. Zmiana jednego miesiąca ma pierwszeństwo.
 */
export const planFor = (doc: BudgetDoc, p: Position, m: MonthKey): number => {
  const firm = doc.settings.main?.firm;
  if (!firm || m < firm.from || p.monthly?.[m] !== undefined || !isActive(p, m)) return plannedAmount(p, m);
  const role = firmRole(doc, p.id);
  if (!role) return plannedAmount(p, m);
  if (role === 'vatIncome') return firmMonthCached(doc, firm, m).outputVat;
  const calc = firmMonthCached(doc, firm, addMonths(m, -(firm.lag ?? 0)));
  if (role === 'vat') return -calc.vatDue;
  if (role === 'pit') return -calc.pit;
  return -r2(calc.social + calc.health);
};
