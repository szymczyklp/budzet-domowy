/**
 * Model danych budżetu – to jest dokładnie format pliku budzet.json.
 *
 * Zasady:
 * - Kwoty są ze znakiem: dodatnie = wpływ, ujemne = wydatek (tak jak w arkuszu).
 * - Miesiące zapisujemy jako tekst "RRRR-MM" (np. "2026-11").
 * - Każdy rekord ma updatedAt/updatedBy, a usunięcie to deleted: true
 *   (tzw. tombstone). Dzięki temu dwie osoby mogą edytować dane na różnych
 *   urządzeniach, a przy synchronizacji scalamy rekord po rekordzie
 *   (wygrywa nowsza zmiana) zamiast nadpisywać cały plik.
 */

export type MonthKey = string; // "RRRR-MM"

export interface Meta {
  updatedAt: string; // ISO 8601
  updatedBy: string; // np. e-mail albo imię
  deleted?: boolean;
}

/** Sekcja budżetu: przychody, opłaty do odhaczenia (firmowe / prywatne) albo wydatki liczone z transakcji. */
export type Section = 'przychody' | 'firmowe' | 'prywatne' | 'wydatki';

export interface Category extends Meta {
  id: string;
  name: string;
  order: number;
  /** Brak = wyliczana z nazwy kategorii (sectionOf). */
  section?: Section;
}

export type AccountKind = 'konto' | 'karta' | 'inne';

export interface Account extends Meta {
  id: string;
  name: string;
  kind: AccountKind;
  bank?: string;
  /** Numer rachunku do przelewu (IBAN / NRB). */
  number?: string;
  /** Dla kart kredytowych: dzień spłaty w miesiącu. */
  dueDay?: number;
  note?: string;
}

/**
 * Reguła kwoty: od miesiąca `from` pozycja ma kwotę `amount`,
 * aż do następnej reguły. `everyMonths` > 1 oznacza płatność
 * co N miesięcy (licząc od `from`), np. 12 = raz w roku.
 */
export interface AmountRule {
  from: MonthKey;
  amount: number;
  /** Płatność co N miesięcy (licząc od `from`), np. 2 = co drugi miesiąc. */
  everyMonths?: number;
  /** Ostatni miesiąc tej kwoty (np. koniec spłaty); później 0 – aż do następnej reguły. */
  until?: MonthKey;
  /**
   * Sezonowość: 12 kwot dla kolejnych miesięcy kalendarza (styczeń…grudzień),
   * powtarzanych co roku od `from`. Gdy jest – zastępuje `amount` i `everyMonths`.
   */
  pattern?: number[];
  /** Coroczna zmiana kwoty w % (np. 5 = +5% od każdego kolejnego stycznia). */
  indexation?: number;
}

export interface Position extends Meta {
  id: string;
  name: string;
  categoryId: string;
  accountId?: string;
  /** Dzień płatności w miesiącu (1–31). */
  day?: number;
  /** Numer umowy, polisy itp. */
  reference?: string;
  note?: string;
  /** Pierwszy i ostatni miesiąc obowiązywania (activeTo puste = bezterminowo). */
  activeFrom: MonthKey;
  activeTo?: MonthKey;
  rules: AmountRule[];
  /** Plan zmieniony tylko dla pojedynczych miesięcy (ma pierwszeństwo przed regułami). */
  monthly?: Record<MonthKey, number>;
  /**
   * Budżet zbiorczy (np. spożywka, paliwo): kwota rzeczywista to suma wielu
   * transakcji z wyciągów, a import nie oznacza pozycji jako rozliczonej.
   */
  envelope?: boolean;
  /** Spłata karty kredytowej – karta to accountId; pokazywana w bloku „Karty kredytowe do spłaty”. */
  cardRepayment?: boolean;
  /** Kto płaci i zaznacza (imię jak w Ustawieniach); brak = wspólne. */
  payer?: string;
  /**
   * Koszt firmowy z VAT do odliczenia: kwota pozycji jest brutto, `rate` to stawka VAT (np. 23),
   * `deductible` – jaka część VAT jest odliczana w % (100, a np. 50 przy samochodzie użytku mieszanego).
   */
  vat?: { rate: number; deductible: number };
  /** Kredyt / pożyczka: plan od `loan.from` liczy się z harmonogramu rat. */
  loan?: LoanPlan;
}

export interface LoanPlan {
  /** Miesiąc pierwszej raty liczonej z harmonogramu. */
  from: MonthKey;
  /** Kapitał do spłaty przed ratą z miesiąca `from`. */
  balance: number;
  /** Oprocentowanie roczne w % (np. 7,25). */
  rate: number;
  /** Liczba rat pozostałych od `from`. */
  months: number;
  kind: 'rowne' | 'malejace';
  /** Nadpłaty: skracają okres albo zmniejszają ratę. */
  overpayments?: { month: MonthKey; amount: number; mode: 'okres' | 'rata' }[];
  /** Stała opłata doliczana do raty (np. ubezpieczenie). */
  fee?: number;
}

/**
 * Wykonanie pozycji w konkretnym miesiącu. Klucz w mapie entries
 * to `${positionId}|${month}`.
 */
export interface Entry extends Meta {
  positionId: string;
  month: MonthKey;
  /** Kwota rzeczywista; jeśli brak – obowiązuje plan z reguł. */
  amount?: number;
  paid: boolean;
  paidAt?: string; // RRRR-MM-DD
  note?: string;
}

/* ---------- import wyciągów ---------- */

export type TxnSource = 'pko-konto' | 'pko-karta' | 'millennium' | 'revolut' | 'mbank' | 'csv' | 'reczny';

/** Transakcja z wyciągu bankowego. Klucz w mapie transactions to `id`. */
export interface Txn extends Meta {
  id: string;
  source: TxnSource;
  date: string; // RRRR-MM-DD
  month: MonthKey;
  amount: number;
  /** Kontrahent / sklep – do wyświetlania. */
  counterparty: string;
  /** Pełny opis (typ, tytuł, kontrahent) – do dopasowania reguł. */
  text: string;
  /** Przypisana pozycja albo pominięta transakcja (np. przelew własny). */
  positionId?: string;
  ignored?: boolean;
  /** Karta / konto, z którego pochodzi wyciąg (np. wyciąg karty kredytowej). */
  accountId?: string;
  /** Podział jednej transakcji na kilka pozycji (suma części = kwota transakcji). */
  splits?: { positionId: string; amount: number }[];
}

/** Reguła importu: opis transakcji zawiera `pattern` → pozycja albo pominięcie. */
export interface ImportRule extends Meta {
  id: string;
  pattern: string;
  positionId?: string;
  ignore?: boolean;
}

/* ---------- na wypadek ---------- */

export type EmergencyKind = 'ubezpieczenie' | 'oszczednosci' | 'zobowiazanie' | 'kontakt' | 'instrukcja';

export interface EmergencyItem extends Meta {
  id: string;
  kind: EmergencyKind;
  name: string;
  /** Bank, ubezpieczyciel, instytucja. */
  institution?: string;
  /** Rodzaj: lokata, IKE, konto oszczędnościowe, polisa na życie… */
  type?: string;
  /** Numer polisy / rachunku / umowy. */
  number?: string;
  /** Czyje to jest / kto jest ubezpieczony. */
  owner?: string;
  /** Kwota: saldo, suma ubezpieczenia, pozostało do spłaty. */
  value?: number;
  valueDate?: string; // RRRR-MM-DD
  /** Uposażony / dyspozycja na wypadek śmierci. */
  beneficiary?: string;
  /** Telefon, e-mail, adres. */
  contact?: string;
  /** Jak uzyskać dostęp, gdzie są dokumenty. */
  access?: string;
  note?: string;
  order: number;
  /** Pozycja budżetu, z której wpis powstał (polisa, kredyt). */
  positionId?: string;
  /** Historia kwoty (saldo / do spłaty) – do wykresu majątku netto. */
  history?: { date: string; value: number }[];
}

/** Ustawienia wspólne dla obu osób (jeden rekord o id „main”). */
export interface Settings extends Meta {
  id: string;
  /** Tolerancja dopasowania po kwocie przy imporcie, w % (domyślnie 1%). */
  amountTolerance?: number;
  /** Moduł firmowy. */
  firm?: FirmSettings;
  /** Zapamiętane mapowania kolumn dla nierozpoznanych plików CSV (klucz: nagłówek). */
  csvMappings?: Record<string, CsvMapping>;
  /** Wykryte stałe płatności odrzucone przez użytkownika (klucze grup). */
  dismissedRecurring?: string[];
  /** Plik na Dysku szyfrowany hasłem (sól i liczba iteracji PBKDF2; samo hasło nie jest zapisywane). */
  encryption?: { salt: string; iterations: number };
}

export interface CsvMapping {
  date: number;
  amount: number;
  /** Kolumny opisu (łączone). */
  text: number[];
  /** Kolumna kontrahenta (opcjonalnie). */
  counterparty?: number;
  /** Wiersz nagłówka (0 = pierwszy). */
  headerRow: number;
  /** Kwoty wydatków są dodatnie (trzeba odwrócić znak). */
  invert?: boolean;
}

export interface FirmSettings {
  /** Od tego miesiąca plan podatków i składek liczy się automatycznie (wcześniej zostaje historia i reguły). */
  from: MonthKey;
  /** Stawka VAT od przychodu w % (np. 23); VAT rozliczany miesięcznie. */
  vatRate: number;
  /** Pozycje przychodu z faktur (kwoty netto), każda ze swoją stawką ryczałtu – np. 12% i 15% w osobnych liniach. */
  incomes: { positionId: string; lumpRate: number }[];
  /** Pozycja „VAT od klienta” (wpływ) – plan = netto × stawka VAT. */
  vatIncomePositionId?: string;
  /** Pozycje wyliczane: VAT do zapłaty, zaliczka ryczałtu, składki ZUS (społeczne + zdrowotna). */
  vatPositionId?: string;
  pitPositionId?: string;
  zusPositionId?: string;
  /** Miesięczne składki społeczne ZUS (odliczane od przychodu przy ryczałcie). */
  socialZus: number;
  /** Podatki i składki za miesiąc płacone w następnym miesiącu budżetu (domyślnie w tym samym). */
  lag?: 0 | 1;
}

export interface BudgetDoc {
  /** 3 – od wersji z ustawieniami, podziałem transakcji i historią majątku; starsza aplikacja odmówi zapisu takiego pliku. */
  schema: 3;
  categories: Record<string, Category>;
  accounts: Record<string, Account>;
  positions: Record<string, Position>;
  entries: Record<string, Entry>;
  transactions: Record<string, Txn>;
  rules: Record<string, ImportRule>;
  emergency: Record<string, EmergencyItem>;
  settings: Record<string, Settings>;
}

export const COLLECTIONS = [
  'categories', 'accounts', 'positions', 'entries', 'transactions', 'rules', 'emergency', 'settings',
] as const;
export type Collection = (typeof COLLECTIONS)[number];

export const entryKey = (positionId: string, month: MonthKey) => `${positionId}|${month}`;

export const emptyDoc = (): BudgetDoc => ({
  schema: 3,
  categories: {},
  accounts: {},
  positions: {},
  entries: {},
  transactions: {},
  rules: {},
  emergency: {},
  settings: {},
});

/** Uzupełnia brakujące kolekcje (pliki zapisane przez starszą wersję) i podnosi schemat. */
export const normalizeDoc = (d: Omit<Partial<BudgetDoc>, 'schema'> & { schema?: number }): BudgetDoc => {
  const out = { ...emptyDoc() } as BudgetDoc;
  // kopiujemy wszystkie kolekcje – także nieznane tej wersji (z nowszej aplikacji), żeby ich nie zgubić
  for (const [k, v] of Object.entries(d as Record<string, unknown>)) {
    if (k === 'schema' || k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      // kopiujemy tylko własne, bezpieczne klucze rekordów (plik z zewnątrz nie może podmienić prototypu)
      const clean: Record<string, unknown> = {};
      for (const [id, rec] of Object.entries(v as Record<string, unknown>)) {
        if (id !== '__proto__' && id !== 'constructor' && id !== 'prototype' && rec && typeof rec === 'object') clean[id] = rec;
      }
      (out as unknown as Record<string, unknown>)[k] = clean;
    }
  }
  return out;
};
