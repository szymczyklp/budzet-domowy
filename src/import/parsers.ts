import type { CsvMapping, TxnSource } from '../lib/types';
import { fold } from '../lib/format';
import { parseCsv } from './csv';

/** Transakcja odczytana z pliku, przed przypisaniem do pozycji. */
export interface RawTxn {
  id: string;
  source: TxnSource;
  date: string;
  amount: number;
  counterparty: string;
  text: string;
}

export const SOURCE_LABEL: Record<TxnSource, string> = {
  'pko-konto': 'PKO BP – konto',
  'pko-karta': 'PKO BP – karta kredytowa',
  millennium: 'Bank Millennium – wyciąg PDF',
  revolut: 'Revolut – wyciąg CSV',
  mbank: 'mBank – historia CSV',
  csv: 'Plik CSV (własne kolumny)',
  reczny: 'Wpis ręczny',
};

const VALID_DATE = /^(19|2[01])\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const MAX_NAME = 200;
const MAX_TEXT = 2000;

const hash = (s: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
};

/**
 * Stały identyfikator transakcji: ten sam wiersz z kolejnego eksportu dostaje ten sam id,
 * więc ponowny import nie dubluje danych. Identyczne transakcje z jednego dnia
 * (np. dwa razy Orange Flex 35 zł) rozróżnia licznik wystąpień.
 */
const withIds = (source: TxnSource, rows: Omit<RawTxn, 'id' | 'source'>[]): RawTxn[] => {
  const seen = new Map<string, number>();
  // wiersze bez poprawnej daty lub kwoty (uszkodzony albo spreparowany plik) są pomijane, a teksty przycinane
  const list = rows
    .filter((t) => typeof t.date === 'string' && VALID_DATE.test(t.date) && Number.isFinite(t.amount) && Math.abs(t.amount) < 1e12)
    .map((t) => ({ ...t, counterparty: String(t.counterparty ?? '').slice(0, MAX_NAME), text: String(t.text ?? '').slice(0, MAX_TEXT) }));
  return list.map((t) => {
    const base = `${source}:${t.date}:${t.amount.toFixed(2)}:${hash(fold(t.text))}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return { ...t, source, id: `${base}:${n}` };
  });
};

const num = (s: string | undefined) => (s ? Number(s.replace(/\s/g, '').replace(',', '.')) : NaN);
const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

/* ---------- PKO BP: historia rachunku (CSV) ---------- */

const field = (parts: string[], label: string) => {
  const p = parts.find((x) => x.startsWith(label));
  return p ? clean(p.slice(label.length)) : undefined;
};

const pkoAccount = (rows: string[][]): RawTxn[] =>
  withIds(
    'pko-konto',
    rows.slice(1).map((r) => {
      const [date, , type, amount, , , ...rest] = r;
      const parts = rest.map(clean).filter(Boolean);
      const location = field(parts, 'Lokalizacja: Adres:');
      const title = field(parts, 'Tytuł:');
      const counterparty =
        field(parts, 'Nazwa odbiorcy:') ??
        field(parts, 'Nazwa nadawcy:') ??
        (location ? clean(location.split(/ Miasto:/)[0]) : undefined) ??
        clean(`${type ?? ''}${title ? ` – ${title}` : ''}`).slice(0, 70);
      return { date, amount: num(amount), counterparty, text: clean([type, ...parts].join(' ')) };
    }),
  );

/* ---------- PKO BP: karta kredytowa (CSV) ---------- */

const pkoCard = (rows: string[][]): RawTxn[] =>
  withIds(
    'pko-karta',
    rows.slice(1).map((r) => {
      const [date, , type, amount, , desc, ...rest] = r;
      const title = (desc ?? '').replace(/^Tytuł:\s*/, '');
      // "ALDI SP. Z O.O.          OZAROW MAZOWIPOL" → nazwa sklepu przed blokiem spacji
      const counterparty = clean(title.split(/\s{2,}/)[0] || type || '');
      return { date, amount: num(amount), counterparty, text: clean([type, title, ...rest].join(' ')) };
    }),
  );

/* ---------- Revolut (CSV, wersja angielska i polska) ---------- */

const REVOLUT_EN = ['Type', 'Product', 'Started Date', 'Completed Date', 'Description', 'Amount', 'Fee', 'Currency', 'State'];
const REVOLUT_PL = ['Typ', 'Produkt', 'Data rozpoczęcia', 'Data zakończenia', 'Opis', 'Kwota', 'Opłata', 'Waluta', 'Stan'];
const SKIP_STATES = /REVERTED|DECLINED|FAILED|PENDING|COFNI|ODRZUC|NIEUDAN|OCZEKUJ/i;

const revolut = (rows: string[][]): RawTxn[] => {
  const head = rows[0].map(clean);
  const col = (en: string, pl: string) => {
    const i = head.indexOf(en);
    return i >= 0 ? i : head.indexOf(pl);
  };
  const [type, started, completed, desc, amount, fee, state] = [
    col('Type', 'Typ'), col('Started Date', 'Data rozpoczęcia'), col('Completed Date', 'Data zakończenia'),
    col('Description', 'Opis'), col('Amount', 'Kwota'), col('Fee', 'Opłata'), col('State', 'Stan'),
  ];
  return withIds(
    'revolut',
    rows
      .slice(1)
      .filter((r) => r[amount] && !SKIP_STATES.test(r[state] ?? ''))
      .map((r) => {
        const date = (r[completed] || r[started] || '').slice(0, 10);
        const value = Math.round((num(r[amount]) - Math.abs(num(r[fee] || '0'))) * 100) / 100;
        return { date, amount: value, counterparty: clean(r[desc] || r[type] || ''), text: clean(`${r[type] ?? ''} ${r[desc] ?? ''}`) };
      }),
  );
};

/* ---------- mBank (CSV z nagłówkiem „#Data operacji”) ---------- */

const mbankAmount = (s: string) => num(s.replace(/[A-Z]{3}/g, ''));

const mbank = (rows: string[][]): RawTxn[] => {
  const h = rows.findIndex((r) => clean(r[0]) === '#Data operacji');
  const head = rows[h].map((x) => clean(x).replace(/^#/, ''));
  const find = (...names: string[]) => head.findIndex((x) => names.some((n) => x.toLowerCase().startsWith(n)));
  const date = 0;
  const amount = find('kwota');
  const desc = find('opis operacji');
  const title = find('tytuł');
  const party = find('nadawca/odbiorca', 'nadawca', 'odbiorca');
  const category = find('kategoria');
  const out: Omit<RawTxn, 'id' | 'source'>[] = [];
  for (const r of rows.slice(h + 1)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(clean(r[date] ?? ''))) continue;
    const parts = [r[desc], r[title], r[party], r[category]].filter((x) => x !== undefined).map((x) => clean(x as string)).filter(Boolean);
    out.push({
      date: clean(r[date]),
      amount: mbankAmount(r[amount] ?? '0'),
      counterparty: clean((party >= 0 && r[party]) || (desc >= 0 && r[desc]) || '').slice(0, 70),
      text: parts.join(' '),
    });
  }
  return withIds('mbank', out);
};

/* ---------- dowolny CSV z mapowaniem kolumn ---------- */

/** Data w formatach RRRR-MM-DD, DD-MM-RRRR, DD.MM.RRRR, DD/MM/RRRR (z godziną albo bez). */
export const parseAnyDate = (s: string): string | null => {
  const t = clean(s);
  let m = t.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = t.match(/^(\d{1,2})[-./](\d{1,2})[-./](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
};

/** Kwota w formatach „-1 234,56”, „-1234.56”, „1.234,56 PLN”, „(12,30)”. */
export const parseAnyAmount = (s: string): number | null => {
  let t = clean(s).replace(/[A-Za-zł\s\u00a0]/g, '');
  const negative = /^\(.*\)$/.test(t) || t.endsWith('-');
  t = t.replace(/[()]/g, '').replace(/-$/, '');
  if (/,\d{1,2}$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
  else t = t.replace(/,/g, '');
  const v = Number(t);
  if (!t || Number.isNaN(v)) return null;
  return negative ? -Math.abs(v) : v;
};

export const csvSignature = (header: string[]) => header.map(clean).join('|').slice(0, 300);

export const parseMappedCsv = (rows: string[][], map: CsvMapping): RawTxn[] => {
  const out: Omit<RawTxn, 'id' | 'source'>[] = [];
  for (const r of rows.slice(map.headerRow + 1)) {
    const date = parseAnyDate(r[map.date] ?? '');
    const amount = parseAnyAmount(r[map.amount] ?? '');
    if (!date || amount === null) continue;
    const text = clean(map.text.map((i) => r[i] ?? '').join(' '));
    const party = map.counterparty !== undefined ? clean(r[map.counterparty] ?? '') : '';
    out.push({ date, amount: map.invert ? -amount : amount, counterparty: (party || text).slice(0, 70), text: text || party });
  }
  return withIds('csv', out);
};

/** Nierozpoznany plik CSV – do ręcznego wskazania kolumn. */
export class UnknownCsv extends Error {
  constructor(public rows: string[][]) {
    super('Nie rozpoznaję tego pliku CSV – wskaż kolumny z datą, kwotą i opisem.');
  }
}

/** Rozpoznaje format CSV po nagłówku i zwraca transakcje. Dla nieznanego formatu rzuca UnknownCsv. */
export const parseBankCsv = (text: string, mappings: Record<string, CsvMapping> = {}): { source: TxnSource; txns: RawTxn[] } => {
  const rows = parseCsv(text);
  const head = (rows[0] ?? []).map((h) => clean(h));
  if (REVOLUT_EN.every((h) => head.includes(h)) || REVOLUT_PL.every((h) => head.includes(h))) {
    return { source: 'revolut', txns: revolut(rows) };
  }
  if (rows.some((r) => clean(r[0] ?? '') === '#Data operacji')) {
    return { source: 'mbank', txns: mbank(rows) };
  }
  if (head[0] === 'Data operacji' && head[2] === 'Typ transakcji' && head[5] === 'Saldo po transakcji') {
    return { source: 'pko-konto', txns: pkoAccount(rows) };
  }
  if (head[0] === 'Data operacji' && head[1] === 'Data przetworzenia' && head[2] === 'Rodzaj operacji') {
    return { source: 'pko-karta', txns: pkoCard(rows) };
  }
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const map = mappings[csvSignature(rows[i])];
    if (map && map.headerRow === i) return { source: 'csv', txns: parseMappedCsv(rows, map) };
  }
  throw new UnknownCsv(rows);
};

/* ---------- Bank Millennium: wyciąg PDF (linie tekstu) ---------- */

const MILLENNIUM_TXN =
  /^(\d{4}-\d{2}-\d{2})\s+(\d{4}-\d{2}-\d{2})\s+(.+?)\s+(\d{1,3}(?:\.\d{3})*,\d{2}-?)\s+(-?\d{1,3}(?:\.\d{3})*,\d{2}-?)$/;
/** Koniec listy transakcji (sekcja podsumowania, następny rachunek). */
const MILLENNIUM_STOP = /^(SALDO|Zestawienie|RACHUNKI|PODSUMOWANIE|OPŁATA ZA PROWADZENIE|Konto |TERMINARZ|KARTY)/i;
/** Nagłówki i stopki stron – pomijamy, bo opis transakcji bywa przeniesiony na następną stronę. */
const MILLENNIUM_SKIP = /^(DATA\b|KSIĘG|WAL\.|www\.bankmillennium|Wyciąg nr|strona \d)/i;

const plAmount = (s: string) => {
  const negative = s.endsWith('-') || s.startsWith('-');
  const v = Number(s.replace(/[-.]/g, '').replace(',', '.'));
  return negative ? -v : v;
};

/** Kontrahent z linii opisu Millennium: „Odbiorca:X Tytułem:…”, nazwa przy przelewie, domena przy BLIK. */
const millenniumCounterparty = (type: string, extra: string[]) => {
  for (const l of extra) {
    const m = l.match(/Odbiorca:\s*(.+?)(?:\s+Tytułem:|$)/i) ?? l.match(/Nadawca:\s*(.+?)(?:\s+Tytułem:|$)/i);
    if (m) return clean(m[1]);
  }
  const first = extra.find((l) => !/^(Na R-k|Z R-ku|Na nr tel|ZLECENIODAWCA)/i.test(l));
  return clean(first ?? type);
};

export const parseMillenniumLines = (lines: string[]): RawTxn[] => {
  const out: Omit<RawTxn, 'id' | 'source'>[] = [];
  let cur: { date: string; amount: number; type: string; extra: string[] } | null = null;
  const flush = () => {
    if (!cur) return;
    out.push({
      date: cur.date,
      amount: cur.amount,
      counterparty: millenniumCounterparty(cur.type, cur.extra),
      text: clean([cur.type, ...cur.extra].join(' ')),
    });
    cur = null;
  };
  for (const raw of lines) {
    const line = clean(raw);
    if (!line) continue;
    const m = line.match(MILLENNIUM_TXN);
    if (m) {
      flush();
      cur = { date: m[1], amount: plAmount(m[4]), type: m[3], extra: [] };
    } else if (MILLENNIUM_SKIP.test(line) || /TeleMillennium/.test(line)) {
      continue;
    } else if (MILLENNIUM_STOP.test(line)) {
      flush();
    } else if (cur && cur.extra.length < 5) {
      cur.extra.push(line);
    }
  }
  flush();
  return withIds('millennium', out);
};
