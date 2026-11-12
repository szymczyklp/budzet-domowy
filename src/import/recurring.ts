import type { BudgetDoc, Txn } from '../lib/types';
import { fold } from '../lib/format';
import { isExpense } from '../lib/sections';
import type { RawTxn } from './parsers';
import { defaultPattern, sortedRules } from './match';

export interface RecurringCandidate {
  key: string;
  name: string;
  pattern: string;
  /** Typowa kwota (mediana). */
  amount: number;
  /** Typowy dzień miesiąca (mediana). */
  day: number;
  months: string[];
  txnIds: string[];
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Szuka płatności powtarzających się co miesiąc, których nie ma jeszcze w planie:
 * ten sam kontrahent w co najmniej 3 różnych miesiącach, podobna kwota (±15%),
 * transakcje nieprzypisane albo przypisane do wydatków zbiorczych.
 */
export const findRecurring = (doc: BudgetDoc, extra: RawTxn[] = []): RecurringCandidate[] => {
  const dismissed = new Set(doc.settings.main?.dismissedRecurring ?? []);
  const rules = sortedRules(doc).map((r) => fold(r.pattern));
  const all = new Map<string, RawTxn & Partial<Txn>>();
  for (const t of Object.values(doc.transactions)) if (!t.deleted && !t.ignored) all.set(t.id, t);
  for (const t of extra) if (!all.has(t.id)) all.set(t.id, t);

  const groups = new Map<string, (RawTxn & Partial<Txn>)[]>();
  for (const t of all.values()) {
    if (t.amount >= 0 || t.source === 'reczny') continue;
    const assigned = t.positionId ? doc.positions[t.positionId] : undefined;
    const open = !t.positionId && !t.splits?.length ? true : assigned ? isExpense(doc, assigned) : false;
    if (!open) continue;
    const pattern = defaultPattern(t);
    const key = fold(pattern);
    if (key.length < 3 || dismissed.has(key)) continue;
    if (rules.some((r) => fold(`${t.text} ${t.counterparty}`).includes(r) && r.length > 3 && !assigned)) continue;
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }

  const out: RecurringCandidate[] = [];
  for (const [key, list] of groups) {
    const months = [...new Set(list.map((t) => t.date.slice(0, 7)))].sort();
    if (months.length < 3) continue;
    // jedna (największa) płatność na miesiąc
    const perMonth = months.map((m) => list.filter((t) => t.date.startsWith(m)).sort((a, b) => a.amount - b.amount)[0]);
    const amounts = perMonth.map((t) => t.amount);
    const med = median(amounts);
    if (!amounts.every((a) => Math.abs(a - med) <= Math.abs(med) * 0.15)) continue;
    out.push({
      key,
      name: defaultPattern(perMonth.at(-1)!),
      pattern: defaultPattern(perMonth.at(-1)!),
      amount: Math.round(med * 100) / 100,
      day: Math.round(median(perMonth.map((t) => Number(t.date.slice(8, 10))))),
      months,
      txnIds: list.map((t) => t.id),
    });
  }
  return out.sort((a, b) => a.amount - b.amount);
};


