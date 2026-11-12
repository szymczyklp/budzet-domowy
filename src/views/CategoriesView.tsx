import { useMemo, useState } from 'react';
import { useStore } from '../lib/store';
import type { Category, Section } from '../lib/types';
import { newId } from '../lib/ids';
import { Field, Sheet } from '../ui';
import { guessSection, looksBusiness, SECTIONS, sectionOf, sectionTitle, sortedCategories } from '../lib/sections';
import { currentMonth } from '../lib/month';
import { knownPeople } from '../lib/people';
import { HelpLink } from './HelpView';

type Draft = Omit<Category, 'updatedAt' | 'updatedBy'>;

export default function CategoriesView() {
  const { doc, update } = useStore();
  const [editing, setEditing] = useState<Draft | null>(null);

  const cats = useMemo(() => sortedCategories(doc), [doc]);
  const unassigned = cats.filter((c) => !c.section);
  const now = currentMonth();
  const business = Object.values(doc.positions).filter(
    (p) => !p.deleted && (!p.activeTo || p.activeTo >= now) && looksBusiness(p.name) && sectionOf(doc.categories[p.categoryId]) !== 'firmowe',
  );

  /** Zapisuje sekcje wynikające z nazw i przenosi księgowość / leasing do kategorii firmowej. */
  const applyProposal = () =>
    update((d, stamp) => {
      const categories = { ...d.categories };
      for (const c of Object.values(categories)) {
        if (!c.deleted && !c.section) categories[c.id] = { ...c, section: guessSection(c.name), ...stamp() };
      }
      const positions = { ...d.positions };
      if (business.length > 0) {
        let target = Object.values(categories).find((c) => !c.deleted && c.name === 'KOSZTY FIRMOWE');
        if (!target) {
          const id = newId('c');
          target = { id, name: 'KOSZTY FIRMOWE', order: Object.keys(categories).length, section: 'firmowe', ...stamp() };
          categories[id] = target;
        }
        for (const p of business) positions[p.id] = { ...positions[p.id], categoryId: target.id, ...stamp() };
      }
      return { ...d, categories, positions };
    });
  const count = (id: string) => Object.values(doc.positions).filter((p) => !p.deleted && p.categoryId === id).length;

  /** Przesuwa kategorię o jedno miejsce i numeruje kolejność od nowa. */
  const move = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= cats.length) return;
    const order = [...cats];
    [order[idx], order[target]] = [order[target], order[idx]];
    update((d, stamp) => {
      const categories = { ...d.categories };
      order.forEach((c, i) => {
        if (categories[c.id].order !== i) categories[c.id] = { ...categories[c.id], order: i, ...stamp() };
      });
      return { ...d, categories };
    });
  };

  return (
    <>
      <header className="page-head">
        <h1>Kategorie <HelpLink topic="konta-karty-i-kategorie" /></h1>
        <p className="muted">Kolejność kategorii to kolejność grup w widoku miesiąca i na liście pozycji.</p>
        <p className="row-actions">
          <button type="button" className="primary" onClick={() => setEditing({ id: newId('c'), name: '', order: cats.length })}>
            Dodaj kategorię
          </button>
        </p>
      </header>
      {(unassigned.length > 0 || business.length > 0) && (
        <section className="panel">
          <h2>Proponowany podział na sekcje</h2>
          <p className="muted small-text">
            Każda kategoria należy do sekcji: przychody, opłaty firmowe, opłaty prywatne albo wydatki.
            {business.length > 0 && ` Do opłat firmowych przeniosę też: ${business.map((p) => p.name).join(', ')} (nowa kategoria KOSZTY FIRMOWE).`}
            {' '}Każdą kategorię możesz potem zmienić ręcznie.
          </p>
          <button type="button" className="primary" onClick={applyProposal}>Zastosuj podział</button>
        </section>
      )}
      <ul className="plain-list">
        {cats.map((c, i) => (
          <li key={c.id} className="reorder-row">
            <button type="button" className="list-button" onClick={() => setEditing(c)}>
              <span className="name">
                {c.name}
                <small>{sectionTitle(sectionOf(c))}{c.section ? '' : ' (z nazwy)'} · pozycji: {count(c.id)}</small>
              </span>
            </button>
            <span className="reorder">
              <button type="button" className="small ghost" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Przesuń ${c.name} wyżej`}>↑</button>
              <button type="button" className="small ghost" disabled={i === cats.length - 1} onClick={() => move(i, 1)} aria-label={`Przesuń ${c.name} niżej`}>↓</button>
            </span>
          </li>
        ))}
      </ul>
      {editing && <CategoryForm initial={editing} positions={count(editing.id)} others={cats.filter((c) => c.id !== editing.id)} onClose={() => setEditing(null)} />}
    </>
  );
}

function CategoryForm({ initial, positions, others, onClose }: {
  initial: Draft; positions: number; others: Category[]; onClose: () => void;
}) {
  const { doc, saveCategory, update } = useStore();
  const [name, setName] = useState(initial.name);
  const [section, setSection] = useState<Section>(sectionOf(initial as Category));
  const [accountId, setAccountId] = useState('');
  const [newCard, setNewCard] = useState('');
  const [msg, setMsg] = useState('');
  const { user } = useStore();
  const people = knownPeople(doc, user);
  const [payer, setPayer] = useState('');
  const [payerMsg, setPayerMsg] = useState('');
  const accounts = Object.values(doc.accounts).filter((a) => !a.deleted).sort((a, b) => a.name.localeCompare(b.name));
  const [moveTo, setMoveTo] = useState(others[0]?.id ?? '');
  const [error, setError] = useState('');
  const isNew = !doc.categories[initial.id];

  const save = () => {
    if (!name.trim()) return setError('Podaj nazwę kategorii.');
    const dup = others.find((c) => c.name.toLowerCase() === name.trim().toLowerCase());
    if (dup) return setError(`Kategoria „${dup.name}” już istnieje.`);
    saveCategory({ ...initial, name: name.trim(), section });
    onClose();
  };

  /** Ustawia jedną kartę / konto we wszystkich pozycjach kategorii (np. karta do subskrypcji). */
  const setAccountForAll = () => {
    if (!accountId) return setError('Wybierz kartę albo konto.');
    if (accountId === '__new' && !newCard.trim()) return setError('Podaj nazwę nowej karty.');
    update((d, stamp) => {
      const accounts = { ...d.accounts };
      let id = accountId;
      if (id === '__new') {
        id = newId('a');
        accounts[id] = { id, name: newCard.trim(), kind: 'karta', ...stamp() };
      }
      const pos = { ...d.positions };
      for (const p of Object.values(pos)) {
        if (!p.deleted && p.categoryId === initial.id) pos[p.id] = { ...p, accountId: id, ...stamp() };
      }
      return { ...d, accounts, positions: pos };
    });
    setError('');
    setMsg(`Ustawiono dla ${positions} pozycji.`);
  };

  const remove = () => {
    if (positions > 0 && !moveTo) return setError('Wybierz kategorię, do której przenieść pozycje.');
    const target = others.find((c) => c.id === moveTo);
    const msg = positions > 0
      ? `Usunąć „${initial.name}” i przenieść ${positions} pozycji do „${target?.name}”?`
      : `Usunąć kategorię „${initial.name}”?`;
    if (!confirm(msg)) return;
    update((d, stamp) => {
      const pos = { ...d.positions };
      for (const p of Object.values(pos)) {
        if (!p.deleted && p.categoryId === initial.id) pos[p.id] = { ...p, categoryId: moveTo, ...stamp() };
      }
      return {
        ...d,
        positions: pos,
        categories: { ...d.categories, [initial.id]: { ...d.categories[initial.id], deleted: true, ...stamp() } },
      };
    });
    onClose();
  };

  return (
    <Sheet title={isNew ? 'Nowa kategoria' : initial.name} onClose={onClose}>
      <Field label="Nazwa"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="np. ZWIERZĘTA" /></Field>
      <Field label="Sekcja" hint={SECTIONS.find((s) => s.id === section)?.hint}>
        <select value={section} onChange={(e) => setSection(e.target.value as Section)}>
          {SECTIONS.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
        </select>
      </Field>
      {error && <p className="error">{error}</p>}
      <p className="row-actions">
        <button type="button" className="primary" onClick={save}>Zapisz kategorię</button>
      </p>
      {!isNew && positions > 0 && (
        <>
          <h3>Karta / konto dla wszystkich pozycji</h3>
          <Field label="Ustaw w każdej pozycji tej kategorii">
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">— wybierz —</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              <option value="__new">+ nowa karta…</option>
            </select>
          </Field>
          {accountId === '__new' && (
            <Field label="Nazwa nowej karty"><input value={newCard} onChange={(e) => setNewCard(e.target.value)} placeholder="np. Revo Mastercard •••• 1234" /></Field>
          )}
          <button type="button" onClick={setAccountForAll}>Ustaw dla {positions} pozycji</button>
          {msg && <p className="ok">{msg}</p>}

          <h3>Kto płaci za wszystkie pozycje</h3>
          <Field label="Ustaw w każdej pozycji tej kategorii" hint="Wpisz imię tak, jak druga osoba ma je w Ustawieniach.">
            <input list="people" value={payer} onChange={(e) => setPayer(e.target.value)} placeholder="puste = wspólne" />
            <datalist id="people">{people.map((n) => <option key={n} value={n} />)}</datalist>
          </Field>
          <button
            type="button"
            onClick={() => {
              const name = payer.trim() || undefined;
              update((d, stamp) => {
                const pos = { ...d.positions };
                for (const p of Object.values(pos)) {
                  if (!p.deleted && p.categoryId === initial.id) pos[p.id] = { ...p, payer: name, ...stamp() };
                }
                return { ...d, positions: pos };
              });
              setPayerMsg(name ? `Płaci ${name}: ${positions} pozycji.` : `Ustawiono jako wspólne: ${positions} pozycji.`);
            }}
          >
            Ustaw dla {positions} pozycji
          </button>
          {payerMsg && <p className="ok">{payerMsg}</p>}
        </>
      )}
      {!isNew && (
        <>
          <h3>Usuń kategorię</h3>
          {positions > 0 && (
            <Field label={`Przenieś ${positions} pozycji do`}>
              <select value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
                {others.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
          )}
          <button type="button" className="danger" onClick={remove}>Usuń kategorię</button>
        </>
      )}
    </Sheet>
  );
}
