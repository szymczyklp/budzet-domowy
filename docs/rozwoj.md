# Rozwój

Zasady pracy z kodem: konwencje, testy, zmiany modelu danych, prywatność, publikacja.

## Konwencje

- **Język**: interfejs, komentarze, komunikaty i dokumentacja po polsku; nazwy w kodzie po angielsku, z wyjątkiem
  pojęć domenowych zapisanych w danych (`przychody`, `firmowe`, `oszczednosci`, `reczny`…).
- **Logika poza widokami**: wszystko, co liczy albo przekształca dane, trafia do `src/lib` lub `src/import` jako
  czysta funkcja i ma test. Widoki tylko wywołują te funkcje i `useStore()`.
- **Zmiany danych tylko przez store**: `savePosition`/`saveAccount`/… dla pojedynczego rekordu, `update((d, stamp)
  => …)` dla zmian wielu rekordów naraz. Każdy zmieniony rekord dostaje `...stamp()` – bez tego zmiana przegra
  przy scalaniu albo nie dotrze do drugiego urządzenia.
- **Nigdy nie usuwaj rekordów z mapy** – ustaw `deleted: true` ze `stamp()`.
- **Kwoty**: `money()` do wyświetlania (respektuje „Ukryj kwoty”), `moneyInput()` do pól edycji, `parseMoney()`
  do odczytu wpisów użytkownika. Zaokrąglenia do grosza: `Math.round(v * 100) / 100`.
- **Daty**: `today()` (lokalna strefa) dla dat zapłaty; miesiące przez `lib/month.ts`.
- **Tekst do porównań**: `fold()` (wielkie litery, bez polskich znaków).
- **Bez nowych zależności** bez wyraźnej potrzeby; wersje w `package.json` przypięte dokładnie.
- **Dostępność**: przyciski z `aria-label`, gdy mają tylko ikonę; elementy interaktywne to `<button>`/`<a>`.
- **Style**: zmienne kolorów w `:root` w `styles.css`, tryb ciemny przez `prefers-color-scheme`; układ musi działać
  na szerokości telefonu (390 px).

## Testy i sprawdzanie

```bash
npm test          # testy jednostkowe (muszą przejść – inaczej publikacja się zatrzyma)
npm run build     # tsc --noEmit + build
```

Przed wypchnięciem zmian w interfejsie sprawdź ekran w przeglądarce w szerokości telefonu (np. `npm run preview`
i narzędzia deweloperskie albo Playwright). Dane do sprawdzania wczytuj z własnej kopii lokalnie – nigdy nie
dołączaj ich do repozytorium ani testów.

## Zmiana modelu danych

Pola **opcjonalne** w istniejących rekordach można dodawać bez zmiany schematu, jeśli starsza wersja aplikacji
może je bezpiecznie pominąć (scalanie i tak przenosi cały rekord, ale starsza wersja przy edycji rekordu
zapisze go bez nowego pola).

Gdy starsza wersja **mogłaby zniszczyć dane** (np. nowa kolekcja, zmiana znaczenia pola, pole, które musi przetrwać
edycję na starym urządzeniu):

1. podnieś `schema` w `BudgetDoc` i `emptyDoc()` (`lib/types.ts`),
2. w `parseDoc` (`lib/backup.ts`) dopuść nowy numer i zostaw komunikat dla nowszych,
3. uzupełnij `normalizeDoc`, jeśli stare pliki wymagają domyślnych wartości, i dopisz nowe pola do kształtów
   w `lib/sanitize.ts` (pole o typie innym niż opisany jest usuwane przy wczytaniu),
4. dodaj test w `lib/schema.test.ts` (odczyt starego pliku, odrzucenie nowszego),
5. opisz zmianę w `docs/model-danych.md` (tabela wersji) i w `docs/historia-zmian.md`.

Starsza aplikacja na telefonie odrzuci plik z nowszym schematem („odśwież aplikację”) i niczego nie zapisze.

## Prywatność danych w repozytorium

Repozytorium jest **publiczne**. Nie mogą do niego trafić:

- wyciągi bankowe, pliki `budzet*.json`, `master_data*.xlsx`, kopie (`.gitignore` blokuje `data/`, `*.csv`,
  `*.xlsx`, `*.xls`, `budzet*.json`, `backup*.json` – nie używaj `git add -f`),
- numery kont i kart, nazwy pracodawców i kontrahentów, kwoty z prawdziwego budżetu – także w testach, przykładach
  i komentarzach (dane testowe muszą być zmyślone),
- sekrety: sekret klienta OAuth, `SEALING_KEY`, hasło do danych.

Jawne z natury (i ograniczone w konsoli Google): Client ID, klucz API Pickera, numer projektu, adres Workera.

## Publikacja

- W tym projekcie zmiany trafiają bezpośrednio na `main`; każdy push publikuje aplikację (po testach).
- Opis commita po polsku: pierwsza linia – co się zmieniło z punktu widzenia użytkownika, potem lista szczegółów.
- Po zmianie funkcji zaktualizuj **podręcznik** (`docs/podrecznik.md` – jest też Pomocą w aplikacji) i właściwy
  dokument techniczny. Odnośniki do tematów pomocy z ekranów (`<HelpLink topic="…" />`) używają kotwic nagłówków
  podręcznika w stylu GitHuba (małe litery, bez interpunkcji, spacje → `-`, polskie litery zostają) – po zmianie
  nagłówka popraw odnośniki.

## Gdzie dodać…

| Co | Gdzie |
|---|---|
| nowy ekran | `src/views/NazwaView.tsx`, wpis w `PAGES` i `MORE` w `App.tsx`, sekcja w podręczniku |
| nowe pole pozycji | `Position` w `lib/types.ts`, formularz w `PositionsView.tsx`, ewentualnie `plan.ts`/`firm.ts` |
| nowy bank | [import](import.md#dodanie-nowego-banku) |
| nowy rodzaj wydatku z podpowiedziami sklepów | `MERCHANTS` i `EXPENSE_SUGGESTIONS` w `import/match.ts` |
| podstawa składki zdrowotnej na nowy rok | `HEALTH_BASE` w `lib/firm.ts` |
| nowe ustawienie wspólne | `Settings` w `lib/types.ts` (rekord `settings.main`) |
| ustawienie tylko dla urządzenia | `localStorage` (opakowane w `try/catch`) |
