import { useMemo } from 'react';
import { useStore } from '../lib/store';
import { currentMonth, forecastEnd, monthsBetween, monthShort } from '../lib/month';
import { monthSummary } from '../lib/projection';
import { money } from '../lib/format';
import { Money } from '../ui';
import { HelpLink } from './HelpView';

/** Prognoza od bieżącego miesiąca do końca roku i dwóch kolejnych pełnych lat. */
export default function ForecastView() {
  const { doc } = useStore();
  const now = currentMonth();
  const end = forecastEnd(now);

  const rows = useMemo(() => {
    let running = 0;
    return monthsBetween(now, end).map((m) => {
      const s = monthSummary(doc, m);
      running += s.net;
      return { ...s, running };
    });
  }, [doc, now, end]);

  const maxAbs = Math.max(1, ...rows.map((r) => Math.abs(r.net)));
  const years = [...new Set(rows.map((r) => r.month.slice(0, 4)))];
  const total = rows.at(-1)?.running ?? 0;

  return (
    <>
      <header className="page-head">
        <h1>Prognoza <HelpLink topic="prognoza-plan-a-wykonanie-i-analiza" /></h1>
        <p className="muted">
          Do grudnia {end.slice(0, 4)} · suma wyników: <b>{money(total)} zł</b>
        </p>
        <p className="muted small-text">
          Kwoty planu obowiązują bez końca, chyba że w karcie pozycji ustawisz „do miesiąca”, płatność co kilka
          miesięcy, sezonowość albo zmianę jednego miesiąca.
        </p>
      </header>
      {years.map((y) => {
        const yr = rows.filter((r) => r.month.startsWith(y));
        return (
          <section className="group" key={y}>
            <h2>
              <span>{y}{y === now.slice(0, 4) ? ' (od bieżącego miesiąca)' : ''}</span>
              <Money value={yr.reduce((s, r) => s + r.net, 0)} />
            </h2>
            <div className="table-wrap">
              <table className="forecast">
                <thead>
                  <tr><th>Miesiąc</th><th className="wide-only">Wpływy</th><th className="wide-only">Wydatki</th><th>Wynik</th><th>Narastająco</th></tr>
                </thead>
                <tbody>
                  {yr.map((r) => (
                    <tr key={r.month}>
                      <th scope="row">{monthShort(r.month)}</th>
                      <td className="wide-only">{money(r.income)}</td>
                      <td className="wide-only">{money(r.outflow)}</td>
                      <td className={r.net < 0 ? 'out' : 'in'}>
                        <span className="net-bar" style={{ width: `${(Math.abs(r.net) / maxAbs) * 100}%` }} aria-hidden="true" />
                        <span className="net-val">{money(r.net)}</span>
                      </td>
                      <td>{money(r.running)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </>
  );
}
