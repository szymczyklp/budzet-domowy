import type { AmountRule, MonthKey, Position } from './types';
import { monthDiff } from './month';
import { loanPayment } from './loan';

export const isActive = (p: Position, m: MonthKey) =>
  !p.deleted && m >= p.activeFrom && (!p.activeTo || m <= p.activeTo);

/** Reguła obowiązująca w danym miesiącu (ostatnia z from <= m). */
export const ruleFor = (p: Position, m: MonthKey): AmountRule | undefined => {
  let found: AmountRule | undefined;
  for (const r of p.rules) if (r.from <= m && (!found || r.from >= found.from)) found = r;
  return found;
};

/** Kwota planowana z reguł (bez uwzględnienia wpisów). */
export const plannedAmount = (p: Position, m: MonthKey): number => {
  if (!isActive(p, m)) return 0;
  const single = p.monthly?.[m];
  if (single !== undefined) return single;
  // kredyt z harmonogramem: od pierwszej raty z harmonogramu plan = rata (+ nadpłata)
  if (p.loan && m >= p.loan.from) return loanPayment(p.loan, m);
  const r = ruleFor(p, m);
  if (!r) return 0;
  if (r.until && m > r.until) return 0;
  // indeksacja: +x% od każdego kolejnego stycznia po miesiącu startu reguły
  const factor = r.indexation ? (1 + r.indexation / 100) ** (Number(m.slice(0, 4)) - Number(r.from.slice(0, 4))) : 1;
  const round = (v: number) => (factor === 1 ? v : Math.round(v * factor * 100) / 100);
  if (r.pattern?.length === 12) return round(r.pattern[Number(m.slice(5, 7)) - 1] ?? 0);
  const every = r.everyMonths ?? 1;
  return monthDiff(r.from, m) % every === 0 ? round(r.amount) : 0;
};

