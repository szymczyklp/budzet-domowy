# Podręcznik

Budżet domowy to aplikacja do planowania i rozliczania domowych finansów miesiąc po miesiącu: przychody, opłaty do
zaznaczenia, wydatki liczone z wyciągów, prognoza na kolejne lata, kredyty, rozliczenia firmy i informacje dla bliskich
„na wypadek”. Działa w przeglądarce i jako aplikacja na telefonie, a dane mogą być wspólne dla dwóch osób przez Dysk Google.

Ten podręcznik jest dostępny w aplikacji (**Więcej → Pomoc**, z wyszukiwarką) i w repozytorium
(`docs/podrecznik.md`). Kółko **?** przy nagłówkach ekranów otwiera właściwy temat pomocy.

## Na start

**Instalacja na telefonie.** Otwórz https://szymczyklp.github.io/budzet-domowy/ – na iPhonie w Safari: „Udostępnij”
(kwadrat ze strzałką) → **Do ekranu początkowego**; na Androidzie w Chrome: menu ⋮ → **Dodaj do ekranu głównego**
(albo „Zainstaluj aplikację”). Aplikacja otwiera się wtedy jak zwykła aplikacja, bez paska przeglądarki, i działa
także bez internetu (zmiany wyślą się na Dysk, gdy sieć wróci). Na laptopie wystarczy zakładka w przeglądarce.

**Aktualizacje.** Nowa wersja pobiera się sama w tle i działa po ponownym otwarciu aplikacji. Na iPhonie czasem
trzeba zamknąć aplikację w przełączniku i otworzyć ją dwa razy.

**Imię.** W **Ustawienia → Kto korzysta z tego urządzenia** wpisz swoje imię. Zapisuje się ono przy każdej zmianie,
dlatego druga osoba widzi, kto i kiedy coś zaznaczył. Na telefonie żony wpisuje się jej imię – to samo, które
wybierasz w polu „Kto płaci” przy pozycjach.

**Skąd biorą się dane.** Masz trzy możliwości:

- połączyć się z istniejącym wspólnym plikiem na Dysku Google (patrz [Wspólne dane](#wspólne-dane-i-synchronizacja)),
- wczytać kopię `budzet.json` (np. przygotowaną z arkusza flow4) w **Ustawienia → Wczytaj kopię**,
- zacząć od zera: **Pozycje → Dodaj pozycję**.

**Kolejność pierwszych kroków** (zalecana): imię → połączenie z Dyskiem → **Kategorie → Zastosuj podział** (jeśli
pojawi się propozycja) → **Konta i karty** (numery rachunków, karty kredytowe) → przegląd pozycji → pierwszy import
wyciągu.

## Jak zbudowany jest budżet

**Sekcje.** Każda kategoria należy do jednej z czterech sekcji, które wyznaczają, jak traktowane są jej pozycje:

- **Przychody** – wynagrodzenia, faktury, świadczenia. Zaznaczasz, co wpłynęło.
- **Opłaty firmowe** – ZUS, podatki, księgowość, leasing. Zaznaczasz, co zapłacone.
- **Opłaty prywatne** – rachunki, kredyty, ubezpieczenia, subskrypcje. Zaznaczasz, co zapłacone.
- **Wydatki** – spożywka, chemia, paliwo, restauracje… Nie zaznacza się ich: kwota to suma transakcji z wyciągów
  i ręcznych wpisów, a kwota w planie jest miesięcznym **budżetem**.

Sekcję kategorii ustawiasz w **Kategorie**. Gdy jej nie ustawisz, aplikacja zgaduje ją z nazwy (np. „PODATKI i
SKŁADKI ZUS” → opłaty firmowe, „PRZYCHODY” → przychody, inne → opłaty prywatne).

**Pozycja** to jedna stała albo planowana rzecz: „czynsz”, „kredyt hipoteczny”, „faktura netto”, „spożywka”. Ma
kategorię, kwotę w planie, opcjonalnie dzień płatności, kartę lub konto, osobę, która płaci, numer umowy i notatkę.

**Plan i wykonanie.** Każda pozycja ma plan (kwoty z reguł). Gdy w danym miesiącu pojawi się kwota rzeczywista –
wpisana ręcznie, z wyciągu albo zapisana przy zaznaczeniu – zastępuje plan w sumach i prognozie. Plan zostaje
zapisany i widać go w widoku [Plan a wykonanie](#prognoza-plan-a-wykonanie-i-analiza).

**Kwoty są ze znakiem**: wpływy dodatnie, wydatki ujemne (np. `-129,99`). Wszystkie kwoty liczone są co do grosza.
Przy dodawaniu wydatku w widoku miesiąca znak minus dodaje się sam.

## Widok miesiąca

Główny ekran. Strzałkami ‹ › zmieniasz miesiąc; „Wróć do bieżącego miesiąca” wraca do dzisiejszego.

**Klocki na górze** pokazują każdą sekcję:

- przychody i opłaty: suma miesiąca, ile pozycji już zaznaczono (np. `zapłacone 12/18`) i ich kwota, pasek postępu,
- wydatki: ile wydano wobec budżetu; klocek robi się czerwony po przekroczeniu budżetu.

Stuknięcie klocka przewija do jego sekcji.

**Balans miesiąca** to wynik z prognozy: kwoty rzeczywiste tam, gdzie są, a w pozostałych pozycjach plan. Pod nim
„dotychczas” – to, co już się wydarzyło (wpływy minus zapłacone i wydane) – i balans trzech kolejnych miesięcy
z odnośnikiem do pełnej prognozy.

**Ukryj kwoty** zamienia wszystkie kwoty na kropki (np. gdy pokazujesz komuś ekran). Ustawienie dotyczy tylko tego
urządzenia; kwoty w polach edycji zostają widoczne.

**Co nowego** (tylko w bieżącym miesiącu) – lista zmian zrobionych przez drugą osobę od ostatniego „OK, widzę” na
tym urządzeniu: zaznaczenia, notatki, importy, zmiany pozycji.

**Do zapłaty w ciągu 14 dni** – niezaznaczone opłaty i przychody z dniem płatności w ciągu najbliższych 14 dni
(z bieżącego i następnego miesiąca), posortowane po dacie. Pozycje z bieżącego miesiąca, których termin już minął,
są na górze. Dla spłat kart bez własnego dnia liczy się dzień spłaty karty z **Konta i karty**.

**Skrzynka** – jeśli z importu zostały nieprzypisane transakcje, pojawia się odnośnik do nich (patrz
[Skrzynka](#skrzynka-tryb-kart-i-podział)).

**Zaległe z poprzednich miesięcy** – niezapłacone opłaty z 6 poprzednich miesięcy. Można je zaznaczyć stąd.

**Filtry**: wyszukiwanie po nazwie, „Tylko niezaznaczone” i „Tylko moje” (pozycje bez osoby albo przypisane do
Ciebie; filtr pojawia się, gdy w danych są co najmniej dwie osoby).

### Zaznaczanie i szczegóły pozycji

Okrągły przycisk ✓ po prawej oznacza pozycję jako zapłaconą / otrzymaną (zapisuje datę i kwotę z planu). Ponowne
stuknięcie cofa zaznaczenie; jeśli kwota była tylko skopiowana z planu, wraca plan, a kwota wpisana ręcznie zostaje.

Liczba po lewej to dzień płatności – na czerwono, gdy termin w bieżącym miesiącu minął, a pozycja nie jest
zaznaczona. Pod nazwą widać kartę lub konto, notatkę (✎) oraz – przy pozycjach drugiej osoby – kto płaci albo kto
i kiedy zaznaczył.

Stuknięcie nazwy rozwija szczegóły:

- **numer konta** do przelewu (z przyciskiem kopiowania) i numer umowy,
- **Historia i plan ›** – przejście do [karty pozycji](#karta-pozycji),
- **Karta / konto** – szybka zmiana bez otwierania edycji,
- kto zaznaczył i kiedy,
- **Notatka do tego miesiąca** – widoczna dla obu osób (np. „zapłaciłam z mojego konta”),
- **transakcje** przypisane w tym miesiącu (z przyciskiem „Odepnij” – transakcja z wyciągu wraca do skrzynki,
  wpis ręczny jest usuwany),
- **kwota rzeczywista** – wpisz, jeśli była inna niż plan („Usuń kwotę rzeczywistą” przywraca plan),
- w **przyszłym miesiącu** zamiast kwoty rzeczywistej zmieniasz plan tylko na ten jeden miesiąc.

### Karty kredytowe do spłaty

Pozycje oznaczone jako spłata karty (w edycji pozycji, gdy wybrana jest karta kredytowa) tworzą osobną grupę
„Karty kredytowe do spłaty” na początku swojej sekcji. W szczegółach widać sumę zakupów tą kartą z poprzedniego
miesiąca (z zaimportowanego wyciągu karty) i przycisk „Ustaw jako kwotę spłaty”. Przelew spłaty z wyciągu konta
przypisuje się sam po czterech ostatnich cyfrach numeru karty.

### Wydatki

W sekcji Wydatki każda pozycja pokazuje, ile wydano, a w nawiasie budżet; pasek pokazuje wykorzystanie.

- **+ Dodaj wydatek** (lub „+” przy pozycji) – ręczny wpis, np. gotówka: kwota (bez minusa), data, opis. Wpis
  sumuje się z transakcjami z wyciągów i jest widoczny w szczegółach pozycji.
- **Więcej rodzajów wydatków** – szybkie dodanie typowych pozycji (restauracje, apteka, dom, transport, rozrywka…).
  Ich nazwy pasują do wbudowanych podpowiedzi sklepów przy imporcie.

W zamkniętym miesiącu liczy się to, co wydano (a jeśli nie ma żadnych danych – budżet). W bieżącym i przyszłych
miesiącach do prognozy wchodzi większa z kwot: budżet albo dotychczasowe wydatki.

## Pozycje i plan

**Pozycje** to lista wszystkich pozycji pogrupowanych w kategorie, z kwotą planu na bieżący miesiąc.
„Pokaż zakończone” dołącza pozycje, których okres się skończył. Wyszukiwarka szuka po nazwie, numerze umowy,
notatce, koncie i kategorii (także w zakończonych).

### Edycja pozycji

Pola formularza:

- **Nazwa**, **Kategoria** (albo nowa kategoria),
- **Dzień płatności** i **Konto / karta**,
- **Kto płaci i zaznacza** – osoba albo „wspólne”; „+ inna osoba…” dodaje nowe imię,
- **To spłata tej karty kredytowej** – gdy wybrana jest karta kredytowa,
- **Numer umowy / polisy**, **Notatka**,
- **Aktywna od / do** (RRRR-MM) – poza tym okresem pozycja się nie pojawia,
- **Liczona jak wydatek** – suma wielu transakcji bez zaznaczania (dla pozycji spoza sekcji Wydatki),
- **VAT do odliczenia** – przy kosztach firmowych (patrz [Firma](#firma-ryczałt-vat-i-zus)),
- **Kwoty** – lista reguł planu i pola nowej reguły: kwota, od miesiąca, co ile miesięcy, do miesiąca.

**Usuń pozycję** ukrywa ją wraz z planem; historia zostaje w kopii pliku.

### Karta pozycji

Otwierasz ją z listy pozycji albo przez „Historia i plan ›” w widoku miesiąca. Pokazuje:

- plan w bieżącym miesiącu i średnią z ostatnich 12 miesięcy,
- **Harmonogram planu** – wszystkie reguły i zmiany pojedynczych miesięcy, z możliwością usunięcia,
- tabelę **miesiąc po miesiącu od stycznia 2024 do grudnia za dwa lata**, z sumami rocznymi. Kwoty zrealizowane
  (✓ albo kwota rzeczywista) zastępują plan; przyszłe mają dopisek „plan”, a ● oznacza miesiąc, od którego
  zaczyna się nowa reguła.

Stuknięcie miesiąca otwiera edytor:

- **Tylko ten miesiąc** – jednorazowa zmiana planu (np. znana wyższa faktura),
- **Od tego miesiąca** – nowa kwota obowiązująca dalej, z opcjami: co ile miesięcy (co miesiąc, co 2, co kwartał,
  co pół roku, raz w roku), do miesiąca (potem 0) i wzrost co rok w %,
- **Jak w ost. 12 mies.** – sezonowość: kwoty z 12 poprzednich miesięcy (wykonanie, a bez niego plan) powtarzane
  co roku, opcjonalnie do miesiąca i ze wzrostem co rok,
- **Rzeczywiście** (miesiące do bieżącego) – kwota rzeczywista i zaznaczenie zapłaty.

### Jak liczony jest plan

Dla danego miesiąca obowiązuje pierwsza pasująca zasada:

1. pozycja poza okresem „aktywna od–do” → 0,
2. **zmiana tylko tego miesiąca**,
3. plan wyliczany przez **moduł firmy** (VAT, zaliczka ryczałtu, ZUS, VAT od klienta – od miesiąca startu modułu),
4. **harmonogram kredytu** (od miesiąca pierwszej raty z harmonogramu),
5. **reguła kwoty** – ostatnia reguła, która zaczęła się nie później niż w tym miesiącu:
   - po miesiącu „do” → 0,
   - **wzrost co rok**: kwota × (1 + %/100) do potęgi liczby lat od roku startu reguły (zmiana od każdego stycznia),
   - **sezonowość**: kwota dla danego miesiąca kalendarza ze schematu,
   - **co N miesięcy**: kwota w miesiącu startu i co N miesięcy później, w pozostałych 0.

Bez daty „do” kwota obowiązuje bez końca. Prognoza pokazuje okres do grudnia za dwa lata.

## Kredyty

Sekcja **Harmonogram kredytu** jest w karcie pozycji, gdy nazwa pozycji albo jej kategorii zawiera „kredyt”,
„pożyczka”, „hipote…” albo „raty” (albo gdy pozycja ma już harmonogram). Gdy harmonogramu jeszcze nie ma, widać
rozwijane „To kredyt? Ustaw harmonogram rat”. „Ustaw harmonogram” pyta o:

- **pierwszą ratę z harmonogramu** (RRRR-MM) i **kapitał do spłaty przed nią**,
- **oprocentowanie roczne %** i **rodzaj rat** (równe albo malejące),
- **liczbę rat do końca** albo **miesiąc ostatniej raty**,
- opcjonalnie **stałą opłatę** doliczaną do raty (np. ubezpieczenie).

Dane najlepiej przepisać z aktualnego harmonogramu banku. Od pierwszej raty plan pozycji liczy się z harmonogramu.
Po zmianie oprocentowania wpisz nowe wartości od miesiąca zmiany.

Panel pokazuje ratę, kapitał do spłaty teraz, miesiąc końca i liczbę rat, odsetki do końca oraz tabelę rat
(kapitał, odsetki, zostaje). **Symulacja nadpłaty** porównuje bez zapisywania: kwota, miesiąc i efekt (krótszy
okres albo niższa rata) → oszczędność na odsetkach i nowy koniec lub nowa rata. „Dodaj nadpłatę do planu” zapisuje
ją – kwota nadpłaty dolicza się do planu w tym miesiącu.

„Dodaj do majątku jako zobowiązanie” / „Zapisz stan … w majątku” przenosi kapitał do spłaty do
[Na wypadek](#na-wypadek) i do historii [majątku netto](#prognoza-plan-a-wykonanie-i-analiza).

Odsetki liczone są miesięcznie (oprocentowanie / 12). Bank liczy je zwykle według dni, więc kwoty mogą różnić się
o grosze.

## Firma: ryczałt, VAT i ZUS

**Więcej → Firma** wylicza plan podatków i składek z przychodów i kosztów firmy. Założenia:

- działalność na **ryczałcie** od przychodów ewidencjonowanych, każda linia przychodu może mieć inną stawkę
  (np. 12% i 15%),
- **VAT rozliczany miesięcznie**,
- przychód z powołania (lub umowy o pracę) rozlicza się osobno i nie wchodzi do wyliczeń ryczałtu ani VAT,
- pełnej księgowości kosztów nie ma – liczy się tylko VAT z kosztów oznaczonych stawką VAT.

### Ustawienia firmy

- **Wyliczaj plan od** – od tego miesiąca plan wybranych pozycji liczy się automatycznie; wcześniejsze miesiące
  zostają bez zmian.
- **Stawka VAT od przychodu** – zwykle 23%.
- **Przychody z faktur (netto)** – pozycje przychodu i ich stawki ryczałtu. Gdy część usług jest na innej stawce,
  dodaj osobną pozycję przychodu (np. „faktura netto 15%”), zmniejsz kwotę głównej i dodaj tu drugą linię.
- **Pozycje wyliczane**: VAT od klienta (wpływ), VAT do zapłaty, zaliczka ryczałtu, składki ZUS (społeczne +
  zdrowotna). Każdą można pominąć („— nie wyliczaj —”).
- **Składki społeczne / mies.** – kwota bez zdrowotnej (z ZUS albo od księgowej).
- **Podatki za miesiąc płacę** – w tym samym miesiącu budżetu co przychód albo w następnym.

**Podgląd** pokazuje wyliczenie dla pierwszego miesiąca i obok kwoty dotychczas w planie.

### Jak liczy

Dla każdego miesiąca (z kwot rzeczywistych, a bez nich z planu):

- **VAT należny** = rzeczywisty wpływ „VAT od klienta”, a bez niego suma przychodów netto × stawka VAT,
- **VAT naliczony** = suma po kosztach z zaznaczonym VAT: |kwota brutto| × stawka / (100 + stawka) × % odliczenia,
- **VAT do zapłaty** = należny − naliczony, zaokrąglony do pełnych złotych (ujemny = nadwyżka),
- **składka zdrowotna** wg rocznego przychodu (suma przychodów roku − 12 × składki społeczne): do 60 tys. zł –
  9% × 60% podstawy, do 300 tys. – 9% × 100%, powyżej – 9% × 180%; podstawa 2026: 9228,64 zł, czyli
  498,35 / 830,58 / 1495,04 zł miesięcznie. Dla lat bez ogłoszonej podstawy używana jest ostatnia znana,
- **zaliczka ryczałtu**: od przychodu odejmowane są składki społeczne i 50% zdrowotnej – najpierw od linii
  z najwyższą stawką; podstawa każdej linii zaokrąglona do złotych × stawka, suma zaokrąglona do złotych,
- **ZUS** = składki społeczne + zdrowotna.

Tabela pokazuje 12 miesięcy (przychód, VAT, ryczałt, ZUS); stuknięcie miesiąca rozwija wyliczenie.

### VAT przy kosztach

Sekcja **Koszty firmowe – VAT do odliczenia** (na dole ekranu Firma) i pole „VAT do odliczenia” w edycji pozycji:
stawka 23 / 8 / 5% i odliczenie 100% albo 50% (np. samochód osobowy użytku mieszanego). Kwota pozycji to kwota
brutto. „+ inny koszt z fakturą VAT” dodaje pozycje spoza kategorii firmowych (np. telefon).

To wyliczenie wspiera planowanie i nie zastępuje księgowej. Pozycje oznaczone jako zapłacone zachowują kwotę z dnia
zaznaczenia, więc rzeczywistą kwotę z deklaracji wpisz jako kwotę rzeczywistą.

## Import z banku

**Import** wczytuje historię z banku i przypisuje transakcje do pozycji. Rozpoznawane pliki:

| Bank | Plik |
|---|---|
| PKO BP – rachunek | CSV z historii rachunku |
| PKO BP – karta kredytowa | CSV z historii karty |
| Bank Millennium | wyciąg PDF |
| Revolut | CSV z wyciągu (wersja polska i angielska; pomijane są transakcje odrzucone, cofnięte i oczekujące; opłata odejmowana od kwoty) |
| mBank | CSV z nagłówkiem „#Data operacji” |
| inny bank | dowolny CSV – za pierwszym razem wskazujesz kolumny, format się zapamiętuje |

Pliki są czytane tylko na urządzeniu – nic nie jest wysyłane na serwer. Kodowanie (UTF-8 albo Windows-1250)
rozpoznawane jest automatycznie.

### Przebieg importu

1. **Wybierz plik z banku.** Po wczytaniu widać bank, liczbę transakcji i ile było już zaimportowanych wcześniej
   (te są pomijane – ponowne wgranie tego samego okresu nie dubluje danych).
2. Przy wyciągu karty (i innych plikach poza rachunkiem PKO i Millennium) wybierz **kartę / konto**, z którego
   pochodzi. Wybór zapamiętuje się dla danego banku. Dzięki temu w spłacie karty widać sumę zakupów.
3. Domyślnie pokazywany jest najnowszy miesiąc z pliku; filtrem zmienisz miesiąc albo wybierzesz wszystkie.
4. Przy każdej transakcji jest propozycja i jej źródło: `reguła`, `spłata karty`, `przelew własny`, `sklep`, `kwota`.
   Możesz ją zmienić, wybrać **Pomiń** (np. przelew własny) albo **Podziel na kilka pozycji…**.
5. Przy ręcznym wyborze można zaznaczyć **Zapamiętaj: opis zawiera …** – powstaje reguła na przyszłość.
6. **Zatwierdź** zapisuje transakcje z wybranego miesiąca (albo wszystkich): przypisane, pominięte, a nieprzypisane
   trafiają do skrzynki.

Po zapisie pozycje dostają **kwotę rzeczywistą** równą sumie przypisanych transakcji. Zwykłe pozycje są oznaczane
jako zapłacone z datą ostatniej transakcji; wydatki tylko się sumują.

### Kolejność dopasowania

1. **Twoje reguły** – opis zawiera wzorzec; dłuższy wzorzec ma pierwszeństwo. Reguła może też pomijać transakcje.
2. **Spłata karty kredytowej** – przelew z „spłata karty”/„credit card” i czterema cyframi pasującymi do karty
   z pozycji oznaczonej jako spłata karty.
3. **Przelewy własne** – „przelew własny”, „own transfer”, „spłata należności” (od strony karty) → pomiń.
4. **Sklepy** – wbudowana lista nazw sklepów dla pozycji wydatków, których nazwa zawiera: spożyw…, paliw…, chemia,
   ubrania, restaurac…, aptek…, wyposaż…, transport, rozryw… (np. Biedronka → spożywka, Orlen → paliwo).
5. **Kwota zgodna z planem** – niezaznaczona pozycja (nie wydatek) z kwotą planu równą kwocie transakcji: co do
   grosza, a od 1000 zł z tolerancją 1%. Tolerancję zmienisz w **Ustawienia → Import z banku**. Przy kilku
   pasujących wygrywa pozycja z najbliższym dniem płatności.

### Skrzynka, tryb kart i podział

**Skrzynka – do przypisania** (na dole ekranu Import) zbiera zapisane, nieprzypisane transakcje. Jest wspólna: widzi
ją też druga osoba. Przy każdej transakcji jest propozycja, wybór pozycji i opcja zapamiętania reguły.

**Przeglądaj po jednej** – tryb kart, wygodny na telefonie: jedna transakcja na ekranie, przycisk z propozycją,
lista innych pozycji, „Pomiń transakcję” i „Później”.

**Podział transakcji** – np. zakupy w Allegro częściowo na dom, częściowo na prezenty. Wybierz pozycję dla każdej
części i kwotę; suma części musi równać się kwocie transakcji („+ część” dodaje kolejną z resztą kwoty). Każda część
liczy się w swojej pozycji.

**Odpięcie** (w szczegółach pozycji w widoku miesiąca) zwraca transakcję z wyciągu do skrzynki i przelicza kwotę
pozycji – gdy to była ostatnia transakcja, pozycja wraca do planu.

### Wykryte stałe płatności

Aplikacja szuka płatności spoza planu, które powtarzają się co miesiąc: ten sam kontrahent w co najmniej 3 różnych
miesiącach, kwoty różnią się najwyżej o 15%, transakcje nieprzypisane albo przypisane do wydatków zbiorczych.
**Utwórz pozycję** zakłada pozycję z typową kwotą (mediana) i dniem, regułę importu oraz przypisuje do niej
transakcje ze skrzynki. **Odrzuć** ukrywa propozycję na stałe.

### Nieznany plik CSV

Gdy format nie jest rozpoznany, pojawia się **Wskaż kolumny**: wiersz nagłówka, data, kwota, opis (można kilka
kolumn), kontrahent i „wydatki są w pliku na plusie (odwróć znak)”. Podgląd pokazuje, ile transakcji odczytano.
„Wczytaj i zapamiętaj format” zapisuje mapowanie we wspólnych ustawieniach – kolejne pliki z tym samym nagłówkiem
wczytają się same. Obsługiwane daty: RRRR-MM-DD, DD.MM.RRRR, DD-MM-RRRR, DD/MM/RRRR; kwoty: `-1 234,56`,
`-1234.56`, `1.234,56 PLN`, `(12,30)`.

### Reguły importu

Lista **Reguły importu** (na dole ekranu Import) pokazuje wszystkie wzorce i przypisane pozycje; regułę można usunąć.
Reguła działa, gdy opis transakcji (bez polskich znaków i wielkości liter) zawiera wzorzec.

## Prognoza, Plan a wykonanie i Analiza

**Prognoza** (Więcej) – od bieżącego miesiąca do grudnia za dwa lata: wpływy, wydatki, wynik miesiąca i wynik
narastająco, z sumami rocznymi.

**Plan a wykonanie** (Więcej) – porównanie za miesiąc albo cały rok (od 2024), pozycja po pozycji w podziale na
sekcje. Różnica liczona jest tylko z miesięcy, które mają i plan, i wykonanie; pozycje bez planu są oznaczone.

**Analiza** (Więcej) ma trzy zakładki:

- **Trendy** – 12 pełnych miesięcy dla każdej kategorii na słupkach (najedź lub dotknij słupka, żeby zobaczyć
  kwotę), suma, średnia miesięczna i zmiana wobec 12 wcześniejszych miesięcy (r/r). Rozwinięcie kategorii pokazuje
  jej pozycje i tabelę miesiąc do miesiąca. „Najbardziej wzrosły” – pozycje kosztowe, które urosły najbardziej
  (o ponad 100 zł rocznie). Tam, gdzie nie ma kwoty rzeczywistej, liczy się plan.
- **Rok** – sumy sekcji i wynik roku z porównaniem do poprzedniego roku, tabela miesięcy z wynikiem narastająco
  (miesiące z prognozy oznaczone kursywą) i 10 największych kosztów.
- **Majątek** – majątek netto = oszczędności minus zobowiązania z [Na wypadek](#na-wypadek). Wykres pokazuje stan
  na koniec każdego miesiąca (ostatnia znana kwota każdego wpisu), do 24 miesięcy wstecz. **Zaktualizuj stany**
  pozwala wpisać nowe salda wszystkich wpisów naraz z jedną datą. Każda nowa kwota trafia do historii.

## Na wypadek

Informacje dla bliskich, gdyby coś się stało. Są we wspólnym pliku, więc widzi je każdy, komu go udostępnisz.

- **Instrukcja** – krótki tekst: do kogo zadzwonić, co zgłosić, gdzie są dokumenty.
- **Oszczędności i inwestycje** – konta, lokaty, IKE/IKZE, PPK, maklerskie, obligacje: instytucja, rodzaj, numer,
  czyje, saldo i stan na dzień, dyspozycja na wypadek śmierci, dostęp, kontakt.
- **Ubezpieczenia** – numer polisy, kto ubezpieczony, suma, uposażony, telefon do zgłoszenia szkody.
- **Kredyty i zobowiązania** – numer umowy, pozostało do spłaty, stan na dzień, ubezpieczenie spłaty.
- **Kontakty** – kadry, księgowa, doradca, notariusz, agent.

„Dodaj polisy i kredyty z pozycji” tworzy wpisy z aktywnych pozycji w kategoriach ubezpieczeń i kredytów.
**Drukuj / zapisz PDF** drukuje stronę bez przycisków.

Nowa kwota oszczędności lub zobowiązania zapisuje się w historii (do wykresu majątku). Gdy zmieniasz kwotę, a nie
zmieniasz daty, ustawia się dzisiejsza data.

**Nie wpisuj tu haseł ani PIN-ów** – tylko informację, gdzie są (np. „menedżer haseł, dostęp awaryjny dla żony”).

## Konta, karty i kategorie

**Konta i karty** (Więcej) – rachunki (z numerem do przelewu i przyciskiem kopiowania), karty kredytowe (z dniem
spłaty) i inne (leasing, odbiorca). Pozycja przypięta do konta pokazuje jego numer w widoku miesiąca.

**Kategorie** (Więcej):

- nazwa i **sekcja** każdej kategorii, kolejność strzałkami ↑ ↓ (to kolejność grup w widoku miesiąca),
- **Proponowany podział na sekcje** – zapisuje sekcje zgadnięte z nazw i przenosi księgowość oraz leasingi do nowej
  kategorii KOSZTY FIRMOWE,
- w edycji kategorii: **karta / konto dla wszystkich pozycji** (np. wszystkie subskrypcje na jedną kartę, także nowa
  karta tworzona od razu) i **kto płaci za wszystkie pozycje**,
- **Usuń kategorię** – z przeniesieniem jej pozycji do innej kategorii.

## Wspólne dane i synchronizacja

Dane mogą być w jednym pliku `budzet-domowy.json` w folderze „Budżet domowy” na Twoim Dysku Google. Aplikacja widzi
na Dysku tylko pliki, które sama utworzyła albo które jej wskażesz (zakres `drive.file`).

**Pierwsze urządzenie:** Ustawienia → Zaloguj przez Google → **Utwórz wspólny plik na Dysku**.

**Kolejne Twoje urządzenia:** Zaloguj przez Google → aplikacja sama znajdzie plik → **Połącz z tym plikiem**.
Dane z urządzenia są scalane z plikiem – nic nie ginie.

**Druga osoba:** w Ustawieniach wpisz jej e-mail Google w „Udostępnij” (Google wyśle jej wiadomość). Ona: Zaloguj
przez Google → **Wybierz plik z Dysku** → zakładka „Udostępnione dla mnie” → plik `budzet-domowy.json`. To robi się
raz; jej kolejne urządzenia znajdą plik same. Jeśli okno wyboru pisze „Nie można uzyskać dostępu do konta Google”,
zobacz [najczęstsze pytania](#najczęstsze-pytania).

**Jak działa synchronizacja:**

- po każdej zmianie (z opóźnieniem ok. 2,5 s), po powrocie do aplikacji i co 2 minuty, gdy jest otwarta,
- zmiany scalane są **rekord po rekordzie** – dla każdej pozycji, wpisu czy transakcji wygrywa nowsza zmiana, więc
  równoległa praca dwóch osób się nie nadpisuje. Usunięcia też są zmianami i nie „wracają”,
- tuż przed zapisem aplikacja sprawdza, czy ktoś w międzyczasie nie zapisał pliku; jeśli tak – najpierw go pobiera,
- właściciel pliku raz w miesiącu zapisuje obok kopię `budzet-domowy kopia RRRR-MM.json`; Dysk Google dodatkowo
  przechowuje historię wersji pliku,
- bez internetu aplikacja działa normalnie; zmiany wyślą się po powrocie sieci.

Pasek u góry pokazuje stan: „Zsynchronizowano o …”, „Synchronizuję…”, „Połącz z Dyskiem” (trzeba się zalogować),
„Podaj hasło” (dane zaszyfrowane) albo błąd z przyciskiem „Spróbuj ponownie”.

**Logowanie stałe.** Aplikacja korzysta z pośrednika logowania (Cloudflare Worker), więc po jednym zalogowaniu token
odnawia się sam. W Ustawieniach widać „✓ Logowanie stałe (przez Cloudflare)”. Jeśli jest tam „Logowanie na
godzinę”, stuknij „Zaloguj ponownie na stałe”.

**Wyloguj z Google** – wylogowuje na tym urządzeniu i unieważnia stałe logowanie; dane i połączenie z plikiem
zostają.

**Odłącz od Dysku** – dane zostają na urządzeniu, ale przestają się synchronizować.

## Bezpieczeństwo i prywatność

**Gdzie są dane.** W przeglądarce urządzenia (IndexedDB) i – jeśli połączysz – w pliku na Twoim Dysku Google.
Strona aplikacji i jej kod źródłowy nie zawierają żadnych danych; autor aplikacji nie ma do nich dostępu.

**Hasło do danych na Dysku** (Ustawienia). Po ustawieniu hasła plik na Dysku (i miesięczne kopie) jest szyfrowany
(AES-256-GCM, klucz z hasła przez PBKDF2-SHA-256, 600 tys. iteracji).

- Hasło wpisujesz **raz na każdym urządzeniu** – urządzenie zapamiętuje tylko klucz, nie hasło.
- Formularz współpracuje z menedżerami haseł (np. Bitdefender SecurePass) – można wkleić hasło lub użyć autouzupełniania.
- Druga osoba wpisuje to samo hasło raz u siebie (pasek „Podaj hasło”).
- **Zmień hasło** – nowe hasło; inne urządzenia poproszą o nie przy następnej synchronizacji.
- **Zapomnij na tym urządzeniu** – usuwa klucz z urządzenia.
- **Wyłącz szyfrowanie** – plik wraca do zwykłego JSON-a.
- **Hasła nie da się odzyskać.** Bez niego danych z Dysku nie da się odczytać – przechowuj je w menedżerze haseł.
- Jeśli pasek u góry napisze **„Plik na Dysku nie jest zaszyfrowany, a powinien”** – ktoś wyłączył szyfrowanie na
  innym urządzeniu albo plik na Dysku został podmieniony. Jeśli nie wyłączaliście szyfrowania, wybierz **Zostaw
  szyfrowanie** (plik zostanie nadpisany zaszyfrowanymi danymi z tego urządzenia) i zmień hasło do konta Google.
  **Wyłączyliśmy je celowo** wybierz tylko wtedy, gdy naprawdę tak było.
- Kopia wczytywana z pliku nie włącza ani nie wyłącza szyfrowania.
- Urządzenie, które nie zna hasła, nigdy nie zapisze pliku jawnym tekstem. Kopia pobierana w Ustawieniach jest
  jawnym JSON-em – trzymaj ją u siebie. Kopie miesięczne sprzed włączenia hasła usuń ręcznie z Dysku.

**Blokada Face ID / Touch ID** (Ustawienia) – po włączeniu aplikacja przy otwarciu i po powrocie wymaga
potwierdzenia biometrią urządzenia (zawsze po powrocie, po 1, 5 albo 15 minutach w tle). Działa osobno na każdym
urządzeniu. Chroni przed kimś, kto weźmie odblokowany telefon; nie szyfruje danych w przeglądarce. Wyłączenie wymaga
potwierdzenia biometrią. Jeśli odblokowanie nie działa, „Nie mogę odblokować – wyczyść to urządzenie” usuwa dane
z urządzenia (wspólne dane na Dysku zostają i wrócą po ponownym połączeniu).

**Ukryj kwoty** – na ekranie miesiąca i w Ustawieniach → Widok.

## Kopie, eksport i czyszczenie

**Pobierz kopię (JSON)** – cały budżet w jednym pliku.

**Wczytaj kopię**:

- **Scal z obecnymi** – dla każdego rekordu zostaje nowsza wersja; nic nie ginie.
- **Zastąp wszystko** – przywraca stan z pliku. Rekordy spoza kopii są usuwane, a przy wspólnych danych zmiana
  obejmuje też plik na Dysku i urządzenie drugiej osoby. Poprzednia wersja zostaje w historii wersji Dysku.

**Eksport do Excela** – dwa pliki CSV (średnik, przecinek dziesiętny, polskie znaki):

- **Pozycje miesiąc po miesiącu** – od stycznia 2024 do końca prognozy; wykonanie, a bez niego plan,
- **Transakcje z wyciągów** – data, kwota, kontrahent, pozycja (części podzielonych transakcji osobno), status,
  źródło, opis.

**Wyczyść dane na tym urządzeniu** – usuwa dane budżetu i zapamiętany klucz hasła z urządzenia i odłącza je od
Dysku; wspólny plik zostaje bez zmian. Zalogowanie Google i blokada Face ID zostają (wyłączysz je osobno).

## Najczęstsze pytania

**Zmiana z telefonu nie widać na laptopie.** Na laptopie stuknij „Odśwież” na pasku u góry albo wróć do aplikacji
(synchronizuje się przy powrocie). Sprawdź, czy oba urządzenia są połączone z tym samym plikiem (Ustawienia).

**„Połącz z Dyskiem” pojawia się co godzinę.** Wejdź w Ustawienia; jeśli jest „Logowanie na godzinę”, stuknij
„Zaloguj ponownie na stałe” i zaakceptuj zgodę Google.

**„Plik zapisała nowsza wersja aplikacji”.** Zamknij aplikację całkiem i otwórz ponownie (czasem dwa razy) –
wczyta się najnowsza wersja.

**Wybór pliku z Dysku pisze „Nie można uzyskać dostępu do konta Google … zezwól na dostęp do plików cookie”.**
Okno wyboru pliku to element Google, który potrzebuje ciasteczek spoza witryny, a Safari na iPhonie domyślnie je
blokuje. Wskazanie pliku robi się tylko raz i dotyczy konta Google (nie telefonu), więc: albo zrób to na komputerze
w Chrome lub Edge (zwykłe okno, nie incognito), albo na iPhonie tymczasowo wyłącz Ustawienia → Aplikacje → Safari →
Prywatność i bezpieczeństwo → „Zapobiegaj śledzeniu między witrynami”, wskaż plik i włącz z powrotem. Potem na
każdym urządzeniu tego konta plik pojawi się jako „Znaleziony plik budżetu” → „Połącz z tym plikiem”.

**Ekran „Coś poszło nie tak”.** Aplikacja trafiła na nieoczekiwany błąd. Dane są bezpieczne: „Otwórz ponownie”
uruchamia aplikację od nowa, „Pobierz kopię danych” zapisuje kopię JSON z urządzenia.

**„Dane na Dysku są zaszyfrowane”.** Podaj hasło do danych (to samo co na innych urządzeniach).

**Transakcja przypisała się źle.** W widoku miesiąca rozwiń pozycję → „Odepnij” (wraca do skrzynki) → przypisz
w Import → Skrzynka. Jeśli przypisała ją reguła, popraw lub usuń regułę w Import → Reguły importu.

**Kwota pozycji po imporcie jest inna niż plan.** Tak ma być – kwota rzeczywista zastępuje plan. Plan zostaje
zapisany (Plan a wykonanie).

**Chcę zmienić kwotę od przyszłego roku.** Karta pozycji → stuknij styczeń → „Od tego miesiąca” → nowa kwota.

**Płatność jest raz na kwartał / raz w roku.** Karta pozycji → miesiąc pierwszej płatności → „Od tego miesiąca” →
„co kwartał” / „raz w roku”.

**Kwoty różnią się w poszczególnych miesiącach co roku (np. gaz).** Karta pozycji → miesiąc, od którego ma
obowiązywać → „Jak w ost. 12 mies.”.

**Gdzie wpisać gotówkę?** Widok miesiąca → Wydatki → „+ Dodaj wydatek”.

**Odpowiedź bez internetu?** Aplikacja działa offline na danych z urządzenia; zmiany wyślą się po powrocie sieci.
