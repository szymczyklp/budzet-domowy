import { useMemo, useState } from 'react';
import { useStore } from '../lib/store';
import type { AmountRule, Category, Position } from '../lib/types';
import { currentMonth, isMonthKey } from '../lib/month';
import { isActive, ruleFor } from '../lib/projection';
import { planFor } from '../lib/firm';
import { fold, parseMoney } from '../lib/format';
import { newId } from '../lib/ids';
import { Field, Money, Sheet } from '../ui';
import { isExpense, looksBusiness, sectionOf, sectionTitle, sortedCategories } from '../lib/sections';
import { knownPeople } from '../lib/people';
import { describeRule } from '../lib/rules';
import { HelpLink } from './HelpView';

type Draft = Omit<Position, 'updatedAt' | 'updatedBy'>;

export default function PositionsView() {
  const { doc } = useStore();
  const [showEnded, setShowEnded] = useState(false);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Draft | null>(null);
  const now = currentMonth();

  const cats = useMemo(() => sortedCategories(doc), [doc]);

  const byCat = useMemo(() => {
    const all = Object.values(doc.positions).filter((p) => !p.deleted);
    const q = fold(query);
    const haystack = (p: Position) =>
      fold([p.name, p.note, p.reference, doc.accounts[p.accountId ?? '']?.name, doc.categories[p.categoryId]?.name].filter(Boolean).join(' '));
    // przy wyszukiwaniu pokazujemy też zakończone pozycje
    const visible = q
      ? all.filter((p) => q.split(' ').every((w) => haystack(p).includes(w)))
      : showEnded ? all : all.filter((p) => !p.activeTo || p.activeTo >= now);
    return cats
      .map((c) => ({ c, items: visible.filter((p) => p.categoryId === c.id).sort((a, b) => a.name.localeCompare(b.name)) }))
      .filter((g) => g.items.length > 0);
  }, [doc.positions, doc.accounts, doc.categories, cats, showEnded, now, query]);

  const startNew = () =>
    setEditing({ id: newId('p'), name: '', categoryId: cats[0]?.id ?? '', activeFrom: now, rules: [] });

  return (
    <>
      <header className="page-head">
        <h1>Pozycje <HelpLink topic="pozycje-i-plan" /></h1>
        <p className="muted">Stałe i planowane wpływy oraz wydatki. Kwota obowiązuje od wskazanego miesiąca do kolejnej zmiany.</p>
        <p className="row-actions">
          <button type="button" className="primary" onClick={startNew}>Dodaj pozycję</button>
          <label className="switch inline">
            <input type="checkbox" checked={showEnded} onChange={(e) => setShowEnded(e.target.checked)} />
            Pokaż zakończone
          </label>
        </p>
        <input
          type="search"
          className="search"
          placeholder="Szukaj: nazwa, numer polisy, konto, kategoria…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Szukaj pozycji"
        />
      </header>
      {query && byCat.length === 0 && <p className="muted">Nic nie znaleziono dla „{query}”.</p>}

      {byCat.map(({ c, items }) => (
        <section className="group" key={c.id}>
          <h2><span>{c.name}</span><small className="section-tag">{sectionTitle(sectionOf(c))}</small></h2>
          <ul className="plain-list">
            {items.map((p) => {
              const r = ruleFor(p, now);
              return (
                <li key={p.id}>
                  <button type="button" className="list-button" onClick={() => { location.hash = `pozycja/${p.id}`; }}>
                    <span className="name">
                      {p.name}
                      <small>
                        {p.day ? `${p.day}. dnia` : 'bez dnia'}
                        {r?.everyMonths && r.everyMonths > 1 ? `, co ${r.everyMonths} mies.` : ''}
                        {p.activeTo ? `, do ${p.activeTo}` : ''}
                        {isExpense(doc, p) ? ', wydatki (suma)' : ''}
                        {doc.accounts[p.accountId ?? ''] ? ` · ${doc.accounts[p.accountId!].name}` : ''}
                        {p.payer ? ` · płaci ${p.payer}` : ''}
                        {p.cardRepayment ? ' · spłata karty' : ''}
                      </small>
                    </span>
                    {isActive(p, now) ? <Money value={planFor(doc, p, now) || r?.amount || 0} /> : <span className="muted">zakończona</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {editing && <PositionForm initial={editing} categories={cats} onClose={() => setEditing(null)} />}
    </>
  );
}

export function PositionForm({ initial, categories, onClose }: { initial: Draft; categories: Category[]; onClose: () => void }) {
  const { doc, savePosition, saveCategory, user } = useStore();
  const [p, setP] = useState<Draft>(initial);
  const [amount, setAmount] = useState('');
  const [from, setFrom] = useState(currentMonth());
  const [every, setEvery] = useState('1');
  const [until, setUntil] = useState('');
  const [newCat, setNewCat] = useState('');
  const [error, setError] = useState('');
  const isNew = !doc.positions[initial.id];

  const accounts = Object.values(doc.accounts).filter((a) => !a.deleted).sort((a, b) => a.name.localeCompare(b.name));
  const people = knownPeople(doc, user);
  const [newPayer, setNewPayer] = useState('');
  const [payerMode, setPayerMode] = useState<'list' | 'new'>('list');
  const isCard = doc.accounts[p.accountId ?? '']?.kind === 'karta';
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setP((x) => ({ ...x, [k]: v }));

  const save = () => {
    if (!p.name.trim()) return setError('Podaj nazwę pozycji.');
    if (!isMonthKey(p.activeFrom)) return setError('„Aktywna od” musi mieć format RRRR-MM.');
    if (p.activeTo && !isMonthKey(p.activeTo)) return setError('„Aktywna do” musi mieć format RRRR-MM.');

    let categoryId = p.categoryId;
    if (newCat.trim()) {
      categoryId = newId('c');
      saveCategory({ id: categoryId, name: newCat.trim(), order: categories.length });
    }
    if (!categoryId) return setError('Wybierz albo dodaj kategorię.');

    let rules = p.rules;
    if (amount.trim()) {
      const v = parseMoney(amount);
      if (v === null) return setError('Kwota: wpisz liczbę, wydatki ze znakiem minus (np. -129,99).');
      if (!isMonthKey(from)) return setError('„Od miesiąca” musi mieć format RRRR-MM.');
      const n = Number(every) || 1;
      if (until && (!isMonthKey(until) || until < from)) return setError('„Do miesiąca” musi mieć format RRRR-MM i nie może być przed „Od miesiąca”.');
      const rule: AmountRule = { from, amount: v, ...(n > 1 ? { everyMonths: n } : {}), ...(until ? { until } : {}) };
      rules = [...rules.filter((r) => r.from !== from), rule].sort((a, b) => a.from.localeCompare(b.from));
    }
    if (rules.length === 0) return setError('Dodaj kwotę – bez niej pozycja nie pojawi się w miesiącach.');

    savePosition({ ...p, name: p.name.trim(), categoryId, rules });
    onClose();
  };

  const remove = () => {
    if (!confirm(`Usunąć „${p.name}” razem z planem? Historia rozliczeń zostanie w kopii, ale nie będzie widoczna.`)) return;
    savePosition({ ...p, deleted: true });
    onClose();
  };

  return (
    <Sheet title={isNew ? 'Nowa pozycja' : p.name || 'Pozycja'} onClose={onClose}>
      <Field label="Nazwa"><input value={p.name} onChange={(e) => set('name', e.target.value)} /></Field>
      <Field label="Kategoria">
        <select value={p.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Field>
      <Field label="albo nowa kategoria"><input value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="np. ZWIERZĘTA" /></Field>
      <div className="two">
        <Field label="Dzień płatności">
          <input inputMode="numeric" value={p.day ?? ''} onChange={(e) => set('day', e.target.value ? Math.min(31, Math.max(1, Number(e.target.value) || 1)) : undefined)} />
        </Field>
        <Field label="Konto / karta">
          <select value={p.accountId ?? ''} onChange={(e) => set('accountId', e.target.value || undefined)}>
            <option value="">brak</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Kto płaci i zaznacza" hint="Pozycje drugiej osoby widzisz z informacją, kto i kiedy zapłacił.">
        {payerMode === 'list' ? (
          <select
            value={p.payer ?? ''}
            onChange={(e) => (e.target.value === '__new' ? setPayerMode('new') : set('payer', e.target.value || undefined))}
          >
            <option value="">wspólne / każdy</option>
            {people.map((n) => <option key={n} value={n}>{n}</option>)}
            <option value="__new">+ inna osoba…</option>
          </select>
        ) : (
          <input
            value={newPayer}
            autoFocus
            placeholder="imię, tak jak w Ustawieniach na jej telefonie"
            onChange={(e) => { setNewPayer(e.target.value); set('payer', e.target.value.trim() || undefined); }}
          />
        )}
      </Field>
      {isCard && (
        <label className="switch">
          <input type="checkbox" checked={!!p.cardRepayment} onChange={(e) => set('cardRepayment', e.target.checked || undefined)} />
          To spłata tej karty kredytowej (blok „Karty kredytowe do spłaty”)
        </label>
      )}
      <Field label="Numer umowy / polisy"><input value={p.reference ?? ''} onChange={(e) => set('reference', e.target.value || undefined)} /></Field>
      <Field label="Notatka"><input value={p.note ?? ''} onChange={(e) => set('note', e.target.value || undefined)} /></Field>
      <div className="two">
        <Field label="Aktywna od" hint="RRRR-MM"><input value={p.activeFrom} onChange={(e) => set('activeFrom', e.target.value)} /></Field>
        <Field label="Aktywna do" hint="puste = bez końca"><input value={p.activeTo ?? ''} onChange={(e) => set('activeTo', e.target.value || undefined)} /></Field>
      </div>

      {sectionOf(doc.categories[p.categoryId]) === 'wydatki' ? (
        <p className="muted small-text">Kategoria w sekcji Wydatki: kwota to miesięczny budżet, a wydane sumuje się z wyciągów i ręcznych wpisów.</p>
      ) : (
        <>
          <label className="switch">
            <input type="checkbox" checked={!!p.envelope} onChange={(e) => set('envelope', e.target.checked || undefined)} />
            Liczona jak wydatek – suma wielu transakcji, bez zaznaczania
          </label>
        </>
      )}

      {(sectionOf(doc.categories[p.categoryId]) === 'firmowe' || p.vat || looksBusiness(p.name)) && (
        <div className="two">
          <Field label="VAT do odliczenia" hint="kwota pozycji jest brutto">
            <select
              value={p.vat?.rate ?? ''}
              onChange={(e) => set('vat', e.target.value ? { rate: Number(e.target.value), deductible: p.vat?.deductible ?? 100 } : undefined)}
            >
              <option value="">brak / nie dotyczy</option>
              {[23, 8, 5].map((r) => <option key={r} value={r}>{r}%</option>)}
            </select>
          </Field>
          {p.vat && (
            <Field label="Odliczenie VAT" hint="50% np. auto osobowe użytku mieszanego">
              <select value={p.vat.deductible} onChange={(e) => set('vat', { ...p.vat!, deductible: Number(e.target.value) })}>
                <option value={100}>100%</option>
                <option value={50}>50%</option>
              </select>
            </Field>
          )}
        </div>
      )}

      <h3>Kwoty</h3>
      {p.rules.length > 0 ? (
        <ul className="rules">
          {p.rules.map((r) => (
            <li key={r.from}>
              <span>{describeRule(r)}</span>
              <button type="button" className="small" onClick={() => set('rules', p.rules.filter((x) => x.from !== r.from))}>Usuń</button>
            </li>
          ))}
        </ul>
      ) : <p className="muted">Brak kwot w planie.</p>}
      <div className="three">
        <Field label={p.rules.length ? 'Nowa kwota' : 'Kwota'} hint="wydatek z minusem"><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="-129,99" /></Field>
        <Field label="Od miesiąca"><input value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="Co ile mies.">
          <select value={every} onChange={(e) => setEvery(e.target.value)}>
            {[1, 2, 3, 6, 12].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Do miesiąca (opcjonalnie)" hint="np. ostatnia rata kredytu; później 0"><input value={until} onChange={(e) => setUntil(e.target.value)} placeholder="RRRR-MM" /></Field>
      <p className="muted small-text">Sezonowość i zmiany pojedynczych miesięcy ustawisz wygodniej w karcie pozycji (stuknij miesiąc).</p>

      {error && <p className="error">{error}</p>}
      <p className="row-actions">
        <button type="button" className="primary" onClick={save}>Zapisz pozycję</button>
        {!isNew && <button type="button" className="danger" onClick={remove}>Usuń pozycję</button>}
      </p>
    </Sheet>
  );
}
