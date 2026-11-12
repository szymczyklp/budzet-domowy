import { useMemo, useState } from 'react';
import { useStore } from '../lib/store';
import type { AmountRule, MonthKey, Position } from '../lib/types';
import { entryKey } from '../lib/types';
import { addMonths, currentMonth, forecastEnd, isMonthKey, monthGenitive, monthName, monthShort, monthsBetween } from '../lib/month';
import { linesForMonth, ruleFor } from '../lib/projection';
import { firmRole, planFor } from '../lib/firm';
import LoanPanel from './LoanPanel';
import { money, moneyInput, parseMoney } from '../lib/format';
import { isExpense, sectionOf, sectionTitle, sortedCategories } from '../lib/sections';
import { Field, Money, Sheet } from '../ui';
import { PositionForm } from './PositionsView';
import { describeRule } from '../lib/rules';
import { HelpLink } from './HelpView';

/** Historia przed tą datą nie jest pokazywana. */
const HISTORY_FROM: MonthKey = '2024-01';

interface Row {
  month: MonthKey;
  planned: number;
  /** Rzeczywista kwota (wpis / suma wydatków) albo undefined, gdy brak danych. */
  actual?: number;
  paid: boolean;
  /** Plan zmieniony tylko dla tego miesiąca. */
  single: boolean;
  /** Od tego miesiąca obowiązuje nowa reguła kwoty. */
  ruleStart: boolean;
}

export default function PositionCardView({ id }: { id: string }) {
  const { doc } = useStore();
  const p = doc.positions[id];
  const [edit, setEdit] = useState(false);
  const [cell, setCell] = useState<Row | null>(null);
  const now = currentMonth();

  const rows = useMemo<Row[]>(() => {
    if (!p) return [];
    const start = p.activeFrom > HISTORY_FROM ? p.activeFrom : HISTORY_FROM;
    const futureEnd = forecastEnd(now);
    const end = p.activeTo && p.activeTo < futureEnd ? p.activeTo : futureEnd;
    const expense = isExpense(doc, p);
    return monthsBetween(start, end).map((m) => {
      const e = doc.entries[entryKey(p.id, m)];
      const live = e && !e.deleted ? e : undefined;
      const line = linesForMonth({ ...doc, positions: { [p.id]: p } }, m).find((l) => l.position.id === p.id);
      return {
        month: m,
        planned: planFor(doc, p, m),
        actual: expense ? (line?.spent || live?.amount) : live?.amount ?? (live?.paid ? planFor(doc, p, m) : undefined),
        paid: !!live?.paid,
        single: p.monthly?.[m] !== undefined,
        ruleStart: p.rules.some((r) => r.from === m),
      };
    });
  }, [doc, p, now]);

  if (!p || p.deleted) {
    return (
      <>
        <p className="muted">Nie ma takiej pozycji.</p>
        <a className="button" href="#pozycje">Wróć do pozycji</a>
      </>
    );
  }

  const cat = doc.categories[p.categoryId];
  const account = doc.accounts[p.accountId ?? ''];
  const expense = isExpense(doc, p);
  const years = [...new Set(rows.map((r) => r.month.slice(0, 4)))];
  const past12 = rows.filter((r) => r.month < now && r.month >= addMonths(now, -12) && r.actual !== undefined);
  const avg12 = past12.length ? past12.reduce((s, r) => s + (r.actual ?? 0), 0) / past12.length : undefined;
  const maxAbs = Math.max(1, ...rows.map((r) => Math.abs(r.actual ?? r.planned)));
  const r = ruleFor(p, now);

  return (
    <>
      <p className="crumbs"><a href="#pozycje">‹ Pozycje</a></p>
      <header className="page-head">
        <h1>{p.name} <HelpLink topic="karta-pozycji" /></h1>
        <p className="muted small-text">
          {cat?.name} · {sectionTitle(sectionOf(cat))}
          {account ? ` · ${account.name}` : ''}
          {p.payer ? ` · płaci ${p.payer}` : ''}
          {p.day ? ` · ${p.day}. dnia` : ''}
          {p.activeTo ? ` · do ${p.activeTo}` : ''}
        </p>
        <dl className="card-stats">
          <div><dt>Plan w tym miesiącu</dt><dd>{money(planFor(doc, p, now))}{r ? <small>{describeRule(r).replace(/^od [^:]+: /, '')}</small> : null}</dd></div>
          <div><dt>Średnio 12 mies.</dt><dd>{avg12 !== undefined ? money(avg12) : '–'}</dd></div>
        </dl>
        <p className="row-actions">
          <button type="button" onClick={() => setEdit(true)}>Edytuj pozycję</button>
        </p>
        <PlanRules position={p} />
        {firmRole(doc, p.id) && (
          <p className="note small-text">
            Plan od {doc.settings.main!.firm!.from} wylicza moduł firmy ({{ vat: 'VAT do zapłaty', pit: 'zaliczka ryczałtu', zus: 'składki ZUS', vatIncome: 'VAT od klienta' }[firmRole(doc, p.id)!]}).{' '}
            <a href="#firma">Ustawienia firmy ›</a>
          </p>
        )}
        <p className="muted small-text">
          Kwoty zrealizowane (✓) zastępują plan; przyszłe miesiące pokazują plan. Stuknij miesiąc, żeby zmienić plan
          (tylko ten miesiąc albo od niego dalej){expense ? '' : ' lub wpisać kwotę rzeczywistą'}. Historia od stycznia 2024.
        </p>
      </header>

      {(p.loan || /KREDYT|POŻYCZ|POZYCZ|HIPOTE|RATY/i.test(`${cat?.name} ${p.name}`)) && <LoanPanel position={p} />}

      {years.map((y) => {
        const yr = rows.filter((x) => x.month.startsWith(y));
        // wykonanie zastępuje plan; plan zostaje zapisany, ale go nie pokazujemy
        const value = (x: Row) => x.actual ?? x.planned;
        const sum = yr.reduce((acc, x) => acc + value(x), 0);
        return (
          <section className="group" key={y}>
            <h2>
              <span>{y}</span>
              <Money value={sum} />
            </h2>
            <table className="card-table">
              <tbody>
                {yr.map((x) => {
                  const done = x.actual !== undefined;
                  const v = value(x);
                  return (
                    <tr key={x.month} className={`${x.month === now ? 'now' : ''}${done ? ' done' : ' planned'}`} onClick={() => setCell(x)}>
                      <th scope="row">
                        {monthName(x.month)}
                        {x.ruleStart && <span className="mark" title="Od tego miesiąca nowa kwota planu">●</span>}
                      </th>
                      <td className={!done && x.single ? 'single' : ''}>
                        {v !== 0 && <span className={`cell-bar${done ? ' actual' : ''}`} style={{ width: `${(Math.abs(v) / maxAbs) * 100}%` }} aria-hidden="true" />}
                        <span className="cell-val">
                          {v !== 0 || done ? money(v) : '–'}
                          {done ? (x.paid && !expense ? <span className="tick" aria-label="zaznaczone"> ✓</span> : null) : v !== 0 ? <small className="plan-tag"> plan</small> : null}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        );
      })}

      {edit && <PositionForm initial={p} categories={sortedCategories(doc)} onClose={() => setEdit(false)} />}
      {cell && <MonthEditor position={p} row={cell} expense={expense} onClose={() => setCell(null)} />}
    </>
  );
}

const SHORT = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];

/** Harmonogram planu pozycji: reguły od najnowszej, z możliwością usunięcia. */
function PlanRules({ position: p }: { position: Position }) {
  const { savePosition } = useStore();
  const singles = Object.entries(p.monthly ?? {}).sort(([a], [b]) => a.localeCompare(b));
  if (p.rules.length === 0 && singles.length === 0) return null;
  return (
    <details className="plan-rules">
      <summary>Harmonogram planu ({p.rules.length + singles.length})</summary>
      <ul className="plain-list">
        {[...p.rules].sort((a, b) => b.from.localeCompare(a.from)).map((r) => (
          <li key={r.from} className="detail-row small-text">
            <span>{describeRule(r)}</span>
            <button
              type="button"
              className="small ghost"
              onClick={() => confirm(`Usunąć regułę „${describeRule(r)}”?`) && savePosition({ ...p, rules: p.rules.filter((x) => x.from !== r.from) })}
            >
              Usuń
            </button>
          </li>
        ))}
        {singles.map(([m, v]) => (
          <li key={m} className="detail-row small-text">
            <span>tylko {monthShort(m)}: {money(v)}</span>
            <button
              type="button"
              className="small ghost"
              onClick={() => {
                const monthly = { ...(p.monthly ?? {}) };
                delete monthly[m];
                savePosition({ ...p, monthly: Object.keys(monthly).length ? monthly : undefined });
              }}
            >
              Usuń
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}

type Scope = 'one' | 'from' | 'season';

function MonthEditor({ position: p, row, expense, onClose }: { position: Position; row: Row; expense: boolean; onClose: () => void }) {
  const { doc, savePosition, setActualAmount, togglePaid } = useStore();
  const now = currentMonth();
  const current = ruleFor(p, row.month);
  const [plan, setPlan] = useState(moneyInput(row.planned));
  const [scope, setScope] = useState<Scope>('one');
  const [every, setEvery] = useState(String(current?.everyMonths ?? 1));
  const [until, setUntil] = useState('');
  const [indexation, setIndexation] = useState(current?.indexation ? String(current.indexation).replace('.', ',') : '');
  const [actual, setActual] = useState(row.actual !== undefined && !expense ? moneyInput(row.actual) : '');
  const [error, setError] = useState('');

  /** Schemat sezonowy: kwoty z 12 miesięcy przed wybranym miesiącem (wykonanie, a bez niego plan). */
  const season = useMemo(() => {
    const months = monthsBetween(addMonths(row.month, -12), addMonths(row.month, -1));
    const pattern = new Array(12).fill(0) as number[];
    for (const m of months) {
      const e = doc.entries[entryKey(p.id, m)];
      const v = e && !e.deleted && e.amount !== undefined ? e.amount : planFor(doc, p, m);
      pattern[Number(m.slice(5, 7)) - 1] = Math.round(v * 100) / 100;
    }
    return pattern;
  }, [doc, p, row.month]);

  const cleanSinglesFrom = (m: MonthKey) => {
    const monthly = Object.fromEntries(Object.entries(p.monthly ?? {}).filter(([x]) => x < m));
    return Object.keys(monthly).length ? monthly : undefined;
  };

  const savePlan = () => {
    if (!isMonthKey(row.month)) return;
    const activeFrom = row.month < p.activeFrom ? row.month : p.activeFrom;
    if (scope === 'season') {
      if (until && (!isMonthKey(until) || until < row.month)) return setError('„Do miesiąca” musi mieć format RRRR-MM i nie może być wcześniej niż ten miesiąc.');
      const ixs = indexation.trim() ? Number(indexation.replace(',', '.')) : 0;
      const rule: AmountRule = { from: row.month, amount: 0, pattern: season, ...(until ? { until } : {}), ...(ixs && !Number.isNaN(ixs) ? { indexation: ixs } : {}) };
      savePosition({ ...p, rules: [...p.rules.filter((r) => r.from !== row.month), rule].sort((a, b) => a.from.localeCompare(b.from)), monthly: cleanSinglesFrom(row.month), activeFrom });
      return onClose();
    }
    const v = parseMoney(plan);
    if (v === null) return setError('Plan: wpisz liczbę, wydatki z minusem (np. -350,00).');
    if (scope === 'one') {
      savePosition({ ...p, monthly: { ...(p.monthly ?? {}), [row.month]: v } });
      return onClose();
    }
    if (until && (!isMonthKey(until) || until < row.month)) return setError('„Do miesiąca” musi mieć format RRRR-MM i nie może być wcześniej niż ten miesiąc.');
    const n = Number(every) || 1;
    const ix = indexation.trim() ? Number(indexation.replace(',', '.')) : 0;
    if (Number.isNaN(ix) || ix < -50 || ix > 100) return setError('Wzrost co rok: wpisz procent, np. 5.');
    const rule: AmountRule = {
      from: row.month, amount: v, ...(n > 1 ? { everyMonths: n } : {}), ...(until ? { until } : {}), ...(ix ? { indexation: ix } : {}),
    };
    savePosition({
      ...p,
      rules: [...p.rules.filter((r) => r.from !== row.month), rule].sort((a, b) => a.from.localeCompare(b.from)),
      monthly: cleanSinglesFrom(row.month),
      activeFrom,
    });
    onClose();
  };

  const clearSingle = () => {
    const monthly = { ...(p.monthly ?? {}) };
    delete monthly[row.month];
    savePosition({ ...p, monthly: Object.keys(monthly).length ? monthly : undefined });
    onClose();
  };

  const saveActual = () => {
    if (!actual.trim()) {
      setActualAmount(p.id, row.month, undefined);
      return onClose();
    }
    const v = parseMoney(actual);
    if (v === null) return setError('Kwota rzeczywista: wpisz liczbę, np. -129,99.');
    setActualAmount(p.id, row.month, v);
    onClose();
  };

  return (
    <Sheet title={`${p.name} – ${monthName(row.month)} ${row.month.slice(0, 4)}`} onClose={onClose}>
      <h3>Plan</h3>
      <div className="segmented" role="group" aria-label="Rodzaj zmiany">
        <button type="button" aria-pressed={scope === 'one'} onClick={() => setScope('one')}>Tylko ten miesiąc</button>
        <button type="button" aria-pressed={scope === 'from'} onClick={() => setScope('from')}>Od tego miesiąca</button>
        <button type="button" aria-pressed={scope === 'season'} onClick={() => setScope('season')}>Jak w ost. 12 mies.</button>
      </div>

      {scope !== 'season' && (
        <Field label="Kwota" hint="wydatek z minusem">
          <input inputMode="decimal" value={plan} onChange={(e) => setPlan(e.target.value)} />
        </Field>
      )}
      {scope === 'one' && <p className="muted small-text">Jednorazowa zmiana, np. znane zdarzenie w tym miesiącu – pozostałe miesiące bez zmian.</p>}
      {scope === 'from' && (
        <>
          <div className="two">
            <Field label="Co ile miesięcy">
              <select value={every} onChange={(e) => setEvery(e.target.value)}>
                <option value="1">co miesiąc</option>
                <option value="2">co 2 miesiące</option>
                <option value="3">co kwartał</option>
                <option value="6">co pół roku</option>
                <option value="12">raz w roku</option>
              </select>
            </Field>
            <Field label="Do miesiąca" hint="puste = bez końca">
              <input value={until} onChange={(e) => setUntil(e.target.value)} placeholder="np. 2028-06" />
            </Field>
          </div>
          <Field label="Wzrost co rok (%)" hint="opcjonalnie, np. 5 = +5% od każdego kolejnego stycznia">
            <input inputMode="decimal" value={indexation} onChange={(e) => setIndexation(e.target.value)} placeholder="np. 5" />
          </Field>
          <p className="muted small-text">Kwota obowiązuje od {monthGenitive(row.month)}{until && isMonthKey(until) ? ` do ${monthGenitive(until)}, potem 0` : ' bez końca'}{Number(every) > 1 ? `, płatna co ${every} mies.` : ''}.</p>
        </>
      )}
      {scope === 'season' && (
        <>
          <p className="muted small-text">Co roku od {monthGenitive(row.month)} powtarzaj kwoty z 12 poprzednich miesięcy (wykonanie, a gdzie go brak – plan):</p>
          <ul className="season">
            {season.map((v, i) => (
              <li key={i} className={v ? '' : 'zero'}><span>{SHORT[i]}</span><b>{v ? money(v) : '–'}</b></li>
            ))}
          </ul>
          <div className="two">
            <Field label="Do miesiąca" hint="puste = bez końca">
              <input value={until} onChange={(e) => setUntil(e.target.value)} placeholder="np. 2028-12" />
            </Field>
            <Field label="Wzrost co rok (%)" hint="opcjonalnie">
              <input inputMode="decimal" value={indexation} onChange={(e) => setIndexation(e.target.value)} placeholder="np. 5" />
            </Field>
          </div>
        </>
      )}
      <p className="row-actions">
        <button type="button" className="primary" onClick={savePlan}>Zapisz plan</button>
        {row.single && <button type="button" onClick={clearSingle}>Przywróć plan z reguły</button>}
      </p>

      {!expense && row.month <= now && (
        <>
          <h3>Rzeczywiście</h3>
          <Field label="Kwota rzeczywista" hint="puste = jak w planie">
            <input inputMode="decimal" value={actual} onChange={(e) => setActual(e.target.value)} />
          </Field>
          <p className="row-actions">
            <button type="button" onClick={saveActual}>Zapisz kwotę</button>
            <button type="button" onClick={() => { togglePaid(p.id, row.month); onClose(); }}>
              {row.paid ? 'Cofnij zaznaczenie' : 'Oznacz jako zapłacone'}
            </button>
          </p>
        </>
      )}
      {expense && <p className="muted small-text">Wydane w tym miesiącu: {row.actual !== undefined ? money(row.actual) : '0,00'} – to suma transakcji (widok miesiąca → pozycja).</p>}
      {error && <p className="error">{error}</p>}
    </Sheet>
  );
}
