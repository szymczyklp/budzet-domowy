# Import wyciągów – opis techniczny

Jak użytkownik importuje wyciągi, opisuje [podręcznik](podrecznik.md#import-z-banku). Tu: formaty, identyfikacja
transakcji, dopasowanie, zapis i jak dodać nowy bank.

## Przepływ

```
plik ─► decodeBytes (UTF-8 / Windows-1250) ─► parseBankCsv / parseMillenniumLines ─► RawTxn[] (stałe id)
     ─► odrzucenie już zaimportowanych ─► suggest() dla każdej ─► decyzje użytkownika
     ─► applyImport() ─► transactions + rules + recalcEntries() ─► entries (kwoty rzeczywiste)
```

Wszystko dzieje się w przeglądarce. PDF czyta `pdfjs-dist`, ładowany dynamicznie tylko przy pierwszym imporcie PDF.

## Rozpoznawanie formatu (`import/parsers.ts`)

`parseBankCsv(text, mappings)` dzieli CSV (`import/csv.ts`: separator `;` albo `,` wykrywany z pierwszej linii,
pola w cudzysłowach, `""` w polu, `\r\n`) i sprawdza formaty w tej kolejności:

| Źródło (`source`) | Rozpoznanie | Uwagi |
|---|---|---|
| `revolut` | nagłówek EN (`Type, Product, Started Date…`) albo PL (`Typ, Produkt, Data rozpoczęcia…`) | pomijane stany REVERTED/DECLINED/FAILED/PENDING (i polskie odpowiedniki); kwota = kwota − opłata |
| `mbank` | wiersz zaczynający się od `#Data operacji` | kwota bez kodu waluty, opis z „Opis operacji”, „Tytuł”, „Nadawca/Odbiorca”, „Kategoria” |
| `pko-konto` | kolumny 1, 3 i 6 nagłówka: „Data operacji”, „Typ transakcji”, „Saldo po transakcji” | opis z pól „Nazwa odbiorcy/nadawcy”, „Tytuł”, „Lokalizacja: Adres” |
| `pko-karta` | kolumny 1–3 nagłówka: „Data operacji”, „Data przetworzenia”, „Rodzaj operacji” | nazwa sklepu z „Tytuł:” przed blokiem spacji |
| `csv` | zapamiętane mapowanie dla dokładnie takiego wiersza nagłówka (`csvSignature`) w pierwszych 30 wierszach | `parseMappedCsv` |
| — | nic nie pasuje | wyjątek `UnknownCsv` z wierszami pliku → ekran „Wskaż kolumny” |

`parseMillenniumLines(lines)` czyta linie tekstu z PDF wyciągu Banku Millennium: wiersz transakcji zaczyna się od
dwóch dat (księgowania i waluty), potem opis, kwota i saldo w formacie `1.234,56` (minus na końcu dla obciążeń).
Kolejne linie (do 5) aż do następnej transakcji to opis; nagłówki i stopki stron są pomijane, a sekcje podsumowań
kończą listę. Kontrahent pochodzi z „Odbiorca:” / „Nadawca:” albo z pierwszej linii opisu.

**Daty i kwoty w dowolnym CSV**: `parseAnyDate` – `RRRR-MM-DD`, `DD.MM.RRRR`, `DD-MM-RRRR`, `DD/MM/RRRR` (z godziną
albo bez); `parseAnyAmount` – `-1 234,56`, `-1234.56`, `1.234,56 PLN`, `(12,30)`, `12,30-`.

## Stały identyfikator transakcji

`id = "<source>:<data>:<kwota z 2 miejscami>:<hash(opis)>:<n>"`, gdzie `hash` to 32-bitowy skrót znormalizowanego
opisu, a `n` numeruje identyczne transakcje w jednym pliku (np. dwie płatności po 35 zł tego samego dnia).
Ten sam wiersz z kolejnego eksportu dostaje ten sam id, więc:

- ponowny import nie dubluje danych (istniejące id są pomijane),
- dwie osoby importujące ten sam wyciąg dostaną te same rekordy, które scalą się bez duplikatów.

Ograniczenie: jeśli bank zmieni opis już zaksięgowanej transakcji między eksportami, powstanie nowy id.

## Dopasowanie (`import/match.ts` → `suggest`)

Tekst do dopasowań: `fold(opis + kontrahent)` – wielkie litery, bez polskich znaków, pojedyncze spacje.

1. **Reguły użytkownika** od najdłuższego wzorca. Reguła `ignore` → pomiń. Reguła z pozycją działa, gdy pozycja
   istnieje i nie skończyła się przed miesiącem transakcji.
2. **Spłata karty**: dla obciążeń tekst pasujący do `(CREDIT CARD|SPLATA KARTY|KARTA KREDYTOWA|KARTY KREDYTOWEJ)`
   i 4 cyfr → aktywna pozycja `cardRepayment`, której konto ma te cyfry w nazwie lub numerze.
3. **Przelewy własne**: `PRZELEW WLASNY`, `OWN TRANSFER`, `SPLATA NALEZNOSCI` → pomiń.
4. **Sklepy** (`MERCHANTS`): dla obciążeń – lista słów kluczowych na każdy rodzaj wydatku; pozycja wydatku, której
   nazwa zawiera klucz (`SPOZYW`, `PALIW`, `CHEMIA`, `UBRANIA`, `RESTAURAC`, `APTEK`, `WYPOSAZ`, `TRANSPORT`,
   `ROZRYW`).
5. **Kwota zgodna z planem** z tolerancją ([obliczenia](obliczenia.md#import-dopasowanie-po-kwocie)).

Brak dopasowania → `decision: null` (do skrzynki).

## Zapis (`applyImport`)

Dla każdej decyzji:

- `null` – z opcją `keepUndecided` transakcja zapisuje się do skrzynki, chyba że już istnieje (nie nadpisujemy
  wcześniejszej decyzji),
- `{ ignore: true }` – `ignored: true`,
- `{ positionId }` – przypisanie,
- `{ split: [...] }` – `splits` (części o kwocie 0 są pomijane).

Opcjonalny `rulePattern` tworzy regułę (albo nadpisuje istniejącą z tym samym wzorcem). Dla podziału reguła nie
powstaje. Na końcu `recalcEntries` przelicza dotknięte pary (pozycja, miesiąc) – także te, z których transakcja
została przeniesiona:

- `amount` wpisu = suma kwot transakcji dotykających pozycji (`txnAmountFor` – dla podziału kwota części),
- zwykła pozycja: `paid = true`, `paidAt` = data ostatniej transakcji,
- wydatek: tylko kwota (status bez zmian),
- brak transakcji: kwota znika (wraca plan), zwykła pozycja traci zaznaczenie.

`detachTxn` (Odepnij): wpis ręczny → `deleted`, transakcja z wyciągu → bez pozycji/podziału/pominięcia (skrzynka),
następnie `recalcEntries`. `addManualTxn` tworzy transakcję `reczny` i przelicza pozycję.

## Karta wyciągu

Przy imporcie wyciągu karty (i innych źródeł poza rachunkiem PKO i Millennium) użytkownik wybiera konto; zapisuje
się w `accountId` transakcji. Widok spłaty karty sumuje obciążenia z `accountId = konto pozycji` z poprzedniego
miesiąca. Ostatni wybór dla źródła pamięta `localStorage` (`import-card-<źródło>`).

## Dodanie nowego banku

1. Zdobądź prawdziwy plik eksportu, ale **nie dodawaj go do repozytorium** (`*.csv` jest w `.gitignore`).
2. W `parsers.ts` napisz funkcję `(rows: string[][]) => RawTxn[]` zwracającą `withIds('<źródło>', …)`:
   data `RRRR-MM-DD`, kwota ze znakiem (obciążenia ujemne), `counterparty` do wyświetlania, `text` z pełnym opisem.
3. Dodaj rozpoznanie w `parseBankCsv` (po charakterystycznym nagłówku) przed obsługą zapamiętanych mapowań.
4. Dodaj źródło do `TxnSource` (`lib/types.ts`) i `SOURCE_LABEL`.
5. W `import.test.ts` dodaj test na **zmyślonych** wierszach w tym formacie (kilka typów operacji, kwoty z groszami,
   polskie znaki).
6. Zaktualizuj tabelę w podręczniku (`docs/podrecznik.md`) i w tym dokumencie.

Zamiast pisać parser, użytkownik może też raz wskazać kolumny – mapowanie zapisuje się we wspólnych ustawieniach.
