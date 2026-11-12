import type { LoanPlan, MonthKey } from './types';
import { addMonths } from './month';

const r2 = (v: number) => Math.round(v * 100) / 100;

export interface LoanRow {
  month: MonthKey;
  /** Rata (kapitał + odsetki), bez nadpłaty i opłat. */
  installment: number;
  interest: number;
  principal: number;
  overpayment: number;
  fee: number;
  /** Kapitał pozostały po tym miesiącu. */
  balance: number;
}

const annuity = (balance: number, r: number, n: number) => (n <= 0 ? balance : r === 0 ? balance / n : (balance * r) / (1 - (1 + r) ** -n));

/**
 * Harmonogram od miesiąca `from`: raty równe (annuitetowe) albo malejące, odsetki miesięcznie (oprocentowanie / 12).
 * Nadpłata zmniejsza kapitał po racie danego miesiąca i skraca okres albo zmniejsza ratę.
 * To przybliżenie – bank liczy odsetki według dni, więc grosze mogą się różnić.
 */
export const loanSchedule = (loan: LoanPlan): LoanRow[] => {
  const r = loan.rate / 100 / 12;
  const over = new Map<MonthKey, { amount: number; mode: 'okres' | 'rata' }[]>();
  for (const o of loan.overpayments ?? []) over.set(o.month, [...(over.get(o.month) ?? []), o]);
  const rows: LoanRow[] = [];
  let balance = loan.balance;
  let n = loan.months;
  let rata = annuity(balance, r, n);
  let capital = balance / Math.max(1, n); // część kapitałowa przy ratach malejących
  let m = loan.from;
  // zabezpieczenie: najwyżej 60 lat rat
  for (let i = 0; balance > 0.005 && i < 720; i++) {
    const interest = r2(balance * r);
    let principal = loan.kind === 'malejace' ? capital : rata - interest;
    if (principal > balance || n <= 1) principal = balance;
    principal = r2(Math.max(0, principal));
    balance = r2(balance - principal);
    n--;
    let overpayment = 0;
    for (const o of over.get(m) ?? []) {
      const a = r2(Math.min(o.amount, balance));
      if (a <= 0) continue;
      overpayment = r2(overpayment + a);
      balance = r2(balance - a);
      if (o.mode === 'rata') {
        rata = annuity(balance, r, n);
        capital = balance / Math.max(1, n);
      }
    }
    rows.push({ month: m, installment: r2(principal + interest), interest, principal, overpayment, fee: loan.fee ?? 0, balance });
    m = addMonths(m, 1);
  }
  return rows;
};

const cache = new WeakMap<LoanPlan, Map<MonthKey, LoanRow>>();

/** Wiersz harmonogramu dla miesiąca (z pamięcią podręczną na obiekt planu). */
export const loanRow = (loan: LoanPlan, m: MonthKey): LoanRow | undefined => {
  let map = cache.get(loan);
  if (!map) {
    map = new Map(loanSchedule(loan).map((x) => [x.month, x]));
    cache.set(loan, map);
  }
  return map.get(m);
};

/** Kwota do budżetu w miesiącu: −(rata + nadpłata + opłata); 0 poza harmonogramem. */
export const loanPayment = (loan: LoanPlan, m: MonthKey): number => {
  const row = loanRow(loan, m);
  return row ? -r2(row.installment + row.overpayment + row.fee) : 0;
};

export interface LoanStats {
  end: MonthKey | undefined;
  interest: number;
  firstInstallment: number;
  count: number;
}

export const loanStats = (rows: LoanRow[]): LoanStats => ({
  end: rows.at(-1)?.month,
  interest: r2(rows.reduce((s, x) => s + x.interest, 0)),
  firstInstallment: rows[0]?.installment ?? 0,
  count: rows.length,
});

/** Kapitał pozostały na koniec miesiąca `m` (przed `from` – kwota startowa). */
export const balanceAt = (loan: LoanPlan, m: MonthKey): number => {
  if (m < loan.from) return loan.balance;
  let last = loan.balance;
  for (const x of loanSchedule(loan)) {
    if (x.month > m) break;
    last = x.balance;
  }
  return last;
};
