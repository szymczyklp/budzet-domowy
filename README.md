# Budżet domowy

Aplikacja do planowania i rozliczania domowego budżetu miesiąc po miesiącu – następca arkusza `flow4`.
Działa w przeglądarce i jako aplikacja na telefonie (PWA), także offline. Dane dwóch osób są wspólne przez plik na
Dysku Google, z opcjonalnym szyfrowaniem hasłem. Bez serwera z danymi i bez LLM.

**Aplikacja:** https://szymczyklp.github.io/budzet-domowy/

## Co potrafi

| Obszar | Funkcje |
|---|---|
| Miesiąc | sekcje przychody / opłaty firmowe / opłaty prywatne / wydatki, zaznaczanie zapłaconych z datą i osobą, balans miesiąca i trzy kolejne, do zapłaty w ciągu 14 dni, zaległe, „Co nowego” (zmiany drugiej osoby), notatki, karty kredytowe do spłaty, ukrywanie kwot |
| Plan i prognoza | reguły kwot bez końca lub „do miesiąca”, co N miesięcy, sezonowość, wzrost co rok, zmiany pojedynczych miesięcy; karta pozycji od 2024 r. do końca prognozy; prognoza do końca roku + 2 lata; plan a wykonanie |
| Import z banku | PKO BP (CSV konto i karta), Millennium (PDF), Revolut, mBank, dowolny CSV z zapamiętanym mapowaniem; reguły, podpowiedzi sklepów, dopasowanie po kwocie, wspólna skrzynka, tryb kart, podział transakcji, wykrywanie stałych płatności |
| Analiza | trendy kategorii (12 miesięcy, r/r), podsumowanie roku, majątek netto z historią |
| Kredyty | harmonogram rat równych i malejących, nadpłaty, symulacja oszczędności |
| Firma | ryczałt z kilkoma stawkami, VAT miesięczny z odliczeniem z kosztów, ZUS ze składką zdrowotną wg progów – plan podatków liczy się sam |
| Na wypadek | ubezpieczenia, oszczędności, zobowiązania, kontakty, instrukcja dla bliskich, wydruk |
| Wspólne dane | synchronizacja z Dyskiem Google ze scalaniem rekord po rekordzie, udostępnianie, kopie miesięczne, stałe logowanie przez pośrednika Cloudflare |
| Bezpieczeństwo | szyfrowanie pliku na Dysku hasłem (AES-256-GCM), blokada Face ID / Touch ID |
| Kopie | kopia JSON (scalenie lub zastąpienie), eksport CSV do Excela |

## Dokumentacja

| Dokument | Dla kogo / o czym |
|---|---|
| [Podręcznik](docs/podrecznik.md) | dla użytkownika – każda funkcja krok po kroku; ten sam tekst jest w aplikacji (Więcej → Pomoc) |
| [Architektura](docs/architektura.md) | stos, struktura kodu, przepływ danych, testy |
| [Model danych](docs/model-danych.md) | format pliku `budzet.json`, wersje schematu, dane trzymane tylko na urządzeniu |
| [Obliczenia](docs/obliczenia.md) | wzory: plan, sumy, prognoza, analizy, kredyt, ryczałt, VAT, ZUS |
| [Import wyciągów](docs/import.md) | formaty banków, identyfikacja transakcji, dopasowanie, dodawanie banku |
| [Synchronizacja i bezpieczeństwo](docs/synchronizacja.md) | algorytm synchronizacji, scalanie, logowanie, szyfrowanie, blokada, model zagrożeń |
| [Wdrożenie i utrzymanie](docs/wdrozenie.md) | uruchomienie, publikacja, Google Cloud, Cloudflare, przeniesienie danych z arkusza, prace coroczne |
| [Rozwój](docs/rozwoj.md) | konwencje, zmiany modelu danych, prywatność w repozytorium |
| [Historia zmian](docs/historia-zmian.md) | najważniejsze etapy |

## Szybki start dla dewelopera

Wymagany Node.js 22 (lub 20+).

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # testy logiki (Vitest)
npm run build      # sprawdzenie typów + wersja produkcyjna w dist/
```

Każdy push na `main` uruchamia testy i publikuje aplikację na GitHub Pages
(`.github/workflows/deploy.yml`). Konfiguracja Google Cloud i Cloudflare: [wdrożenie](docs/wdrozenie.md).

## Dane i prywatność

Repozytorium jest publiczne, a **danych w nim nie ma**. Strona otwiera się każdemu pusta; dane są tylko
w przeglądarce użytkownika (IndexedDB) i w pliku na jego Dysku Google. Katalog `data/` oraz pliki `*.xlsx`, `*.csv`,
`budzet*.json` i `backup*.json` są w `.gitignore` – nie dodawaj ich ręcznie (`git add -f`). Dane w testach są
zmyślone. Zasady: [rozwój](docs/rozwoj.md#prywatność-danych-w-repozytorium); polityka prywatności dla Google:
[prywatnosc.html](https://szymczyklp.github.io/budzet-domowy/prywatnosc.html).
