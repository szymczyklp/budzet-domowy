import type { BudgetDoc, ImportRule, MonthKey, Position, Txn } from '../lib/types';
import { entryKey } from '../lib/types';
import { fold } from '../lib/format';
import { isActive } from '../lib/projection';
import { planFor } from '../lib/firm';
import { isExpense } from '../lib/sections';
import type { RawTxn } from './parsers';

export type SplitPart = { positionId: string; amount: number };

/** Co zrobić z transakcją: przypisać do pozycji, podzielić, pominąć albo zostawić na później. */
export type Decision = { positionId: string } | { split: SplitPart[] } | { ignore: true } | null;

/** Transakcja w skrzynce: zapisana, ale jeszcze nieprzypisana. */
export const isInbox = (t: Txn) => !t.deleted && !t.ignored && !t.positionId && !t.splits?.length;

/** Kwota transakcji przypadająca na pozycję (cała albo część z podziału). */
export const txnAmountFor = (t: Txn, positionId: string) =>
  t.positionId === positionId ? t.amount : (t.splits ?? []).filter((x) => x.positionId === positionId).reduce((a, x) => a + x.amount, 0);

export const txnTouches = (t: Txn, positionId: string) => t.positionId === positionId || !!t.splits?.some((x) => x.positionId === positionId);

export type How = 'reguła' | 'sklep' | 'kwota' | 'przelew własny' | 'spłata karty';

export interface Suggestion {
  decision: Decision;
  how?: How;
  /** Reguła, która zadecydowała (do podglądu). */
  rule?: string;
}

/**
 * Wbudowane podpowiedzi po nazwie sklepu dla zakupów kartą. Klucz to fragment nazwy
 * pozycji (np. „spożywka”), wartości – fragmenty opisu transakcji. Działają tylko,
 * gdy taka pozycja istnieje; własne reguły mają pierwszeństwo.
 */
export const MERCHANTS: Record<string, string[]> = {
  SPOZYW: [
    'ALDI', 'LIDL', 'BIEDRONKA', 'ZABKA', 'KAUFLAND', 'CARREFOUR', 'AUCHAN', 'NETTO', 'DINO', 'STOKROTKA',
    'LEWIATAN', 'DELIKATESY', 'FRISCO', 'PIEKARNIA', 'PIEKARZ', 'MAKRO', 'SELGROS', 'INTERMARCHE', 'POLOMARKET',
    'SPOLEM', 'MIESNY', 'WARZYW', 'BARBORA', 'GROSZEK',
  ],
  PALIW: ['ORLEN', 'BP-', 'BP ', 'SHELL', 'CIRCLE K', 'MOL ', 'AMIC', 'LOTOS', 'MOYA', 'AVIA', 'MYORLEN'],
  CHEMIA: ['ROSSMANN', 'HEBE', 'DM DROGERIE', 'DROGERIA', 'NATURA', 'SUPER-PHARM'],
  UBRANIA: ['ZALANDO', 'RESERVED', 'H&M', 'HM ', 'CCC', 'SINSAY', 'PEPCO', 'HOUSE', 'CROPP', 'MOHITO', 'LPP', 'ZARA', 'DECATHLON'],
  RESTAURAC: [
    'RESTAURACJA', 'RESTAURANT', 'BAR MLECZNY', 'PIZZ', 'KEBAB', 'SUSHI', 'KFC', 'MCDONALD', 'BURGER', 'COFFEE',
    'KAWIARNIA', 'STARBUCKS', 'COSTA', 'PAUL ', 'BISTRO', 'PYSZNE', 'GLOVO', 'WOLT', 'UBER EATS',
  ],
  APTEK: ['APTEKA', 'DOZ.PL', 'GEMINI', 'SUPER-PHARM'],
  WYPOSAZ: ['IKEA', 'CASTORAMA', 'LEROY', 'OBI ', 'JYSK', 'TEDI', 'ACTION', 'BRICOMARCHE', 'PSB', 'AGATA MEBLE', 'HOME&YOU'],
  TRANSPORT: ['UBER', 'BOLT', 'FREENOW', 'PARKING', 'SKYCASH', 'JAKDOJADE', 'PKP', 'INTERCITY', 'KOLEJE', 'MPK', 'ZTM', 'AUTOSTRAD'],
  ROZRYW: ['KINO', 'CINEMA', 'MULTIKINO', 'HELIOS', 'EMPIK', 'TEATR', 'BILET', 'EVENTIM', 'STEAM', 'PLAYSTATION'],
};

/** Proponowane kategorie wydatków (nazwy zawierają klucze z MERCHANTS, żeby działały podpowiedzi sklepów). */
export const EXPENSE_SUGGESTIONS = [
  'spożywka', 'chemia', 'paliwo', 'ubrania', 'restauracje i kawiarnie', 'apteka i zdrowie',
  'dom i wyposażenie', 'transport i parkingi', 'rozrywka i kultura', 'prezenty',
];

/** Typowe przelewy własne i spłaty karty widziane od strony karty – domyślnie do pominięcia. */
const OWN_TRANSFER = ['PRZELEW WLASNY', 'OWN TRANSFER', 'SPLATA NALEZNOSCI'];

const usable = (doc: BudgetDoc, positionId: string | undefined, month: MonthKey) => {
  const p = positionId ? doc.positions[positionId] : undefined;
  return p && !p.deleted && (!p.activeTo || p.activeTo >= month) ? p : undefined;
};

export const txnMonth = (date: string): MonthKey => date.slice(0, 7);

/** Aktywne reguły od najdłuższego wzorca (bardziej szczegółowa reguła wygrywa). */
export const sortedRules = (doc: BudgetDoc): ImportRule[] =>
  Object.values(doc.rules)
    .filter((r) => !r.deleted && r.pattern.trim())
    .sort((a, b) => fold(b.pattern).length - fold(a.pattern).length);

export const suggest = (doc: BudgetDoc, t: RawTxn, rules = sortedRules(doc)): Suggestion => {
  const text = fold(`${t.text} ${t.counterparty}`);
  const month = txnMonth(t.date);

  // 1. własne reguły
  for (const r of rules) {
    if (!text.includes(fold(r.pattern))) continue;
    if (r.ignore) return { decision: { ignore: true }, how: 'reguła', rule: r.pattern };
    if (usable(doc, r.positionId, month)) return { decision: { positionId: r.positionId! }, how: 'reguła', rule: r.pattern };
  }

  const active = Object.values(doc.positions).filter((p) => isActive(p, month));

  // 2. przelew spłacający kartę kredytową: końcówka numeru karty → pozycja „spłata karty” z tą kartą
  const card = t.amount < 0 ? text.match(/(?:CREDIT CARD|SPLATA KARTY|KARTA KREDYTOWA|KARTY KREDYTOWEJ)\D{0,12}(\d{4})\b/) : null;
  if (card) {
    const pos = active.find((p) => {
      const a = p.cardRepayment ? doc.accounts[p.accountId ?? ''] : undefined;
      return a && `${a.name} ${a.number ?? ''}`.includes(card[1]);
    });
    if (pos) return { decision: { positionId: pos.id }, how: 'spłata karty' };
  }

  // 3. przelewy własne
  if (OWN_TRANSFER.some((k) => text.includes(k))) return { decision: { ignore: true }, how: 'przelew własny' };

  // 4. zakupy: nazwa sklepu → pozycja w wydatkach (spożywka, paliwo, chemia, restauracje…)
  if (t.amount < 0) {
    const expenses = active.filter((p) => isExpense(doc, p));
    for (const [posKey, words] of Object.entries(MERCHANTS)) {
      if (!words.some((w) => text.includes(w))) continue;
      const pos = expenses.find((p) => fold(p.name).includes(posKey));
      if (pos) return { decision: { positionId: pos.id }, how: 'sklep' };
    }
  }

  // 5. kwota zgodna z planem (stałe opłaty: czynsz, ochrona, śmieci…)
  // Drobne kwoty muszą się zgadzać co do grosza; od 1000 zł dopuszczamy 1% różnicy (podatki, faktury).
  // Pozycje zbiorcze (spożywka, paliwo…) pomijamy – tam kwota planu to budżet, nie konkretna płatność.
  const custom = doc.settings?.main?.amountTolerance;
  const tolerance = (plan: number) =>
    custom !== undefined ? Math.max(0.005, (Math.abs(plan) * custom) / 100) : Math.abs(plan) >= 1000 ? Math.abs(plan) * 0.01 : 0.005;
  const byAmount = active
    .filter((p) => !isExpense(doc, p) && !doc.entries[entryKey(p.id, month)]?.paid)
    .map((p) => ({ p, plan: planFor(doc, p, month) }))
    .filter(({ plan }) => plan !== 0 && Math.sign(plan) === Math.sign(t.amount) && Math.abs(plan - t.amount) <= tolerance(plan));
  if (byAmount.length > 0) {
    const day = Number(t.date.slice(8, 10));
    byAmount.sort((a, b) => Math.abs((a.p.day ?? day) - day) - Math.abs((b.p.day ?? day) - day));
    return { decision: { positionId: byAmount[0].p.id }, how: 'kwota' };
  }

  return { decision: null };
};

/** Proponowany wzorzec reguły dla ręcznego przypisania: nazwa kontrahenta bez cyfr na końcu. */
export const defaultPattern = (t: RawTxn) =>
  // przycięcie przed wyrażeniem regularnym: na bardzo długim tekście ze spacjami liczyłoby się ono kwadratowo
  t.counterparty.slice(0, 200).replace(/\s+\d[\d\s./-]*$/, '').replace(/\s+K\.\d+$/i, '').trim().slice(0, 60);

export interface ImportChoice {
  txn: RawTxn & { accountId?: string };
  decision: Decision;
  /** Zapisz regułę z tym wzorcem (tylko dla ręcznych wyborów). */
  rulePattern?: string;
}

export interface ImportResult {
  doc: BudgetDoc;
  assigned: number;
  ignored: number;
  /** Zapisane do skrzynki (nieprzypisane). */
  inbox: number;
  rules: number;
  touched: { positionId: string; month: MonthKey }[];
}

type Stamp = () => { updatedAt: string; updatedBy: string };

/**
 * Zapisuje decyzje importu: transakcje (przypisane i pominięte), nowe reguły oraz
 * kwoty rzeczywiste pozycji. Kwota pozycji w miesiącu to suma wszystkich przypisanych
 * do niej transakcji; zwykłe pozycje dostają też status „rozliczone”.
 */
export const applyImport = (
  doc: BudgetDoc,
  choices: ImportChoice[],
  stamp: Stamp,
  newId: () => string,
  opts: { keepUndecided?: boolean } = {},
): ImportResult => {
  const transactions = { ...doc.transactions };
  const rules = { ...doc.rules };
  let assigned = 0;
  let ignored = 0;
  let inbox = 0;
  let ruleCount = 0;
  const touched = new Map<string, { positionId: string; month: MonthKey }>();
  const touch = (positionId: string, month: MonthKey) => touched.set(entryKey(positionId, month), { positionId, month });

  for (const { txn, decision, rulePattern } of choices) {
    const prev = transactions[txn.id];
    const live = prev && !prev.deleted ? prev : undefined;
    // nieprzypisane: do skrzynki, ale nie nadpisujemy wcześniejszej decyzji
    if (!decision && (!opts.keepUndecided || live)) continue;
    const month = txnMonth(txn.date);
    if (live?.positionId) touch(live.positionId, live.month);
    for (const sp of live?.splits ?? []) touch(sp.positionId, live!.month);
    const record: Txn = {
      id: txn.id, source: txn.source, date: txn.date, month, amount: txn.amount,
      counterparty: txn.counterparty, text: txn.text, ...(txn.accountId ? { accountId: txn.accountId } : {}), ...stamp(),
    };
    if (!decision) {
      inbox++;
    } else if ('ignore' in decision) {
      record.ignored = true;
      ignored++;
    } else if ('split' in decision) {
      record.splits = decision.split.filter((x) => x.amount !== 0);
      for (const sp of record.splits) touch(sp.positionId, month);
      assigned++;
    } else {
      record.positionId = decision.positionId;
      touch(decision.positionId, month);
      assigned++;
    }
    transactions[txn.id] = record;

    const pattern = rulePattern?.trim();
    if (pattern && decision && !('split' in decision)) {
      const existing = Object.values(rules).find((r) => !r.deleted && fold(r.pattern) === fold(pattern));
      const id = existing?.id ?? newId();
      rules[id] = { id, pattern, ...('ignore' in decision ? { ignore: true } : { positionId: decision.positionId }), ...stamp() };
      ruleCount++;
    }
  }

  const next = { ...doc, transactions, rules };
  return { doc: recalcEntries(next, [...touched.values()], stamp), assigned, ignored, inbox, rules: ruleCount, touched: [...touched.values()] };
};

/** Przelicza kwoty rzeczywiste pozycji z przypisanych transakcji. */
export const recalcEntries = (doc: BudgetDoc, targets: { positionId: string; month: MonthKey }[], stamp: Stamp): BudgetDoc => {
  const entries = { ...doc.entries };
  for (const { positionId, month } of targets) {
    const pos: Position | undefined = doc.positions[positionId];
    const expense = pos ? isExpense(doc, pos) : false;
    const list = Object.values(doc.transactions).filter((t) => !t.deleted && !t.ignored && t.month === month && txnTouches(t, positionId));
    const key = entryKey(positionId, month);
    const prev = entries[key] && !entries[key].deleted ? entries[key] : undefined;
    if (list.length === 0) {
      // ostatnią transakcję odpięto – wracamy do planu
      if (prev) entries[key] = { ...prev, amount: undefined, paid: expense ? prev.paid : false, paidAt: undefined, ...stamp() };
      continue;
    }
    const sum = Math.round(list.reduce((s, t) => s + txnAmountFor(t, positionId), 0) * 100) / 100;
    const lastDate = list.map((t) => t.date).sort().at(-1);
    entries[key] = {
      positionId,
      month,
      ...prev,
      amount: sum,
      paid: expense ? !!prev?.paid : true,
      paidAt: expense ? prev?.paidAt : lastDate,
      ...stamp(),
    };
  }
  return { ...doc, entries };
};

/** Odpina transakcję: z wyciągu wraca do skrzynki, wpis ręczny jest usuwany. */
export const detachTxn = (doc: BudgetDoc, txnId: string, stamp: Stamp): BudgetDoc => {
  const t = doc.transactions[txnId];
  if (!t) return doc;
  const targets = [...(t.positionId ? [t.positionId] : []), ...(t.splits ?? []).map((x) => x.positionId)].map((positionId) => ({ positionId, month: t.month }));
  const changed: Txn = t.source === 'reczny'
    ? { ...t, deleted: true, ...stamp() }
    : { ...t, positionId: undefined, splits: undefined, ignored: undefined, ...stamp() };
  const next = { ...doc, transactions: { ...doc.transactions, [txnId]: changed } };
  return recalcEntries(next, targets, stamp);
};

/** Ręcznie dodany wydatek (np. gotówka) – zapisany jak transakcja, więc sumuje się z wyciągami. */
export const addManualTxn = (
  doc: BudgetDoc,
  input: { positionId: string; date: string; amount: number; description: string },
  stamp: Stamp,
  id: string,
): BudgetDoc => {
  const month = txnMonth(input.date);
  const txn: Txn = {
    id, source: 'reczny', date: input.date, month, amount: input.amount,
    counterparty: input.description || 'wpis ręczny', text: input.description, positionId: input.positionId, ...stamp(),
  };
  const next = { ...doc, transactions: { ...doc.transactions, [id]: txn } };
  return recalcEntries(next, [{ positionId: input.positionId, month }], stamp);
};
