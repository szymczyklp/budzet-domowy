# Model danych

Cały budżet to jeden dokument JSON – ten sam format w IndexedDB, w kopii zapasowej i w pliku na Dysku Google.
Źródłem prawdy są typy w `src/lib/types.ts`; ten dokument je opisuje.

## Zasady ogólne

- **Kwoty ze znakiem**: wpływy dodatnie, wydatki ujemne; liczby z dokładnością do grosza (`-129.99`).
- **Miesiące** jako tekst `"RRRR-MM"`, **daty** jako `"RRRR-MM-DD"`, znaczniki czasu jako ISO 8601 (UTC).
- **Kolekcje to mapy `id → rekord`**, nie tablice – dzięki temu scalanie działa rekord po rekordzie.
- **Każdy rekord ma `updatedAt` i `updatedBy`** (imię osoby z Ustawień). Przy scalaniu dla danego id wygrywa
  rekord z późniejszym `updatedAt`.
- **Usunięcie to `deleted: true`** (tombstone) z nowym `updatedAt` – rekord zostaje w pliku, żeby usunięcie
  „wygrało” z jego starszą kopią na innym urządzeniu.
- **Zgodność w przód**: aplikacja zachowuje przy scalaniu kolekcje, których nie zna (zapisane przez nowszą wersję).

## Dokument

```jsonc
{
  "schema": 3,
  "categories":   { "<id>": Category },
  "accounts":     { "<id>": Account },
  "positions":    { "<id>": Position },
  "entries":      { "<positionId>|<RRRR-MM>": Entry },
  "transactions": { "<id>": Txn },
  "rules":        { "<id>": ImportRule },
  "emergency":    { "<id>": EmergencyItem },
  "settings":     { "main": Settings }
}
```

### Wersje schematu

| `schema` | Zmiana |
|---|---|
| 1 | kategorie, konta, pozycje, wpisy |
| 2 | transakcje, reguły importu, „Na wypadek” |
| 3 | kolekcja `settings` (ustawienia wspólne). Późniejsze pola – podział transakcji, historia kwot w „Na wypadek”, VAT i harmonogram kredytu w pozycji – są opcjonalne i doszły bez zmiany numeru |
| 99 | koperta zaszyfrowanego pliku (patrz niżej) – nie jest dokumentem budżetu |

Każdy wczytany plik przechodzi kontrolę kształtu rekordów (`sanitizeDoc`, `lib/sanitize.ts`): rekordy bez
wymaganych pól są pomijane, złe pola opcjonalne usuwane ([szczegóły](synchronizacja.md#zabezpieczenia-strony)).
Plik ze starszym schematem jest wczytywany i uzupełniany o brakujące kolekcje (`normalizeDoc`). Plik z nowszym
schematem jest odrzucany komunikatem „Plik zapisała nowsza wersja aplikacji – odśwież aplikację”, dzięki czemu
stara, zapamiętana w telefonie wersja aplikacji nie nadpisze pól, których nie rozumie. Procedura podnoszenia
schematu: [rozwój](rozwoj.md#zmiana-modelu-danych).

## Category – kategoria

| Pole | Typ | Opis |
|---|---|---|
| `id`, `name` | string | |
| `order` | number | kolejność w obrębie sekcji |
| `section` | `'przychody' \| 'firmowe' \| 'prywatne' \| 'wydatki'` | brak = zgadywana z nazwy (`guessSection`) |

## Account – konto lub karta

| Pole | Typ | Opis |
|---|---|---|
| `id`, `name` | string | np. „Revo Mastercard •••• 1234” |
| `kind` | `'konto' \| 'karta' \| 'inne'` | |
| `bank`, `number`, `note` | string? | `number` – rachunek do przelewu |
| `dueDay` | number? | karta kredytowa: dzień spłaty |

## Position – pozycja budżetu

| Pole | Typ | Opis |
|---|---|---|
| `id`, `name`, `categoryId` | string | |
| `accountId` | string? | konto lub karta |
| `day` | number? | dzień płatności 1–31 |
| `reference`, `note` | string? | numer umowy / polisy, notatka |
| `activeFrom` / `activeTo` | MonthKey / MonthKey? | okres obowiązywania (brak `activeTo` = bez końca) |
| `rules` | AmountRule[] | reguły planu (niżej) |
| `monthly` | `Record<MonthKey, number>`? | zmiana planu tylko dla wskazanych miesięcy |
| `envelope` | boolean? | liczona jak wydatek (suma transakcji) poza sekcją Wydatki |
| `cardRepayment` | boolean? | spłata karty `accountId` – grupa „Karty kredytowe do spłaty” |
| `payer` | string? | kto płaci i zaznacza (imię); brak = wspólne |
| `vat` | `{ rate, deductible }`? | koszt firmowy: stawka VAT (%) i odliczenie (%); kwota pozycji jest brutto |
| `loan` | LoanPlan? | harmonogram kredytu (niżej) |

### AmountRule – reguła planu

| Pole | Typ | Opis |
|---|---|---|
| `from` | MonthKey | od tego miesiąca do następnej reguły |
| `amount` | number | kwota |
| `everyMonths` | number? | płatność co N miesięcy licząc od `from` |
| `until` | MonthKey? | ostatni miesiąc kwoty; później 0 (do następnej reguły) |
| `pattern` | number[12]? | sezonowość: kwoty styczeń…grudzień; zastępuje `amount` i `everyMonths` |
| `indexation` | number? | wzrost w % od każdego kolejnego stycznia |

Przykład – czynsz 1250 zł, od 2027 r. 1310 zł, ubezpieczenie domu raz w roku w marcu:

```jsonc
// czynsz
"rules": [
  { "from": "2024-01", "amount": -1250 },
  { "from": "2027-01", "amount": -1310 }
]
// ubezpieczenie domu: marzec co roku, +5% rocznie
"rules": [{ "from": "2025-03", "amount": -890, "everyMonths": 12, "indexation": 5 }]
```

### LoanPlan – harmonogram kredytu

| Pole | Typ | Opis |
|---|---|---|
| `from` | MonthKey | miesiąc pierwszej raty liczonej z harmonogramu |
| `balance` | number | kapitał do spłaty przed ratą z miesiąca `from` (dodatni) |
| `rate` | number | oprocentowanie roczne w % |
| `months` | number | liczba rat od `from` |
| `kind` | `'rowne' \| 'malejace'` | |
| `overpayments` | `{ month, amount, mode: 'okres' \| 'rata' }[]`? | nadpłaty |
| `fee` | number? | stała opłata doliczana do raty |

## Entry – wykonanie pozycji w miesiącu

Klucz: `"<positionId>|<RRRR-MM>"`.

| Pole | Typ | Opis |
|---|---|---|
| `positionId`, `month` | string | |
| `amount` | number? | kwota rzeczywista; brak = obowiązuje plan |
| `paid` | boolean | zaznaczone (zapłacone / otrzymane) |
| `paidAt` | string? | data zaznaczenia (lokalna, RRRR-MM-DD) |
| `note` | string? | notatka do miesiąca |

Przy zaznaczeniu zapisywana jest kwota z planu (`amount`), żeby późniejsza zmiana planu nie zmieniła historii.
Dla wydatków `amount` to suma transakcji, wyliczana przez `recalcEntries`.

## Txn – transakcja z wyciągu albo wpis ręczny

| Pole | Typ | Opis |
|---|---|---|
| `id` | string | stały: `źródło:data:kwota:hash(opisu):n` – ponowny import nie dubluje |
| `source` | `'pko-konto' \| 'pko-karta' \| 'millennium' \| 'revolut' \| 'mbank' \| 'csv' \| 'reczny'` | |
| `date`, `month`, `amount` | | |
| `counterparty` | string | kontrahent / sklep (do wyświetlania) |
| `text` | string | pełny opis (do reguł) |
| `positionId` | string? | przypisana pozycja |
| `splits` | `{ positionId, amount }[]`? | podział na kilka pozycji (suma = `amount`) |
| `ignored` | boolean? | pominięta (np. przelew własny) |
| `accountId` | string? | karta / konto, z którego pochodzi wyciąg |

Transakcja bez `positionId`, `splits` i `ignored` jest w **skrzynce** (`isInbox`). Wpis ręczny (`reczny`) jest
usuwany przy odpięciu; transakcja z wyciągu wraca do skrzynki.

## ImportRule – reguła importu

| Pole | Typ | Opis |
|---|---|---|
| `pattern` | string | fragment opisu (porównanie bez polskich znaków i wielkości liter) |
| `positionId` | string? | pozycja docelowa |
| `ignore` | boolean? | pomijaj takie transakcje |

## EmergencyItem – „Na wypadek”

| Pole | Typ | Opis |
|---|---|---|
| `kind` | `'oszczednosci' \| 'ubezpieczenie' \| 'zobowiazanie' \| 'kontakt' \| 'instrukcja'` | |
| `name`, `institution`, `type`, `number`, `owner` | string | |
| `value`, `valueDate` | number?, string? | saldo / suma ubezpieczenia / do spłaty (zawsze dodatnie) i stan na dzień |
| `beneficiary`, `contact`, `access`, `note` | string? | |
| `order` | number | |
| `positionId` | string? | pozycja budżetu, z której wpis powstał |
| `history` | `{ date, value }[]`? | historia kwot (majątek netto) |

Rekord `instrukcja` przechowuje tekst instrukcji w `note`.

## Settings – ustawienia wspólne

Jeden rekord o id `main`. Scalany jak każdy rekord – w całości (równoczesna zmiana dwóch różnych ustawień na dwóch
urządzeniach zostawi nowszą).

| Pole | Typ | Opis |
|---|---|---|
| `amountTolerance` | number? | tolerancja dopasowania po kwocie w % |
| `firm` | FirmSettings? | moduł firmy (niżej) |
| `csvMappings` | `Record<nagłówek, CsvMapping>`? | zapamiętane formaty CSV |
| `dismissedRecurring` | string[]? | odrzucone propozycje stałych płatności |
| `encryption` | `{ salt, iterations }`? | szyfrowanie pliku na Dysku włączone (bez hasła i klucza) |

**FirmSettings**: `from` (miesiąc startu), `vatRate`, `incomes: { positionId, lumpRate }[]`, `vatIncomePositionId?`,
`vatPositionId?`, `pitPositionId?`, `zusPositionId?`, `socialZus`, `lag?: 0 | 1`.

**CsvMapping**: `date`, `amount`, `text: number[]`, `counterparty?`, `headerRow`, `invert?` – numery kolumn od 0.

## Koperta zaszyfrowanego pliku

Gdy szyfrowanie jest włączone, plik na Dysku ma postać:

```json
{
  "schema": 99,
  "format": "budzet-domowy-szyfr",
  "v": 1,
  "kdf": { "name": "PBKDF2", "hash": "SHA-256", "iterations": 600000, "salt": "<base64, 16 B>" },
  "iv": "<base64, 12 B>",
  "data": "<base64: AES-256-GCM(JSON dokumentu)>"
}
```

`schema: 99` sprawia, że starsze wersje aplikacji odrzucą plik zamiast nadpisać go jawnym tekstem. Szczegóły:
[synchronizacja i bezpieczeństwo](synchronizacja.md#szyfrowanie-pliku-na-dysku).

## Dane tylko na urządzeniu

Poza dokumentem aplikacja trzyma lokalnie (nie synchronizuje):

| Gdzie | Klucz | Zawartość |
|---|---|---|
| IndexedDB `budzet-domowy/kv` | `doc` | dokument budżetu |
| | `user` | imię na tym urządzeniu |
| | `dirty` | są niewysłane zmiany |
| | `drive-conf` | id pliku na Dysku, wersja po ostatniej synchronizacji, miesiąc ostatniej kopii |
| | `google-token` | token dostępu, wskazówka konta, zapieczętowany refresh token |
| | `crypto-key` | niewyciągalny klucz AES (CryptoKey) i sól |
| localStorage | `hide-amounts`, `last-seen`, `app-lock`, `import-card-<źródło>` | ukryte kwoty, „Co nowego”, blokada, ostatnio wybrana karta |
| | `budzet-oauth-state`, `budzet-oauth-verifier` | tymczasowo w trakcie logowania Google (stan i weryfikator PKCE) |
| sessionStorage | `hidden-at` | kiedy aplikacja przeszła w tło (blokada) |
