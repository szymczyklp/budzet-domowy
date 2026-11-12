import { useEffect, useState } from 'react';
import { useStore } from './lib/store';
import { setAmountsHidden } from './lib/format';
import MonthView from './views/MonthView';
import ForecastView from './views/ForecastView';
import PositionsView from './views/PositionsView';
import AccountsView from './views/AccountsView';
import SettingsView from './views/SettingsView';
import CategoriesView from './views/CategoriesView';
import EmergencyView from './views/EmergencyView';
import ImportView from './views/ImportView';
import PositionCardView from './views/PositionCardView';
import PlanActualView from './views/PlanActualView';
import AnalysisView from './views/AnalysisView';
import FirmView from './views/FirmView';
import HelpView from './views/HelpView';
import SyncBar from './sync/SyncBar';

const PAGES = ['miesiac', 'prognoza', 'pozycje', 'pozycja', 'plan', 'analiza', 'firma', 'import', 'wiecej', 'wypadek', 'konta', 'kategorie', 'ustawienia', 'pomoc'] as const;
type Tab = (typeof PAGES)[number];

/** Dolny pasek: pięć głównych miejsc; rzadziej używane strony są pod „Więcej”. */
const NAV: { id: Tab; label: string; group?: Tab[] }[] = [
  { id: 'miesiac', label: 'Miesiąc' },
  { id: 'pozycje', label: 'Pozycje', group: ['pozycje', 'pozycja'] },
  { id: 'import', label: 'Import' },
  { id: 'wiecej', label: 'Więcej', group: ['wiecej', 'prognoza', 'plan', 'analiza', 'firma', 'wypadek', 'konta', 'kategorie', 'ustawienia', 'pomoc'] },
];

const MORE: { id: Tab; label: string; hint: string }[] = [
  { id: 'prognoza', label: 'Prognoza', hint: 'Wynik miesiąc po miesiącu na 1–3 lata' },
  { id: 'plan', label: 'Plan a wykonanie', hint: 'Porównanie za miesiąc albo rok, pozycja po pozycji' },
  { id: 'analiza', label: 'Analiza', hint: 'Trendy kategorii, podsumowanie roku, majątek netto' },
  { id: 'firma', label: 'Firma', hint: 'Ryczałt, VAT i ZUS – plan podatków liczony z przychodów' },
  { id: 'wypadek', label: 'Na wypadek', hint: 'Ubezpieczenia, oszczędności, kontakty – dla bliskich' },
  { id: 'konta', label: 'Konta i karty', hint: 'Numery rachunków do przelewów' },
  { id: 'kategorie', label: 'Kategorie', hint: 'Nazwy, kolejność, usuwanie' },
  { id: 'ustawienia', label: 'Ustawienia', hint: 'Dysk Google, hasło, blokada, kopia zapasowa, imię' },
  { id: 'pomoc', label: 'Pomoc', hint: 'Podręcznik: jak działa każda funkcja' },
];

const fromHash = (): Tab => {
  const h = location.hash.slice(1).split('/')[0] as Tab;
  return PAGES.includes(h) ? h : 'miesiac';
};
const hashParam = () => decodeURIComponent(location.hash.slice(1).split('/')[1] ?? '');

function MoreView() {
  return (
    <>
      <header className="page-head"><h1>Więcej</h1></header>
      <ul className="plain-list">
        {MORE.map((m) => (
          <li key={m.id}>
            <a className="list-button link-row" href={`#${m.id}`}>
              <span className="name">{m.label}<small>{m.hint}</small></span>
              <span aria-hidden="true">›</span>
            </a>
          </li>
        ))}
      </ul>
    </>
  );
}

export default function App() {
  const { ready, doc } = useStore();
  const [tab, setTab] = useState<Tab>(fromHash);
  const [param, setParam] = useState(hashParam);
  const [hidden, setHidden] = useState(() => {
    let v = false;
    try { v = localStorage.getItem('hide-amounts') === '1'; } catch { /* brak */ }
    setAmountsHidden(v);
    return v;
  });

  // przełącznik „ukryj kwoty” – wywoływany zdarzeniem z dowolnego widoku
  useEffect(() => {
    const on = () =>
      setHidden((h) => {
        const v = !h;
        setAmountsHidden(v);
        try { localStorage.setItem('hide-amounts', v ? '1' : '0'); } catch { /* brak */ }
        return v;
      });
    addEventListener('toggle-amounts', on);
    return () => removeEventListener('toggle-amounts', on);
  }, []);

  useEffect(() => {
    const on = () => {
      setTab(fromHash());
      setParam(hashParam());
      window.scrollTo(0, 0);
    };
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);

  if (!ready) return <main className="page"><p className="muted">Wczytuję dane…</p></main>;

  const empty = Object.keys(doc.positions).length === 0;
  const worksWhenEmpty: Tab[] = ['pomoc', 'analiza', 'ustawienia', 'pozycje', 'wiecej', 'wypadek', 'kategorie', 'konta', 'import'];

  return (
    <>
      <main className={`page${hidden ? ' amounts-hidden' : ''}`} key={hidden ? 'h' : 'v'}>
        {tab !== 'ustawienia' && <SyncBar />}
        {empty && !worksWhenEmpty.includes(tab) ? (
          <section className="empty">
            <h1>Budżet jest pusty</h1>
            <p>Połącz się ze wspólnym plikiem na Dysku Google, wczytaj plik budzet.json przygotowany z arkusza albo dodaj pierwszą pozycję.</p>
            <p className="row-actions">
              <a className="button primary" href="#ustawienia">Połącz albo wczytaj plik</a>
              <a className="button" href="#pozycje">Dodaj pozycję</a>
            </p>
          </section>
        ) : (
          <>
            {tab === 'miesiac' && <MonthView />}
            {tab === 'prognoza' && <ForecastView />}
            {tab === 'pozycje' && <PositionsView />}
            {tab === 'pozycja' && <PositionCardView id={param} />}
            {tab === 'plan' && <PlanActualView />}
            {tab === 'analiza' && <AnalysisView param={param} />}
            {tab === 'firma' && <FirmView />}
            {tab === 'pomoc' && <HelpView topic={param} />}
            {tab === 'import' && <ImportView />}
            {tab === 'wiecej' && <MoreView />}
            {tab === 'wypadek' && <EmergencyView />}
            {tab === 'konta' && <AccountsView />}
            {tab === 'kategorie' && <CategoriesView />}
            {tab === 'ustawienia' && <SettingsView />}
          </>
        )}
      </main>
      <nav className="tabs" aria-label="Widoki">
        {NAV.map((t) => (
          <a key={t.id} href={`#${t.id}`} aria-current={(t.group ?? [t.id]).includes(tab) ? 'page' : undefined}>
            {t.label}
          </a>
        ))}
      </nav>
    </>
  );
}
