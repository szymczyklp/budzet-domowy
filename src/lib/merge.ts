import type { BudgetDoc, Meta } from './types';
import { COLLECTIONS, emptyDoc } from './types';

/** Klucze, które w złośliwie spreparowanym pliku mogłyby nadpisać prototyp obiektów (prototype pollution). */
export const unsafeKey = (k: string) => k === '__proto__' || k === 'constructor' || k === 'prototype';

const coll = (d: BudgetDoc, c: string) =>
  (Object.prototype.hasOwnProperty.call(d, c) ? (d as unknown as Record<string, Record<string, Meta> | undefined>)[c] ?? {} : {});

/** Wszystkie kolekcje obu dokumentów – znane i nieznane tej wersji aplikacji. */
const collections = (a: BudgetDoc, b: BudgetDoc) => {
  const names = new Set<string>(COLLECTIONS);
  for (const d of [a, b]) {
    for (const [k, v] of Object.entries(d)) if (k !== 'schema' && !unsafeKey(k) && v && typeof v === 'object') names.add(k);
  }
  return [...names];
};

const newer = <T extends Meta>(a: T | undefined, b: T | undefined): T | undefined => {
  if (!a) return b;
  if (!b) return a;
  return b.updatedAt > a.updatedAt ? b : a;
};

/**
 * Scala dwie wersje dokumentu rekord po rekordzie: dla każdego id wygrywa
 * nowsza zmiana (updatedAt). Usunięcia (deleted: true) też są zmianami,
 * więc nie „wracają” po synchronizacji.
 */
export const mergeDocs = (local: BudgetDoc, remote: BudgetDoc): BudgetDoc => {
  const out = emptyDoc();
  for (const c of collections(local, remote)) {
    if (!Object.prototype.hasOwnProperty.call(out, c)) (out as unknown as Record<string, unknown>)[c] = {};
    const a = coll(local, c);
    const b = coll(remote, c);
    const target = coll(out, c);
    for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (unsafeKey(id)) continue;
      target[id] = newer(a[id], b[id])!;
    }
  }
  return out;
};

/** Liczba rekordów, które różnią się między dokumentami (do komunikatów). */
export const countDifferences = (a: BudgetDoc, b: BudgetDoc): number => {
  let n = 0;
  for (const c of collections(a, b)) {
    const x = coll(a, c);
    const y = coll(b, c);
    for (const id of new Set([...Object.keys(x), ...Object.keys(y)])) {
      if (x[id]?.updatedAt !== y[id]?.updatedAt) n++;
    }
  }
  return n;
};
