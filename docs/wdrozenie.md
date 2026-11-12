# Wdrożenie i utrzymanie

Jak uruchomić aplikację lokalnie, opublikować ją, skonfigurować Google i Cloudflare, przenieść dane z arkusza
i co robić co roku. Bieżąca konfiguracja produkcyjna:

| Element | Wartość |
|---|---|
| Adres aplikacji | https://szymczyklp.github.io/budzet-domowy/ |
| Repozytorium | https://github.com/szymczyklp/budzet-domowy (publiczne, bez danych) |
| Projekt Google Cloud | `budzet-domowy` (ID `budzet-domowy-514411`; OAuth: klient „Budżet web”, status *In production*) |
| Pośrednik logowania | https://budzet-auth.szymczyklp.workers.dev (Cloudflare, plan darmowy) |
| Polityka prywatności | https://szymczyklp.github.io/budzet-domowy/prywatnosc.html |

## Uruchomienie lokalne

Wymagany Node.js 22 (lub 20+).

```bash
npm install
npm run dev        # http://localhost:5173 – z przeładowaniem na żywo
npm test           # testy logiki
npm run build      # sprawdzenie typów + wersja produkcyjna w dist/
npm run preview    # podgląd zbudowanej wersji (http://localhost:4173)
```

Logowanie Google działa także lokalnie (`http://localhost:5173` jest wśród dozwolonych adresów w Google Cloud
i w `ALLOWED_ORIGIN` Workera).

## Publikacja (GitHub Pages)

Każdy push na `main` uruchamia `.github/workflows/deploy.yml`: `npm ci` → `npm test` → `npm run build` → publikacja
`dist/` na GitHub Pages. Nieudane testy zatrzymują publikację. Pierwsza konfiguracja: w repozytorium
**Settings → Pages → Build and deployment → Source: GitHub Actions**.

Na urządzeniach nowa wersja instaluje się w tle; użytkownik widzi ją po zamknięciu i ponownym otwarciu aplikacji
(czasem dwa razy).

## Google Cloud

Jednorazowo w https://console.cloud.google.com (projekt `budzet-domowy`). Bezpośrednie adresy: klienci OAuth –
https://console.cloud.google.com/auth/clients, odbiorcy – https://console.cloud.google.com/auth/audience, elementy
marki – https://console.cloud.google.com/auth/branding, dane logowania – https://console.cloud.google.com/apis/credentials. Nazwy w nawiasach to wersja polska konsoli.

1. **API** (*APIs & Services → Library* / *Interfejsy API i usługi → Biblioteka*): włącz **Google Drive API**
   i **Google Picker API**.
2. **Ekran zgody** (*Google Auth Platform* / *Platforma Google Auth*):
   - *Branding* (*Elementy marki*): nazwa „Budżet domowy”, e-mail pomocy, **bez logo** (logo wymaga weryfikacji),
     strona główna `https://szymczyklp.github.io/budzet-domowy/`, polityka prywatności
     `https://szymczyklp.github.io/budzet-domowy/prywatnosc.html`, autoryzowana domena `szymczyklp.github.io`,
     e-mail dewelopera,
   - *Audience* (*Odbiorcy*): typ **External**, stan **In production** (*Opublikuj aplikację*). W stanie *Testing*
     refresh tokeny wygasają po 7 dniach, a zalogować się mogą tylko użytkownicy testowi,
   - *Data access* (*Dostęp do danych*): zakres `https://www.googleapis.com/auth/drive.file`.
3. **Klient OAuth** (*Clients* / *Klienci* albo *Interfejsy API i usługi → Dane logowania → Identyfikatory klienta
   OAuth 2.0*), typ *Web application*:
   - *Authorized JavaScript origins*: `https://szymczyklp.github.io`, `http://localhost:5173`,
   - *Authorized redirect URIs*: `https://szymczyklp.github.io/budzet-domowy/`, `http://localhost:5173/`
     (z ukośnikiem na końcu),
   - *Client secret* – potrzebny tylko Workerowi. Google pokazuje go w całości **tylko przy tworzeniu**; istniejący
     widać jako `****abcd`. Nowy: *Add secret* / *Dodaj tajny klucz*.
4. **Klucz API** (*Credentials → Create credentials → API key*), dla Google Picker. Ograniczenia:
   *Website restrictions*: `https://szymczyklp.github.io/*`, `http://localhost:5173/*`;
   *API restrictions*: **Google Picker API** i **Google Drive API**.
5. **Numer projektu** (*IAM & Admin → Settings → Project number*).
6. Client ID, klucz API i numer projektu wpisz w `src/config.ts` (`clientId`, `apiKey`, `appId`). To nie są
   sekrety – i tak są widoczne w kodzie strony; zabezpieczają je ograniczenia z punktów 3–4.

### Gdy okno wyboru pliku zgłasza błąd

- **„Klucz programistyczny API jest nieprawidłowy”** – sprawdź w *Credentials → klucz API*: *Website restrictions*
  zawiera dokładnie `https://szymczyklp.github.io/*`, a *API restrictions* – Google Picker API i Google Drive API;
  w *Library* muszą być włączone oba. Strona musi wysyłać Referera (meta `referrer` = `strict-origin`, nie
  `no-referrer`). Zmiany ograniczeń w konsoli działają po kilku minutach.
- **„Nie można uzyskać dostępu do konta Google … ciasteczka”** – ograniczenie Pickera w Safari/iOS (blokada
  ciasteczek spoza witryny), opis obejścia w [podręczniku](podrecznik.md) (najczęstsze pytania).

## Cloudflare Worker (logowanie stałe)

1. Konto: https://dash.cloudflare.com/sign-up (plan darmowy, bez karty). Subdomena `workers.dev` konta:
   `szymczyklp.workers.dev`.
2. **Workers & Pages → Create application → Start with Hello World!**, nazwa `budzet-auth`, *Deploy*.
3. **Edit code** → zastąp całość treścią `worker/worker.js` → *Deploy*.
4. **Settings → Variables and Secrets → Add**:

   | Nazwa | Typ | Wartość |
   |---|---|---|
   | `GOOGLE_CLIENT_ID` | Text | Client ID z `src/config.ts` |
   | `GOOGLE_CLIENT_SECRET` | Secret | sekret klienta OAuth |
   | `SEALING_KEY` | Secret | losowy tekst, min. 32 znaki (np. z generatora haseł) |
   | `ALLOWED_ORIGIN` | Text | `https://szymczyklp.github.io,http://localhost:5173` |

5. Sprawdzenie: adres Workera otwarty w przeglądarce ma pokazać **Forbidden** (żądanie spoza dozwolonych originów).
6. Adres Workera w `src/config.ts` → `tokenProxy`, push.
7. Na każdym urządzeniu raz „Połącz z Dyskiem” – w Ustawieniach pojawi się „✓ Logowanie stałe (przez Cloudflare)”.

Alternatywnie z terminala: `cd worker && npx wrangler deploy` (konfiguracja w `worker/wrangler.toml`), sekrety
`npx wrangler secret put GOOGLE_CLIENT_SECRET` i `SEALING_KEY`.

**Aktualizacja kodu Workera** – po zmianie `worker/worker.js` w repozytorium: *Workers & Pages → budzet-auth →
Edit code*, wklej całą zawartość pliku, *Deploy* (zmienne i sekrety zostają).

**Zmiana `SEALING_KEY`** unieważnia zapieczętowane tokeny – każde urządzenie poprosi o jednorazowe zalogowanie.
**Zmiana sekretu klienta** (usunięcie starego w Google) – zaktualizuj `GOOGLE_CLIENT_SECRET` w Workerze.

Limit planu darmowego (100 000 zapytań dziennie) jest wielokrotnie większy niż potrzeba: zapytanie do Workera
następuje tylko przy logowaniu i raz na godzinę używania aplikacji na urządzeniu.

## Przeniesienie danych z arkusza flow4

```bash
pip install openpyxl
python scripts/konwertuj_flow4.py master_data2.xlsx --od 2026-11 -o data/budzet.json
```

Skrypt czyta arkusz `flow4`: wiersz 2 – miesiące, kolumna A – nazwy, B – dzień płatności; wiersze z ciemnym tłem to
kategorie; ciemniejszy odcień komórki = zapłacone, jaśniejszy = prognoza; szare wiersze = pozycje zakończone.
Miesiące przed `--od` trafiają do historii (wpisy z kwotą i statusem), od `--od` powstaje plan (kwota obowiązuje do
następnej zmiany; płatności co 2–3 miesiące są wykrywane).

W aplikacji: **Ustawienia → Wczytaj kopię → Zastąp wszystko** → `data/budzet.json`. Katalog `data/` jest w
`.gitignore` – plik wynikowy zawiera dane i nie może trafić do repozytorium.

Po wczytaniu warto: **Kategorie → Zastosuj podział**, ustawić karty i osoby płacące, przejrzeć reguły planu pozycji
(daty „do”, sezonowość – np. gaz).

## Utrzymanie

**Co roku (styczeń–luty):**

- dopisać podstawę składki zdrowotnej na nowy rok w `HEALTH_BASE` (`src/lib/firm.ts`) – przeciętne wynagrodzenie
  z IV kwartału poprzedniego roku (komunikat GUS); zaktualizować tabelę w `docs/obliczenia.md` i test progów,
- sprawdzić w Firmie kwotę składek społecznych ZUS na nowy rok,
- przejrzeć indeksacje i kwoty planu (czynsz, ubezpieczenia).

**Przy zmianie banku lub formatu eksportu** – dodać parser albo raz wskazać kolumny ([import](import.md)).

**Aktualizacje zależności** – przypinane do konkretnych wersji w `package.json`; po aktualizacji `npm test`
i `npm run build`, sprawdzenie importu PDF i logowania.

**Kopie** – Dysk Google ma historię wersji i kopie miesięczne; dodatkowo raz na jakiś czas warto pobrać kopię
JSON i trzymać ją poza Dyskiem (jest jawna – w zaszyfrowanym miejscu).
