import { useRef, useState } from 'react';
import { useStore } from '../lib/store';
import { downloadDoc, parseDoc } from '../lib/backup';
import { countDifferences } from '../lib/merge';
import { restoreDoc } from '../lib/restore';
import { emptyDoc } from '../lib/types';
import { Field } from '../ui';
import { downloadText, positionsCsv, transactionsCsv } from '../lib/exportCsv';
import { amountsHidden, today } from '../lib/format';
import DriveSection from '../sync/DriveSection';
import SecuritySection from './SecuritySection';
import { keepEncryption, unpinEncryption } from '../lib/crypto';
import { useSync } from '../sync/SyncProvider';
import { HelpLink } from './HelpView';

export default function SettingsView() {
  const { doc, user, setUser, replaceDoc, mergeDoc, update } = useStore();
  const sync = useSync();
  const shared = !!sync.conf;
  const file = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const live = (r: Record<string, { deleted?: boolean }>) => Object.values(r).filter((x) => !x.deleted).length;

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setMsg(''); setErr('');
    try {
      if (f.size > 50 * 1024 * 1024) throw new Error('Plik jest za duży (ponad 50 MB) – to nie wygląda na kopię budżetu.');
      // kopia nie włącza ani nie wyłącza szyfrowania – zostaje ustawienie z tego urządzenia
      const incoming = keepEncryption(doc, parseDoc(await f.text()));
      if (mode === 'replace') {
        const q = shared
          ? 'Zastąpić dane zawartością pliku? To urządzenie jest połączone z Dyskiem – kopia zastąpi też wspólny plik i dane na innych urządzeniach (poprzednia wersja zostaje w historii Dysku).'
          : 'Zastąpić wszystkie dane na tym urządzeniu zawartością pliku?';
        if (live(doc.positions) > 0 && !confirm(q)) return;
        update((d, stamp) => restoreDoc(d, incoming, stamp));
        setMsg(`Wczytano ${live(incoming.positions)} pozycji z pliku ${f.name}.`);
      } else {
        const diff = countDifferences(doc, incoming);
        mergeDoc(incoming);
        setMsg(`Scalono plik ${f.name}: zmienionych lub nowych rekordów ${diff}.`);
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      if (file.current) file.current.value = '';
    }
  };

  return (
    <>
      <header className="page-head"><h1>Ustawienia <HelpLink topic="wspólne-dane-i-synchronizacja" /></h1></header>

      <section className="panel">
        <h2>Kto korzysta z tego urządzenia</h2>
        <Field label="Imię" hint="Zapisywane przy każdej zmianie, żeby było widać, kto co rozliczył.">
          <input value={user} onChange={(e) => setUser(e.target.value)} placeholder="np. Jan" />
        </Field>
      </section>

      <section className="panel">
        <h2>Kopia zapasowa</h2>
        <p className="muted">
          Na tym urządzeniu: {live(doc.positions)} pozycji, {live(doc.accounts)} kont, {live(doc.entries)} wpisów.
        </p>
        <p className="row-actions">
          <button type="button" className="primary" onClick={() => downloadDoc(doc)}>Pobierz kopię (JSON)</button>
        </p>
        <h3>Wczytaj kopię</h3>
        <div className="segmented" role="group" aria-label="Sposób wczytania">
          <button type="button" aria-pressed={mode === 'merge'} onClick={() => setMode('merge')}>Scal z obecnymi</button>
          <button type="button" aria-pressed={mode === 'replace'} onClick={() => setMode('replace')}>Zastąp wszystko</button>
        </div>
        <p className="muted small-text">
          {mode === 'merge'
            ? 'Przy scalaniu dla każdego rekordu zostaje nowsza wersja – nic nie ginie.'
            : 'Zastąpienie przywraca stan z pliku: rekordy spoza kopii są usuwane – także na Dysku i u drugiej osoby.'}
        </p>
        <input ref={file} type="file" aria-label="Plik kopii zapasowej (JSON)" accept="application/json,.json" onChange={(e) => onFile(e.target.files?.[0])} />
        {msg && <p className="ok">{msg}</p>}
        {err && <p className="error">{err}</p>}
      </section>

      <DriveSection />
      <SecuritySection />

      <section className="panel">
        <h2>Import z banku</h2>
        <Field label="Tolerancja dopasowania po kwocie (%)" hint="Transakcja dopasuje się do pozycji, jeśli kwota różni się od planu najwyżej o tyle procent. Puste = domyślnie (co do grosza, od 1000 zł do 1%).">
          <input
            inputMode="decimal"
            defaultValue={doc.settings.main?.amountTolerance ?? ''}
            placeholder="np. 7,5"
            onBlur={(e) => {
              const raw = e.target.value.trim().replace(',', '.');
              const v = raw === '' ? undefined : Number(raw);
              if (v !== undefined && (Number.isNaN(v) || v < 0 || v > 50)) return;
              update((d, stamp) => ({
                ...d,
                settings: { ...d.settings, main: { ...(d.settings.main ?? { id: 'main' }), id: 'main', amountTolerance: v, ...stamp() } },
              }));
            }}
          />
        </Field>
      </section>

      <section className="panel">
        <h2>Eksport do Excela</h2>
        <p className="muted small-text">Pliki CSV otwierają się w Excelu z polskimi znakami i przecinkiem dziesiętnym.</p>
        <p className="row-actions">
          <button type="button" onClick={() => downloadText(`budzet-pozycje-${today()}.csv`, positionsCsv(doc))}>Pozycje miesiąc po miesiącu</button>
          <button type="button" onClick={() => downloadText(`budzet-transakcje-${today()}.csv`, transactionsCsv(doc))}>Transakcje z wyciągów</button>
        </p>
      </section>

      <section className="panel">
        <h2>Widok</h2>
        <button type="button" onClick={() => dispatchEvent(new Event('toggle-amounts'))}>{amountsHidden() ? 'Pokaż kwoty' : 'Ukryj kwoty'}</button>
        <p className="muted small-text">Ukrywa kwoty na tym urządzeniu, np. gdy pokazujesz komuś ekran.</p>
      </section>

      <section className="panel">
        <h2>Wyczyść dane</h2>
        <p className="muted">Usuwa dane budżetu i zapamiętany klucz hasła z tego urządzenia{shared ? ' oraz odłącza je od Dysku (wspólny plik zostaje bez zmian)' : ''}. Logowanie Google i blokada zostają. Najpierw pobierz kopię.</p>
        <button
          type="button"
          className="danger"
          onClick={async () => {
            if (!confirm('Na pewno usunąć wszystkie dane z tego urządzenia?')) return;
            if (shared) await sync.disconnect();
            await unpinEncryption();
            replaceDoc(emptyDoc());
          }}
        >
          Wyczyść dane na tym urządzeniu
        </button>
      </section>
    </>
  );
}
