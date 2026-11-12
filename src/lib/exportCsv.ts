import type { BudgetDoc } from './types';
import { entryKey } from './types';
import { forecastEnd, monthsBetween } from './month';
import { linesForMonth } from './projection';
import { sectionOf, sectionTitle, sortedCategories } from './sections';

/** CSV pod polskiego Excela: średnik, przecinek dziesiętny, BOM UTF-8. */
const cell = (v: string | number | undefined) => {
  if (v === undefined) return '';
  if (typeof v === 'number') return v.toFixed(2).replace('.', ',');
  // tekst zaczynający się od = + - @ Excel potraktowałby jako formułę (np. spreparowany tytuł przelewu) – apostrof to blokuje
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[;"\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
const toCsv = (rows: (string | number | undefined)[][]) => '﻿' + rows.map((r) => r.map(cell).join(';')).join('\r\n');

/** Pozycje × miesiące od 2024-01 do końca horyzontu: wykonanie, a bez niego plan. */
export const positionsCsv = (doc: BudgetDoc) => {
  const months = monthsBetween('2024-01', forecastEnd());
  const byMonth = new Map(months.map((m) => [m, new Map(linesForMonth(doc, m).map((l) => [l.position.id, l]))]));
  const header = ['Sekcja', 'Kategoria', 'Pozycja', 'Karta / konto', 'Płaci', ...months];
  const rows: (string | number | undefined)[][] = [header];
  for (const c of sortedCategories(doc)) {
    for (const p of Object.values(doc.positions).filter((x) => !x.deleted && x.categoryId === c.id).sort((a, b) => a.name.localeCompare(b.name))) {
      rows.push([
        sectionTitle(sectionOf(c)), c.name, p.name, doc.accounts[p.accountId ?? '']?.name, p.payer,
        ...months.map((m) => {
          const l = byMonth.get(m)!.get(p.id);
          if (!l) return undefined;
          if (l.expense) return l.spent || (doc.entries[entryKey(p.id, m)] ? 0 : l.planned) || undefined;
          return l.amount || undefined;
        }),
      ]);
    }
  }
  return toCsv(rows);
};

export const transactionsCsv = (doc: BudgetDoc) => {
  const rows: (string | number | undefined)[][] = [['Data', 'Kwota', 'Kontrahent', 'Pozycja', 'Status', 'Źródło', 'Opis']];
  for (const t of Object.values(doc.transactions).filter((x) => !x.deleted).sort((a, b) => a.date.localeCompare(b.date))) {
    const parts = t.splits?.length ? t.splits : [{ positionId: t.positionId ?? '', amount: t.amount }];
    for (const s of parts) {
      rows.push([
        t.date, s.amount, t.counterparty, doc.positions[s.positionId]?.name,
        t.ignored ? 'pominięta' : s.positionId ? (t.splits?.length ? 'podzielona' : 'przypisana') : 'do przypisania',
        t.source, t.text,
      ]);
    }
  }
  return toCsv(rows);
};

export const downloadText = (name: string, text: string, type = 'text/csv;charset=utf-8') => {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
