# Synchronizacja i bezpieczeństwo

Jak dane trafiają na Dysk Google, jak scalają się zmiany dwóch osób, jak działa logowanie, szyfrowanie i blokada.
Konfiguracja Google Cloud i Cloudflare krok po kroku: [wdrożenie](wdrozenie.md).

## Wspólny plik

- Jeden plik `budzet-domowy.json` w folderze „Budżet domowy” na Dysku właściciela, udostępniony drugiej osobie
  z prawem edycji.
- Zakres OAuth `https://www.googleapis.com/auth/drive.file`: aplikacja widzi tylko pliki, które sama utworzyła
  albo które użytkownik wskazał w Google Picker. Nie ma dostępu do reszty Dysku.
- Plik udostępniony przez kogoś trzeba wskazać raz w Pickerze („Wybierz plik z Dysku”); od tej chwili aplikacja
  ma do niego dostęp na każdym urządzeniu tego konta i znajduje go sama (`findFiles`).
- Właściciel pliku raz w miesiącu tworzy obok kopię `budzet-domowy kopia RRRR-MM.json`. Dysk Google dodatkowo
  przechowuje historię wersji pliku.

## Algorytm synchronizacji (`src/sync/engine.ts`)

`syncOnce(api, local, conf, month)`, do 3 prób:

1. `getMeta(fileId)` – wersja pliku (`version` z Drive API).
2. Jeśli wersja różni się od zapamiętanej po ostatniej synchronizacji → `download` i `mergeDocs(lokalny, zdalny)`;
   wynik trafia też do stanu aplikacji (`mergeRemote`, bez oznaczania jako lokalna zmiana).
3. Czy trzeba wysłać? Gdy pobrano plik – jeśli scalony dokument różni się od pobranego (`countDifferences > 0`);
   gdy nie pobrano – jeśli są niewysłane zmiany lokalne (`dirty`).
4. Tuż przed wysłaniem ponownie `getMeta`: jeśli wersja się zmieniła (ktoś zapisał w międzyczasie) → kolejna próba
   od kroku 1.
5. `upload` scalonego dokumentu; zapamiętanie nowej wersji; `markSynced(licznik)` – flaga `dirty` jest kasowana
   tylko, jeśli od początku synchronizacji nie było nowych lokalnych zmian (inaczej zostaną wysłane następnym razem).
6. Właściciel pliku: jeśli w tym miesiącu nie było kopii → `createSnapshot`.

**Kiedy synchronizuje** (`SyncProvider.tsx`): 2,5 s po ostatniej lokalnej zmianie, po powrocie aplikacji na
pierwszy plan, co 2 minuty, gdy jest widoczna, i ręcznie („Odśwież”, „Synchronizuj teraz”). Równoległe wywołania
są łączone (najwyżej jedna synchronizacja naraz, kolejna po jej zakończeniu).

### Scalanie (`src/lib/merge.ts`)

Dla każdej kolekcji (także nieznanej tej wersji aplikacji) i każdego id wygrywa rekord z późniejszym `updatedAt`.
Konsekwencje:

- niezależne zmiany różnych rekordów zawsze się sumują (Ty zaznaczasz prąd, żona dodaje wydatek),
- przy zmianie tego samego rekordu na dwóch urządzeniach zostaje nowsza (ostatnia zmiana wygrywa),
- usunięcie (`deleted: true`) to zmiana z nowym czasem – nie wraca po scaleniu ze starszą kopią,
- rekord `settings.main` jest scalany w całości.

Czas pochodzi z zegara urządzenia; przy rozjechanym zegarze „nowsza” może być zmiana faktycznie starsza.

**Przywracanie kopii** („Zastąp wszystko”, `lib/restore.ts`) nadaje wszystkim rekordom z kopii bieżący czas
i oznacza jako usunięte rekordy, których w kopii nie ma – dzięki temu kopia „wygrywa” także na Dysku i na
urządzeniu drugiej osoby.

## Logowanie Google

### Tryb podstawowy (bez pośrednika)

OAuth 2.0 *implicit flow* z przekierowaniem (bez wyskakujących okien – działa w aplikacji z ekranu głównego):
`response_type=token`, parametr `state` sprawdzany po powrocie, sprawdzenie, czy użytkownik zgodził się na
zakres `drive.file`. Token dostępu jest ważny ok. godziny; po wygaśnięciu pasek prosi o „Połącz z Dyskiem”.

### Tryb z pośrednikiem (domyślny, gdy `GOOGLE.tokenProxy` jest ustawiony)

```
aplikacja ── przekierowanie: response_type=code, access_type=offline, PKCE (S256), state ──► Google
aplikacja ◄─ ?code=…&state=… ────────────────────────────────────────────────────────────── Google
aplikacja ── POST /token {code, redirect_uri, code_verifier} ──► Worker ── + client_secret ──► Google
aplikacja ◄─ {access_token, expires_in, sealed} ◄──────────────── Worker ◄── refresh_token ─── Google
   … po godzinie …
aplikacja ── POST /refresh {sealed} ──► Worker ── odpieczętuj, grant_type=refresh_token ──► Google
aplikacja ◄─ {access_token, expires_in} ◄────────────────────────────────────────────────── Google
```

- `sealed` = refresh token zaszyfrowany w Workerze (AES-256-GCM, klucz = SHA-256 z `SEALING_KEY`). Aplikacja
  przechowuje go w IndexedDB i nie zna samego refresh tokenu; Worker niczego nie przechowuje.
- Przy pierwszym logowaniu (albo gdy brak `sealed`) aplikacja wymusza ekran zgody (`prompt=consent`), bo tylko
  wtedy Google wydaje refresh token.
- Przed każdym zapytaniem do Drive API `ensureToken()` odświeża token, jeśli wygasł; po odpowiedzi 401 próbuje
  odświeżyć i ponowić zapytanie raz. Gdy Google odrzuci refresh token (`invalid_grant`), `sealed` jest usuwany
  i aplikacja prosi o ponowne logowanie.
- **Wyloguj z Google** (Ustawienia) wywołuje `/revoke` – Worker unieważnia refresh token w Google; token i `sealed`
  są usuwane z urządzenia.

### Pośrednik logowania (Cloudflare Worker)

`worker/worker.js`, bez zależności. Endpointy `POST /token`, `/refresh`, `/revoke`. Zabezpieczenia:

- odpowiada tylko na żądania z originów z `ALLOWED_ORIGIN` (inne: 403 – dlatego otwarty w przeglądarce adres
  Workera pokazuje „Forbidden”),
- `/token` przyjmuje tylko `redirect_uri` z dozwolonego originu,
- PKCE: przechwycony kod logowania jest bezużyteczny bez weryfikatora z urządzenia,
- sekret klienta i klucz pieczętowania są zmiennymi typu Secret w Cloudflare – nie ma ich w repozytorium.

Konto Google Cloud musi mieć aplikację OAuth w stanie **In production** – w stanie *Testing* Google unieważnia
refresh tokeny po 7 dniach.

## Szyfrowanie pliku na Dysku

`src/lib/crypto.ts`:

- **Klucz**: PBKDF2-SHA-256, 600 000 iteracji, sól 16 B (losowa przy ustawieniu lub zmianie hasła) → AES-256-GCM.
  Hasło jest normalizowane (NFC). Klucz jest tworzony jako **niewyciągalny** `CryptoKey` i zapisywany w IndexedDB;
  hasło nie jest nigdzie zapisywane.
- **Szyfrowanie**: losowy IV 12 B przy każdym zapisie; zaszyfrowany JSON dokumentu w kopercie z `schema: 99`
  ([format](model-danych.md#koperta-zaszyfrowanego-pliku)).
- **Stan wspólny**: `settings.main.encryption = { salt, iterations }` – synchronizowany jak każde ustawienie, więc
  włączenie, zmiana hasła i wyłączenie docierają do drugiego urządzenia.
- **Odczyt** (`readRemote`): jawny JSON → walidacja; koperta → potrzebny klucz o tej samej soli, inaczej
  `PasswordNeeded` (pasek „Podaj hasło”). Złe hasło = błąd uwierzytelnienia GCM → „Złe hasło”.
- **Zapis** (`writeRemote`): gdy ustawienia mówią, że szyfrowanie jest włączone, zapis wymaga właściwego klucza;
  bez niego `PasswordNeeded` – **urządzenie bez hasła nigdy nie nadpisze pliku jawnym tekstem**. Starsze wersje
  aplikacji odrzucą kopertę (nieznany schemat) i też niczego nie zapiszą.
- Kopie miesięczne są szyfrowane tak samo. Kopia pobierana ręcznie w Ustawieniach jest jawna.

### Ochrona przed wyłączeniem szyfrowania z zewnątrz

Ustawienie szyfrowania jest częścią synchronizowanych danych, więc bez dodatkowej ochrony osoba z dostępem do
Dysku (bez hasła) mogłaby podmienić plik na jawny JSON z „nowszym” rekordem ustawień bez szyfrowania – po scaleniu
urządzenie wysłałoby cały budżet jawnym tekstem. Dlatego:

- **Przypięcie** (`crypto-pin` w IndexedDB, poza synchronizowanymi danymi): urządzenie, które pobrało albo wysłało
  zaszyfrowany plik, pamięta, że plik ma być zaszyfrowany – także po „Zapomnij na tym urządzeniu”.
- Przypięte urządzenie **nie scala jawnego pliku** z Dysku i **nie wysyła danych jawnie** (`EncryptionDowngrade`).
  Pasek pokazuje wybór: **Zostaw szyfrowanie** (plik na Dysku jest nadpisywany zaszyfrowanymi danymi z urządzenia,
  bez scalania z podmienionym plikiem) albo **Wyłączyliśmy je celowo** (zdjęcie przypięcia i zwykła synchronizacja).
- Przypięcie zdejmuje tylko świadoma decyzja na tym urządzeniu: „Wyłącz szyfrowanie”, potwierdzenie na pasku,
  „Wyczyść dane”.
- **Parametry klucza z pliku są sprawdzane** (`checkKdf`, `checkEnvelope`): liczba iteracji 600 000 – 5 000 000,
  sól 16–64 B, IV 12 B, algorytm PBKDF2/SHA-256. Podstawiona koperta lub ustawienia z 1 iteracją (hasło dałoby się
  wtedy łamać błyskawicznie) albo z miliardami (zawieszenie urządzenia) są odrzucane.
- **Kopia wczytywana z pliku nie zmienia szyfrowania** (`keepEncryption`) – stara kopia sprzed włączenia hasła nie
  wyłączy szyfrowania pliku na Dysku.

Czego to nie obejmuje: urządzenie, które nigdy nie widziało zaszyfrowanego pliku (pierwsze połączenie), nie ma
punktu odniesienia. Osoba z prawem zapisu na Dysku może też zawsze uszkodzić plik albo cofnąć go do starszej
zaszyfrowanej wersji – scalanie rekord po rekordzie i tak zachowa nowsze dane z urządzeń.

**Znane ograniczenie:** hasło zmieniaj, gdy oba urządzenia są zsynchronizowane. Jeśli druga osoba zapisze plik
starym kluczem w chwili zmiany hasła, urządzenie zmieniające hasło poprosi najpierw o stare hasło.

## Blokada aplikacji (WebAuthn)

`src/lib/applock.ts`, `src/AppLock.tsx`. Włączenie rejestruje poświadczenie platformowe
(`authenticatorAttachment: 'platform'`, `userVerification: 'required'`, rp = domena aplikacji) – Face ID, Touch ID
albo Windows Hello. Odblokowanie wywołuje `navigator.credentials.get` z tym poświadczeniem. Wynik nie jest
weryfikowany po stronie serwera (nie ma serwera), więc to **blokada interfejsu**, a nie szyfrowanie danych w
przeglądarce. Czas blokady: zawsze po powrocie albo po 1 / 5 / 15 minutach w tle. Awaryjne „wyczyść to
urządzenie” usuwa dane lokalne, połączenie z Dyskiem, token i klucz – dane wracają po ponownym połączeniu
(i podaniu hasła do danych).

## Model zagrożeń

| Zagrożenie | Ochrona | Uwagi |
|---|---|---|
| Ktoś czyta repozytorium | W kodzie nie ma danych; dane testowe zmyślone; `.gitignore` blokuje pliki danych | Klucz API i Client ID są jawne z natury (są w kodzie strony) – ograniczone do domeny w Google Cloud |
| Ktoś ma dostęp do Dysku (np. przejęte konto, udostępnienie) | Szyfrowanie hasłem | Bez hasła plik jest tylko jawnym JSON-em |
| Ktoś z dostępem do Dysku podmienia plik (jawny zamiast zaszyfrowanego, słabe parametry klucza) | Przypięcie szyfrowania, kontrola parametrów | Wymaga decyzji użytkownika na pasku synchronizacji |
| Spreparowany lub uszkodzony plik (Dysk, kopia JSON, wyciąg) | Walidacja kształtu rekordów, limity rozmiaru, ekran błędu z kopią danych | Złe rekordy są pomijane, reszta działa |
| Ktoś bierze odblokowany telefon | Blokada Face ID / Touch ID, „Ukryj kwoty” | Dane w przeglądarce nie są szyfrowane |
| Ktoś ma dostęp do systemu plików urządzenia | — | Dane IndexedDB są jawne; klucz szyfrowania jest niewyciągalny, ale może zostać użyty przez stronę aplikacji |
| Przechwycenie kodu logowania | PKCE, `state` | |
| Nadużycie Workera z innej strony | Lista dozwolonych originów, zapieczętowany refresh token | Zapytanie spoza przeglądarki może podać dowolny `Origin`; bez `sealed` lub kodu z PKCE nic nie uzyska |
| Wyciek `sealed` z urządzenia | Działa tylko przez Worker; „Wyloguj z Google” go unieważnia | Równoważny sesji – chroni go to samo co resztę danych urządzenia |
| Utrata danych | Scalanie bez nadpisywania, historia wersji Dysku, kopie miesięczne, kopia ręczna | |
| Utrata hasła do danych | — | Danych zaszyfrowanych nie da się odzyskać; trzymaj hasło w menedżerze haseł |
| Hasła w „Na wypadek” | Komunikat w aplikacji | Wpisuj, gdzie są hasła, nie same hasła |

## Zabezpieczenia strony

- **Content-Security-Policy** (meta w wersji produkcyjnej, `vite.config.ts`): skrypty, połączenia i ramki tylko własne,
  z domen Google (`*.google.com`, `*.gstatic.com`, `*.googleapis.com` – Picker, Drive API) i do pośrednika logowania, `object-src 'none'`, `base-uri 'self'`. Nowa usługa zewnętrzna wymaga dopisania jej domeny do `CSP`.
- **Nagłówek Referer**: `strict-origin` (meta w wersji produkcyjnej) – do innych witryn wychodzi tylko adres
  domeny (`https://szymczyklp.github.io/`), bez ścieżki i parametrów. Nie wolno ustawić `no-referrer`: klucz API
  Pickera jest ograniczony do adresu strony („Website restrictions”), a Google sprawdza to właśnie po nagłówku
  Referer – bez niego okno wyboru pliku kończy się błędem „Klucz programistyczny API jest nieprawidłowy”.
- **Ramki**: aplikacja odmawia działania w ramce obcej strony (ochrona przed clickjackingiem; GitHub Pages nie
  pozwala ustawić nagłówka `X-Frame-Options`).
- **Pliki z zewnątrz** (plik z Dysku, kopia JSON): klucze `__proto__`, `constructor`, `prototype` są pomijane przy
  odczycie i scalaniu, więc spreparowany plik nie zmieni prototypów obiektów (prototype pollution).
- **Kształt rekordów** (`lib/sanitize.ts`): każdy plik z zewnątrz i dane wczytywane z przeglądarki przechodzą
  kontrolę typów pól. Rekord bez wymaganych pól jest pomijany, złe pole opcjonalne usuwane, z listy reguł kwot
  zostają tylko poprawne; liczby muszą być skończone, miesiące i daty poprawne, listy i teksty mają limity długości
  (np. kredyt najwyżej 1200 rat). Nieznane pola i kolekcje zostają. Błąd w widoku łapie `ErrorBoundary` – ekran
  z przyciskami „Otwórz ponownie” i „Pobierz kopię danych” zamiast pustej strony.
- **Import z banku**: plik do 25 MB; wiersze bez poprawnej daty lub kwoty są pomijane, teksty przycinane
  (kontrahent 200 znaków, opis 2000), wyrażenia regularne działają na przyciętym tekście.
- **Eksport CSV**: teksty zaczynające się od `=`, `+`, `-`, `@` dostają apostrof, żeby Excel nie wykonał ich jako
  formuły (np. spreparowany tytuł przelewu z wyciągu).
- **Treść z wyciągów i plików** jest wyświetlana wyłącznie jako tekst (React, bez `innerHTML`); podręcznik renderuje
  własny parser Markdown, który dopuszcza tylko odnośniki `https`, kotwice i pliki `.md`.
- **Logowanie**: parametr `state` i weryfikator PKCE z generatora kryptograficznego.
- **Pośrednik (Worker)**: żądania do 16 kB, tylko obiekt JSON, zły `redirect_uri` → 400, błędy wewnętrzne bez
  szczegółów w odpowiedzi (są w logach Workera).
- **Łańcuch dostaw**: akcje GitHub przypięte do konkretnych commitów (SHA), Dependabot proponuje aktualizacje raz
  w miesiącu, wersje zależności przypięte w `package.json`.
- **Zależności**: `npm audit --omit=dev` (to, co trafia do przeglądarki) powinno pokazywać 0 podatności; narzędzia
  deweloperskie (Vitest) nie są częścią opublikowanej aplikacji.
