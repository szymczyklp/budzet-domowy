import type { BudgetDoc, Entry, MonthKey, Position, Section } from './types';
import { entryKey } from './types';
import { addMonths, currentMonth, monthRange } from './month';
import { isActive } from './plan';
import { planFor } from './firm';
import { isExpense, positionSection } from './sections';

export { isActive, ruleFor, plannedAmount } from './plan';

export interface Line {
  position: Position;
  month: MonthKey;
  section: Section;
  /** Wydatek liczony z transakcji (bez odhaczania). */
  expense: boolean;
  planned: number;
  /**
   * Kwota obowiązująca w prognozie: rzeczywista z wpisu albo planowana.
   * Dla wydatków w bieżącym i przyszłych miesiącach – większa z budżetu i dotychczasowych wydatków.
   */
  amount: number;
  /** Dla wydatków: dotychczas wydane w miesiącu (suma transakcji). */
  spent: number;
  entry?: Entry;
  paid: boolean;
}

const liveEntry = (doc: BudgetDoc, positionId: string, m: MonthKey) => {
  const e = doc.entries[entryKey(positionId, m)];
  return e && !e.deleted ? e : undefined;
};

/** Wszystkie pozycje danego miesiąca, które mają niezerową kwotę lub wpis. */
export const linesForMonth = (doc: BudgetDoc, m: MonthKey, now: MonthKey = currentMonth()): Line[] => {
  const lines: Line[] = [];
  for (const p of Object.values(doc.positions)) {
    if (p.deleted) continue;
    const entry = liveEntry(doc, p.id, m);
    const planned = planFor(doc, p, m);
    const expense = isExpense(doc, p);
    const section = positionSection(doc, p);
    if (expense) {
      const spent = entry?.amount ?? 0;
      // miesiąc zamknięty: liczy się to, co wydano (a bez danych – budżet); bieżący i przyszłe: co najmniej budżet
      const amount = m < now ? (entry?.amount ?? planned) : Math.min(planned, spent);
      // rodzaje wydatków pokazujemy zawsze, gdy są aktywne – nawet bez budżetu i wydatków
      if (!isActive(p, m) && spent === 0 && !entry) continue;
      lines.push({ position: p, month: m, section, expense, planned, amount, spent, entry, paid: false });
      continue;
    }
    const amount = entry?.amount ?? planned;
    if (amount === 0 && !entry) continue;
    lines.push({ position: p, month: m, section, expense, planned, amount, spent: 0, entry, paid: !!entry?.paid });
  }
  return lines;
};

export interface MonthSummary {
  month: MonthKey;
  income: number;
  outflow: number;
  net: number;
  /** Suma wydatków jeszcze niezapłaconych (wartość ujemna lub 0). */
  outstanding: number;
  /** Suma wpływów jeszcze nieodnotowanych. */
  pendingIncome: number;
  /** Liczniki dotyczą pozycji do odhaczenia (bez wydatków). */
  paidCount: number;
  totalCount: number;
}

export const summarize = (m: MonthKey, lines: Line[]): MonthSummary => {
  const s: MonthSummary = {
    month: m, income: 0, outflow: 0, net: 0, outstanding: 0, pendingIncome: 0,
    paidCount: 0, totalCount: lines.filter((l) => !l.expense).length,
  };
  for (const l of lines) {
    if (l.amount >= 0) s.income += l.amount;
    else s.outflow += l.amount;
    if (l.expense) continue;
    if (l.paid) s.paidCount++;
    else if (l.amount < 0) s.outstanding += l.amount;
    else s.pendingIncome += l.amount;
  }
  s.net = s.income + s.outflow;
  return s;
};

export const monthSummary = (doc: BudgetDoc, m: MonthKey) => summarize(m, linesForMonth(doc, m));

/** Niezapłacone wydatki z `lookback` miesięcy przed `m` (zaległości). */
export const overdue = (doc: BudgetDoc, m: MonthKey, lookback = 6): Line[] =>
  monthRange(addMonths(m, -lookback), lookback)
    .flatMap((x) => linesForMonth(doc, x))
    .filter((l) => !l.expense && !l.paid && l.amount < 0);

export interface SectionTotal {
  section: Section;
  /** Plan miesiąca (dla wydatków – budżet). */
  planned: number;
  /** Kwota w prognozie: rzeczywiste tam, gdzie są, planowane w pozostałych. */
  amount: number;
  /** Zrealizowane: wpłynęło / zapłacono / wydano. */
  done: number;
  doneCount: number;
  count: number;
}

/** Sumy miesiąca w podziale na sekcje + balans planowany i dotychczasowy. */
export const sectionTotals = (lines: Line[]) => {
  const ids: Section[] = ['przychody', 'firmowe', 'prywatne', 'wydatki'];
  const totals = Object.fromEntries(
    ids.map((id) => [id, { section: id, planned: 0, amount: 0, done: 0, doneCount: 0, count: 0 } as SectionTotal]),
  ) as Record<Section, SectionTotal>;
  for (const l of lines) {
    const t = totals[l.section];
    t.count++;
    t.amount += l.amount;
    t.planned += l.expense ? l.planned : l.amount;
    if (l.expense) t.done += l.spent;
    else if (l.paid) {
      t.done += l.amount;
      t.doneCount++;
    }
  }
  const all = Object.values(totals);
  return {
    totals,
    /** Wynik miesiąca z prognozy. */
    balance: all.reduce((s, t) => s + t.amount, 0),
    /** To, co już się wydarzyło: wpływy minus zapłacone i wydane. */
    balanceNow: all.reduce((s, t) => s + t.done, 0),
  };
};
