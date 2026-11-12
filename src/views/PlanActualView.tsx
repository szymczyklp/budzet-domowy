import { useMemo, useState } from 'react';
import { useStore } from '../lib/store';
import type { MonthKey, Section } from '../lib/types';
import { addMonths, currentMonth, monthName, monthRange } from '../lib/month';
import { linesForMonth } from '../lib/projection';
import { SECTIONS } from '../lib/sections';
import { money } from '../lib/format';
import { HelpLink } from './HelpView';

const FROM: MonthKey = '2024-01';

interface Row {
  id: string;
  name: string;
  section: Section;
  planned: number;
  /** Plan i wykonanie tylko z miesięcy, w których jest jedno i drugie – do uczciwej różnicy. */
  plannedDone: number;
  actualCmp: number;
  cmpMonths: number;
  actual: number;
  /** Ile miesięcy ma wykonanie (rzeczywistą kwotę albo zaznaczenie). */
  doneMonths: number;
  months: number;
}

/** Porównanie planu z wykonaniem dla miesiąca albo całego roku. */
export default function PlanActualView() {
  const { doc } = useStore();
  const now = currentMonth();
  const [period, setPeriod] = useState<string>(addMonths(now, -1));

  const options = useMemo(() => {
    const count = (Number(now.slice(0, 4)) - 2024) * 12 + Number(now.slice(5));
    const months = monthRange(FROM, count).reverse();
    const years = [...new Set(months.map((m) => m.slice(0, 4)))];
    return { months, years };
  }, [now]);

  const rows = useMemo(() => {
    const months = period.length === 4 ? monthRange(`${period}-01`, 12).filter((m) => m <= now) : [period];
    const map = new Map<string, Row>();
    for (const m of months) {
      for (const l of linesForMonth(doc, m)) {
        const actual = l.expense ? (l.spent || undefined) : l.entry?.amount ?? (l.paid ? l.planned : undefined);
        if (l.planned === 0 && actual === undefined) continue;
        const r = map.get(l.position.id) ?? {
          id: l.position.id, name: l.position.name, section: l.section, planned: 0, plannedDone: 0, actualCmp: 0, cmpMonths: 0, actual: 0, doneMonths: 0, months: 0,
        };
        r.planned += l.planned;
        r.months++;
        if (actual !== undefined) {
          r.actual += actual;
          r.doneMonths++;
          if (l.planned !== 0) {
            r.plannedDone += l.planned;
            r.actualCmp += actual;
            r.cmpMonths++;
          }
        }
        map.set(l.position.id, r);
      }
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [doc, period, now]);

  return (
    <>
      <header className="page-head">
        <h1>Plan a wykonanie <HelpLink topic="prognoza-plan-a-wykonanie-i-analiza" /></h1>
        <p className="muted small-text">Różnica = wykonanie minus plan, liczona tylko za miesiące, w których jest i plan, i wykonanie (dane z arkusza sprzed listopada 2026 nie mają planu). Na plusie – lepiej niż w planie (mniej wydane albo więcej wpłynęło).</p>
        <select value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Okres">
          {options.years.map((y) => <option key={y} value={y}>Cały rok {y}{y === now.slice(0, 4) ? ' (do dziś)' : ''}</option>)}
          {options.months.map((m) => <option key={m} value={m}>{monthName(m)} {m.slice(0, 4)}</option>)}
        </select>
      </header>

      {SECTIONS.map((s) => {
        const list = rows.filter((r) => r.section === s.id);
        if (list.length === 0) return null;
        const plan = list.reduce((a, r) => a + r.planned, 0);
        const actual = list.reduce((a, r) => a + r.actual, 0);
        const diffSum = list.reduce((a, r) => a + (r.actualCmp - r.plannedDone), 0);
        return (
          <section key={s.id} className="group">
            <h2><span>{s.title}</span></h2>
            <div className="table-wrap">
              <table className="pva">
                <thead>
                  <tr><th>Pozycja</th><th>Plan</th><th>Wykonanie</th><th>Różnica</th></tr>
                </thead>
                <tbody>
                  {list.map((r) => {
                    const diff = r.actualCmp - r.plannedDone;
                    const missing = r.doneMonths < r.months;
                    return (
                      <tr key={r.id} onClick={() => { location.hash = `pozycja/${r.id}`; }}>
                        <th scope="row">
                          {r.name}
                          {missing && <small>{r.doneMonths === 0 ? 'brak wykonania' : `wykonanie ${r.doneMonths}/${r.months} mies.`}</small>}
                        </th>
                        <td>{money(r.planned)}</td>
                        <td>{r.doneMonths ? money(r.actual) : '–'}</td>
                        <td className={r.cmpMonths ? (diff < -0.004 ? 'out' : diff > 0.004 ? 'in' : '') : 'muted'}>
                          {r.cmpMonths ? money(diff) : r.doneMonths ? 'bez planu' : ''}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row">Razem</th>
                    <td>{money(plan)}</td>
                    <td>{money(actual)}</td>
                    <td className={diffSum < -0.004 ? 'out' : diffSum > 0.004 ? 'in' : ''}>{money(diffSum)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>
        );
      })}
      {rows.length === 0 && <p className="muted">Brak danych w tym okresie.</p>}
    </>
  );
}
