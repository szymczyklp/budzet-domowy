# Historia zmian

Najważniejsze etapy rozwoju (szczegóły w historii commitów).

## Listopad 2026

**Drugi przegląd bezpieczeństwa** – ochrona przed podmianą zaszyfrowanego pliku na jawny (przypięcie szyfrowania,
decyzja na pasku synchronizacji), kontrola parametrów klucza z pliku, kopia z pliku nie zmienia szyfrowania;
kontrola kształtu rekordów z plików i ekran błędu z kopią danych; odporność importu na spreparowane pliki (limity,
pomijanie złych wierszy, wyrażenie regularne o kwadratowym czasie); twardszy pośrednik logowania; akcje GitHub
przypięte do commitów i Dependabot.

**Poprawka Pickera** – polityka Referera zmieniona z `no-referrer` na `strict-origin`: okno „Wybierz plik z Dysku”
zgłaszało nieprawidłowy klucz API (ograniczenie klucza po adresie strony wymaga nagłówka Referer). Opisane obejście
blokady ciasteczek w Safari.

**Pomoc i dokumentacja** – podręcznik użytkownika w aplikacji (Więcej → Pomoc, odnośniki „?” na ekranach) i w
repozytorium (`docs/`): architektura, model danych, obliczenia, import, synchronizacja i bezpieczeństwo, wdrożenie,
rozwój. Wylogowanie z Google w Ustawieniach.

**Poprawki po przeglądzie** – data zapłaty w lokalnej strefie czasowej; cofnięcie zaznaczenia przywraca plan;
„Zastąp wszystko” przy wspólnych danych naprawdę przywraca kopię na wszystkich urządzeniach; kwoty z wąską spacją,
typograficznym minusem i plusem; czas lokalny w „Co nowego”.

**Logowanie stałe** – pośrednik logowania na Cloudflare (kod autoryzacyjny + PKCE, zapieczętowany refresh token),
polityka prywatności dla Google, wskaźnik rodzaju logowania w Ustawieniach.

**Bezpieczeństwo** – szyfrowanie pliku na Dysku hasłem (AES-256-GCM, PBKDF2), blokada Face ID / Touch ID.

**Kredyty i firma** – harmonogram rat (równe / malejące), nadpłaty i symulacja; moduł firmy: ryczałt z wieloma
stawkami, VAT miesięczny z odliczeniem z kosztów, ZUS ze składką zdrowotną według progów; VAT przy pozycjach.

**Analiza** – trendy kategorii, podsumowanie roku, majątek netto z historią.

**Import** – skrzynka nieprzypisanych (wspólna), tryb kart, podział transakcji, wykrywanie stałych płatności,
Revolut, mBank, dowolny CSV z zapamiętanym mapowaniem kolumn.

**Wygoda** – do zapłaty w ciągu 14 dni, co nowego (zmiany drugiej osoby), notatki do miesiąca, ukrywanie kwot,
wzrost planu co rok, tolerancja dopasowania kwot, eksport CSV. Schemat danych 3 (wspólne ustawienia).

**Prognozy** – kwota bez końca z opcjonalnym „do miesiąca”, płatności co N miesięcy, sezonowość, zmiany
pojedynczych miesięcy, horyzont do końca roku + 2 lata.

**Plan i wykonanie** – kwoty co do grosza, wykonanie zastępuje plan, widok „Plan a wykonanie”, karta pozycji
z historią od 2024 roku.

**Struktura budżetu** – sekcje (przychody, opłaty firmowe, opłaty prywatne, wydatki), karty kredytowe do spłaty,
kto płaci.

**Import wyciągów i „Na wypadek”** – PKO BP (CSV), Millennium (PDF), reguły; ubezpieczenia, oszczędności,
zobowiązania, kontakty, instrukcja z wydrukiem. Schemat danych 2.

**Wspólne dane** – synchronizacja z Dyskiem Google ze scalaniem rekord po rekordzie, udostępnianie drugiej osobie,
kopie miesięczne; logowanie przez przekierowanie.

**Początek** – szkielet aplikacji (React, PWA), model danych, konwersja arkusza flow4.
