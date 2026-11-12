import { useMemo, useState } from 'react';
import { useStore } from '../lib/store';
import type { MonthKey, Position, Section } from '../lib/types';
import { entryKey } from '../lib/types';
import { addMonths, currentMonth, monthLocative, monthName, monthRange, monthShort } from '../lib/month';
import { linesForMonth, overdue, sectionTotals } from '../lib/projection';
import type { Line } from '../lib/projection';
import { amountsHidden, fold, money, parseMoney, today } from '../lib/format';
import { SECTIONS, sortedCategories } from '../lib/sections';
import { newId } from '../lib/ids';
import { CopyButton, Field, Money, Sheet } from '../ui';
import { addManualTxn, detachTxn, EXPENSE_SUGGESTIONS, isInbox, txnAmountFor, txnTouches } from '../import/match';
import { isMine, knownPeople } from '../lib/people';
import { isActive } from '../lib/projection';
import { isExpense, sectionOf } from '../lib/sections';
import { HelpLink } from './HelpView';

const byDayThenName = (a: Line, b: Line) =>
  (a.position.day ?? 99) - (b.position.day ?? 99) || a.position.name.localeCompare(b.position.name);

export default function MonthView() {
  const { doc, user } = useStore();
  const [month, setMonth] = useState(currentMonth);
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [onlyMine, setOnlyMine] = useState(false);
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [addFor, setAddFor] = useState<string | null>(null);

  const lines = useMemo(() => linesForMonth(doc, month), [doc, month]);
  const { totals, balance, balanceNow } = useMemo(() => sectionTotals(lines), [lines]);
  const late = useMemo(() => (month === currentMonth() ? overdue(doc, month) : []), [doc, month]);
  const ahead = useMemo(
    () => monthRange(addMonths(month, 1), 3).map((m) => ({ m, ...sectionTotals(linesForMonth(doc, m)) })),
    [doc, month],
  );

  const q = fold(query);
  const cats = useMemo(() => sortedCategories(doc), [doc]);
  const visible = (l: Line) =>
    (!onlyOpen || l.expense || !l.paid) &&
    (!onlyMine || l.expense || isMine(l.position.payer, user)) &&
    (!q || fold(l.position.name).includes(q));

  /** Grupy sekcji: najpierw spłaty kart kredytowych, potem kategorie. */
  const sectionGroups = (section: Section) => {
    const inSection = lines.filter((l) => l.section === section && visible(l));
    const cards = inSection.filter((l) => l.position.cardRepayment).sort(byDayThenName);
    const groups = cats
      .map((c) => ({
        key: c.id,
        title: c.name,
        cards: false,
        lines: inSection.filter((l) => !l.position.cardRepayment && l.position.categoryId === c.id).sort(byDayThenName),
      }))
      .filter((g) => g.lines.length > 0);
    return cards.length ? [{ key: 'karty', title: 'Karty kredytowe do spłaty', cards: true, lines: cards }, ...groups] : groups;
  };

  const { update } = useStore();
  const expensePositions = Object.values(doc.positions).filter((p) => isActive(p, month) && isExpense(doc, p));
  const missingKinds = EXPENSE_SUGGESTIONS.filter(
    (name) => !expensePositions.some((p) => fold(p.name).includes(fold(name.split(' ')[0]).slice(0, 6))),
  );

  /** Dodaje rodzaj wydatku (pozycję bez budżetu) w pierwszej kategorii sekcji Wydatki. */
  const addKind = (name: string) =>
    update((d, stamp) => {
      const categories = { ...d.categories };
      let cat = Object.values(categories).find((c) => !c.deleted && sectionOf(c) === 'wydatki');
      if (!cat) {
        const cid = newId('c');
        cat = { id: cid, name: 'WYDATKI', order: Object.keys(categories).length, section: 'wydatki', ...stamp() };
        categories[cid] = cat;
      }
      const id = newId('p');
      return {
        ...d,
        categories,
        positions: { ...d.positions, [id]: { id, name, categoryId: cat.id, activeFrom: month, rules: [{ from: month, amount: 0 }], ...stamp() } },
      };
    });

  return (
    <>
      <header className="month-head">
        <button type="button" className="ghost nav" onClick={() => setMonth(addMonths(month, -1))} aria-label="Poprzedni miesiąc">‹</button>
        <h1>
          <span className="month-name">{monthName(month)}</span>
          <span className="month-year">{month.slice(0, 4)}</span>
        </h1>
        <button type="button" className="ghost nav" onClick={() => setMonth(addMonths(month, 1))} aria-label="Następny miesiąc">›</button>
      </header>
      <p className="eye-row">
        <button type="button" className="small ghost" onClick={() => dispatchEvent(new Event('toggle-amounts'))}>
          {amountsHidden() ? 'Pokaż kwoty' : 'Ukryj kwoty'}
        </button>
        <HelpLink topic="widok-miesiąca" />
      </p>
      {month !== currentMonth() && (
        <p className="center"><button type="button" className="small" onClick={() => setMonth(currentMonth())}>Wróć do bieżącego miesiąca</button></p>
      )}

      <section className="blocks" aria-label="Podsumowanie miesiąca">
        {SECTIONS.map((s) => {
          const t = totals[s.id];
          if (t.count === 0) return null;
          const expense = s.id === 'wydatki';
          const share = expense ? (t.planned ? Math.min(1, t.done / t.planned) : 0) : t.count ? t.doneCount / t.count : 0;
          const over = expense && t.planned !== 0 && Math.abs(t.done) > Math.abs(t.planned);
          return (
            <a key={s.id} className={`block ${s.id}${over ? ' over' : ''}`} href={`#miesiac`} onClick={(e) => { e.preventDefault(); document.getElementById(`sekcja-${s.id}`)?.scrollIntoView({ behavior: 'smooth' }); }}>
              <span className="block-title">{s.short}</span>
              <span className="block-main">{money(expense ? t.done : t.amount)}</span>
              <span className="block-sub">
                {expense
                  ? `z budżetu ${money(t.planned)}`
                  : `${s.id === 'przychody' ? 'wpłynęło' : 'zapłacone'} ${t.doneCount}/${t.count} · ${money(t.done)}`}
              </span>
              <span className="bar"><span style={{ width: `${share * 100}%` }} /></span>
            </a>
          );
        })}
        <div className={`block balance${balance < 0 ? ' negative' : ''}`}>
          <span className="block-title">Balans miesiąca</span>
          <span className="block-main">{money(balance)}</span>
          <span className="block-sub">dotychczas {money(balanceNow)} · reszta wg planu</span>
          <span className="ahead">
            {ahead.map((a) => (
              <span key={a.m} className={a.balance < 0 ? 'neg' : ''}>{monthShort(a.m)} <b>{money(a.balance)}</b></span>
            ))}
            <a href="#prognoza">Prognoza ›</a>
          </span>
        </div>
      </section>

      {month === currentMonth() && <WhatsNew />}
      {month === currentMonth() && <DueSoon onOpen={setOpenId} openId={openId} />}
      {month === currentMonth() && <InboxHint />}

      {late.length > 0 && (
        <details className="late-box">
          <summary>
            <span>Zaległe z poprzednich miesięcy: {late.length}</span>
            <Money value={late.reduce((sum, l) => sum + l.amount, 0)} />
          </summary>
          <ul className="lines">
            {late.map((l) => (
              <LineRow key={`${l.position.id}|${l.month}`} line={l} showMonth open={openId === `${l.position.id}|${l.month}`} onOpen={setOpenId} />
            ))}
          </ul>
        </details>
      )}

      <div className="filters">
        <input type="search" className="search" placeholder="Szukaj w miesiącu" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Szukaj w miesiącu" />
        <label className="switch">
          <input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} />
          Tylko niezaznaczone
        </label>
        {knownPeople(doc, user).length > 1 && (
          <label className="switch">
            <input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} />
            Tylko moje{user ? ` (${user})` : ''}
          </label>
        )}
      </div>

      {SECTIONS.map((s) => {
        const groups = sectionGroups(s.id);
        if (groups.length === 0) return null;
        const t = totals[s.id];
        return (
          <section key={s.id} id={`sekcja-${s.id}`} className={`section-block ${s.id}`}>
            <header className="section-head">
              <h2>{s.title}</h2>
              <Money value={s.id === 'wydatki' ? t.done : t.amount} strong />
            </header>
            {s.id === 'wydatki' && (
              <p className="row-actions">
                <button type="button" className="small" onClick={() => setAddFor('')}>+ Dodaj wydatek</button>
                <span className="muted small-text">Suma z wyciągów i ręcznych wpisów; budżet w nawiasie.</span>
              </p>
            )}
            {s.id === 'wydatki' && missingKinds.length > 0 && (
              <details className="kinds">
                <summary className="small-text">Więcej rodzajów wydatków ({missingKinds.length})</summary>
                <p className="chips">
                  {missingKinds.map((k) => (
                    <button key={k} type="button" className="small" onClick={() => addKind(k)}>+ {k}</button>
                  ))}
                </p>
                <p className="muted small-text">Zakupy z wyciągów trafią tu same po nazwie sklepu. Budżet ustawisz w Pozycjach.</p>
              </details>
            )}
            {groups.map(({ key, title, cards, lines: ls }) => (
              <div className={`group${cards ? ' cards' : ''}`} key={key}>
                <h3 className="group-head">
                  <span>{title}</span>
                  <Money value={ls.reduce((sum, l) => sum + (l.expense ? l.spent : l.amount), 0)} />
                </h3>
                <ul className="lines">
                  {ls.map((l) =>
                    l.expense ? (
                      <ExpenseRow key={l.position.id} line={l} open={openId === `${l.position.id}|${l.month}`} onOpen={setOpenId} onAdd={() => setAddFor(l.position.id)} />
                    ) : (
                      <LineRow key={l.position.id} line={l} open={openId === `${l.position.id}|${l.month}`} onOpen={setOpenId} />
                    ),
                  )}
                </ul>
              </div>
            ))}
          </section>
        );
      })}
      {lines.length > 0 && SECTIONS.every((s) => sectionGroups(s.id).length === 0) && (
        <p className="muted center">{query ? `Nic nie znaleziono dla „${query}”.` : 'Wszystko zaznaczone w tym miesiącu.'}</p>
      )}

      {addFor !== null && (
        <AddExpense month={month} positions={expensePositions} initialPosition={addFor} onClose={() => setAddFor(null)} />
      )}
    </>
  );
}

function Details({ line }: { line: Line }) {
  const { doc, update, setActualAmount, savePosition } = useStore();
  const { position: p, month } = line;
  const account = p.accountId ? doc.accounts[p.accountId] : undefined;
  const future = month > currentMonth();
  const single = p.monthly?.[month] !== undefined;
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const txns = Object.values(doc.transactions)
    .filter((t) => !t.deleted && !t.ignored && txnTouches(t, p.id) && t.month === month)
    .sort((a, b) => a.date.localeCompare(b.date));

  const saveAmount = () => {
    const v = parseMoney(draft);
    if (v === null) return setError('Wpisz kwotę, np. -1250,50');
    setError('');
    // przyszły miesiąc: zmiana planu tylko na ten miesiąc (np. znane zdarzenie jednorazowe)
    if (future) savePosition({ ...p, monthly: { ...(p.monthly ?? {}), [month]: v } });
    else setActualAmount(p.id, month, v);
    setDraft('');
  };
  const clearSingle = () => {
    const monthly = { ...(p.monthly ?? {}) };
    delete monthly[month];
    savePosition({ ...p, monthly: Object.keys(monthly).length ? monthly : undefined });
  };

  return (
    <div className="details">
      {account?.number && (
        <p className="detail-row">
          <span>Konto <b>{account.number}</b></span>
          <CopyButton text={account.number} label="Kopiuj numer" />
        </p>
      )}
      {p.reference && <p className="detail-row"><span>Nr umowy <b>{p.reference}</b></span><CopyButton text={p.reference} /></p>}
      {p.note && <p className="muted">{p.note}</p>}
      <p className="row-actions"><a className="button small" href={`#pozycja/${p.id}`}>Historia i plan ›</a></p>
      <AccountPicker position={p} />
      {p.payer && <p className="muted small-text">Płaci i zaznacza: {p.payer}</p>}
      {line.paid && line.entry?.paidAt && (
        <p className="muted">Zaznaczone {line.entry.paidAt}{line.entry.updatedBy ? ` przez ${line.entry.updatedBy}` : ''}</p>
      )}
      {p.cardRepayment && <CardUsage line={line} />}
      <MonthNote line={line} />
      {txns.length > 0 && (
        <div className="line-txns">
          <p className="muted small-text">Transakcje ({txns.length}):</p>
          <ul className="plain-list">
            {txns.map((t) => (
              <li key={t.id} className="detail-row small-text">
                <span>{t.date.slice(5).split('-').reverse().join('.')} {t.counterparty} <b>{money(txnAmountFor(t, p.id))}</b>{t.splits?.length ? <small> (część z {money(t.amount)})</small> : null}</span>
                <button type="button" className="small ghost" onClick={() => update((d, stamp) => detachTxn(d, t.id, stamp))}>
                  {t.source === 'reczny' ? 'Usuń' : 'Odepnij'}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {!line.expense && (
        <>
          {future ? (
            <p className="detail-row">
              <span className="muted small-text">{single ? 'Plan zmieniony tylko na ten miesiąc.' : 'Przyszły miesiąc – możesz zmienić plan tylko na ten miesiąc.'}</span>
              {single && <button type="button" className="small" onClick={clearSingle}>Przywróć plan z reguły</button>}
            </p>
          ) : line.entry?.amount === undefined ? (
            <p className="muted small-text">Kwota z planu – wpisz rzeczywistą, jeśli była inna.</p>
          ) : (
            <p className="detail-row">
              <span className="muted small-text">Kwota rzeczywista zastąpiła plan.</span>
              <button type="button" className="small" onClick={() => setActualAmount(p.id, month, undefined)}>Usuń kwotę rzeczywistą</button>
            </p>
          )}
          <div className="inline-form">
            <input
              inputMode="decimal"
              placeholder={future ? 'Plan na ten miesiąc' : 'Kwota rzeczywista'}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && saveAmount()}
              aria-label={future ? 'Plan na ten miesiąc' : 'Kwota rzeczywista'}
            />
            <button type="button" className="small" onClick={saveAmount}>{future ? 'Zapisz plan' : 'Zapisz kwotę'}</button>
          </div>
          {error && <p className="error">{error}</p>}
        </>
      )}
    </div>
  );
}

/** Karta / konto pozycji – zmiana bez wchodzenia w edycję pozycji. */
function AccountPicker({ position: p }: { position: Position }) {
  const { doc, savePosition } = useStore();
  const accounts = Object.values(doc.accounts).filter((a) => !a.deleted).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <label className="account-pick">
      <span>Karta / konto</span>
      <select value={p.accountId ?? ''} onChange={(e) => savePosition({ ...p, accountId: e.target.value || undefined })}>
        <option value="">brak</option>
        {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
    </label>
  );
}

/** Zakupy kartą w poprzednim miesiącu (z zaimportowanych wyciągów tej karty) – podpowiedź kwoty spłaty. */
function CardUsage({ line }: { line: Line }) {
  const { doc, setActualAmount } = useStore();
  const { position: p, month } = line;
  const prev = addMonths(month, -1);
  const spent = Object.values(doc.transactions)
    .filter((t) => !t.deleted && t.accountId === p.accountId && t.month === prev && t.amount < 0)
    .reduce((s, t) => s + t.amount, 0);
  const account = doc.accounts[p.accountId ?? ''];
  if (!spent) {
    return <p className="muted small-text">Zakupy kartą pojawią się tu po imporcie wyciągu karty (Import → wybierz kartę „{account?.name}”).</p>;
  }
  const rounded = Math.round(spent * 100) / 100;
  return (
    <p className="detail-row small-text">
      <span>Zakupy kartą w {monthLocative(prev)}: <b>{money(rounded)}</b></span>
      {line.amount !== rounded && (
        <button type="button" className="small" onClick={() => setActualAmount(p.id, month, rounded)}>Ustaw jako kwotę spłaty</button>
      )}
    </p>
  );
}

function LineRow({ line, open, onOpen, showMonth, dateLabel }: {
  line: Line; open: boolean; onOpen: (id: string | null) => void; showMonth?: boolean; dateLabel?: string;
}) {
  const { doc, togglePaid, user } = useStore();
  const { position: p, month } = line;
  const id = `${p.id}|${month}`;
  const account = p.accountId ? doc.accounts[p.accountId] : undefined;
  const isLate = !line.paid && month === currentMonth() && p.day !== undefined && p.day < new Date().getDate();
  const income = line.section === 'przychody';
  const otherPayer = !!p.payer && p.payer !== user;
  const paidByOther = line.paid && !!line.entry?.updatedBy && line.entry.updatedBy !== user && line.entry.updatedBy !== 'to urządzenie';
  const due = p.cardRepayment && !p.day ? account?.dueDay : undefined;
  const dueNote = due ? ` · spłata do ${due}.` : '';

  return (
    <li className={`line${line.paid ? ' paid' : ''}`}>
      <button type="button" className="line-main" aria-expanded={open} onClick={() => onOpen(open ? null : id)}>
        <span className={`day${isLate ? ' late' : ''}`}>{dateLabel ?? (showMonth ? monthShort(month) : p.day ?? due ?? '–')}</span>
        <span className="name">
          {p.name}
          {account && <small>{account.name}{dueNote}</small>}
          {!account && dueNote && <small>{dueNote}</small>}
          {line.entry?.note && <small className="note">✎ {line.entry.note}</small>}
          {(otherPayer || paidByOther) && (
            <small className="payer">
              {line.paid ? `✓ ${line.entry?.updatedBy ?? ''}${line.entry?.paidAt ? `, ${line.entry.paidAt.slice(8, 10)}.${line.entry.paidAt.slice(5, 7)}` : ''}` : `płaci ${p.payer}`}
            </small>
          )}
        </span>
        <Money value={line.amount} />
      </button>
      <button
        type="button"
        className="check"
        aria-pressed={line.paid}
        aria-label={line.paid ? `Cofnij: ${p.name}` : `${income ? 'Oznacz jako otrzymane' : 'Oznacz jako zapłacone'}: ${p.name}`}
        onClick={() => togglePaid(p.id, month)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7" /></svg>
      </button>
      {open && <Details line={line} />}
    </li>
  );
}

function ExpenseRow({ line, open, onOpen, onAdd }: {
  line: Line; open: boolean; onOpen: (id: string | null) => void; onAdd: () => void;
}) {
  const { position: p, month } = line;
  const id = `${p.id}|${month}`;
  const share = line.planned ? Math.min(1, line.spent / line.planned) : line.spent ? 1 : 0;
  const over = line.planned !== 0 && Math.abs(line.spent) > Math.abs(line.planned);
  return (
    <li className={`line expense${over ? ' over' : ''}`}>
      <button type="button" className="line-main" aria-expanded={open} onClick={() => onOpen(open ? null : id)}>
        <span className="name">
          {p.name}
          <span className="bar thin"><span style={{ width: `${share * 100}%` }} /></span>
        </span>
        <span className="expense-sum">
          <Money value={line.spent} />
          {line.planned !== 0 && <small>({money(line.planned)})</small>}
        </span>
      </button>
      <button type="button" className="check add" aria-label={`Dodaj wydatek: ${p.name}`} onClick={onAdd}>+</button>
      {open && <Details line={line} />}
    </li>
  );
}

function AddExpense({ month, positions, initialPosition, onClose }: {
  month: MonthKey; positions: Position[]; initialPosition: string; onClose: () => void;
}) {
  const { update } = useStore();
  const defaultDate = month === currentMonth() ? today() : `${month}-01`;
  const [positionId, setPositionId] = useState(initialPosition || positions[0]?.id || '');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(defaultDate);
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const sorted = [...positions].sort((a, b) => a.name.localeCompare(b.name));

  const save = () => {
    const v = parseMoney(amount);
    if (v === null || v === 0) return setError('Wpisz kwotę, np. 45,90.');
    if (!positionId) return setError('Wybierz, na co był wydatek.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return setError('Podaj datę.');
    // wydatek wpisany jako dodatnia liczba zapisujemy ze znakiem minus
    update((d, stamp) => addManualTxn(d, { positionId, date, amount: -Math.abs(v), description: description.trim() }, stamp, newId('t')));
    onClose();
  };

  return (
    <Sheet title="Dodaj wydatek" onClose={onClose}>
      {sorted.length === 0 ? (
        <p className="muted">W tym miesiącu nie ma pozycji w sekcji Wydatki. Dodaj je w Pozycjach (np. spożywka, restauracje) w kategorii z sekcją „Wydatki”.</p>
      ) : (
        <>
          <Field label="Na co">
            <select value={positionId} onChange={(e) => setPositionId(e.target.value)}>
              {sorted.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <Field label="Kwota (zł)"><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="45,90" autoFocus /></Field>
          <Field label="Data"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Opis (opcjonalnie)"><input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="np. targ, gotówka" /></Field>
          {error && <p className="error">{error}</p>}
          <p className="row-actions"><button type="button" className="primary" onClick={save}>Dodaj</button></p>
        </>
      )}
    </Sheet>
  );
}

/** Notatka do tego miesiąca tej pozycji – widoczna dla obojga. */
function MonthNote({ line }: { line: Line }) {
  const { update } = useStore();
  const { position: p, month } = line;
  const [text, setText] = useState(line.entry?.note ?? '');
  const [saved, setSaved] = useState(false);
  const save = () => {
    update((d, stamp) => {
      const key = entryKey(p.id, month);
      const prev = d.entries[key] && !d.entries[key].deleted ? d.entries[key] : { positionId: p.id, month, paid: false };
      return { ...d, entries: { ...d.entries, [key]: { ...prev, note: text.trim() || undefined, ...stamp() } } };
    });
    setSaved(true);
  };
  return (
    <div className="month-note">
      <label className="field-label" htmlFor={`note-${p.id}-${month}`}>Notatka do tego miesiąca</label>
      <div className="inline-form">
        <input id={`note-${p.id}-${month}`} value={text} onChange={(e) => { setText(e.target.value); setSaved(false); }} placeholder="np. zapłaciłam z mojego konta" />
        <button type="button" className="small" onClick={save} disabled={text === (line.entry?.note ?? '')}>{saved ? 'Zapisano' : 'Zapisz'}</button>
      </div>
    </div>
  );
}

/** Liczba transakcji czekających w skrzynce importu. */
function InboxHint() {
  const { doc } = useStore();
  const n = Object.values(doc.transactions).filter(isInbox).length;
  if (n === 0) return null;
  return (
    <a className="panel inbox-hint" href="#import">
      <span>Skrzynka: <b>{n}</b> {n === 1 ? 'transakcja czeka' : 'transakcji czeka'} na przypisanie</span>
      <span aria-hidden="true">›</span>
    </a>
  );
}

/** Najbliższe 14 dni: niezaznaczone opłaty i przychody po dacie, z zaległymi z bieżącego miesiąca na górze. */
function DueSoon({ onOpen, openId }: { onOpen: (id: string | null) => void; openId: string | null }) {
  const { doc } = useStore();
  const now = currentMonth();
  const today = new Date();
  const horizon = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 14);
  const items = [now, addMonths(now, 1)]
    .flatMap((m) => linesForMonth(doc, m))
    .filter((l) => !l.expense && !l.paid && l.amount !== 0)
    .map((l) => {
      const day = l.position.day ?? (l.position.cardRepayment ? doc.accounts[l.position.accountId ?? '']?.dueDay : undefined);
      if (!day) return null;
      const [y, mo] = l.month.split('-').map(Number);
      const date = new Date(y, mo - 1, Math.min(day, new Date(y, mo, 0).getDate()));
      return { l, date };
    })
    .filter((x): x is { l: Line; date: Date } => !!x && x.date <= horizon && (x.l.month === now || x.date >= new Date(today.getFullYear(), today.getMonth(), today.getDate())))
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  if (items.length === 0) return null;
  const sum = items.filter((x) => x.l.amount < 0).reduce((s, x) => s + x.l.amount, 0);
  return (
    <details className="due-soon" open>
      <summary>
        <span>Do zapłaty w ciągu 14 dni: {items.length}</span>
        <Money value={sum} />
      </summary>
      <ul className="lines">
        {items.map(({ l, date }) => {
          return (
            <LineRow
              key={`${l.position.id}|${l.month}`}
              line={l}
              dateLabel={`${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}`}
              open={openId === `soon|${l.position.id}|${l.month}`}
              onOpen={(id) => onOpen(id ? `soon|${id}` : null)}
            />
          );
        })}
      </ul>
    </details>
  );
}

const SEEN_KEY = 'last-seen';

/** Zmiany drugiej osoby od ostatniego zamknięcia tej informacji na tym urządzeniu. */
function WhatsNew() {
  const { doc, user } = useStore();
  const [seen, setSeen] = useState(() => {
    try {
      const v = localStorage.getItem(SEEN_KEY);
      if (v) return v;
      const now = new Date().toISOString();
      localStorage.setItem(SEEN_KEY, now);
      return now;
    } catch {
      return new Date().toISOString();
    }
  });
  const isOther = (by: string) => !!by && by !== user && by !== 'to urządzenie' && by !== 'import-flow4';
  const changes: { at: string; by: string; text: string }[] = [];
  for (const e of Object.values(doc.entries)) {
    if (e.updatedAt <= seen || !isOther(e.updatedBy)) continue;
    const p = doc.positions[e.positionId];
    if (!p) continue;
    const text = e.paid ? `zaznaczył(a) ${p.name}` : e.note ? `notatka przy ${p.name}: „${e.note}”` : `zmienił(a) ${p.name}`;
    changes.push({ at: e.updatedAt, by: e.updatedBy, text: `${text}${e.amount !== undefined ? ` (${money(e.amount)})` : ''}` });
  }
  for (const t of Object.values(doc.transactions)) {
    if (t.updatedAt <= seen || !isOther(t.updatedBy) || t.deleted || t.ignored) continue;
    const p = doc.positions[t.positionId ?? ''];
    const target = p ? ` → ${p.name}` : t.splits?.length ? ` → podział na ${t.splits.length}` : '';
    changes.push({ at: t.updatedAt, by: t.updatedBy, text: `${t.source === 'reczny' ? 'dodał(a) wydatek' : 'zaimportował(a)'} ${t.counterparty}${target} (${money(t.amount)})` });
  }
  for (const p of Object.values(doc.positions)) {
    if (p.updatedAt <= seen || !isOther(p.updatedBy)) continue;
    changes.push({ at: p.updatedAt, by: p.updatedBy, text: `${p.deleted ? 'usunął(ęła)' : 'zmienił(a) pozycję'} ${p.name}` });
  }
  if (changes.length === 0) return null;
  changes.sort((a, b) => b.at.localeCompare(a.at));
  const dismiss = () => {
    const now = new Date().toISOString();
    try { localStorage.setItem(SEEN_KEY, now); } catch { /* brak */ }
    setSeen(now);
  };
  return (
    <section className="whats-new" aria-label="Co nowego">
      <header className="detail-row">
        <b>Co nowego od ostatniej wizyty ({changes.length})</b>
        <button type="button" className="small" onClick={dismiss}>OK, widzę</button>
      </header>
      <ul className="plain-list small-text">
        {changes.slice(0, 12).map((c, i) => (
          <li key={i}><b>{c.by}</b> {c.text} <span className="muted">· {new Date(c.at).toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span></li>
        ))}
        {changes.length > 12 && <li className="muted">i {changes.length - 12} więcej…</li>}
      </ul>
    </section>
  );
}
