import { useState } from 'react';
import { useStore } from '../lib/store';
import type { Account, AccountKind } from '../lib/types';
import { newId } from '../lib/ids';
import { CopyButton, Field, Sheet } from '../ui';
import { HelpLink } from './HelpView';

type Draft = Omit<Account, 'updatedAt' | 'updatedBy'>;
const KINDS: { id: AccountKind; label: string }[] = [
  { id: 'konto', label: 'Rachunek' },
  { id: 'karta', label: 'Karta kredytowa' },
  { id: 'inne', label: 'Inne (leasing, odbiorca)' },
];

export default function AccountsView() {
  const { doc } = useStore();
  const [editing, setEditing] = useState<Draft | null>(null);
  const accounts = Object.values(doc.accounts).filter((a) => !a.deleted).sort((a, b) => a.name.localeCompare(b.name));
  const usage = (id: string) => Object.values(doc.positions).filter((p) => !p.deleted && p.accountId === id).length;

  return (
    <>
      <header className="page-head">
        <h1>Konta i karty <HelpLink topic="konta-karty-i-kategorie" /></h1>
        <p className="muted">Numery rachunków do przelewów i dni spłaty kart. Pozycje przypięte do konta pokazują numer w widoku miesiąca.</p>
        <p className="row-actions">
          <button type="button" className="primary" onClick={() => setEditing({ id: newId('a'), name: '', kind: 'konto' })}>Dodaj konto</button>
        </p>
      </header>
      <ul className="plain-list cards">
        {accounts.map((a) => (
          <li key={a.id}>
            <div className="account">
              <button type="button" className="list-button" onClick={() => setEditing(a)}>
                <span className="name">
                  {a.name}
                  <small>
                    {KINDS.find((k) => k.id === a.kind)?.label}
                    {a.bank ? `, ${a.bank}` : ''}
                    {a.dueDay ? `, spłata ${a.dueDay}. dnia` : ''}
                    {`, pozycji: ${usage(a.id)}`}
                  </small>
                </span>
              </button>
              {a.number ? (
                <p className="detail-row"><b className="iban">{a.number}</b><CopyButton text={a.number} label="Kopiuj numer" /></p>
              ) : (
                <p className="muted">Bez numeru rachunku</p>
              )}
            </div>
          </li>
        ))}
      </ul>
      {accounts.length === 0 && <p className="muted">Nie masz jeszcze żadnych kont. Dodaj pierwsze, aby mieć numer pod ręką przy płaceniu.</p>}
      {editing && <AccountForm initial={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function AccountForm({ initial, onClose }: { initial: Draft; onClose: () => void }) {
  const { doc, saveAccount } = useStore();
  const [a, setA] = useState<Draft>(initial);
  const [error, setError] = useState('');
  const isNew = !doc.accounts[initial.id];
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setA((x) => ({ ...x, [k]: v }));

  const save = () => {
    if (!a.name.trim()) return setError('Podaj nazwę konta.');
    const digits = a.number?.replace(/\s/g, '').replace(/^PL/i, '');
    if (digits && !/^\d{26}$/.test(digits)) return setError('Polski numer rachunku ma 26 cyfr (można z odstępami lub z PL na początku).');
    saveAccount({ ...a, name: a.name.trim() });
    onClose();
  };

  return (
    <Sheet title={isNew ? 'Nowe konto' : a.name} onClose={onClose}>
      <Field label="Nazwa"><input value={a.name} onChange={(e) => set('name', e.target.value)} placeholder="np. PKO karta *7478" /></Field>
      <Field label="Rodzaj">
        <select value={a.kind} onChange={(e) => set('kind', e.target.value as AccountKind)}>
          {KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
        </select>
      </Field>
      <Field label="Bank"><input value={a.bank ?? ''} onChange={(e) => set('bank', e.target.value || undefined)} /></Field>
      <Field label="Numer rachunku do przelewu"><input inputMode="numeric" value={a.number ?? ''} onChange={(e) => set('number', e.target.value || undefined)} placeholder="00 0000 0000 0000 0000 0000 0000" /></Field>
      {a.kind === 'karta' && (
        <Field label="Dzień spłaty karty"><input inputMode="numeric" value={a.dueDay ?? ''} onChange={(e) => set('dueDay', e.target.value ? Number(e.target.value) : undefined)} /></Field>
      )}
      <Field label="Notatka"><input value={a.note ?? ''} onChange={(e) => set('note', e.target.value || undefined)} /></Field>
      {error && <p className="error">{error}</p>}
      <p className="row-actions">
        <button type="button" className="primary" onClick={save}>Zapisz konto</button>
        {!isNew && <button type="button" className="danger" onClick={() => { if (confirm(`Usunąć konto „${a.name}”?`)) { saveAccount({ ...a, deleted: true }); onClose(); } }}>Usuń konto</button>}
      </p>
    </Sheet>
  );
}
