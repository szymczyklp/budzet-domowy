import type { MonthKey } from './types';

export const toMonth = (d: Date): MonthKey =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

export const currentMonth = (): MonthKey => toMonth(new Date());

export const monthIndex = (m: MonthKey): number =>
  Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1;

export const fromIndex = (i: number): MonthKey =>
  `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;

export const addMonths = (m: MonthKey, n: number): MonthKey => fromIndex(monthIndex(m) + n);

export const monthDiff = (a: MonthKey, b: MonthKey): number => monthIndex(b) - monthIndex(a);

export const monthRange = (from: MonthKey, count: number): MonthKey[] =>
  Array.from({ length: count }, (_, i) => addMonths(from, i));

const NAMES = [
  'styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec',
  'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień',
];
const SHORT = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];

export const monthName = (m: MonthKey) => NAMES[Number(m.slice(5, 7)) - 1];
export const monthShort = (m: MonthKey) => `${SHORT[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;
export const isMonthKey = (s: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(s);

const LOCATIVE = [
  'styczniu', 'lutym', 'marcu', 'kwietniu', 'maju', 'czerwcu',
  'lipcu', 'sierpniu', 'wrześniu', 'październiku', 'listopadzie', 'grudniu',
];
/** „w październiku” – forma do zdań typu „Zakupy kartą w …”. */
export const monthLocative = (m: MonthKey) => LOCATIVE[Number(m.slice(5, 7)) - 1];

/** Koniec horyzontu prognozy: grudzień za dwa lata (bieżący rok + 2 pełne lata). */
export const forecastEnd = (now: MonthKey = currentMonth()): MonthKey => `${Number(now.slice(0, 4)) + 2}-12`;

/** Lista miesięcy od `from` do `to` włącznie. */
export const monthsBetween = (from: MonthKey, to: MonthKey): MonthKey[] =>
  to < from ? [] : monthRange(from, monthDiff(from, to) + 1);

const GENITIVE = [
  'stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca',
  'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia',
];
/** „od listopada 2026” – forma po „od”, „do”. */
export const monthGenitive = (m: MonthKey) => `${GENITIVE[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
