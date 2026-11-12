import type { BudgetDoc, Category, Position, Section } from './types';
import { fold } from './format';

export const SECTIONS: { id: Section; title: string; short: string; hint: string }[] = [
  { id: 'przychody', title: 'Przychody', short: 'Przychody', hint: 'Wynagrodzenia, faktury, świadczenia – zaznaczasz, co wpłynęło.' },
  { id: 'firmowe', title: 'Opłaty firmowe', short: 'Firmowe', hint: 'ZUS, podatki, księgowość, leasing – zaznaczasz, co zapłacone.' },
  { id: 'prywatne', title: 'Opłaty prywatne', short: 'Prywatne', hint: 'Rachunki, kredyty, ubezpieczenia, subskrypcje – zaznaczasz, co zapłacone.' },
  { id: 'wydatki', title: 'Wydatki', short: 'Wydatki', hint: 'Spożywka, chemia, paliwo… – suma z wyciągów i ręcznych wpisów wobec budżetu.' },
];

export const sectionTitle = (s: Section) => SECTIONS.find((x) => x.id === s)!.title;

/** Sekcja domyślna wynikająca z nazwy kategorii (gdy nie ustawiono jej ręcznie). */
export const guessSection = (name: string): Section => {
  const n = fold(name);
  if (n.includes('PRZYCHOD') || n.includes('WPLYW')) return 'przychody';
  if (n.includes('PODAT') || n.includes('ZUS') || n.includes('FIRM')) return 'firmowe';
  if (n.includes('WYDATK')) return 'wydatki';
  return 'prywatne';
};

export const sectionOf = (c: Category | undefined): Section => c?.section ?? (c ? guessSection(c.name) : 'prywatne');

export const positionSection = (doc: BudgetDoc, p: Position): Section => sectionOf(doc.categories[p.categoryId]);

/** Pozycja liczona jako suma wydatków (bez odhaczania). */
export const isExpense = (doc: BudgetDoc, p: Position) => !!p.envelope || positionSection(doc, p) === 'wydatki';

/** Kategorie posortowane: najpierw według sekcji, potem według kolejności. */
export const sortedCategories = (doc: BudgetDoc): Category[] => {
  const rank = (c: Category) => SECTIONS.findIndex((s) => s.id === sectionOf(c));
  return Object.values(doc.categories)
    .filter((c) => !c.deleted)
    .sort((a, b) => rank(a) - rank(b) || a.order - b.order);
};

/** Pozycje, które proponowany podział przenosi do opłat firmowych. */
export const looksBusiness = (name: string) => /KSIEGOW|LEASING|BIURO RACHUNK/.test(fold(name));
