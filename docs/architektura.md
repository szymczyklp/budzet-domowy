# Architektura

Dokument dla osoby, która rozwija aplikację. Opis funkcji z punktu widzenia użytkownika jest w
[podręczniku](podrecznik.md).

## Założenia

- **Bez serwera z danymi.** Aplikacja to statyczna strona (GitHub Pages). Dane są w przeglądarce (IndexedDB) i –
  opcjonalnie – w jednym pliku JSON na Dysku Google użytkownika. Jedyny element po stronie serwera to bezstanowy
  pośrednik logowania na Cloudflare ([synchronizacja](synchronizacja.md#pośrednik-logowania-cloudflare-worker)).
- **Bez LLM i bez zewnętrznych usług analitycznych.** Import wyciągów, dopasowanie i prognozy to deterministyczny kod.
- **Offline-first.** Każda zmiana zapisuje się najpierw lokalnie; synchronizacja to scalanie dokumentów.
- **Dwie osoby, wiele urządzeń.** Model danych jest zaprojektowany pod scalanie rekord po rekordzie (bez blokad).
- **Publiczny kod, prywatne dane.** W repozytorium nie ma żadnych danych osobowych ani finansowych
  ([zasady](rozwoj.md#prywatność-danych-w-repozytorium)).

## Stos technologiczny

| Warstwa | Technologia |
|---|---|
| Interfejs | React 19, TypeScript 5.9 (tryb `strict`), własne style CSS (bez frameworka UI) |
| Budowanie | Vite 6, `vite-plugin-pwa` (service worker Workbox, manifest, tryb `autoUpdate`) |
| Testy | Vitest 3 (środowisko `node`) |
| PDF | `pdfjs-dist` – ładowany leniwie tylko przy imporcie PDF |
| Dane lokalne | IndexedDB (magazyn klucz–wartość `src/lib/idb.ts`) |
| Wspólne dane | Google Drive API v3 (zakres `drive.file`), Google Picker |
| Logowanie | OAuth 2.0 Google: przekierowanie; z pośrednikiem – kod autoryzacyjny + PKCE + refresh token |
| Kryptografia | Web Crypto API (AES-256-GCM, PBKDF2-SHA-256), WebAuthn (blokada biometrią) |
| Pośrednik | Cloudflare Worker (`worker/worker.js`, czysty JavaScript, bez zależności) |
| Publikacja | GitHub Actions → GitHub Pages przy każdym pushu na `main` |

## Struktura katalogów

```
src/
  main.tsx              start: odbiór przekierowania Google, providery, blokada aplikacji
  App.tsx               routing po #hash, dolny pasek, strona „Więcej”
  AppLock.tsx           ekran blokady (Face ID / Touch ID)
  config.ts             identyfikatory Google i adres pośrednika logowania
  ui.tsx                wspólne komponenty: Money, Sheet (okno/panel), Field, CopyButton
  styles.css            wszystkie style (zmienne kolorów, tryb ciemny, druk)
  lib/                  logika bez interfejsu (testowana)
    types.ts            model danych = format pliku budzet.json
    store.tsx           stan aplikacji, zapis do IndexedDB, operacje zmieniające dane
    merge.ts            scalanie dwóch wersji dokumentu
    backup.ts           odczyt i walidacja pliku, pobieranie kopii
    sanitize.ts         kontrola kształtu rekordów z plików (złe rekordy pomijane)
    restore.ts          przywracanie kopii „zastąp wszystko” zgodne ze scalaniem
    plan.ts             plan pozycji z reguł i harmonogramu kredytu
    projection.ts       linie miesiąca, sumy, zaległości, sumy sekcji
    firm.ts             moduł firmy: ryczałt, VAT, ZUS; planFor() – plan z uwzględnieniem firmy
    loan.ts             harmonogram kredytu, nadpłaty
    analysis.ts         trendy, podsumowanie roku, majątek netto
    crypto.ts           szyfrowanie pliku na Dysku, klucz na urządzeniu
    applock.ts          rejestracja i weryfikacja WebAuthn
    sections.ts         sekcje budżetu, sortowanie kategorii
    month.ts            operacje na miesiącach „RRRR-MM”, polskie nazwy
    format.ts           kwoty, daty, normalizacja tekstu (fold)
    exportCsv.ts        eksport CSV pod polskiego Excela
    markdown.tsx        renderer podręcznika w aplikacji
    people.ts, rules.ts, ids.ts, idb.ts
  import/               import wyciągów
    csv.ts              dekodowanie (UTF-8 / Windows-1250) i parser CSV
    pdf.ts              tekst z PDF w liniach (pdf.js)
    parsers.ts          rozpoznawanie banku i parsery
    match.ts            propozycje przypisań, zapis importu, przeliczanie kwot
    recurring.ts        wykrywanie stałych płatności
  sync/                 synchronizacja z Dyskiem Google
    engine.ts           algorytm jednej synchronizacji (niezależny od Google – testowany)
    google.ts           logowanie, Drive API, Picker
    SyncProvider.tsx    stan synchronizacji, harmonogram, akcje dla widoków
    SyncBar.tsx, DriveSection.tsx, PasswordSheet.tsx
  views/                ekrany (jeden plik na ekran) + panele (LoanPanel, SecuritySection)
docs/                   dokumentacja (podręcznik jest też wyświetlany w aplikacji)
public/                 ikony, prywatnosc.html (polityka prywatności dla Google)
scripts/                konwersja arkusza flow4 do budzet.json (Python); e2e/ – test synchronizacji i szyfrowania w przeglądarce
worker/                 pośrednik logowania Cloudflare
.github/workflows/      testy, budowanie i publikacja
```

## Przepływ danych

```
            ┌──────────────── widoki (views/*) ────────────────┐
            │  useStore(): doc, togglePaid, savePosition, update │
            └───────────────┬───────────────────────────────────┘
                            │ mutate(fn)  – każda zmiana z updatedAt/updatedBy
                            ▼
   IndexedDB  ◄── zapis po 300 ms ──  StoreProvider (doc w pamięci)  ── changeTick ──►  SyncProvider
   „doc”, „dirty”, „user”                    ▲                                            │ po 2,5 s, przy
                                             │ mergeRemote(remote)                        │ powrocie, co 2 min
                                             └──────────── syncOnce(drive, …) ◄───────────┘
                                                              │  getMeta / download / upload
                                                              ▼
                                       google.ts → readRemote / writeRemote (crypto.ts)
                                                              ▼
                                               Dysk Google: budzet-domowy.json
```

**Stan (`src/lib/store.tsx`).** Cały budżet to jeden niezmienny obiekt `BudgetDoc` w stanie Reacta. Każda zmiana
przechodzi przez `mutate(fn)`, które:

1. tworzy nowy dokument (`fn` zwraca kopię ze zmienionymi rekordami),
2. zwiększa licznik zmian i ustawia flagę `dirty` (zapisaną w IndexedDB – przetrwa zamknięcie aplikacji),
3. zwiększa `changeTick` – sygnał dla synchronizacji.

Rekordy dostają `updatedAt` (ISO) i `updatedBy` (imię z Ustawień) przez funkcję `stamp()`. Zapis do IndexedDB
następuje 300 ms po ostatniej zmianie. `StoreInternals` udostępnia synchronizacji odczyt dokumentu, licznik zmian
i scalanie danych z Dysku bez oznaczania ich jako lokalnej zmiany.

**Wyliczenia są czystymi funkcjami** w `src/lib` – nie przechowują wyników, liczą je z dokumentu przy renderowaniu
(z `useMemo` w widokach i pamięcią podręczną `WeakMap` po obiekcie dokumentu tam, gdzie liczenie jest kosztowne:
harmonogram kredytu, moduł firmy).

## Kluczowe moduły

**`plan.ts` → `firm.ts` → `projection.ts`.** `plannedAmount(p, m)` liczy plan pozycji z jej reguł i harmonogramu
kredytu. `planFor(doc, p, m)` dodatkowo podstawia wyliczenia modułu firmy (pozycje VAT / PIT / ZUS / VAT od klienta)
i jest używane wszędzie tam, gdzie potrzebny jest plan. `linesForMonth(doc, m)` buduje linie miesiąca (plan, kwota
w prognozie, wydane, wpis, status) – z nich korzystają widok miesiąca, prognoza, plan a wykonanie, analizy i eksport.
Szczegóły wzorów: [obliczenia](obliczenia.md).

**Import (`src/import`).** Parser → `RawTxn[]` ze stałym id → `suggest()` proponuje decyzję → użytkownik zatwierdza
→ `applyImport()` zapisuje transakcje i reguły, a `recalcEntries()` przelicza kwoty rzeczywiste pozycji. Szczegóły:
[import](import.md).

**Synchronizacja (`src/sync`).** `syncOnce()` porównuje wersję pliku na Dysku, pobiera i scala, wysyła po scaleniu
i sprawdza wyścigi. Szczegóły i model zagrożeń: [synchronizacja i bezpieczeństwo](synchronizacja.md).

## Routing i ekrany

Routing to `location.hash`: `#miesiac`, `#pozycje`, `#pozycja/<id>`, `#import`, `#wiecej`, `#prognoza`, `#plan`,
`#analiza/<trendy|rok|majatek>`, `#firma`, `#wypadek`, `#konta`, `#kategorie`, `#ustawienia`, `#pomoc/<kotwica>`.
Dolny pasek ma cztery miejsca: Miesiąc, Pozycje, Import, Więcej. Powrót z logowania Google czyta `#access_token`
(tryb bez pośrednika) albo `?code=` (tryb z pośrednikiem) w `main.tsx`, zanim wyrenderuje się aplikacja.

Okna edycji (`Sheet`) to element `<dialog>` otwierany przez `showModal()` – na telefonie wysuwa się od dołu,
na komputerze jest oknem.

## PWA i aktualizacje

`vite-plugin-pwa` generuje service worker (Workbox) z `registerType: 'autoUpdate'` – nowa wersja instaluje się
w tle i działa po ponownym otwarciu aplikacji (czasem po drugim). Wszystkie zasoby są w pamięci podręcznej, więc
aplikacja działa offline. `prywatnosc.html` jest wyłączona z nawigacji service workera (otwiera się jako zwykła
strona). Ścieżki są względne (`base: './'`), więc ten sam build działa lokalnie i pod `/budzet-domowy/`.

## Testy

`npm test` uruchamia testy logiki w `src/**/*.test.ts` (Vitest, bez przeglądarki). Pokrywają:

| Plik | Zakres |
|---|---|
| `lib/projection.test.ts` | miesiące i horyzont prognozy; plan z reguł: okres aktywności, zmiana jednego miesiąca, do miesiąca, sezonowość, indeksacja, co N miesięcy; linie miesiąca, wynik, zaległości |
| `lib/merge.test.ts`, `lib/schema.test.ts` | scalanie, tombstone, nieznane kolekcje, walidacja i wersje schematu |
| `lib/security.test.ts` | podmiana zaszyfrowanego pliku na jawny, parametry klucza, uszkodzona koperta, rekordy o złym kształcie, spreparowany plik z banku |
| `lib/restore.test.ts` | przywracanie kopii zgodne ze scalaniem, formaty kwot i dat |
| `lib/sections.test.ts`, `lib/people.test.ts` | sekcje z nazw, wydatki wobec budżetu, sumy sekcji i balans; osoby i filtr „moje” |
| `lib/firm.test.ts` | harmonogram kredytu, nadpłaty, ryczałt z dwiema stawkami, VAT, progi składki zdrowotnej |
| `lib/analysis.test.ts` | trendy, podsumowanie roku, majątek netto |
| `lib/crypto.test.ts` | szyfrowanie, złe hasło, ochrona przed jawnym zapisem |
| `import/import.test.ts` | parsery wszystkich banków, mapowanie CSV, dopasowanie, skrzynka, podział, stałe płatności |
| `sync/engine.test.ts` | synchronizacja z atrapą Dysku: równoległe zapisy, wyścigi, kopie miesięczne |

Dane testowe są zmyślone – mają tylko format plików z banków. Widoki są sprawdzane ręcznie w przeglądarce
(Playwright w środowisku deweloperskim), testów interfejsu w repozytorium nie ma.
