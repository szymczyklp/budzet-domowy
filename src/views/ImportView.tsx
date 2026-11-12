import { useMemo, useRef, useState } from 'react';
import { useStore } from '../lib/store';
import type { BudgetDoc, CsvMapping, MonthKey, Position, Txn, TxnSource } from '../lib/types';
import { isActive } from '../lib/projection';
import { currentMonth, monthName, monthShort } from '../lib/month';
import { money, moneyInput, parseMoney } from '../lib/format';
import { newId } from '../lib/ids';
import { sortedCategories, sectionOf } from '../lib/sections';
import { decodeBytes } from '../import/csv';
import { csvSignature, parseBankCsv, parseMappedCsv, parseMillenniumLines, SOURCE_LABEL, UnknownCsv } from '../import/parsers';
import type { RawTxn } from '../import/parsers';
import { applyImport, defaultPattern, isInbox, sortedRules, suggest, txnMonth } from '../import/match';
import type { Decision, How, SplitPart } from '../import/match';
import { findRecurring } from '../import/recurring';
import { Field, Money, Sheet } from '../ui';
import { HelpLink } from './HelpView';

interface Row {
  txn: RawTxn;
  decision: Decision;
  how?: How;
  manual: boolean;
  remember: boolean;
  pattern: string;
}

type Filter = 'todo' | 'all' | 'assigned' | 'ignored';
const IGNORE = '__ignore';
const SPLIT = '__split';

const encode = (d: Decision) => (d === null ? '' : 'ignore' in d ? IGNORE : 'split' in d ? SPLIT : d.positionId);

/** Pozycje aktywne w miesiącu, pogrupowane w kategorie (do list wyboru). */
const useOptions = (doc: BudgetDoc) =>
  useMemo(() => {
    const cache = new Map<MonthKey, { name: string; positions: Position[] }[]>();
    const cats = sortedCategories(doc);
    return (m: MonthKey) => {
      if (!cache.has(m)) {
        const active = Object.values(doc.positions).filter((p) => isActive(p, m));
        cache.set(
          m,
          cats
            .map((c) => ({ name: c.name, positions: active.filter((p) => p.categoryId === c.id).sort((a, b) => a.name.localeCompare(b.name)) }))
            .filter((g) => g.positions.length > 0),
        );
      }
      return cache.get(m)!;
    };
  }, [doc]);

function PositionSelect({ value, month, onChange, label, allowSplit = true }: {
  value: string; month: MonthKey; onChange: (v: string) => void; label: string; allowSplit?: boolean;
}) {
  const { doc } = useStore();
  const options = useOptions(doc);
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      <option value="">— nie teraz —</option>
      <option value={IGNORE}>Pomiń (przelew własny, nie dotyczy budżetu)</option>
      {allowSplit && <option value={SPLIT}>Podziel na kilka pozycji…</option>}
      {options(month).map((g) => (
        <optgroup key={g.name} label={g.name}>
          {g.positions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </optgroup>
      ))}
    </select>
  );
}

export default function ImportView() {
  const { doc, update } = useStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [parsed, setParsed] = useState<{ source: TxnSource; fileName: string; total: number; duplicates: number } | null>(null);
  const [unknown, setUnknown] = useState<{ rows: string[][]; fileName: string } | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [filter, setFilter] = useState<Filter>('todo');
  const [month, setMonth] = useState<MonthKey | 'all'>('all');
  const [done, setDone] = useState<{ assigned: number; ignored: number; inbox: number; rules: number; months: MonthKey[] } | null>(null);
  const [splitFor, setSplitFor] = useState<{ txn: RawTxn; onDone: (parts: SplitPart[]) => void } | null>(null);
  const cards = Object.values(doc.accounts).filter((a) => !a.deleted && a.kind === 'karta').sort((a, b) => a.name.localeCompare(b.name));
  const [cardId, setCardIdState] = useState('');
  const setCardId = (id: string) => {
    setCardIdState(id);
    try { localStorage.setItem(`import-card-${parsed?.source}`, id); } catch { /* bez pamięci wyboru */ }
  };

  const loadTxns = (source: TxnSource, txns: RawTxn[], fileName: string) => {
    const fresh = txns.filter((t) => !doc.transactions[t.id] || doc.transactions[t.id].deleted);
    const rules = sortedRules(doc);
    setRows(
      fresh
        .sort((a, b) => b.date.localeCompare(a.date))
        .map((txn) => {
          const s = suggest(doc, txn, rules);
          return { txn, decision: s.decision, how: s.how, manual: false, remember: false, pattern: defaultPattern(txn) };
        }),
    );
    setParsed({ source, fileName, total: txns.length, duplicates: txns.length - fresh.length });
    let remembered = '';
    try { remembered = localStorage.getItem(`import-card-${source}`) ?? ''; } catch { /* brak */ }
    setCardIdState(doc.accounts[remembered] ? remembered : '');
    setFilter('todo');
    // domyślnie najnowszy miesiąc z pliku – starsze zwykle są już rozliczone
    setMonth(fresh.length ? fresh.map((t) => txnMonth(t.date)).sort().at(-1)! : 'all');
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError('');
    setDone(null);
    setUnknown(null);
    setBusy(true);
    try {
      if (file.size > 25 * 1024 * 1024) throw new Error('Plik jest za duży (ponad 25 MB) – to nie wygląda na wyciąg z banku.');
      const data = await file.arrayBuffer();
      if (file.name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf') {
        const { pdfLines } = await import('../import/pdf');
        const txns = parseMillenniumLines(await pdfLines(data));
        if (txns.length === 0) throw new Error('Nie znalazłem transakcji w tym PDF. Obsługiwane są wyciągi z Banku Millennium – prześlij przykład innego banku, a go dodam.');
        loadTxns('millennium', txns, file.name);
      } else {
        try {
          const { source, txns } = parseBankCsv(decodeBytes(data), doc.settings.main?.csvMappings);
          loadTxns(source, txns, file.name);
        } catch (e) {
          if (e instanceof UnknownCsv) {
            setParsed(null);
            setRows([]);
            setUnknown({ rows: e.rows, fileName: file.name });
          } else throw e;
        }
      }
    } catch (e) {
      setParsed(null);
      setRows([]);
      setError((e as Error).message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const months = useMemo(() => [...new Set(rows.map((r) => txnMonth(r.txn.date)))].sort().reverse(), [rows]);
  const inScope = (r: Row) => month === 'all' || txnMonth(r.txn.date) === month;

  const counts = useMemo(() => {
    const inMonth = rows.filter(inScope);
    return {
      todo: inMonth.filter((r) => r.decision === null).length,
      assigned: inMonth.filter((r) => r.decision && !('ignore' in r.decision)).length,
      ignored: inMonth.filter((r) => r.decision && 'ignore' in r.decision).length,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, month]);

  const visible = rows.filter((r) => {
    if (!inScope(r)) return false;
    // ręcznie wybrane zostają na liście „do przypisania”, żeby było widać opcję zapamiętania reguły
    if (filter === 'todo') return r.decision === null || r.manual;
    if (filter === 'assigned') return !!r.decision && !('ignore' in r.decision);
    if (filter === 'ignored') return !!r.decision && 'ignore' in r.decision;
    return true;
  });

  const patch = (id: string, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.txn.id === id ? { ...r, ...p } : r)));
  const choose = (row: Row, value: string) => {
    if (value === SPLIT) {
      setSplitFor({ txn: row.txn, onDone: (parts) => patch(row.txn.id, { decision: { split: parts }, how: undefined, manual: true, remember: false }) });
      return;
    }
    const decision: Decision = value === '' ? null : value === IGNORE ? { ignore: true } : { positionId: value };
    patch(row.txn.id, { decision, how: undefined, manual: true, remember: value !== '' });
  };

  const commit = () => {
    const scoped = rows.filter(inScope);
    update((d, stamp) =>
      applyImport(
        d,
        scoped.map((r) => ({
          txn: cardId ? { ...r.txn, accountId: cardId } : r.txn,
          decision: r.decision,
          rulePattern: r.manual && r.remember ? r.pattern : undefined,
        })),
        stamp,
        () => newId('r'),
        { keepUndecided: true },
      ).doc,
    );
    setDone({
      assigned: scoped.filter((r) => r.decision && !('ignore' in r.decision)).length,
      ignored: scoped.filter((r) => r.decision && 'ignore' in r.decision).length,
      inbox: scoped.filter((r) => r.decision === null).length,
      rules: scoped.filter((r) => r.manual && r.remember && r.pattern.trim() && r.decision && !('split' in r.decision)).length,
      months: [...new Set(scoped.map((r) => txnMonth(r.txn.date)))].sort(),
    });
    const saved = new Set(scoped.map((r) => r.txn.id));
    setRows((rs) => rs.filter((r) => !saved.has(r.txn.id)));
    window.scrollTo(0, 0);
  };

  const scopedCount = rows.filter(inScope).length;
  const extra = useMemo(() => rows.map((r) => r.txn), [rows]);

  return (
    <>
      <header className="page-head">
        <h1>Import z banku <HelpLink topic="import-z-banku" /></h1>
        {!parsed && !unknown && (
          <>
            <p className="muted">
              Wgraj historię z banku – transakcje przypiszą się do pozycji, a pozycje oznaczą jako rozliczone z kwotą z wyciągu.
              Nieprzypisane trafią do skrzynki. Ponowne wgranie tego samego okresu nie zdubluje danych.
            </p>
            <p className="muted small-text">
              Rozpoznawane: PKO BP (konto i karta, CSV), Bank Millennium (PDF), Revolut (CSV), mBank (CSV). Inny CSV – wskażesz kolumny raz, a aplikacja zapamięta format.
            </p>
          </>
        )}
        <label className="button primary file-button">
          {busy ? 'Czytam plik…' : parsed || unknown ? 'Wybierz inny plik' : 'Wybierz plik z banku'}
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.pdf,.txt,text/csv,application/pdf,text/comma-separated-values"
            disabled={busy}
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
        </label>
        {error && <p className="error">{error}</p>}
      </header>

      {unknown && (
        <MappingForm
          rows={unknown.rows}
          onDone={(map, txns) => {
            update((d, stamp) => ({
              ...d,
              settings: {
                ...d.settings,
                main: {
                  ...(d.settings.main ?? { id: 'main' }),
                  id: 'main',
                  csvMappings: { ...(d.settings.main?.csvMappings ?? {}), [csvSignature(unknown.rows[map.headerRow])]: map },
                  ...stamp(),
                },
              },
            }));
            setUnknown(null);
            loadTxns('csv', txns, unknown.fileName);
          }}
        />
      )}

      {done && (
        <section className="panel">
          <h2>Zapisano</h2>
          <p>
            Przypisane: <b>{done.assigned}</b>, pominięte: <b>{done.ignored}</b>, do skrzynki: <b>{done.inbox}</b>
            {done.rules > 0 && <>, nowe reguły: <b>{done.rules}</b></>}.
          </p>
          <p className="muted small-text">Miesiące: {done.months.map((m) => `${monthName(m)} ${m.slice(0, 4)}`).join(', ')}.</p>
          <a className="button small" href="#miesiac">Przejdź do miesiąca</a>
        </section>
      )}

      {parsed && (
        <>
          <section className="panel">
            <p><b>{SOURCE_LABEL[parsed.source]}</b> · {parsed.fileName}</p>
            {parsed.source !== 'pko-konto' && parsed.source !== 'millennium' && cards.length > 0 && (
              <label className="account-pick">
                <span>{parsed.source === 'pko-karta' ? 'Karta z tego wyciągu' : 'Karta / konto (opcjonalnie)'}</span>
                <select value={cardId} onChange={(e) => setCardId(e.target.value)}>
                  <option value="">— nie wiem / brak —</option>
                  {cards.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </label>
            )}
            <p className="muted small-text">
              Transakcji w pliku: {parsed.total}
              {parsed.duplicates > 0 && `, już zaimportowanych wcześniej: ${parsed.duplicates}`}.
            </p>
          </section>

          {rows.length > 0 && (
            <div className="filters">
              <select value={month} onChange={(e) => setMonth(e.target.value as MonthKey | 'all')} aria-label="Miesiąc">
                <option value="all">Wszystkie miesiące</option>
                {months.map((m) => <option key={m} value={m}>{monthName(m)} {m.slice(0, 4)}</option>)}
              </select>
              <div className="segmented" role="group" aria-label="Filtr">
                <button type="button" aria-pressed={filter === 'todo'} onClick={() => setFilter('todo')}>Do przypisania {counts.todo}</button>
                <button type="button" aria-pressed={filter === 'assigned'} onClick={() => setFilter('assigned')}>Przypisane {counts.assigned}</button>
                <button type="button" aria-pressed={filter === 'ignored'} onClick={() => setFilter('ignored')}>Pominięte {counts.ignored}</button>
                <button type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>Wszystkie</button>
              </div>
            </div>
          )}

          <ul className="txns">
            {visible.map((r) => {
              const m = txnMonth(r.txn.date);
              return (
                <li key={r.txn.id} className={r.decision === null ? 'txn todo' : 'txn'}>
                  <TxnHead txn={r.txn} />
                  <div className="txn-choose">
                    <PositionSelect value={encode(r.decision)} month={m} onChange={(v) => choose(r, v)} label={`Pozycja dla ${r.txn.counterparty}`} />
                    {r.how && <span className="badge" title="Skąd ta propozycja">{r.how}</span>}
                  </div>
                  {r.decision && 'split' in r.decision && <p className="small-text muted">{r.decision.split.map((x) => `${doc.positions[x.positionId]?.name}: ${money(x.amount)}`).join(' · ')}</p>}
                  {r.manual && r.decision !== null && !('split' in r.decision) && (
                    <label className="remember">
                      <input type="checkbox" checked={r.remember} onChange={(e) => patch(r.txn.id, { remember: e.target.checked })} />
                      <span>Zapamiętaj: opis zawiera</span>
                      <input value={r.pattern} onChange={(e) => patch(r.txn.id, { pattern: e.target.value })} aria-label="Wzorzec reguły" />
                    </label>
                  )}
                  <details className="txn-more">
                    <summary>Szczegóły</summary>
                    <p className="small-text muted">{r.txn.text}</p>
                  </details>
                </li>
              );
            })}
          </ul>
          {rows.length > 0 && visible.length === 0 && <p className="muted center">Brak transakcji w tym widoku.</p>}
          {parsed && rows.length === 0 && !done && <p className="muted">Wszystkie transakcje z tego pliku są już zaimportowane.</p>}

          {scopedCount > 0 && (
            <div className="import-bar">
              <span>Zapisz{month !== 'all' ? ` (${monthName(month)})` : ''}: {scopedCount}</span>
              <button type="button" className="primary" onClick={commit}>Zatwierdź</button>
            </div>
          )}
        </>
      )}

      <Inbox onSplit={(txn, onDone) => setSplitFor({ txn, onDone })} />
      <Recurring extra={extra} />
      <RulesSection />

      {splitFor && <SplitEditor txn={splitFor.txn} onClose={() => setSplitFor(null)} onDone={(parts) => { splitFor.onDone(parts); setSplitFor(null); }} />}
    </>
  );
}

function TxnHead({ txn }: { txn: RawTxn }) {
  const m = txnMonth(txn.date);
  return (
    <div className="txn-head">
      <span className="txn-date">{txn.date.slice(8, 10)} {monthShort(m)}</span>
      <span className="name">{txn.counterparty}</span>
      <Money value={txn.amount} />
    </div>
  );
}

/* ---------- skrzynka: zapisane, nieprzypisane transakcje ---------- */

function Inbox({ onSplit }: { onSplit: (txn: RawTxn, onDone: (parts: SplitPart[]) => void) => void }) {
  const { doc, update } = useStore();
  const [cardMode, setCardMode] = useState(false);
  const items = Object.values(doc.transactions).filter(isInbox).sort((a, b) => b.date.localeCompare(a.date));
  if (items.length === 0) return null;

  const apply = (t: Txn, decision: Decision, rulePattern?: string) =>
    update((d, stamp) => applyImport(d, [{ txn: t, decision, rulePattern }], stamp, () => newId('r')).doc);

  return (
    <section className="panel inbox">
      <header className="detail-row">
        <h2>Skrzynka – do przypisania ({items.length})</h2>
        <button type="button" className="small primary" onClick={() => setCardMode(true)}>Przeglądaj po jednej</button>
      </header>
      <p className="muted small-text">Zapisane transakcje bez pozycji – widzi je też druga osoba. Przypisz albo pomiń.</p>
      <ul className="txns">
        {items.slice(0, 50).map((t) => (
          <InboxRow key={t.id} txn={t} onApply={apply} onSplit={onSplit} />
        ))}
      </ul>
      {items.length > 50 && <p className="muted small-text">Pokazuję 50 najnowszych z {items.length}.</p>}
      {cardMode && <CardMode items={items} onApply={apply} onSplit={onSplit} onClose={() => setCardMode(false)} />}
    </section>
  );
}

function InboxRow({ txn, onApply, onSplit }: {
  txn: Txn; onApply: (t: Txn, d: Decision, rule?: string) => void; onSplit: (txn: RawTxn, onDone: (parts: SplitPart[]) => void) => void;
}) {
  const { doc } = useStore();
  const s = useMemo(() => suggest(doc, txn), [doc, txn]);
  const [value, setValue] = useState(encode(s.decision));
  const [remember, setRemember] = useState(true);
  const [pattern, setPattern] = useState(defaultPattern(txn));
  const decision: Decision = value === '' ? null : value === IGNORE ? { ignore: true } : value === SPLIT ? null : { positionId: value };
  return (
    <li className="txn todo">
      <TxnHead txn={txn} />
      <div className="txn-choose">
        <PositionSelect
          value={value}
          month={txn.month}
          label={`Pozycja dla ${txn.counterparty}`}
          onChange={(v) => (v === SPLIT ? onSplit(txn, (parts) => onApply(txn, { split: parts })) : setValue(v))}
        />
        {s.how && value === encode(s.decision) && <span className="badge">{s.how}</span>}
      </div>
      {decision && (
        <div className="remember">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} aria-label="Zapamiętaj regułę" />
          <span>Zapamiętaj: opis zawiera</span>
          <input value={pattern} onChange={(e) => setPattern(e.target.value)} aria-label="Wzorzec reguły" />
          <button type="button" className="small primary" onClick={() => onApply(txn, decision, remember ? pattern : undefined)}>Zapisz</button>
        </div>
      )}
    </li>
  );
}

/** Przeglądanie skrzynki po jednej transakcji – wygodne na telefonie. */
function CardMode({ items, onApply, onSplit, onClose }: {
  items: Txn[]; onApply: (t: Txn, d: Decision, rule?: string) => void; onSplit: (txn: RawTxn, onDone: (parts: SplitPart[]) => void) => void; onClose: () => void;
}) {
  const { doc } = useStore();
  const [skipped, setSkipped] = useState<string[]>([]);
  const [remember, setRemember] = useState(true);
  const queue = items.filter((t) => !skipped.includes(t.id) && isInbox(doc.transactions[t.id] ?? t));
  const t = queue[0];
  const s = useMemo(() => (t ? suggest(doc, t) : null), [doc, t]);
  const [other, setOther] = useState('');

  if (!t) {
    return (
      <Sheet title="Skrzynka" onClose={onClose}>
        <p>Gotowe – {skipped.length ? `zostało ${skipped.length} odłożonych na później.` : 'skrzynka pusta.'}</p>
        <button type="button" className="primary" onClick={onClose}>Zamknij</button>
      </Sheet>
    );
  }
  const go = (d: Decision) => {
    onApply(t, d, remember && d && !('split' in d) ? defaultPattern(t) : undefined);
    setOther('');
  };
  const suggested = s?.decision && 'positionId' in s.decision ? s.decision.positionId : undefined;

  return (
    <Sheet title={`Do przypisania: ${queue.length}`} onClose={onClose}>
      <div className="swipe-card">
        <p className="txn-date">{t.date.split('-').reverse().join('.')}</p>
        <p className="swipe-name">{t.counterparty}</p>
        <p className="swipe-amount"><Money value={t.amount} strong /></p>
        <p className="muted small-text">{t.text}</p>
      </div>
      {suggested && (
        <button type="button" className="primary wide" onClick={() => go({ positionId: suggested })}>
          {doc.positions[suggested]?.name} <small>({s?.how})</small>
        </button>
      )}
      <div className="txn-choose">
        <PositionSelect value={other} month={t.month} label="Inna pozycja" onChange={(v) => {
          if (v === SPLIT) return onSplit(t, (parts) => onApply(t, { split: parts }));
          if (v === IGNORE) return go({ ignore: true });
          if (v) go({ positionId: v });
          else setOther(v);
        }} />
      </div>
      <label className="switch">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
        Zapamiętaj jako regułę („{defaultPattern(t)}”)
      </label>
      <p className="row-actions">
        <button type="button" onClick={() => go({ ignore: true })}>Pomiń transakcję</button>
        <button type="button" onClick={() => setSkipped((x) => [...x, t.id])}>Później</button>
      </p>
    </Sheet>
  );
}

/* ---------- podział transakcji ---------- */

function SplitEditor({ txn, onClose, onDone }: { txn: RawTxn; onClose: () => void; onDone: (parts: SplitPart[]) => void }) {
  const [parts, setParts] = useState<{ positionId: string; amount: string }[]>([
    { positionId: '', amount: moneyInput(txn.amount) },
    { positionId: '', amount: '' },
  ]);
  const [error, setError] = useState('');
  const m = txnMonth(txn.date);
  const sum = parts.reduce((a, p) => a + (parseMoney(p.amount) ?? 0), 0);
  const rest = Math.round((txn.amount - sum) * 100) / 100;
  const set = (i: number, p: Partial<{ positionId: string; amount: string }>) => setParts((xs) => xs.map((x, j) => (j === i ? { ...x, ...p } : x)));

  const save = () => {
    const out: SplitPart[] = [];
    for (const p of parts) {
      if (!p.amount.trim() && !p.positionId) continue;
      const v = parseMoney(p.amount);
      if (v === null) return setError('Wpisz kwoty części, np. -120,50.');
      if (!p.positionId || p.positionId === IGNORE || p.positionId === SPLIT) return setError('Wybierz pozycję dla każdej części.');
      out.push({ positionId: p.positionId, amount: v });
    }
    if (out.length < 2) return setError('Podział ma sens dla co najmniej dwóch części.');
    if (Math.abs(rest) > 0.004) return setError(`Części muszą sumować się do kwoty transakcji – brakuje ${money(rest)}.`);
    onDone(out);
  };

  return (
    <Sheet title="Podziel transakcję" onClose={onClose}>
      <TxnHead txn={txn} />
      {parts.map((p, i) => (
        <div className="split-row" key={i}>
          <PositionSelect value={p.positionId} month={m} allowSplit={false} label={`Pozycja części ${i + 1}`} onChange={(v) => set(i, { positionId: v })} />
          <input inputMode="decimal" value={p.amount} onChange={(e) => set(i, { amount: e.target.value })} placeholder="kwota" aria-label={`Kwota części ${i + 1}`} />
        </div>
      ))}
      <p className="detail-row">
        <button type="button" className="small" onClick={() => setParts((xs) => [...xs, { positionId: '', amount: rest ? moneyInput(rest) : '' }])}>+ część</button>
        <span className={Math.abs(rest) > 0.004 ? 'error small-text' : 'ok small-text'}>{Math.abs(rest) > 0.004 ? `Do rozdzielenia: ${money(rest)}` : 'Suma się zgadza'}</span>
      </p>
      {error && <p className="error">{error}</p>}
      <p className="row-actions"><button type="button" className="primary" onClick={save}>Zapisz podział</button></p>
    </Sheet>
  );
}

/* ---------- mapowanie kolumn nieznanego CSV ---------- */

function MappingForm({ rows, onDone }: { rows: string[][]; onDone: (map: CsvMapping, txns: RawTxn[]) => void }) {
  // nagłówek: pierwszy wiersz z co najmniej 3 niepustymi polami
  const guessHeader = Math.max(0, rows.findIndex((r) => r.filter((x) => x.trim()).length >= 3));
  const [headerRow, setHeaderRow] = useState(guessHeader);
  const head = rows[headerRow] ?? [];
  const find = (re: RegExp) => head.findIndex((h) => re.test(h));
  const [date, setDate] = useState(Math.max(0, find(/data|date/i)));
  const [amount, setAmount] = useState(Math.max(0, find(/kwota|amount|warto|suma/i)));
  const [text, setText] = useState<number[]>([find(/opis|tytu|desc/i)].filter((i) => i >= 0));
  const [party, setParty] = useState(find(/odbiorc|nadawc|kontrahent|payee|merchant/i));
  const [invert, setInvert] = useState(false);
  const map: CsvMapping = { date, amount, text, headerRow, ...(party >= 0 ? { counterparty: party } : {}), ...(invert ? { invert } : {}) };
  const preview = useMemo(() => parseMappedCsv(rows, map), [rows, date, amount, text, party, invert, headerRow]); // eslint-disable-line react-hooks/exhaustive-deps
  const cols = head.map((h, i) => ({ i, label: `${i + 1}. ${h || '(bez nazwy)'}` }));

  return (
    <section className="panel">
      <h2>Wskaż kolumny</h2>
      <p className="muted small-text">Nie znam tego formatu. Ustaw kolumny raz – kolejne pliki z tego banku wczytają się same.</p>
      <Field label="Wiersz nagłówka">
        <select value={headerRow} onChange={(e) => setHeaderRow(Number(e.target.value))}>
          {rows.slice(0, 15).map((r, i) => <option key={i} value={i}>{i + 1}: {r.join(' | ').slice(0, 60)}</option>)}
        </select>
      </Field>
      <div className="two">
        <Field label="Data"><select value={date} onChange={(e) => setDate(Number(e.target.value))}>{cols.map((c) => <option key={c.i} value={c.i}>{c.label}</option>)}</select></Field>
        <Field label="Kwota"><select value={amount} onChange={(e) => setAmount(Number(e.target.value))}>{cols.map((c) => <option key={c.i} value={c.i}>{c.label}</option>)}</select></Field>
      </div>
      <Field label="Opis (można kilka)">
        <select multiple value={text.map(String)} onChange={(e) => setText([...e.target.selectedOptions].map((o) => Number(o.value)))} size={Math.min(6, cols.length)}>
          {cols.map((c) => <option key={c.i} value={c.i}>{c.label}</option>)}
        </select>
      </Field>
      <Field label="Kontrahent (opcjonalnie)">
        <select value={party} onChange={(e) => setParty(Number(e.target.value))}>
          <option value={-1}>— brak —</option>
          {cols.map((c) => <option key={c.i} value={c.i}>{c.label}</option>)}
        </select>
      </Field>
      <label className="switch">
        <input type="checkbox" checked={invert} onChange={(e) => setInvert(e.target.checked)} />
        Wydatki są w pliku na plusie (odwróć znak)
      </label>
      <p className="muted small-text">Podgląd: {preview.length} transakcji{preview[0] ? `, np. ${preview[0].date} ${preview[0].counterparty} ${money(preview[0].amount)}` : ''}.</p>
      <button type="button" className="primary" disabled={preview.length === 0} onClick={() => onDone(map, preview)}>Wczytaj i zapamiętaj format</button>
    </section>
  );
}

/* ---------- wykryte stałe płatności ---------- */

function Recurring({ extra }: { extra: RawTxn[] }) {
  const { doc, update } = useStore();
  const found = useMemo(() => findRecurring(doc, extra), [doc, extra]);
  const cats = sortedCategories(doc).filter((c) => sectionOf(c) === 'prywatne' || sectionOf(c) === 'firmowe');
  const defaultCat = cats.find((c) => /SUBSKRYP/i.test(c.name))?.id ?? cats[0]?.id ?? '';
  const [catFor, setCatFor] = useState<Record<string, string>>({});
  if (found.length === 0) return null;

  const create = (key: string) => {
    const c = found.find((x) => x.key === key)!;
    const now = currentMonth();
    update((d, stamp) => {
      const pid = newId('p');
      const rid = newId('r');
      const positions = {
        ...d.positions,
        [pid]: { id: pid, name: c.name, categoryId: catFor[key] ?? defaultCat, day: c.day, activeFrom: c.months[0], rules: [{ from: now, amount: c.amount }], ...stamp() },
      };
      const rules = { ...d.rules, [rid]: { id: rid, pattern: c.pattern, positionId: pid, ...stamp() } };
      const next = { ...d, positions, rules };
      // nieprzypisane transakcje tej grupy od razu trafiają do nowej pozycji
      const inbox = c.txnIds.map((id) => d.transactions[id]).filter((t): t is Txn => !!t && isInbox(t));
      return applyImport(next, inbox.map((t) => ({ txn: t, decision: { positionId: pid } })), stamp, () => newId('r')).doc;
    });
  };
  const dismiss = (key: string) =>
    update((d, stamp) => ({
      ...d,
      settings: {
        ...d.settings,
        main: { ...(d.settings.main ?? { id: 'main' }), id: 'main', dismissedRecurring: [...(d.settings.main?.dismissedRecurring ?? []), key], ...stamp() },
      },
    }));

  return (
    <section className="panel">
      <h2>Wykryte stałe płatności ({found.length})</h2>
      <p className="muted small-text">Powtarzają się co miesiąc w wyciągach, a nie ma ich w planie. Utwórz pozycję albo odrzuć.</p>
      <ul className="plain-list">
        {found.map((c) => (
          <li key={c.key} className="recurring">
            <div className="detail-row">
              <span><b>{c.name}</b><small>{c.months.length} mies. · ok. {c.day}. dnia</small></span>
              <Money value={c.amount} />
            </div>
            <div className="row-actions">
              <select value={catFor[c.key] ?? defaultCat} onChange={(e) => setCatFor((x) => ({ ...x, [c.key]: e.target.value }))} aria-label="Kategoria">
                {cats.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
              </select>
              <button type="button" className="small primary" onClick={() => create(c.key)}>Utwórz pozycję</button>
              <button type="button" className="small" onClick={() => dismiss(c.key)}>Odrzuć</button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function RulesSection() {
  const { doc, update } = useStore();
  const rules = Object.values(doc.rules).filter((r) => !r.deleted).sort((a, b) => a.pattern.localeCompare(b.pattern));
  if (rules.length === 0) return null;
  return (
    <details className="panel rules-panel">
      <summary><b>Reguły importu ({rules.length})</b></summary>
      <p className="muted small-text">Reguła działa, gdy opis transakcji zawiera wzorzec. Dłuższy wzorzec ma pierwszeństwo.</p>
      <ul className="plain-list">
        {rules.map((r) => (
          <li key={r.id} className="detail-row rule-row">
            <span>„{r.pattern}” → <b>{r.ignore ? 'pomiń' : doc.positions[r.positionId ?? '']?.name ?? 'usunięta pozycja'}</b></span>
            <button
              type="button"
              className="small"
              onClick={() => update((d, stamp) => ({ ...d, rules: { ...d.rules, [r.id]: { ...d.rules[r.id], deleted: true, ...stamp() } } }))}
            >
              Usuń
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}
