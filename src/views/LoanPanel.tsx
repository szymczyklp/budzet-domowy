import { useMemo, useState } from 'react';
import { useStore } from '../lib/store';
import type { EmergencyItem, LoanPlan, Position } from '../lib/types';
import { addMonths, currentMonth, isMonthKey, monthShort, monthDiff } from '../lib/month';
import { money, moneyInput, parseMoney, today } from '../lib/format';
import { balanceAt, loanSchedule, loanStats } from '../lib/loan';
import { withHistory } from '../lib/analysis';
import { newId } from '../lib/ids';
import { Field, Sheet } from '../ui';
import { HelpLink } from './HelpView';

const num = (s: string) => {
  const v = Number(s.replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(v) ? v : null;
};
const pctText = (v: number) => v.toLocaleString('pl-PL', { maximumFractionDigits: 3 });

/** Harmonogram kredytu w karcie pozycji: parametry, symulacja nadpłaty, stan do majątku. */
export default function LoanPanel({ position: p }: { position: Position }) {
  const { doc, savePosition, update } = useStore();
  const [edit, setEdit] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const loan = p.loan;
  const now = currentMonth();
  const rows = useMemo(() => (loan ? loanSchedule(loan) : []), [loan]);
  const stats = loanStats(rows);
  const linked = Object.values(doc.emergency).find((e) => !e.deleted && e.kind === 'zobowiazanie' && e.positionId === p.id);

  if (!loan) {
    return (
      <details className="plan-rules">
        <summary>To kredyt? Ustaw harmonogram rat</summary>
        <p className="muted small-text">
          Podaj kapitał do spłaty, oprocentowanie i liczbę rat – plan policzy się z harmonogramu (z nadpłatami),
          a pozostały kapitał możesz przenosić do majątku netto.
        </p>
        <button type="button" className="small" onClick={() => setEdit(true)}>Ustaw harmonogram</button>
        {edit && <LoanForm position={p} onClose={() => setEdit(false)} />}
      </details>
    );
  }

  const remaining = balanceAt(loan, now);
  const upcoming = rows.filter((x) => x.month >= now);
  const visible = showAll ? upcoming : upcoming.slice(0, 12);
  const toNetWorth = () =>
    update((d, stamp) => {
      const id = linked?.id ?? newId('w');
      const base: EmergencyItem = linked ?? {
        id, kind: 'zobowiazanie', name: p.name, order: Object.keys(d.emergency).length, positionId: p.id, ...stamp(),
      };
      return { ...d, emergency: { ...d.emergency, [id]: { ...withHistory(base, today(), remaining), ...stamp() } } };
    });

  return (
    <section className="panel loan">
      <header className="detail-row">
        <h2>Harmonogram kredytu <HelpLink topic="kredyty" /></h2>
        <button type="button" className="small" onClick={() => setEdit(true)}>Zmień</button>
      </header>
      <dl className="card-stats">
        <div><dt>Rata</dt><dd>{money(rows.find((x) => x.month >= now)?.installment ?? stats.firstInstallment)}</dd></div>
        <div><dt>Do spłaty teraz</dt><dd>{money(remaining)}</dd></div>
        <div><dt>Koniec</dt><dd>{stats.end ? monthShort(stats.end) : '–'}<small>{upcoming.length} rat</small></dd></div>
        <div><dt>Odsetki do końca</dt><dd>{money(upcoming.reduce((s, x) => s + x.interest, 0))}</dd></div>
      </dl>
      <p className="muted small-text">
        {loan.kind === 'rowne' ? 'Raty równe' : 'Raty malejące'}, {pctText(loan.rate)}% rocznie, od {monthShort(loan.from)}: {money(loan.balance)} zł na {loan.months} rat.
        Plan pozycji od {monthShort(loan.from)} liczy się z harmonogramu. Odsetki liczone miesięcznie – bank może różnić się o grosze.
      </p>
      <p className="row-actions">
        <button type="button" className="small" onClick={toNetWorth}>
          {linked ? `Zapisz stan ${money(remaining)} w majątku` : 'Dodaj do majątku jako zobowiązanie'}
        </button>
      </p>

      <Simulation position={p} loan={loan} />

      {(loan.overpayments?.length ?? 0) > 0 && (
        <>
          <h3>Nadpłaty w planie</h3>
          <ul className="plain-list">
            {loan.overpayments!.map((o, i) => (
              <li key={`${o.month}-${i}`} className="detail-row small-text">
                <span>{monthShort(o.month)}: <b>{money(o.amount)}</b> – {o.mode === 'okres' ? 'skraca okres' : 'zmniejsza ratę'}</span>
                <button type="button" className="small ghost" onClick={() => savePosition({ ...p, loan: { ...loan, overpayments: loan.overpayments!.filter((_, j) => j !== i) } })}>Usuń</button>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="table-wrap">
        <table className="forecast">
          <thead><tr><th>Miesiąc</th><th>Rata</th><th className="wide-only">Kapitał</th><th>Odsetki</th><th>Zostaje</th></tr></thead>
          <tbody>
            {visible.map((x) => (
              <tr key={x.month}>
                <th scope="row">{monthShort(x.month)}</th>
                <td>{money(x.installment + x.overpayment)}{x.overpayment > 0 && <small> w tym nadpłata</small>}</td>
                <td className="wide-only">{money(x.principal)}</td>
                <td>{money(x.interest)}</td>
                <td>{money(x.balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {upcoming.length > 12 && (
        <button type="button" className="small" onClick={() => setShowAll((v) => !v)}>{showAll ? 'Pokaż 12 rat' : `Pokaż wszystkie (${upcoming.length})`}</button>
      )}
      {edit && <LoanForm position={p} onClose={() => setEdit(false)} />}
    </section>
  );
}

/** „Co jeśli nadpłacę?” – porównanie bez zapisu; można dodać do planu. */
function Simulation({ position: p, loan }: { position: Position; loan: LoanPlan }) {
  const { savePosition } = useStore();
  const [amount, setAmount] = useState('');
  const [month, setMonth] = useState(addMonths(currentMonth(), 1));
  const [mode, setMode] = useState<'okres' | 'rata'>('okres');
  const v = parseMoney(amount);
  const valid = v !== null && v > 0 && isMonthKey(month) && month >= loan.from;
  const result = useMemo(() => {
    if (!valid) return null;
    const base = loanSchedule(loan);
    const after = loanSchedule({ ...loan, overpayments: [...(loan.overpayments ?? []), { month, amount: v!, mode }] });
    const next = addMonths(month, 1);
    return {
      saved: loanStats(base).interest - loanStats(after).interest,
      shorter: base.length - after.length,
      before: base.find((x) => x.month === next)?.installment,
      afterRata: after.find((x) => x.month === next)?.installment,
      end: after.at(-1)?.month,
    };
  }, [loan, month, v, mode, valid]);

  return (
    <details className="plan-rules">
      <summary>Symulacja nadpłaty</summary>
      <div className="two">
        <Field label="Kwota"><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="20 000" /></Field>
        <Field label="Miesiąc" hint="RRRR-MM"><input value={month} onChange={(e) => setMonth(e.target.value)} /></Field>
      </div>
      <div>
        <Field label="Efekt">
          <select value={mode} onChange={(e) => setMode(e.target.value as 'okres' | 'rata')}>
            <option value="okres">krótszy okres</option>
            <option value="rata">niższa rata</option>
          </select>
        </Field>
      </div>
      {result && (
        <>
          <p>
            Oszczędność na odsetkach: <b>{money(result.saved)} zł</b>.{' '}
            {mode === 'okres'
              ? <>Koniec {result.shorter > 0 ? `o ${result.shorter} mies. wcześniej (${result.end ? monthShort(result.end) : ''})` : 'bez zmian'}.</>
              : <>Rata od {monthShort(addMonths(month, 1))}: {money(result.before ?? 0)} → <b>{money(result.afterRata ?? 0)}</b>.</>}
          </p>
          <button
            type="button"
            className="small primary"
            onClick={() => { savePosition({ ...p, loan: { ...loan, overpayments: [...(loan.overpayments ?? []), { month, amount: v!, mode }].sort((a, b) => a.month.localeCompare(b.month)) } }); setAmount(''); }}
          >
            Dodaj nadpłatę do planu
          </button>
        </>
      )}
    </details>
  );
}

function LoanForm({ position: p, onClose }: { position: Position; onClose: () => void }) {
  const { savePosition } = useStore();
  const l = p.loan;
  const now = currentMonth();
  const [from, setFrom] = useState(l?.from ?? addMonths(now, 1));
  const [balance, setBalance] = useState(l ? moneyInput(l.balance) : '');
  const [rate, setRate] = useState(l ? pctText(l.rate) : '');
  const [months, setMonths] = useState(l ? String(l.months) : '');
  const [end, setEnd] = useState(l ? addMonths(l.from, l.months - 1) : '');
  const [kind, setKind] = useState<LoanPlan['kind']>(l?.kind ?? 'rowne');
  const [fee, setFee] = useState(l?.fee ? moneyInput(l.fee) : '');
  const [error, setError] = useState('');

  const save = () => {
    const b = parseMoney(balance);
    const r = num(rate);
    let n = Number(months);
    if (!n && isMonthKey(end)) n = monthDiff(from, end) + 1;
    const f = fee.trim() ? parseMoney(fee) : 0;
    if (!isMonthKey(from)) return setError('Pierwsza rata: RRRR-MM.');
    if (b === null || b <= 0) return setError('Wpisz kapitał do spłaty, np. 312 450,00.');
    if (r === null || r < 0 || r > 50) return setError('Oprocentowanie w % rocznie, np. 7,25.');
    if (!Number.isInteger(n) || n < 1 || n > 600) return setError('Liczba rat (albo miesiąc ostatniej raty) jest wymagana.');
    if (f === null) return setError('Opłata: wpisz kwotę albo zostaw puste.');
    savePosition({ ...p, loan: { from, balance: Math.abs(b), rate: r, months: n, kind, ...(f ? { fee: Math.abs(f) } : {}), ...(l?.overpayments ? { overpayments: l.overpayments } : {}) } });
    onClose();
  };

  return (
    <Sheet title="Harmonogram kredytu" onClose={onClose}>
      <p className="muted small-text">Dane z ostatniego harmonogramu z banku albo z aplikacji banku: kapitał pozostały, oprocentowanie, liczba rat do końca. Po zmianie WIBOR / stawki wpisz nowe wartości od miesiąca zmiany.</p>
      <div className="two">
        <Field label="Pierwsza rata z harmonogramu" hint="RRRR-MM"><input value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="Kapitał do spłaty przed nią"><input inputMode="decimal" value={balance} onChange={(e) => setBalance(e.target.value)} /></Field>
      </div>
      <div className="two">
        <Field label="Oprocentowanie roczne %"><input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="7,25" /></Field>
        <Field label="Rodzaj rat">
          <select value={kind} onChange={(e) => setKind(e.target.value as LoanPlan['kind'])}>
            <option value="rowne">równe</option>
            <option value="malejace">malejące</option>
          </select>
        </Field>
      </div>
      <div className="two">
        <Field label="Liczba rat do końca"><input inputMode="numeric" value={months} onChange={(e) => { setMonths(e.target.value); setEnd(''); }} /></Field>
        <Field label="albo ostatnia rata" hint="RRRR-MM"><input value={end} onChange={(e) => { setEnd(e.target.value); setMonths(''); }} /></Field>
      </div>
      <Field label="Stała opłata do raty (opcjonalnie)" hint="np. ubezpieczenie pobierane z ratą"><input inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} /></Field>
      {error && <p className="error">{error}</p>}
      <p className="row-actions">
        <button type="button" className="primary" onClick={save}>Zapisz</button>
        {l && <button type="button" className="danger" onClick={() => { if (confirm('Usunąć harmonogram? Plan wróci do reguł kwot.')) { savePosition({ ...p, loan: undefined }); onClose(); } }}>Usuń harmonogram</button>}
      </p>
    </Sheet>
  );
}
