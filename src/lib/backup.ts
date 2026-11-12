import type { BudgetDoc } from './types';
import { normalizeDoc } from './types';
import { sanitizeDoc } from './sanitize';

/** Sprawdza, czy wczytany JSON wygląda jak plik budżetu. Rzuca błąd z opisem. */
export const parseDoc = (text: string): BudgetDoc => {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Plik nie jest poprawnym JSON-em.');
  }
  const d = data as Omit<Partial<BudgetDoc>, "schema"> & { schema?: number };
  if (d?.schema !== 1 && d?.schema !== 2 && d?.schema !== 3) {
    throw new Error(typeof d?.schema === 'number' && d.schema > 3
      ? 'Plik zapisała nowsza wersja aplikacji – odśwież aplikację (zamknij ją i otwórz ponownie).'
      : 'To nie jest plik budżetu (brak "schema").');
  }
  for (const k of ['categories', 'accounts', 'positions', 'entries'] as const) {
    if (typeof d[k] !== 'object' || d[k] === null) throw new Error(`Brak sekcji "${k}" w pliku.`);
  }
  return sanitizeDoc(normalizeDoc(d));
};

export const downloadDoc = (doc: BudgetDoc) => {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const blob = new Blob([JSON.stringify(doc, null, 1)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `budzet-${stamp}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
