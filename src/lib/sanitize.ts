import type { BudgetDoc } from './types';

/**
 * Sprawdzenie kształtu rekordów z pliku z zewnątrz (Dysk, kopia JSON, dane zapisane przez starszą wersję).
 *
 * Plik może być uszkodzony albo celowo spreparowany. Rekord, który nie ma wymaganych pól we właściwym typie,
 * jest pomijany; pola opcjonalne o złym typie są usuwane. Dzięki temu obliczenia i widoki mogą ufać typom
 * z `types.ts`, a jeden zły rekord nie unieruchamia aplikacji. Nieznane pola i nieznane kolekcje zostają
 * (mogą pochodzić z nowszej wersji aplikacji).
 */

type Rec = Record<string, unknown>;

const MAX_TEXT = 100_000;
const MAX_LIST = 5_000;

const isObj = (x: unknown): x is Rec => !!x && typeof x === 'object' && !Array.isArray(x);
const isStr = (x: unknown): x is string => typeof x === 'string' && x.length <= MAX_TEXT;
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) < 1e12;
const isMonth = (x: unknown): x is string => typeof x === 'string' && /^(19|2[01])\d{2}-(0[1-9]|1[0-2])$/.test(x);
const isDate = (x: unknown): x is string => typeof x === 'string' && /^(19|2[01])\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(x);
const isBool = (x: unknown): x is boolean => typeof x === 'boolean';
const isInt = (min: number, max: number) => (x: unknown): x is number => isNum(x) && Number.isInteger(x) && x >= min && x <= max;
const oneOf = (...values: unknown[]) => (x: unknown) => values.includes(x);
const listOf = (item: (x: unknown) => boolean) => (x: unknown) => Array.isArray(x) && x.length <= MAX_LIST && x.every(item);

type Check = (x: unknown) => boolean;
/** Pola wymagane – brak albo zły typ odrzuca cały rekord. */
type Shape = { required: Record<string, Check>; optional: Record<string, Check>; repair?: (x: Rec) => Rec };

/** Zwraca kopię obiektu bez pól opcjonalnych o złym typie albo null, gdy brakuje pola wymaganego. */
const shape = (x: unknown, s: Shape): Rec | null => {
  if (!isObj(x)) return null;
  if (s.repair) x = s.repair(x);
  if (!isObj(x)) return null;
  for (const [k, ok] of Object.entries(s.required)) if (!ok(x[k])) return null;
  let out: Rec = x;
  for (const [k, ok] of Object.entries(s.optional)) {
    if (x[k] !== undefined && x[k] !== null && !ok(x[k])) {
      if (out === x) out = { ...x };
      delete out[k];
    }
  }
  return out;
};

const amountRule: Shape = {
  required: { from: isMonth, amount: isNum },
  optional: { everyMonths: isInt(1, 120), until: isMonth, pattern: (x) => listOf(isNum)(x) && (x as unknown[]).length === 12, indexation: isNum },
};
const loan: Shape = {
  required: { from: isMonth, balance: isNum, rate: isNum, months: (x) => isNum(x) && x >= 0 && x <= 1200, kind: oneOf('rowne', 'malejace') },
  optional: {
    overpayments: listOf((o) => !!shape(o, { required: { month: isMonth, amount: isNum, mode: oneOf('okres', 'rata') }, optional: {} })),
    fee: isNum,
  },
};
const firm: Shape = {
  required: {
    from: isMonth,
    vatRate: isNum,
    incomes: listOf((i) => !!shape(i, { required: { positionId: isStr, lumpRate: isNum }, optional: {} })),
    socialZus: isNum,
  },
  optional: { vatIncomePositionId: isStr, vatPositionId: isStr, pitPositionId: isStr, zusPositionId: isStr, lag: oneOf(0, 1) },
};
const csvMapping: Shape = {
  required: { date: isInt(0, 500), amount: isInt(0, 500), text: listOf(isInt(0, 500)), headerRow: isInt(0, 500) },
  optional: { counterparty: isInt(0, 500), invert: isBool },
};

const meta = { updatedAt: isStr, updatedBy: isStr };

/** Łagodne naprawy: brakujące pole dostaje wartość domyślną, zamiast odrzucać cały rekord. */
const fill = (defaults: Rec, also?: (x: Rec) => Rec) => (x: Rec): Rec => {
  let out = x;
  for (const [k, v] of Object.entries(defaults)) {
    if (out[k] === undefined || out[k] === null) out = { ...out, [k]: v };
  }
  return also ? also(out) : out;
};
/** Z listy reguł kwot zostają tylko poprawne (jedna zła reguła nie usuwa pozycji). */
const keepValidRules = (x: Rec): Rec => {
  if (!Array.isArray(x.rules)) return { ...x, rules: [] };
  const rules = x.rules.slice(0, MAX_LIST).map((r) => shape(r, amountRule)).filter(Boolean);
  return rules.length === x.rules.length && rules.every((r, i) => r === (x.rules as unknown[])[i]) ? x : { ...x, rules };
};
const metaOpt = { deleted: isBool };

const SHAPES: Record<string, Shape> = {
  categories: {
    required: { ...meta, id: isStr, name: isStr, order: isNum },
    optional: { ...metaOpt, section: oneOf('przychody', 'firmowe', 'prywatne', 'wydatki') },
    repair: fill({ order: 0, updatedBy: '' }),
  },
  accounts: {
    required: { ...meta, id: isStr, name: isStr, kind: oneOf('konto', 'karta', 'inne') },
    optional: { ...metaOpt, bank: isStr, number: isStr, dueDay: isInt(1, 31), note: isStr },
    repair: fill({ kind: 'inne', updatedBy: '' }),
  },
  positions: {
    required: { ...meta, id: isStr, name: isStr, categoryId: isStr, activeFrom: isMonth, rules: listOf((r) => !!shape(r, amountRule)) },
    optional: {
      ...metaOpt, accountId: isStr, day: isInt(1, 31), reference: isStr, note: isStr, activeTo: isMonth,
      monthly: (x) => isObj(x) && Object.entries(x).every(([m, v]) => isMonth(m) && isNum(v)),
      envelope: isBool, cardRepayment: isBool, payer: isStr,
      vat: (x) => !!shape(x, { required: { rate: isNum, deductible: isNum }, optional: {} }),
      loan: (x) => !!shape(x, loan),
    },
    repair: fill({ updatedBy: '' }, keepValidRules),
  },
  entries: {
    required: { ...meta, positionId: isStr, month: isMonth, paid: isBool },
    optional: { ...metaOpt, amount: isNum, paidAt: isDate, note: isStr },
    repair: fill({ paid: false, updatedBy: '' }),
  },
  transactions: {
    required: { ...meta, id: isStr, source: isStr, date: isDate, month: isMonth, amount: isNum, counterparty: isStr, text: isStr },
    optional: {
      ...metaOpt, positionId: isStr, ignored: isBool, accountId: isStr,
      splits: listOf((s) => !!shape(s, { required: { positionId: isStr, amount: isNum }, optional: {} })),
    },
    repair: fill({ source: 'csv', counterparty: '', text: '', updatedBy: '' }),
  },
  rules: {
    required: { ...meta, id: isStr, pattern: isStr },
    optional: { ...metaOpt, positionId: isStr, ignore: isBool },
    repair: fill({ updatedBy: '' }),
  },
  emergency: {
    required: { ...meta, id: isStr, kind: oneOf('ubezpieczenie', 'oszczednosci', 'zobowiazanie', 'kontakt', 'instrukcja'), name: isStr, order: isNum },
    optional: {
      ...metaOpt, institution: isStr, type: isStr, number: isStr, owner: isStr, value: isNum, valueDate: isDate, beneficiary: isStr,
      contact: isStr, access: isStr, note: isStr, positionId: isStr,
      history: listOf((h) => !!shape(h, { required: { date: isDate, value: isNum }, optional: {} })),
    },
    repair: fill({ order: 0, updatedBy: '' }),
  },
  settings: {
    required: { ...meta, id: isStr },
    optional: {
      ...metaOpt, amountTolerance: isNum,
      firm: (x) => !!shape(x, firm),
      csvMappings: (x) => isObj(x) && Object.values(x).every((m) => !!shape(m, csvMapping)),
      dismissedRecurring: listOf(isStr),
      encryption: (x) => !!shape(x, { required: { salt: isStr, iterations: isNum }, optional: {} }),
    },
    repair: fill({ updatedBy: '' }),
  },
};

/** Kolekcje, w których klucz mapy musi być równy polu `id` rekordu. */
const KEYED_BY_ID = new Set(['categories', 'accounts', 'positions', 'transactions', 'rules', 'emergency', 'settings']);

export interface SanitizeReport { dropped: number }

/** Zwraca dokument bez rekordów o złym kształcie (znane kolekcje); `report.dropped` – ile pominięto. */
export const sanitizeDoc = (doc: BudgetDoc, report?: SanitizeReport): BudgetDoc => {
  const out = { ...doc } as unknown as Record<string, unknown>;
  for (const [name, s] of Object.entries(SHAPES)) {
    const source = (doc as unknown as Record<string, unknown>)[name];
    const clean: Record<string, Rec> = {};
    if (isObj(source)) {
      for (const [id, rec] of Object.entries(source)) {
        if (id === '__proto__' || id === 'constructor' || id === 'prototype') continue;
        // brak pola id w rekordzie – przyjmujemy klucz mapy
        const withId = KEYED_BY_ID.has(name) && isObj(rec) && (rec.id === undefined || rec.id === null) ? { ...rec, id } : rec;
        const ok = id.length <= 500 ? shape(withId, s) : null;
        const keyOk = ok && (KEYED_BY_ID.has(name) ? ok.id === id : name !== 'entries' || id === `${ok.positionId as string}|${ok.month as string}`);
        if (ok && keyOk) clean[id] = ok;
        else if (report) report.dropped++;
      }
    }
    out[name] = clean;
  }
  return out as unknown as BudgetDoc;
};
