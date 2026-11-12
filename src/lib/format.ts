const pln = new Intl.NumberFormat('pl-PL', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

let hidden = false;
/** Tryb „ukryj kwoty” (np. przy pokazywaniu ekranu) – kwoty zastępowane kropkami. */
export const setAmountsHidden = (v: boolean) => {
  hidden = v;
};
export const amountsHidden = () => hidden;

/** 1234.5 → "1 234,50" (albo kropki w trybie ukrytych kwot). */
export const money = (n: number) => (hidden ? '••• ••' : pln.format(n));
/** Kwota do pola edycji – zawsze jawna. */
export const moneyInput = (n: number) => pln.format(n);

/** Akceptuje "1 234,50", "-1234.5", "1234" itd. Zwraca null dla błędnych danych. */
export const parseMoney = (s: string): number | null => {
  const clean = s.replace(/[\s\u00a0\u202f]/g, '').replace(',', '.').replace(/^\+/, '').replace(/^−/, '-');
  if (!/^-?\d+(\.\d{1,2})?$/.test(clean)) return null;
  return Number(clean);
};

/** Dzisiejsza data w strefie czasowej urządzenia (RRRR-MM-DD) – nie UTC, żeby po północy nie wychodził wczorajszy dzień. */
export const today = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Tekst do wyszukiwania i dopasowań: wielkie litery, bez polskich znaków, pojedyncze spacje. */
export const fold = (s: string) =>
  s
    .replace(/ł/g, 'l')
    .replace(/Ł/g, 'L')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
