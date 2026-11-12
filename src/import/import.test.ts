import { describe, expect, it } from 'vitest';
import { decodeBytes, parseCsv } from './csv';
import { csvSignature, parseAnyAmount, parseAnyDate, parseBankCsv, parseMillenniumLines, UnknownCsv } from './parsers';
import { applyImport, detachTxn, isInbox, suggest } from './match';
import { findRecurring } from './recurring';
import type { RawTxn } from './parsers';
import type { BudgetDoc, Position } from '../lib/types';
import { emptyDoc, entryKey } from '../lib/types';

/* Dane testowe są zmyślone – mają tylko format plików z banków. */

const PKO_ACCOUNT = [
  '"Data operacji","Data waluty","Typ transakcji","Kwota","Waluta","Saldo po transakcji","Opis transakcji","","","",""',
  '"2026-11-09","2026-11-09","Przelew z rachunku","-80.00","PLN","+9900.00","Rachunek odbiorcy: 45 1240 0000 0000 0000 0000 0000","Nazwa odbiorcy: OCHRONA TEST SP. Z O.O.","Tytuł: FAKTURA 1","",""',
  '"2026-11-08","2026-11-06","Płatność kartą","-40.00","PLN","+9950.00","Tytuł:  100001","Lokalizacja: Adres: ALDI SP. Z O.O. Miasto: TESTOWO Kraj: POLSKA","Data wykonania operacji: 2026-11-06","Oryginalna kwota operacji: 40.00","Numer karty: 000000******0000"',
  '"2026-11-07","2026-11-06","Płatność kartą","-25.00","PLN","+9975.00","Tytuł: 100002","Lokalizacja: Adres: ORLEN STACJA 1 Miasto: TESTOWO Kraj: POLSKA","","",""',
  '"2026-11-05","2026-11-05","Przelew na konto","+8000.00","PLN","+18000.00","Rachunek nadawcy: 86 1090 0000 0000 0000 0000 0000","Nazwa nadawcy: FIRMA SA","Tytuł: Wynagrodzenie 10/2026","",""',
].join('\r\n');

const PKO_CARD = [
  '"Data operacji","Data przetworzenia","Rodzaj operacji","Kwota operacji","Waluta","Opis","","","",""',
  '"2026-11-10","2026-11-09","Płatność kartą","-35.00","PLN","Tytuł: Telefon Abc              warszawa     POL","","","",""',
  '"2026-11-10","2026-11-09","Płatność kartą","-35.00","PLN","Tytuł: Telefon Abc              warszawa     POL","","","",""',
  '"2026-11-09","2026-11-07","Płatność kartą","-30.00","PLN","Tytuł: Bar ""Testowy""    Warszawa     POL","","","",""',
  '"2026-11-06","2026-11-06","Spłata należności - Dziękujemy","1000.00","PLN","Tytuł: SPŁATA NALEŻNOŚCI - DZIĘKUJEMY","","","",""',
].join('\n');

const MILLENNIUM = [
  'DATA         DATA',
  'KSIĘG.       WAL.   OPIS TRANSAKCJI   WARTOŚĆ   SALDO',
  '2026-10-04   2026-10-04   PRZELEW NA NUMER TELEFONU   200,00-   170,00',
  'Na R-k:00000000000000000000000001',
  'Odbiorca:Adam Tytułem:Kolacja',
  '2026-10-09   2026-10-09   PŁATNOŚĆ BLIK W INTERNECIE   70,00-   4.900,00',
  'www.bankmillennium.pl   TeleMillennium 801 331 331   Wyciąg nr 10/2026   strona 1 z 5',
  'DATA   DATA',
  'www.sklep-test.pl',
  'ZLECENIODAWCA: TEST',
  '2026-10-06   2026-10-06   PRZELEW PRZYCHODZĄCY   5.000,00   5.170,00',
  'Z R-ku:00000000000000000000000002',
  'JAN TEST Przelew własny',
  'SALDO KOŃCOWE   1.000,00',
  'Konto Oszczędnościowe Profit',
];

describe('odczyt plików z banku', () => {
  it('dekoduje Windows-1250 i UTF-8', () => {
    const cp1250 = new Uint8Array([0x50, 0xb3, 0x61, 0x74, 0x6e, 0x6f, 0x9c, 0xe6]); // „Płatność”
    expect(decodeBytes(cp1250)).toBe('Płatność');
    expect(decodeBytes(new TextEncoder().encode('﻿Zażółć'))).toBe('Zażółć');
  });

  it('parsuje CSV z cudzysłowami i pustymi kolumnami', () => {
    expect(parseCsv('"a","b ""c""",""\n"1","2",""')).toEqual([['a', 'b "c"', ''], ['1', '2', '']]);
    expect(parseCsv('a;b\n1;2')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('PKO – konto: kwoty, kontrahenci, sklepy', () => {
    const { source, txns } = parseBankCsv(PKO_ACCOUNT);
    expect(source).toBe('pko-konto');
    expect(txns.map((t) => [t.amount, t.counterparty])).toEqual([
      [-80.00, 'OCHRONA TEST SP. Z O.O.'],
      [-40.00, 'ALDI SP. Z O.O.'],
      [-25.00, 'ORLEN STACJA 1'],
      [8000.00, 'FIRMA SA'],
    ]);
  });

  it('PKO – karta: identyczne transakcje z jednego dnia mają różne, stałe id', () => {
    const a = parseBankCsv(PKO_CARD).txns;
    const b = parseBankCsv(PKO_CARD).txns;
    expect(a[0].counterparty).toBe('Telefon Abc');
    expect(a[2].counterparty).toBe('Bar "Testowy"');
    expect(a[0].id).not.toBe(a[1].id);
    expect(a.map((t) => t.id)).toEqual(b.map((t) => t.id));
  });

  it('nieznany CSV daje czytelny błąd', () => {
    expect(() => parseBankCsv('"x","y"\n"1","2"')).toThrow(/Nie rozpoznaję/);
  });

  it('Millennium PDF: kwoty z minusem na końcu, opis przeniesiony na następną stronę', () => {
    const t = parseMillenniumLines(MILLENNIUM);
    expect(t.map((x) => [x.date, x.amount, x.counterparty])).toEqual([
      ['2026-10-04', -200, 'Adam'],
      ['2026-10-09', -70, 'www.sklep-test.pl'],
      ['2026-10-06', 5000, 'JAN TEST Przelew własny'],
    ]);
  });
});

const meta = { updatedAt: '2026-01-01T00:00:00Z', updatedBy: 'test' };
const pos = (id: string, amount: number, extra: Partial<Position> = {}): Position => ({
  id, name: id, categoryId: 'c', activeFrom: '2026-01', rules: [{ from: '2026-01', amount }], ...meta, ...extra,
});
const baseDoc = (): BudgetDoc => ({
  ...emptyDoc(),
  positions: {
    ochrona: pos('ochrona (TEST)', -80.00, { id: 'ochrona', day: 9 }),
    spozywka: pos('spożywka', -1500, { id: 'spozywka', envelope: true }),
    paliwo: pos('paliwo', -1600, { id: 'paliwo', envelope: true }),
    orange: pos('opłaty TELEFON ABC', -130, { id: 'orange' }),
  },
});
let n = 0;
const stamp = () => ({ updatedAt: `2026-11-11T10:00:${String(n++ % 60).padStart(2, '0')}Z`, updatedBy: 'ja' });

describe('dopasowanie i zapis importu', () => {
  const account = parseBankCsv(PKO_ACCOUNT).txns;
  const card = parseBankCsv(PKO_CARD).txns;

  it('proponuje pozycje po kwocie i po nazwie sklepu, pomija spłatę karty', () => {
    const doc = baseDoc();
    expect(suggest(doc, account[0])).toMatchObject({ decision: { positionId: 'ochrona' }, how: 'kwota' });
    expect(suggest(doc, account[1])).toMatchObject({ decision: { positionId: 'spozywka' }, how: 'sklep' });
    expect(suggest(doc, account[2])).toMatchObject({ decision: { positionId: 'paliwo' }, how: 'sklep' });
    expect(suggest(doc, account[3]).decision).toBeNull();
    expect(suggest(doc, card[3])).toMatchObject({ decision: { ignore: true } });
  });

  it('własna reguła ma pierwszeństwo, dłuższy wzorzec wygrywa', () => {
    const doc = baseDoc();
    doc.rules = {
      r1: { id: 'r1', pattern: 'Telefon', ignore: true, ...meta },
      r2: { id: 'r2', pattern: 'telefon abc', positionId: 'orange', ...meta },
    };
    expect(suggest(doc, card[0])).toMatchObject({ decision: { positionId: 'orange' }, how: 'reguła' });
  });

  it('sumuje wiele transakcji do jednej pozycji, zapisuje reguły i nie dubluje przy ponownym imporcie', () => {
    let doc = baseDoc();
    const choices = [
      { txn: card[0], decision: { positionId: 'orange' }, rulePattern: 'Telefon Abc' },
      { txn: card[1], decision: { positionId: 'orange' } },
      { txn: account[1], decision: { positionId: 'spozywka' } },
      { txn: card[3], decision: { ignore: true } as const },
    ];
    const res = applyImport(doc, choices, stamp, () => 'rule-1');
    doc = res.doc;
    expect(res.assigned).toBe(3);
    expect(res.ignored).toBe(1);
    expect(doc.entries[entryKey('orange', '2026-11')]).toMatchObject({ amount: -70, paid: true, paidAt: '2026-11-10' });
    // budżet zbiorczy: suma bez odhaczania
    expect(doc.entries[entryKey('spozywka', '2026-11')]).toMatchObject({ amount: -40.00, paid: false });
    expect(Object.values(doc.rules)).toHaveLength(1);

    // ten sam plik jeszcze raz – te same id, kwota bez zmian
    doc = applyImport(doc, choices.slice(0, 2), stamp, () => 'rule-2').doc;
    expect(doc.entries[entryKey('orange', '2026-11')].amount).toBe(-70);
    expect(Object.values(doc.rules)).toHaveLength(1);

    // odpięcie transakcji przelicza kwotę
    doc = detachTxn(doc, card[1].id, stamp);
    expect(doc.entries[entryKey('orange', '2026-11')].amount).toBe(-35);
    doc = detachTxn(doc, card[0].id, stamp);
    expect(doc.entries[entryKey('orange', '2026-11')]).toMatchObject({ amount: undefined, paid: false });
  });

  it('po zapłaceniu pozycji nie proponuje jej drugi raz po kwocie', () => {
    let doc = baseDoc();
    doc = applyImport(doc, [{ txn: account[0], decision: { positionId: 'ochrona' } }], stamp, () => 'x').doc;
    const again = { ...account[0], id: 'inny' };
    expect(suggest(doc, again).decision).toBeNull();
  });
});

describe('spłata karty kredytowej', () => {
  const account = parseBankCsv(PKO_ACCOUNT).txns;
  const card = parseBankCsv(PKO_CARD).txns;
  it('przelew spłaty trafia do pozycji spłaty karty po końcówce numeru', () => {
    const doc = baseDoc();
    doc.accounts = { k: { id: 'k', name: 'PKO karta *7478', kind: 'karta', ...meta } };
    doc.positions.splata = pos('karta PKO – spłata', -8000, { id: 'splata', accountId: 'k', cardRepayment: true });
    const transfer = {
      ...account[0],
      id: 'x',
      amount: -2552.4,
      counterparty: 'JAN TEST',
      text: 'Przelew z rachunku Nazwa odbiorcy: JAN TEST Tytuł: CURRENT BALANCE REPAYED FOR CREDIT CARD * 7478',
    };
    expect(suggest(doc, transfer)).toMatchObject({ decision: { positionId: 'splata' }, how: 'spłata karty' });
    // inna karta – bez dopasowania
    expect(suggest(doc, { ...transfer, text: transfer.text.replace('7478', '0544') }).how).not.toBe('spłata karty');
  });

  it('transakcje z wyciągu karty zapamiętują kartę', () => {
    const res = applyImport(baseDoc(), [{ txn: { ...card[0], accountId: 'k' }, decision: { positionId: 'orange' } }], stamp, () => 'r');
    expect(res.doc.transactions[card[0].id].accountId).toBe('k');
  });
});

describe('Revolut, mBank i dowolny CSV', () => {
  it('Revolut: kwota minus opłata, pomija cofnięte', () => {
    const csv = [
      'Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance',
      'CARD_PAYMENT,Current,2026-11-02 10:00:00,2026-11-03 09:00:00,Spotify,-45.99,0.00,PLN,COMPLETED,100.00',
      'CARD_PAYMENT,Current,2026-11-04 10:00:00,,Sklep,-10.00,0.00,PLN,REVERTED,100.00',
      'TRANSFER,Current,2026-11-05 10:00:00,2026-11-05 10:00:00,To EUR,-100.00,1.00,PLN,COMPLETED,0.00',
    ].join('\n');
    const { source, txns } = parseBankCsv(csv);
    expect(source).toBe('revolut');
    expect(txns.map((t) => [t.date, t.amount, t.counterparty])).toEqual([['2026-11-03', -45.99, 'Spotify'], ['2026-11-05', -101, 'To EUR']]);
  });

  it('mBank: nagłówek po wstępie, kwoty z walutą', () => {
    const csv = [
      'mBank S.A. Bankowość Detaliczna;',
      '#Klient;',
      'JAN TEST;',
      '',
      '#Data operacji;#Opis operacji;#Rachunek;#Kategoria;#Kwota;#Saldo po operacji;',
      '2026-11-10;"ZAKUP PRZY UŻYCIU KARTY BIEDRONKA 123";"eKonto";"Żywność";"-23,45 PLN";"1 000,00 PLN";',
      '2026-11-09;"PRZELEW PRZYCHODZĄCY FIRMA";"eKonto";"Wpływy";"1 500,00 PLN";"1 023,45 PLN";',
    ].join('\n');
    const { source, txns } = parseBankCsv(csv);
    expect(source).toBe('mbank');
    expect(txns.map((t) => t.amount)).toEqual([-23.45, 1500]);
  });

  it('nieznany CSV: wyjątek z wierszami, potem import wg zapamiętanego mapowania', () => {
    const csv = 'Data;Opis;Wartość\n10.11.2026;Kawa;-12,50\n11.11.2026;Zwrot;3,00';
    let rows: string[][] = [];
    try { parseBankCsv(csv); } catch (e) { rows = (e as UnknownCsv).rows; }
    expect(rows[0]).toEqual(['Data', 'Opis', 'Wartość']);
    const map = { date: 0, amount: 2, text: [1], headerRow: 0 };
    const { source, txns } = parseBankCsv(csv, { [csvSignature(rows[0])]: map });
    expect(source).toBe('csv');
    expect(txns.map((t) => [t.date, t.amount, t.counterparty])).toEqual([['2026-11-10', -12.5, 'Kawa'], ['2026-11-11', 3, 'Zwrot']]);
  });

  it('rozpoznaje różne zapisy kwot i dat', () => {
    expect(parseAnyAmount('-1 234,56 PLN')).toBe(-1234.56);
    expect(parseAnyAmount('1.234,56')).toBe(1234.56);
    expect(parseAnyAmount('-1,234.56')).toBe(-1234.56);
    expect(parseAnyAmount('(12,30)')).toBe(-12.3);
    expect(parseAnyDate('2026/11/05 10:00')).toBe('2026-11-05');
    expect(parseAnyDate('5.11.2026')).toBe('2026-11-05');
  });
});

describe('skrzynka, podział i stałe płatności', () => {
  const account = parseBankCsv(PKO_ACCOUNT).txns;

  it('nieprzypisane trafiają do skrzynki i nie nadpisują wcześniejszej decyzji', () => {
    let doc = applyImport(baseDoc(), [{ txn: account[3], decision: null }], stamp, () => 'r', { keepUndecided: true }).doc;
    expect(isInbox(doc.transactions[account[3].id])).toBe(true);
    doc = applyImport(doc, [{ txn: account[0], decision: { positionId: 'ochrona' } }], stamp, () => 'r').doc;
    const again = applyImport(doc, [{ txn: account[0], decision: null }], stamp, () => 'r', { keepUndecided: true }).doc;
    expect(again.transactions[account[0].id].positionId).toBe('ochrona');
  });

  it('dzieli transakcję między pozycje, a odpięcie zwraca ją do skrzynki', () => {
    const t = account[1]; // -37,02 w ALDI
    let doc = applyImport(baseDoc(), [{ txn: t, decision: { split: [{ positionId: 'spozywka', amount: -30 }, { positionId: 'paliwo', amount: -7.02 }] } }], stamp, () => 'r').doc;
    expect(doc.entries[entryKey('spozywka', '2026-11')].amount).toBe(-30);
    expect(doc.entries[entryKey('paliwo', '2026-11')].amount).toBe(-7.02);
    doc = detachTxn(doc, t.id, stamp);
    expect(isInbox(doc.transactions[t.id])).toBe(true);
    expect(doc.entries[entryKey('spozywka', '2026-11')].amount).toBeUndefined();
  });

  it('wykrywa płatność powtarzającą się co miesiąc', () => {
    const mk = (m: string, amount: number, i: number): RawTxn => ({
      id: `n${i}`, source: 'pko-karta', date: `2026-${m}-05`, amount, counterparty: 'NETFLIX.COM', text: 'Tytuł: NETFLIX.COM',
    });
    const extra = [mk('08', -43, 1), mk('09', -43, 2), mk('10', -49, 3)];
    const found = findRecurring(baseDoc(), extra);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ amount: -43, day: 5, months: ['2026-08', '2026-09', '2026-10'] });
    // tylko 2 miesiące – za mało
    expect(findRecurring(baseDoc(), extra.slice(0, 2))).toHaveLength(0);
    // odrzucone nie wraca
    const doc = baseDoc();
    doc.settings = { main: { id: 'main', dismissedRecurring: [found[0].key], ...meta } };
    expect(findRecurring(doc, extra)).toHaveLength(0);
  });
});
