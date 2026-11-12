import { useMemo, useState } from 'react';
import { useStore } from '../lib/store';
import type { EmergencyItem, EmergencyKind } from '../lib/types';
import { currentMonth } from '../lib/month';
import { isActive, ruleFor } from '../lib/projection';
import { fold, money, moneyInput, parseMoney, today } from '../lib/format';
import { newId } from '../lib/ids';
import { CopyButton, Field, Sheet } from '../ui';
import { HelpLink } from './HelpView';

type Draft = Omit<EmergencyItem, 'updatedAt' | 'updatedBy'>;
type FieldKey = 'institution' | 'type' | 'number' | 'owner' | 'value' | 'valueDate' | 'beneficiary' | 'contact' | 'access' | 'note';

interface KindDef {
  kind: Exclude<EmergencyKind, 'instrukcja'>;
  title: string;
  add: string;
  intro: string;
  fields: FieldKey[];
  labels: Partial<Record<FieldKey, string>>;
  placeholders: Partial<Record<FieldKey, string>>;
}

const KINDS: KindDef[] = [
  {
    kind: 'oszczednosci',
    title: 'Oszczędności i inwestycje',
    add: 'Dodaj oszczędności',
    intro: 'Konta oszczędnościowe, lokaty, IKE/IKZE, PPK, rachunki maklerskie, obligacje.',
    fields: ['institution', 'type', 'number', 'owner', 'value', 'valueDate', 'beneficiary', 'access', 'contact', 'note'],
    labels: { value: 'Saldo (przybliżone)', valueDate: 'Stan na dzień', beneficiary: 'Dyspozycja na wypadek śmierci / uposażony', number: 'Numer rachunku / umowy' },
    placeholders: { type: 'lokata, IKE, konto oszczędnościowe…', access: 'np. bankowość internetowa, login w menedżerze haseł' },
  },
  {
    kind: 'ubezpieczenie',
    title: 'Ubezpieczenia',
    add: 'Dodaj ubezpieczenie',
    intro: 'Na życie, NNW, domu, samochodu, pracownicze. Najważniejsze: numer polisy, uposażony i telefon do zgłoszenia.',
    fields: ['institution', 'type', 'number', 'owner', 'value', 'beneficiary', 'contact', 'access', 'note'],
    labels: { value: 'Suma ubezpieczenia', owner: 'Kto ubezpieczony', beneficiary: 'Uposażony', number: 'Numer polisy', contact: 'Zgłoszenie szkody (telefon / strona)' },
    placeholders: { type: 'na życie, NNW, dom, samochód…', access: 'gdzie leży polisa, konto klienta' },
  },
  {
    kind: 'zobowiazanie',
    title: 'Kredyty i zobowiązania',
    add: 'Dodaj zobowiązanie',
    intro: 'Kredyty, leasingi, karty kredytowe – czy jest ubezpieczenie spłaty i kogo powiadomić.',
    fields: ['institution', 'type', 'number', 'owner', 'value', 'valueDate', 'contact', 'access', 'note'],
    labels: { value: 'Pozostało do spłaty', valueDate: 'Stan na dzień', number: 'Numer umowy' },
    placeholders: { type: 'hipoteka, leasing, karta…', note: 'np. ubezpieczenie spłaty w banku' },
  },
  {
    kind: 'kontakt',
    title: 'Kontakty',
    add: 'Dodaj kontakt',
    intro: 'Kadry w pracy, księgowa, doradca, notariusz, agent ubezpieczeniowy.',
    fields: ['institution', 'type', 'contact', 'note'],
    labels: { institution: 'Firma / instytucja', type: 'Rola', contact: 'Telefon, e-mail' },
    placeholders: { type: 'księgowa, kadry, notariusz…' },
  },
];

const LABELS: Record<FieldKey, string> = {
  institution: 'Instytucja', type: 'Rodzaj', number: 'Numer', owner: 'Czyje', value: 'Kwota', valueDate: 'Stan na',
  beneficiary: 'Uposażony', contact: 'Kontakt', access: 'Jak uzyskać dostęp / gdzie dokumenty', note: 'Notatka',
};

const label = (def: KindDef, k: FieldKey) => def.labels[k] ?? LABELS[k];

export default function EmergencyView() {
  const { doc, saveEmergency, update } = useStore();
  const [editing, setEditing] = useState<{ def: KindDef; item: Draft } | null>(null);
  const [editText, setEditText] = useState<string | null>(null);

  const items = useMemo(() => Object.values(doc.emergency).filter((e) => !e.deleted), [doc.emergency]);
  const instruction = items.find((e) => e.kind === 'instrukcja');

  const now = currentMonth();
  const catName = (id: string) => fold(doc.categories[id]?.name ?? '');
  const linked = new Set(items.map((e) => e.positionId).filter(Boolean));
  const candidates = Object.values(doc.positions).filter((p) => {
    if (p.deleted || linked.has(p.id) || !isActive(p, now)) return false;
    const c = catName(p.categoryId);
    return c.includes('UBEZPIECZ') || c.includes('KREDYT');
  });

  /** Tworzy wpisy z aktywnych polis i kredytów, których jeszcze tu nie ma. */
  const importFromPositions = () => {
    update((d, stamp) => {
      const emergency = { ...d.emergency };
      let order = items.length;
      for (const p of candidates) {
        const insurance = catName(p.categoryId).includes('UBEZPIECZ');
        const r = ruleFor(p, now);
        const rate = r ? `${insurance ? 'Składka' : 'Rata'} ${money(Math.abs(r.amount))} zł${r.everyMonths && r.everyMonths > 1 ? ` co ${r.everyMonths} mies.` : ' mies.'}` : '';
        const end = p.activeTo ? `, do ${p.activeTo}` : '';
        const id = newId('e');
        emergency[id] = {
          id,
          kind: insurance ? 'ubezpieczenie' : 'zobowiazanie',
          name: p.name,
          number: p.reference,
          institution: d.accounts[p.accountId ?? '']?.name,
          note: [rate + end, p.note].filter(Boolean).join('. '),
          order: order++,
          positionId: p.id,
          ...stamp(),
        };
      }
      return { ...d, emergency };
    });
  };

  return (
    <div className="emergency">
      <header className="page-head">
        <h1>Na wypadek <HelpLink topic="na-wypadek" /></h1>
        <p className="muted">
          Wszystko, czego bliscy potrzebują, gdyby coś się stało. Te dane są we wspólnym pliku, więc widzi je każdy, komu go udostępnisz.
        </p>
        <p className="notice no-print">
          Nie wpisuj tu haseł ani PIN-ów – tylko informację, gdzie są (np. „menedżer haseł, dostęp awaryjny ustawiony dla współmałżonka”).
        </p>
        <p className="row-actions no-print">
          <button type="button" onClick={() => window.print()}>Drukuj / zapisz PDF</button>
          {candidates.length > 0 && (
            <button type="button" onClick={importFromPositions}>Dodaj polisy i kredyty z pozycji ({candidates.length})</button>
          )}
        </p>
      </header>

      <section className="panel">
        <h2>Co zrobić najpierw</h2>
        {instruction?.note ? <p className="prewrap">{instruction.note}</p> : <p className="muted">Krótka instrukcja: do kogo zadzwonić, co zgłosić, gdzie są dokumenty.</p>}
        <button type="button" className="small no-print" onClick={() => setEditText(instruction?.note ?? '')}>
          {instruction?.note ? 'Edytuj instrukcję' : 'Napisz instrukcję'}
        </button>
      </section>

      {KINDS.map((def) => {
        const list = items.filter((e) => e.kind === def.kind).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
        const total = list.reduce((s, e) => s + (e.value ?? 0), 0);
        return (
          <section className="group" key={def.kind}>
            <h2>
              <span>{def.title}</span>
              {def.kind === 'oszczednosci' && total > 0 && <span className="money">{money(total)} zł</span>}
            </h2>
            {list.length === 0 && <p className="muted small-text">{def.intro}</p>}
            <ul className="plain-list">
              {list.map((e) => (
                <li key={e.id} className="ecard">
                  <div className="ecard-head">
                    <b>{e.name}</b>
                    <button type="button" className="small ghost no-print" onClick={() => setEditing({ def, item: e })}>Edytuj</button>
                  </div>
                  <dl>
                    {def.fields.filter((k) => k !== 'valueDate' && e[k] !== undefined && e[k] !== '').map((k) => (
                      <div key={k}>
                        <dt>{label(def, k)}</dt>
                        <dd>
                          {k === 'value' ? `${money(e.value!)} zł${e.valueDate ? ` (stan na ${e.valueDate})` : ''}` : String(e[k])}
                          {k === 'number' && <span className="no-print"> <CopyButton text={String(e.number)} /></span>}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="small no-print"
              onClick={() => setEditing({ def, item: { id: newId('e'), kind: def.kind, name: '', order: list.length } })}
            >
              {def.add}
            </button>
          </section>
        );
      })}

      <p className="muted small-text print-only">Wydrukowano {today()}.</p>

      {editing && <ItemForm def={editing.def} initial={editing.item} onClose={() => setEditing(null)} />}
      {editText !== null && (
        <Sheet title="Co zrobić najpierw" onClose={() => setEditText(null)}>
          <Field label="Instrukcja" hint="Np. 1. Zadzwoń do kadr (zasiłek pogrzebowy, ubezpieczenie grupowe). 2. Zgłoś polisy ERGO…">
            <textarea rows={10} value={editText} onChange={(e) => setEditText(e.target.value)} />
          </Field>
          <p className="row-actions">
            <button
              type="button"
              className="primary"
              onClick={() => {
                saveEmergency({ ...(instruction ?? { id: newId('e'), kind: 'instrukcja', name: 'Instrukcja', order: 0 }), note: editText });
                setEditText(null);
              }}
            >
              Zapisz instrukcję
            </button>
          </p>
        </Sheet>
      )}
    </div>
  );
}

function ItemForm({ def, initial, onClose }: { def: KindDef; initial: Draft; onClose: () => void }) {
  const { doc, saveEmergency } = useStore();
  const [e, setE] = useState<Draft>(initial);
  const [value, setValue] = useState(initial.value !== undefined ? moneyInput(initial.value) : '');
  const [error, setError] = useState('');
  const isNew = !doc.emergency[initial.id];
  const set = (k: FieldKey | 'name', v: string) => setE((x) => ({ ...x, [k]: v || undefined }));

  const save = () => {
    if (!e.name?.trim()) return setError('Podaj nazwę.');
    let parsed: number | undefined;
    if (value.trim()) {
      const v = parseMoney(value);
      if (v === null) return setError('Kwota: wpisz liczbę, np. 25 000,00.');
      parsed = Math.abs(v);
    }
    // nowa kwota bez zmienionej daty = stan na dziś
    const fresh = parsed !== initial.value && e.valueDate === initial.valueDate;
    const valueDate = parsed !== undefined && def.fields.includes('valueDate') && (!e.valueDate || fresh) ? today() : e.valueDate;
    // oszczędności i zobowiązania: każda nowa kwota trafia do historii (wykres majątku netto)
    const tracked = def.kind === 'oszczednosci' || def.kind === 'zobowiazanie';
    const history = tracked && parsed !== undefined && valueDate && (parsed !== initial.value || valueDate !== initial.valueDate)
      ? [...(e.history ?? []).filter((h) => h.date !== valueDate), { date: valueDate, value: parsed }].sort((a, b) => a.date.localeCompare(b.date))
      : e.history;
    saveEmergency({ ...e, name: e.name.trim(), value: parsed, valueDate, ...(history ? { history } : {}) });
    onClose();
  };

  return (
    <Sheet title={isNew ? def.add : e.name} onClose={onClose}>
      <Field label="Nazwa"><input value={e.name ?? ''} onChange={(ev) => set('name', ev.target.value)} placeholder={def.kind === 'kontakt' ? 'np. Anna Kowalska' : 'np. IKE w PKO TFI'} /></Field>
      {def.fields.map((k) => {
        if (k === 'value') {
          return <Field key={k} label={label(def, k)}><input inputMode="decimal" value={value} onChange={(ev) => setValue(ev.target.value)} /></Field>;
        }
        if (k === 'valueDate') {
          return <Field key={k} label={label(def, k)} hint="przy nowej kwocie ustawi się dzisiejsza data; poprzednia trafi do historii"><input type="date" value={e.valueDate ?? ''} onChange={(ev) => set(k, ev.target.value)} /></Field>;
        }
        if (k === 'access' || k === 'note') {
          return <Field key={k} label={label(def, k)}><textarea rows={3} value={e[k] ?? ''} onChange={(ev) => set(k, ev.target.value)} placeholder={def.placeholders[k]} /></Field>;
        }
        return <Field key={k} label={label(def, k)}><input value={(e[k] as string | undefined) ?? ''} onChange={(ev) => set(k, ev.target.value)} placeholder={def.placeholders[k]} /></Field>;
      })}
      {error && <p className="error">{error}</p>}
      <p className="row-actions">
        <button type="button" className="primary" onClick={save}>Zapisz</button>
        {!isNew && (
          <button type="button" className="danger" onClick={() => { if (confirm(`Usunąć „${e.name}”?`)) { saveEmergency({ ...e, deleted: true }); onClose(); } }}>
            Usuń
          </button>
        )}
      </p>
    </Sheet>
  );
}
