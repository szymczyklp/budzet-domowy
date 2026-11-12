import { useMemo, useState } from 'react';
import { useStore } from '../lib/store';
import type { FirmSettings, MonthKey, Position } from '../lib/types';
import { currentMonth, isMonthKey, monthRange, monthShort } from '../lib/month';
import { money, moneyInput, parseMoney } from '../lib/format';
import { firmMonth, healthBase, HEALTH_BASE } from '../lib/firm';
import { plannedAmount } from '../lib/plan';
import { isActive } from '../lib/projection';
import { looksBusiness, positionSection } from '../lib/sections';
import { Field, Money } from '../ui';
import { HelpLink } from './HelpView';

const LUMP_RATES = [17, 15, 14, 12.5, 12, 10, 8.5, 5.5, 3, 2];
const pct = (v: number) => `${v.toLocaleString('pl-PL')}%`;

export default function FirmView() {
  const { doc, update } = useStore();
  const firm = doc.settings.main?.firm;
  const [editing, setEditing] = useState(!firm);
  const now = currentMonth();
  const start = firm && firm.from > now ? firm.from : now;
  const months = useMemo(() => monthRange(start, 12), [start]);
  const calc = useMemo(() => (firm ? months.map((m) => firmMonth(doc, firm, m)) : []), [doc, firm, months]);
  const [open, setOpen] = useState<MonthKey | null>(null);

  const save = (f: FirmSettings | undefined) =>
    update((d, stamp) => {
      const main = { ...(d.settings.main ?? { id: 'main' }), id: 'main' };
      if (f) main.firm = f;
      else delete main.firm;
      return { ...d, settings: { ...d.settings, main: { ...main, ...stamp() } } };
    });

  return (
    <>
      <header className="page-head">
        <h1>Firma <HelpLink topic="firma-ryczałt-vat-i-zus" /></h1>
        <p className="muted small-text">
          Ryczałt i VAT miesięcznie: plan VAT do zapłaty, zaliczki ryczałtu i składek ZUS liczy się z przychodów i kosztów
          firmowych. Przychód z powołania rozlicza się osobno – nie wchodzi do wyliczeń ryczałtu ani VAT.
        </p>
      </header>

      {editing ? (
        <FirmForm initial={firm} onCancel={firm ? () => setEditing(false) : undefined} onSave={(f) => { save(f); setEditing(false); }} onRemove={firm ? () => { save(undefined); } : undefined} />
      ) : firm && (
        <>
          <section className="panel">
            <p className="detail-row">
              <span>
                Od {monthShort(firm.from)} · VAT {firm.vatRate}% · ryczałt {firm.incomes.map((i) => `${doc.positions[i.positionId]?.name ?? '?'} ${pct(i.lumpRate)}`).join(', ')}
                {' '}· ZUS społeczne {money(firm.socialZus)} · {firm.lag ? 'płatne w następnym miesiącu' : 'płatne w tym samym miesiącu'}
              </span>
              <button type="button" className="small" onClick={() => setEditing(true)}>Zmień</button>
            </p>
            {calc[0] && (
              <p className="muted small-text">
                Składka zdrowotna {calc[0].month.slice(0, 4)}: przychód roczny ok. {money(calc[0].annualRevenue)} zł → próg <b>{calc[0].bracket}</b>,{' '}
                {money(calc[0].health)} zł / mies. (podstawa {money(healthBase(Number(calc[0].month.slice(0, 4))))} zł
                {HEALTH_BASE[Number(calc[0].month.slice(0, 4))] ? '' : ' – z ostatniego znanego roku'}).
              </p>
            )}
          </section>

          <div className="table-wrap">
            <table className="forecast firm-table">
              <thead>
                <tr><th>Miesiąc</th><th className="wide-only">Przychód netto</th><th>VAT</th><th>Ryczałt</th><th>ZUS</th></tr>
              </thead>
              <tbody>
                {calc.map((c) => (
                  <FirmRow key={c.month} c={c} open={open === c.month} onToggle={() => setOpen(open === c.month ? null : c.month)} />
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small-text">
            {firm.lag ? 'Podatki za miesiąc pojawiają się w budżecie miesiąc później. ' : ''}
            Stuknij miesiąc, żeby zobaczyć wyliczenie. Kwoty podatków zaokrąglone do pełnych złotych.
          </p>
        </>
      )}

      <VatCosts />
    </>
  );
}

function FirmRow({ c, open, onToggle }: { c: ReturnType<typeof firmMonth>; open: boolean; onToggle: () => void }) {
  return (
    <>
      <tr onClick={onToggle} className="clickable">
        <th scope="row">{monthShort(c.month)}</th>
        <td className="wide-only">{money(c.revenue)}</td>
        <td>{money(c.vatDue)}</td>
        <td>{money(c.pit)}</td>
        <td>{money(c.social + c.health)}</td>
      </tr>
      {open && (
        <tr className="firm-detail">
          <td colSpan={5}>
            <ul className="plain-list small-text">
              {c.incomes.map((i) => (
                <li key={i.positionId} className="detail-row"><span>{i.name}: {money(i.revenue)} → podstawa {money(i.base)} × {pct(i.lumpRate)}</span><b>{money(i.tax)}</b></li>
              ))}
              <li className="detail-row"><span>Odliczone od przychodu: ZUS społeczne {money(c.social)} + 50% zdrowotnej {money(c.health / 2)}</span></li>
              <li className="detail-row"><span>VAT należny</span><b>{money(c.outputVat)}</b></li>
              {c.inputLines.map((l) => (
                <li key={l.positionId} className="detail-row"><span>− {l.name}: {money(-l.gross)} brutto, VAT {l.rate}%{l.deductible < 100 ? ` × ${l.deductible}%` : ''}</span><span>{money(l.vat)}</span></li>
              ))}
              <li className="detail-row"><span>VAT do zapłaty</span><b>{money(c.vatDue)}</b></li>
              <li className="detail-row"><span>ZUS: społeczne {money(c.social)} + zdrowotna {money(c.health)} ({c.bracket})</span><b>{money(c.social + c.health)}</b></li>
            </ul>
          </td>
        </tr>
      )}
    </>
  );
}

function PosSelect({ value, onChange, list }: { value: string; onChange: (v: string) => void; list: Position[] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">— nie wyliczaj —</option>
      {list.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
    </select>
  );
}

function FirmForm({ initial, onSave, onCancel, onRemove }: {
  initial?: FirmSettings; onSave: (f: FirmSettings) => void; onCancel?: () => void; onRemove?: () => void;
}) {
  const { doc } = useStore();
  const now = currentMonth();
  const active = Object.values(doc.positions).filter((p) => !p.deleted && (isActive(p, now) || p.activeFrom > now)).sort((a, b) => a.name.localeCompare(b.name));
  const incomesAll = active.filter((p) => positionSection(doc, p) === 'przychody');
  const costs = active.filter((p) => positionSection(doc, p) !== 'przychody' && positionSection(doc, p) !== 'wydatki');
  const find = (list: Position[], re: RegExp) => list.find((p) => re.test(p.name))?.id;

  const [from, setFrom] = useState(initial?.from ?? now);
  const [vatRate, setVatRate] = useState(String(initial?.vatRate ?? 23));
  const [incomes, setIncomes] = useState(initial?.incomes ?? [{ positionId: find(incomesAll, /netto/i) ?? '', lumpRate: 12 }]);
  const [vatIncome, setVatIncome] = useState(initial?.vatIncomePositionId ?? find(incomesAll, /VAT/i) ?? '');
  const [vatPos, setVatPos] = useState(initial?.vatPositionId ?? find(costs, /VAT/i) ?? '');
  const [pitPos, setPitPos] = useState(initial?.pitPositionId ?? find(costs, /PIT|PODST|RYCZA/i) ?? '');
  const [zusPos, setZusPos] = useState(initial?.zusPositionId ?? find(costs, /ZUS/i) ?? '');
  const [social, setSocial] = useState(initial ? moneyInput(initial.socialZus) : '');
  const [lag, setLag] = useState<0 | 1>(initial?.lag ?? 0);
  const [error, setError] = useState('');

  const draft = (): FirmSettings | string => {
    const s = parseMoney(social);
    if (!isMonthKey(from)) return 'Od miesiąca: RRRR-MM.';
    if (s === null) return 'Wpisz miesięczne składki społeczne ZUS (bez zdrowotnej).';
    const lines = incomes.filter((i) => i.positionId);
    if (lines.length === 0) return 'Wybierz co najmniej jedną pozycję przychodu z faktur.';
    return {
      from, vatRate: Number(vatRate) || 0, incomes: lines, socialZus: Math.abs(s), lag,
      ...(vatIncome ? { vatIncomePositionId: vatIncome } : {}),
      ...(vatPos ? { vatPositionId: vatPos } : {}),
      ...(pitPos ? { pitPositionId: pitPos } : {}),
      ...(zusPos ? { zusPositionId: zusPos } : {}),
    };
  };
  const d = draft();
  const preview = typeof d === 'string' ? null : firmMonth(doc, d, from > now ? from : now);
  const planNow = (id: string) => (doc.positions[id] ? plannedAmount(doc.positions[id], preview?.month ?? now) : undefined);
  const cmp = (label: string, id: string, v: number) => (
    <li className="detail-row small-text" key={label}>
      <span>{label}{id && planNow(id) !== undefined ? <small className="muted"> (dotąd w planie {money(planNow(id)!)})</small> : null}</span>
      <Money value={v} />
    </li>
  );

  return (
    <section className="panel">
      <h2>Ustawienia firmy</h2>
      <div className="two">
        <Field label="Wyliczaj plan od" hint="RRRR-MM; wcześniejsze miesiące bez zmian"><input value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="Stawka VAT od przychodu">
          <select value={vatRate} onChange={(e) => setVatRate(e.target.value)}>{[23, 8, 5, 0].map((r) => <option key={r} value={r}>{r}%</option>)}</select>
        </Field>
      </div>

      <h3>Przychody z faktur (netto) i stawki ryczałtu</h3>
      <p className="muted small-text">Część usług na 15%? Dodaj osobną pozycję przychodu (np. „faktura netto 15%”), zmniejsz kwotę głównej i ustaw tu jej stawkę.</p>
      {incomes.map((i, idx) => (
        <div className="split-row" key={idx}>
          <select value={i.positionId} onChange={(e) => setIncomes((xs) => xs.map((x, j) => (j === idx ? { ...x, positionId: e.target.value } : x)))} aria-label="Pozycja przychodu">
            <option value="">— wybierz —</option>
            {incomesAll.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select value={i.lumpRate} onChange={(e) => setIncomes((xs) => xs.map((x, j) => (j === idx ? { ...x, lumpRate: Number(e.target.value) } : x)))} aria-label="Stawka ryczałtu">
            {LUMP_RATES.map((r) => <option key={r} value={r}>{pct(r)}</option>)}
          </select>
        </div>
      ))}
      <p className="row-actions">
        <button type="button" className="small" onClick={() => setIncomes((xs) => [...xs, { positionId: '', lumpRate: 15 }])}>+ linia przychodu</button>
        {incomes.length > 1 && <button type="button" className="small ghost" onClick={() => setIncomes((xs) => xs.slice(0, -1))}>usuń ostatnią</button>}
      </p>

      <h3>Pozycje wyliczane</h3>
      <Field label="VAT od klienta (wpływ)"><PosSelect value={vatIncome} onChange={setVatIncome} list={incomesAll} /></Field>
      <Field label="VAT do zapłaty"><PosSelect value={vatPos} onChange={setVatPos} list={costs} /></Field>
      <Field label="Zaliczka ryczałtu"><PosSelect value={pitPos} onChange={setPitPos} list={costs} /></Field>
      <Field label="Składki ZUS (społeczne + zdrowotna)"><PosSelect value={zusPos} onChange={setZusPos} list={costs} /></Field>
      <div className="two">
        <Field label="Składki społeczne / mies." hint="bez zdrowotnej – z ZUS albo od księgowej"><input inputMode="decimal" value={social} onChange={(e) => setSocial(e.target.value)} /></Field>
        <Field label="Podatki za miesiąc płacę">
          <select value={lag} onChange={(e) => setLag(Number(e.target.value) as 0 | 1)}>
            <option value={0}>w tym samym miesiącu budżetu</option>
            <option value={1}>w następnym miesiącu</option>
          </select>
        </Field>
      </div>

      {preview && (
        <>
          <h3>Podgląd: {monthShort(preview.month)}</h3>
          <ul className="plain-list">
            {cmp('VAT od klienta', vatIncome, preview.outputVat)}
            {cmp('VAT do zapłaty', vatPos, -preview.vatDue)}
            {cmp('Zaliczka ryczałtu', pitPos, -preview.pit)}
            {cmp(`ZUS (zdrowotna ${preview.bracket})`, zusPos, -(preview.social + preview.health))}
          </ul>
        </>
      )}
      {error && <p className="error">{error}</p>}
      <p className="row-actions">
        <button type="button" className="primary" onClick={() => (typeof d === 'string' ? setError(d) : onSave(d))}>Zapisz i wyliczaj plan</button>
        {onCancel && <button type="button" onClick={onCancel}>Anuluj</button>}
        {onRemove && <button type="button" className="danger" onClick={() => confirm('Wyłączyć moduł firmy? Plan wróci do reguł kwot.') && onRemove()}>Wyłącz</button>}
      </p>
    </section>
  );
}

/** Koszty firmowe i ich VAT – szybkie oznaczanie stawki do odliczenia. */
function VatCosts() {
  const { doc, savePosition } = useStore();
  const now = currentMonth();
  const list = Object.values(doc.positions)
    .filter((p) => !p.deleted && (isActive(p, now) || p.activeFrom > now) && (p.vat || positionSection(doc, p) === 'firmowe' || looksBusiness(p.name)))
    .filter((p) => p.id !== doc.settings.main?.firm?.vatPositionId && p.id !== doc.settings.main?.firm?.pitPositionId && p.id !== doc.settings.main?.firm?.zusPositionId)
    .sort((a, b) => a.name.localeCompare(b.name));
  const others = Object.values(doc.positions)
    .filter((p) => !p.deleted && !list.includes(p) && isActive(p, now) && plannedAmount(p, now) < 0 && positionSection(doc, p) !== 'wydatki' && positionSection(doc, p) !== 'przychody')
    .sort((a, b) => a.name.localeCompare(b.name));
  return (
    <section className="group">
      <h2><span>Koszty firmowe – VAT do odliczenia</span></h2>
      <p className="muted small-text">Kwoty pozycji są brutto. Zaznacz stawkę VAT i ile odliczasz – VAT naliczony zmniejszy plan VAT do zapłaty.</p>
      <ul className="plain-list">
        {list.map((p) => (
          <li key={p.id} className="vat-row">
            <a className="name" href={`#pozycja/${p.id}`}>{p.name}<small>{money(plannedAmount(p, now))} zł / mies.</small></a>
            <select value={p.vat?.rate ?? ''} aria-label={`VAT ${p.name}`} onChange={(e) => savePosition({ ...p, vat: e.target.value ? { rate: Number(e.target.value), deductible: p.vat?.deductible ?? 100 } : undefined })}>
              <option value="">bez VAT</option>
              {[23, 8, 5].map((r) => <option key={r} value={r}>{r}%</option>)}
            </select>
            <select value={p.vat?.deductible ?? 100} disabled={!p.vat} aria-label={`Odliczenie ${p.name}`} onChange={(e) => savePosition({ ...p, vat: { ...p.vat!, deductible: Number(e.target.value) } })}>
              <option value={100}>100%</option>
              <option value={50}>50%</option>
            </select>
          </li>
        ))}
      </ul>
      {others.length > 0 && (
        <select className="add-vat" value="" aria-label="Dodaj koszt z VAT" onChange={(e) => { const p = doc.positions[e.target.value]; if (p) savePosition({ ...p, vat: { rate: 23, deductible: 100 } }); }}>
          <option value="">+ inny koszt z fakturą VAT (np. telefon)…</option>
          {others.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      )}
    </section>
  );
}
