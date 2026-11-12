import { useMemo, useState } from 'react';
import { useStore } from '../lib/store';
import type { EmergencyItem, MonthKey, Section } from '../lib/types';
import { addMonths, currentMonth, forecastEnd, monthName, monthRange, monthShort } from '../lib/month';
import { money, moneyInput, parseMoney, today } from '../lib/format';
import { SECTIONS } from '../lib/sections';
import { categoryTrends, change, isAsset, isLiability, netWorthSeries, sum, valuePoints, withHistory, yearSummary } from '../lib/analysis';
import type { Series } from '../lib/analysis';
import { Money, Sheet } from '../ui';
import { HelpLink } from './HelpView';

type Tab = 'trendy' | 'rok' | 'majatek';
const TABS: { id: Tab; label: string }[] = [
  { id: 'trendy', label: 'Trendy' },
  { id: 'rok', label: 'Rok' },
  { id: 'majatek', label: 'Majątek' },
];

export default function AnalysisView({ param }: { param: string }) {
  const tab: Tab = TABS.some((t) => t.id === param) ? (param as Tab) : 'trendy';
  return (
    <>
      <header className="page-head">
        <h1>Analiza <HelpLink topic="prognoza-plan-a-wykonanie-i-analiza" /></h1>
        <div className="segmented" role="group" aria-label="Widok">
          {TABS.map((t) => (
            <button key={t.id} type="button" aria-pressed={tab === t.id} onClick={() => (location.hash = `analiza/${t.id}`)}>{t.label}</button>
          ))}
        </div>
      </header>
      {tab === 'trendy' && <Trends />}
      {tab === 'rok' && <Year />}
      {tab === 'majatek' && <NetWorth />}
    </>
  );
}

const pct = (v: number | null) => (v === null ? '—' : `${v > 0 ? '+' : ''}${v.toLocaleString('pl-PL', { maximumFractionDigits: 1 })}%`);

/** Słupki miesiąc po miesiącu; najedź / dotknij słupka, żeby zobaczyć kwotę. */
function Bars({ values, months, height = 34 }: { values: number[]; months: MonthKey[]; height?: number }) {
  const max = Math.max(1, ...values.map(Math.abs));
  const w = 100 / values.length;
  return (
    <svg className="bars" viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" role="img" aria-label="Kwoty w kolejnych miesiącach">
      {values.map((v, i) => {
        const h = Math.max(v === 0 ? 0 : 1.5, (Math.abs(v) / max) * (height - 2));
        return (
          <g key={months[i]}>
            <rect x={i * w} y={0} width={w} height={height} fill="transparent">
              <title>{`${monthShort(months[i])}: ${money(v)} zł`}</title>
            </rect>
            <rect className={v < 0 ? 'vbar out' : 'vbar in'} x={i * w + w * 0.15} y={height - h} width={w * 0.7} height={h} rx={0.8}>
              <title>{`${monthShort(months[i])}: ${money(v)} zł`}</title>
            </rect>
          </g>
        );
      })}
    </svg>
  );
}

/* ---------- trendy ---------- */

function Trends() {
  const { doc } = useStore();
  const now = currentMonth();
  // 24 zamknięte miesiące: ostatnie 12 i 12 wcześniejszych do porównania
  const months = useMemo(() => monthRange(addMonths(now, -24), 24), [now]);
  const trends = useMemo(() => categoryTrends(doc, months, now), [doc, months, now]);
  const last = months.slice(12);
  const split = (s: Series) => ({ cur: sum(s.values.slice(12)), prev: sum(s.values.slice(0, 12)), last: s.values.slice(12) });

  const risers = useMemo(() => trends
    .flatMap((c) => c.positions)
    .filter((p) => p.section !== 'przychody')
    .map((p) => ({ p, ...split(p) }))
    .filter((x) => x.cur < 0 && x.cur < x.prev - 100)
    .sort((a, b) => (a.cur - a.prev) - (b.cur - b.prev))
    .slice(0, 5), [trends]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <p className="muted small-text">
        Ostatnie 12 pełnych miesięcy ({monthShort(last[0])} – {monthShort(last[11])}) w porównaniu z 12 wcześniejszymi.
        Tam, gdzie nie ma kwoty rzeczywistej, liczy się plan.
      </p>
      {risers.length > 0 && (
        <section className="panel">
          <h2>Najbardziej wzrosły</h2>
          <ul className="plain-list">
            {risers.map(({ p, cur, prev }) => (
              <li key={p.id} className="detail-row">
                <a href={`#pozycja/${p.id}`}>{p.name}</a>
                <span className="small-text"><b>{money(cur - prev)} zł</b> / rok ({pct(change(cur, prev))})</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {SECTIONS.map((sec) => {
        const cats = trends.filter((c) => c.section === sec.id);
        if (cats.length === 0) return null;
        return (
          <section className="group" key={sec.id}>
            <h2><span>{sec.title}</span></h2>
            <ul className="plain-list trend-list">
              {cats.map((c) => {
                const { cur, prev } = split(c);
                return (
                  <li key={c.id}>
                    <details>
                      <summary className="trend-row">
                        <span className="name">{c.name}<small>średnio {money(cur / 12)} zł / mies.</small></span>
                        <Bars values={c.values.slice(12)} months={last} />
                        <span className="trend-num"><Money value={cur} /><small>{pct(change(cur, prev))} r/r</small></span>
                      </summary>
                      <ul className="plain-list trend-positions">
                        {c.positions.map((p) => {
                          const s = split(p);
                          return (
                            <li key={p.id} className="trend-row">
                              <a className="name" href={`#pozycja/${p.id}`}>{p.name}</a>
                              <Bars values={s.last} months={last} height={24} />
                              <span className="trend-num"><Money value={s.cur} /><small>{pct(change(s.cur, s.prev))}</small></span>
                            </li>
                          );
                        })}
                      </ul>
                      <div className="table-wrap">
                        <table className="forecast">
                          <thead><tr><th>Miesiąc</th><th>Kwota</th><th>Rok wcześniej</th><th>Zmiana</th></tr></thead>
                          <tbody>
                            {last.map((m, i) => (
                              <tr key={m}>
                                <th scope="row">{monthShort(m)}</th>
                                <td>{money(c.values[12 + i])}</td>
                                <td>{money(c.values[i])}</td>
                                <td>{pct(change(c.values[12 + i], c.values[i]))}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </details>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </>
  );
}

/* ---------- podsumowanie roku ---------- */

function Year() {
  const { doc } = useStore();
  const now = currentMonth();
  const years = useMemo(() => {
    const first = Object.values(doc.positions).filter((p) => !p.deleted).map((p) => p.activeFrom).sort()[0] ?? now;
    const out: string[] = [];
    for (let y = Number(forecastEnd(now).slice(0, 4)); y >= Math.max(2020, Number(first.slice(0, 4))); y--) out.push(String(y));
    return out;
  }, [doc.positions, now]);
  const [year, setYear] = useState(now.slice(0, 4));
  const s = useMemo(() => yearSummary(doc, year, now), [doc, year, now]);
  const p = useMemo(() => yearSummary(doc, String(Number(year) - 1), now), [doc, year, now]);
  const total = (k: Section) => sum(s.bySection[k]);
  const totalPrev = (k: Section) => sum(p.bySection[k]);

  return (
    <>
      <div className="filters">
        <select value={year} onChange={(e) => setYear(e.target.value)} aria-label="Rok">
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <span className="muted small-text">
          {s.closed === 12 ? 'Rok zamknięty – kwoty rzeczywiste.' : s.closed === 0 ? 'Cały rok to prognoza.' : `${s.closed} mies. rzeczywistych, ${12 - s.closed} z prognozy.`}
        </span>
      </div>
      <section className="panel year-tiles">
        {SECTIONS.map((sec) => (
          <div key={sec.id} className="tile">
            <span className="muted small-text">{sec.title}</span>
            <Money value={total(sec.id)} strong />
            <small className="muted">{pct(change(total(sec.id), totalPrev(sec.id)))} vs {Number(year) - 1}</small>
          </div>
        ))}
        <div className="tile total">
          <span className="muted small-text">Wynik roku</span>
          <Money value={sum(s.net)} strong />
          <small className="muted">{Number(year) - 1}: {money(sum(p.net))} zł</small>
        </div>
      </section>

      <div className="table-wrap">
        <table className="forecast">
          <thead><tr><th>Miesiąc</th><th className="wide-only">Przychody</th><th className="wide-only">Opłaty</th><th className="wide-only">Wydatki</th><th>Wynik</th><th>Narastająco</th></tr></thead>
          <tbody>
            {s.months.map((m, i) => {
              const running = sum(s.net.slice(0, i + 1));
              return (
                <tr key={m} className={i >= s.closed ? 'forecasted' : undefined}>
                  <th scope="row">{monthName(m).slice(0, 3)}{i >= s.closed && <small> prognoza</small>}</th>
                  <td className="wide-only">{money(s.bySection.przychody[i])}</td>
                  <td className="wide-only">{money(s.bySection.firmowe[i] + s.bySection.prywatne[i])}</td>
                  <td className="wide-only">{money(s.bySection.wydatki[i])}</td>
                  <td className={s.net[i] < 0 ? 'out' : 'in'}>{money(s.net[i])}</td>
                  <td>{money(running)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {s.top.length > 0 && (
        <section className="group">
          <h2><span>Największe koszty w {year}</span></h2>
          <ol className="top-list">
            {s.top.map((t) => (
              <li key={t.id} className="detail-row">
                <a href={`#pozycja/${t.id}`}>{t.name}</a>
                <Money value={t.amount} />
              </li>
            ))}
          </ol>
        </section>
      )}
    </>
  );
}

/* ---------- majątek netto ---------- */

function NetWorth() {
  const { doc, update } = useStore();
  const now = currentMonth();
  const items = Object.values(doc.emergency).filter((e) => !e.deleted && (isAsset(e) || isLiability(e))).sort((a, b) => a.order - b.order);
  const series = useMemo(() => netWorthSeries(doc, now), [doc, now]);
  const [editing, setEditing] = useState(false);
  const assets = items.filter(isAsset).reduce((s, e) => s + (e.value ?? 0), 0);
  const liabilities = items.filter(isLiability).reduce((s, e) => s + (e.value ?? 0), 0);

  if (items.length === 0) {
    return (
      <section className="panel">
        <p>Majątek netto liczy się z oszczędności i zobowiązań wpisanych w „Na wypadek” (lokaty, IKE, konta oszczędnościowe, kredyty).</p>
        <a className="button primary" href="#wypadek">Przejdź do „Na wypadek”</a>
      </section>
    );
  }

  return (
    <>
      <section className="panel year-tiles">
        <div className="tile"><span className="muted small-text">Oszczędności</span><Money value={assets} strong /></div>
        <div className="tile"><span className="muted small-text">Zobowiązania</span><Money value={-liabilities} strong /></div>
        <div className="tile total"><span className="muted small-text">Majątek netto</span><Money value={assets - liabilities} strong /></div>
      </section>

      {series.length > 1 && (
        <section className="group">
          <h2><span>Majątek netto – koniec miesiąca</span></h2>
          <Bars values={series.map((x) => x.net)} months={series.map((x) => x.month)} height={60} />
          <p className="detail-row small-text">
            <span>{monthShort(series[0].month)}: <b>{money(series[0].net)} zł</b></span>
            <span>{monthShort(series.at(-1)!.month)}: <b>{money(series.at(-1)!.net)} zł</b> ({series.at(-1)!.net - series[0].net >= 0 ? '+' : ''}{money(series.at(-1)!.net - series[0].net)})</span>
          </p>
          <p className="muted small-text">Ostatnia znana kwota każdego wpisu w danym miesiącu. Aktualizuj stany co jakiś czas, żeby wykres był dokładny.</p>
        </section>
      )}

      <section className="group">
        <h2>
          <span>Stany</span>
          <button type="button" className="small primary" onClick={() => setEditing(true)}>Zaktualizuj stany</button>
        </h2>
        <ul className="plain-list">
          {items.map((e) => {
            const pts = valuePoints(e);
            const prev = pts.at(-2);
            return (
              <li key={e.id} className="worth-row">
                <span className="name">
                  {e.name}
                  <small>{[e.institution, e.valueDate && `stan na ${e.valueDate}`, prev && `wcześniej ${money(prev.value)}`].filter(Boolean).join(' · ')}</small>
                </span>
                <Money value={isLiability(e) ? -(e.value ?? 0) : e.value ?? 0} />
              </li>
            );
          })}
        </ul>
      </section>
      {editing && <UpdateValues items={items} onClose={() => setEditing(false)} save={(changes, date) => {
        update((d, stamp) => {
          const emergency = { ...d.emergency };
          for (const [id, v] of changes) emergency[id] = { ...withHistory(emergency[id], date, v), ...stamp() };
          return { ...d, emergency };
        });
        setEditing(false);
      }} />}
    </>
  );
}

function UpdateValues({ items, onClose, save }: { items: EmergencyItem[]; onClose: () => void; save: (changes: [string, number][], date: string) => void }) {
  const [date, setDate] = useState(today());
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries(items.map((e) => [e.id, e.value !== undefined ? moneyInput(e.value) : ''])));
  const [error, setError] = useState('');
  const submit = () => {
    const changes: [string, number][] = [];
    for (const e of items) {
      const raw = vals[e.id]?.trim();
      if (!raw) continue;
      const v = parseMoney(raw);
      if (v === null) return setError(`Popraw kwotę przy „${e.name}”.`);
      if (Math.abs(v) !== e.value || date !== e.valueDate) changes.push([e.id, Math.abs(v)]);
    }
    save(changes, date);
  };
  return (
    <Sheet title="Zaktualizuj stany" onClose={onClose}>
      <label className="field"><span className="field-label">Data</span><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
      {items.map((e) => (
        <label key={e.id} className="field">
          <span className="field-label">{e.name}{isLiability(e) ? ' (do spłaty)' : ''}</span>
          <input inputMode="decimal" value={vals[e.id] ?? ''} onChange={(ev) => setVals((x) => ({ ...x, [e.id]: ev.target.value }))} />
        </label>
      ))}
      {error && <p className="error">{error}</p>}
      <p className="row-actions">
        <button type="button" className="primary" onClick={submit}>Zapisz</button>
        <button type="button" onClick={onClose}>Anuluj</button>
      </p>
    </Sheet>
  );
}
