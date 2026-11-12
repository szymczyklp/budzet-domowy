import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Account, BudgetDoc, Category, Entry, MonthKey, Position } from './types';
import { emptyDoc, entryKey, normalizeDoc } from './types';
import type { Collection, EmergencyItem } from './types';
import { idbGet, idbSet } from './idb';
import { mergeDocs } from './merge';
import { sanitizeDoc } from './sanitize';
import { planFor } from './firm';
import { today } from './format';

const DOC_KEY = 'doc';
const USER_KEY = 'user';
const DIRTY_KEY = 'dirty';

type Draft<T> = Omit<T, 'updatedAt' | 'updatedBy'>;

/** Dostęp dla synchronizacji – nie używać w widokach. */
export interface StoreInternals {
  getDoc: () => BudgetDoc;
  /** Licznik lokalnych zmian (rośnie przy każdej edycji). */
  changeCount: () => number;
  isDirty: () => boolean;
  /** Scala dane z Dysku bez oznaczania ich jako lokalna zmiana. */
  mergeRemote: (remote: BudgetDoc) => void;
  /** Oznacza dane jako wysłane, o ile od `count` nie było nowych zmian. */
  markSynced: (count: number) => void;
}

interface Store {
  ready: boolean;
  doc: BudgetDoc;
  user: string;
  /** Zmienia się przy każdej lokalnej edycji – sygnał do synchronizacji. */
  changeTick: number;
  setUser: (name: string) => void;
  togglePaid: (positionId: string, month: MonthKey) => void;
  setActualAmount: (positionId: string, month: MonthKey, amount: number | undefined) => void;
  savePosition: (p: Draft<Position>) => void;
  saveAccount: (a: Draft<Account>) => void;
  saveCategory: (c: Draft<Category>) => void;
  saveEmergency: (e: Draft<EmergencyItem>) => void;
  /** Dowolna zmiana kilku kolekcji naraz (np. zatwierdzenie importu). `stamp` daje updatedAt/updatedBy. */
  update: (fn: (d: BudgetDoc, stamp: () => { updatedAt: string; updatedBy: string }) => BudgetDoc) => void;
  replaceDoc: (doc: BudgetDoc) => void;
  mergeDoc: (doc: BudgetDoc) => void;
  internals: StoreInternals;
}

const Ctx = createContext<Store | null>(null);

export const useStore = () => {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore poza StoreProvider');
  return s;
};

export function StoreProvider({ children }: { children: ReactNode }) {
  const [doc, setDocState] = useState<BudgetDoc>(emptyDoc);
  const [user, setUserState] = useState('');
  const [ready, setReady] = useState(false);
  const [changeTick, setChangeTick] = useState(0);
  const loaded = useRef(false);
  const docRef = useRef<BudgetDoc>(doc);
  const changes = useRef(0);
  const dirty = useRef(false);
  const userRef = useRef('');

  useEffect(() => {
    Promise.all([idbGet<BudgetDoc>(DOC_KEY), idbGet<string>(USER_KEY), idbGet<boolean>(DIRTY_KEY)])
      .then(([d, u, dt]) => {
        if (d) {
          const n = sanitizeDoc(normalizeDoc(d));
          docRef.current = n;
          setDocState(n);
        }
        if (u) {
          userRef.current = u;
          setUserState(u);
        }
        dirty.current = !!dt;
      })
      .catch((e) => console.error('Nie udało się wczytać danych z przeglądarki', e))
      .finally(() => {
        loaded.current = true;
        setReady(true);
      });
  }, []);

  useEffect(() => {
    if (!loaded.current) return;
    const t = setTimeout(() => idbSet(DOC_KEY, doc).catch(console.error), 300);
    return () => clearTimeout(t);
  }, [doc]);

  const setDoc = useCallback((fn: (d: BudgetDoc) => BudgetDoc) => {
    setDocState((prev) => {
      const next = fn(prev);
      docRef.current = next;
      return next;
    });
  }, []);

  /** Lokalna zmiana: aktualizuje dane i zaznacza, że trzeba je wysłać. */
  const mutate = useCallback(
    (fn: (d: BudgetDoc) => BudgetDoc) => {
      setDoc(fn);
      changes.current += 1;
      if (!dirty.current) {
        dirty.current = true;
        idbSet(DIRTY_KEY, true).catch(console.error);
      }
      setChangeTick((t) => t + 1);
    },
    [setDoc],
  );

  const stamp = useCallback(
    () => ({ updatedAt: new Date().toISOString(), updatedBy: userRef.current || 'to urządzenie' }),
    [],
  );

  const setUser = useCallback((name: string) => {
    userRef.current = name;
    setUserState(name);
    idbSet(USER_KEY, name).catch(console.error);
  }, []);

  const togglePaid = useCallback(
    (positionId: string, month: MonthKey) =>
      mutate((d) => {
        const key = entryKey(positionId, month);
        const prev = d.entries[key] && !d.entries[key].deleted ? d.entries[key] : undefined;
        const paid = !prev?.paid;
        const pos = d.positions[positionId];
        const plan = pos ? planFor(d, pos, month) : 0;
        // przy oznaczaniu zapisujemy kwotę, żeby późniejsza zmiana planu nie zmieniła historii;
        // przy cofnięciu kwota równa planowi wraca do planu (kwota wpisana ręcznie zostaje)
        const amount = paid ? prev?.amount ?? plan : prev?.amount === plan ? undefined : prev?.amount;
        const entry: Entry = {
          positionId,
          month,
          ...prev,
          paid,
          paidAt: paid ? today() : undefined,
          amount,
          ...stamp(),
        };
        return { ...d, entries: { ...d.entries, [key]: entry } };
      }),
    [mutate, stamp],
  );

  const setActualAmount = useCallback(
    (positionId: string, month: MonthKey, amount: number | undefined) =>
      mutate((d) => {
        const key = entryKey(positionId, month);
        const base: Entry = d.entries[key] && !d.entries[key].deleted
          ? d.entries[key]
          : { positionId, month, paid: false, ...stamp() };
        return { ...d, entries: { ...d.entries, [key]: { ...base, amount, ...stamp() } } };
      }),
    [mutate, stamp],
  );

  const saveRecord = useCallback(
    <K extends Collection>(coll: K, rec: { id: string }) =>
      mutate((d) => ({ ...d, [coll]: { ...d[coll], [rec.id]: { ...rec, ...stamp() } } })),
    [mutate, stamp],
  );

  const internals = useMemo<StoreInternals>(
    () => ({
      getDoc: () => docRef.current,
      changeCount: () => changes.current,
      isDirty: () => dirty.current,
      mergeRemote: (remote) => setDoc((cur) => mergeDocs(cur, remote)),
      markSynced: (count) => {
        if (changes.current === count && dirty.current) {
          dirty.current = false;
          idbSet(DIRTY_KEY, false).catch(console.error);
        }
      },
    }),
    [setDoc],
  );

  const value = useMemo<Store>(
    () => ({
      ready,
      doc,
      user,
      changeTick,
      setUser,
      togglePaid,
      setActualAmount,
      savePosition: (p) => saveRecord('positions', p),
      saveAccount: (a) => saveRecord('accounts', a),
      saveCategory: (c) => saveRecord('categories', c),
      saveEmergency: (e) => saveRecord('emergency', e),
      update: (fn) => mutate((d) => fn(d, stamp)),
      replaceDoc: (d) => mutate(() => normalizeDoc(d)),
      mergeDoc: (d) => mutate((cur) => mergeDocs(cur, d)),
      internals,
    }),
    [ready, doc, user, changeTick, setUser, togglePaid, setActualAmount, saveRecord, mutate, stamp, internals],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
