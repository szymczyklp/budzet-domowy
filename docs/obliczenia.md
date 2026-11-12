# Obliczenia

Wzory i reguły, według których aplikacja liczy plan, sumy, prognozę, analizy, kredyty i podatki. Odnośniki
w nawiasach wskazują funkcje w kodzie.

## Plan pozycji

`planFor(doc, p, m)` (`lib/firm.ts`) → `plannedAmount(p, m)` (`lib/plan.ts`). Dla miesiąca `m`:

1. `m` poza `[activeFrom, activeTo]` lub pozycja usunięta → **0**.
2. `monthly[m]` istnieje → **ta kwota** (zmiana tylko tego miesiąca).
3. Pozycja wyliczana przez moduł firmy i `m ≥ firm.from` → **wyliczenie firmy** (niżej).
4. `loan` i `m ≥ loan.from` → **−(rata + nadpłata + opłata)** z harmonogramu, 0 po ostatniej racie.
5. Reguła `r` = ostatnia reguła z `r.from ≤ m` (brak → 0):
   - `r.until` i `m > r.until` → 0,
   - współczynnik indeksacji `f = (1 + r.indexation/100)^(rok(m) − rok(r.from))`, wynik zaokrąglony do grosza,
   - `r.pattern` → `pattern[miesiąc(m) − 1] × f`,
   - inaczej: `r.amount × f`, jeśli `(m − r.from) mod everyMonths = 0`, w pozostałych miesiącach 0.

## Linie miesiąca

`linesForMonth(doc, m, now)` (`lib/projection.ts`) zwraca dla każdej pozycji linię z polami `planned`, `amount`
(kwota w prognozie), `spent`, `entry`, `paid`, `section`, `expense`.

**Pozycja zwykła** (przychód lub opłata): `amount = entry.amount ?? planned`. Linia jest pomijana, gdy `amount = 0`
i nie ma wpisu.

**Wydatek** (sekcja Wydatki albo `envelope`): `spent = entry.amount ?? 0` (suma transakcji), a kwota w prognozie:

- miesiąc zamknięty (`m < now`): `entry.amount ?? planned` – to, co wydano, a bez danych budżet,
- miesiąc bieżący i przyszłe: `min(planned, spent)` – czyli większy z wydatków co do wartości bezwzględnej
  (kwoty są ujemne): co najmniej budżet, a po jego przekroczeniu faktyczna suma.

Aktywne rodzaje wydatków są pokazywane zawsze, także z budżetem 0.

## Sumy miesiąca

`sectionTotals(lines)` dla każdej sekcji:

- `amount` – suma kwot w prognozie,
- `planned` – suma planów (dla wydatków budżet, dla pozostałych kwota w prognozie),
- `done` – zrealizowane: dla wydatków suma `spent`, dla pozostałych suma zaznaczonych,
- `doneCount` / `count` – liczba zaznaczonych / wszystkich.

**Balans miesiąca** = Σ `amount` po sekcjach. **Dotychczas** = Σ `done`.

`summarize` (prognoza): `income` = suma dodatnich `amount`, `outflow` = suma ujemnych, `net = income + outflow`.

**Zaległe** (`overdue`): linie z 6 poprzednich miesięcy, które nie są wydatkami, nie są zaznaczone i mają
`amount < 0`.

**Do zapłaty w ciągu 14 dni**: linie z bieżącego i następnego miesiąca, niezaznaczone, z niezerową kwotą
i dniem płatności (dla spłaty karty bez dnia – dzień spłaty karty). Data = dzień w miesiącu linii (ograniczony do
długości miesiąca). Wchodzą daty ≤ dziś + 14 dni; z bieżącego miesiąca także te, które już minęły.

## Prognoza i porównania

**Prognoza**: `summarize` dla każdego miesiąca od bieżącego do `forecastEnd(now)` = grudzień roku bieżącego + 2;
narastająco = suma kolejnych `net`.

**Plan a wykonanie** (`views/PlanActualView.tsx`): okres = miesiąc albo rok (miesiące do bieżącego). Dla pozycji:
wykonanie w miesiącu = dla wydatków `spent` (gdy > 0), dla pozostałych `entry.amount`, a przy zaznaczeniu bez
kwoty – plan. Różnica liczona tylko z miesięcy, w których jest i plan (≠ 0), i wykonanie.

## Analiza

**Trendy** (`categoryTrends`, `lib/analysis.ts`): 24 pełne miesiące przed bieżącym; dla kategorii i pozycji suma
`amount` z linii (wykonanie, a bez niego plan). „Ostatnie 12” = miesiące 13–24, „poprzednie 12” = 1–12.
Zmiana r/r = `(|ostatnie| − |poprzednie|) / |poprzednie| × 100%` (brak, gdy poprzednie = 0).
„Najbardziej wzrosły”: pozycje spoza przychodów z `ostatnie < 0` i `ostatnie < poprzednie − 100 zł`, 5
o największym wzroście.

**Rok** (`yearSummary`): sumy sekcji po 12 miesiącach z linii; miesiące `< now` to wykonanie, pozostałe prognoza;
10 największych kosztów = pozycje z najniższą (najbardziej ujemną) sumą roku.

**Majątek netto** (`netWorthSeries`): wpisy „Na wypadek” rodzaju oszczędności (aktywa) i zobowiązania (pasywa).
Punkty wpisu = `history` + bieżąca kwota (`value` z `valueDate`). Dla każdego miesiąca (od pierwszego punktu, najwyżej
24 wstecz) bierzemy ostatni punkt z datą ≤ koniec miesiąca; netto = Σ aktywów − Σ pasywów.

## Kredyt

`loanSchedule(loan)` (`lib/loan.ts`), `r = rate / 100 / 12`, `B` = kapitał, `n` = liczba pozostałych rat.

- **Raty równe** (annuitet): `rata = B·r / (1 − (1 + r)^−n)` (dla `r = 0`: `B / n`).
  Każdego miesiąca: `odsetki = round(B·r, 2)`, `kapitał = rata − odsetki`, `B ← B − kapitał`.
- **Raty malejące**: `kapitał = B₀ / n` stały, `odsetki = round(B·r, 2)`.
- Ostatnia rata (albo gdy kapitał raty przekracza saldo) spłaca resztę salda.
- **Nadpłata** w miesiącu `m` zmniejsza saldo po racie tego miesiąca:
  - `okres` – rata (lub część kapitałowa) bez zmian, kredyt kończy się wcześniej,
  - `rata` – rata przeliczana od nowa: annuitet z nowego salda na pozostałe `n`, przy malejących `B / n`.
- Kwota w planie = −(rata + nadpłata + opłata stała).
- Kapitał „do spłaty teraz” (`balanceAt`) = saldo po racie bieżącego miesiąca.

Odsetki miesięczne `B × r` to przybliżenie – banki liczą zwykle według liczby dni (rzeczywista/365), stąd możliwe
różnice groszowe.

## Firma: ryczałt, VAT, ZUS

`firmMonth(doc, firm, m)` (`lib/firm.ts`). Kwota pozycji w miesiącu = `entry.amount ?? plannedAmount` (kwota
rzeczywista, a bez niej plan z reguł).

**Przychód** linii *i*: `Pᵢ` (netto), suma `P = Σ Pᵢ`.

**VAT należny** = rzeczywisty wpływ pozycji „VAT od klienta” w miesiącu, a bez niego `round(P × vatRate / 100, 2)`.

**VAT naliczony** = Σ po aktywnych pozycjach z `vat.rate > 0` i ujemną kwotą brutto `G`:
`|G| × rate / (100 + rate) × deductible / 100` (zaokrąglone do grosza).

**VAT do zapłaty** = `round(należny − naliczony)` do pełnych złotych (ujemny = nadwyżka).

**Składka zdrowotna** (ryczałt): przychód roczny `R = Σ_{12 mies. roku} P − 12 × socialZus`;
`zdrowotna = round(podstawa × p × 9%, 2)`, gdzie `p = 60%` dla `R ≤ 60 000`, `100%` dla `R ≤ 300 000`,
`180%` powyżej. Podstawa = przeciętne wynagrodzenie z IV kwartału poprzedniego roku:

| Rok | Podstawa | ≤ 60 tys. | ≤ 300 tys. | > 300 tys. |
|---|---|---|---|---|
| 2025 | 8549,18 zł | 461,66 zł | 769,43 zł | 1384,97 zł |
| 2026 | 9228,64 zł | 498,35 zł | 830,58 zł | 1495,04 zł |

Dla lat bez wpisu w `HEALTH_BASE` używana jest ostatnia znana podstawa. Po ogłoszeniu podstawy na nowy rok trzeba
dopisać ją w `src/lib/firm.ts`. Próg jest wyznaczany z przychodu całego roku (plan + wykonanie), a nie narastająco –
to uproszczenie względem rozliczenia rocznego.

**Zaliczka ryczałtu**: pomniejszenie `D = socialZus + zdrowotna / 2` odejmowane od linii w kolejności od najwyższej
stawki: `użyteᵢ = min(max(0, Pᵢ), D_pozostałe)`. Podstawa `Bᵢ = round(max(0, Pᵢ − użyteᵢ))` (pełne zł),
podatek `Tᵢ = Bᵢ × stawkaᵢ`, zaliczka = `round(Σ Tᵢ)` (pełne zł). Niewykorzystane pomniejszenie nie przechodzi
na kolejny miesiąc (uproszczenie).

**ZUS** = `socialZus + zdrowotna`.

**Przesunięcie** (`lag = 1`): pozycje VAT, ryczałtu i ZUS w miesiącu `m` dostają wyliczenie dla `m − 1`.
„VAT od klienta” zawsze dotyczy miesiąca `m`.

## Import: dopasowanie po kwocie

Tolerancja dla planu `p`: ustawiona w % → `max(0,005; |p| × % / 100)`; domyślnie `0,005` (co do grosza), a dla
`|p| ≥ 1000` – `1% × |p|`. Kandydaci: aktywne pozycje niebędące wydatkiem, niezaznaczone w miesiącu, z planem tego
samego znaku. Przy kilku – najbliższy dzień płatności. Pełna kolejność dopasowania: [import](import.md).

## Stałe płatności

`findRecurring` (`import/recurring.ts`): grupowanie ujemnych transakcji (bez wpisów ręcznych) po znormalizowanej
nazwie kontrahenta (`defaultPattern`). Grupa jest kandydatem, gdy:

- obejmuje co najmniej 3 różne miesiące,
- każda kwota (największa płatność w miesiącu) różni się od mediany najwyżej o 15%,
- transakcje są nieprzypisane albo przypisane do wydatku zbiorczego,
- grupy nie odrzucono i nie pokrywa jej istniejąca reguła.

Proponowana kwota = mediana, dzień = mediana dni.
