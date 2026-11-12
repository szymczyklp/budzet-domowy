import { useEffect, useState } from 'react';
import { useStore } from '../lib/store';
import { beginDisabling, beginEnabling, deriveKey, forgetKey, ITERATIONS, loadKey, newSalt, rememberKey } from '../lib/crypto';
import { disableLock, enableLock, lockConf, lockSupported, setLockAfter, verifyLock } from '../lib/applock';
import { useSync } from '../sync/SyncProvider';
import PasswordSheet from '../sync/PasswordSheet';
import { HelpLink } from './HelpView';

/** Ustawienia: hasło do danych na Dysku i blokada aplikacji biometrią. */
export default function SecuritySection() {
  return (
    <>
      <EncryptionPanel />
      <LockPanel />
    </>
  );
}

function EncryptionPanel() {
  const { doc, update } = useStore();
  const sync = useSync();
  const enc = doc.settings.main?.encryption;
  const [knows, setKnows] = useState<boolean | null>(null);
  const [mode, setMode] = useState<'idle' | 'set' | 'unlock'>('idle');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  /** Plik na Dysku czeka na hasło albo na decyzję – w tym stanie nie zmieniamy ustawień szyfrowania. */
  const waiting = sync.status === 'needs-password';
  const blocked = waiting || sync.status === 'plain-remote';

  useEffect(() => {
    void loadKey().then((k) => setKnows(!!k && !!enc && k.salt === enc.salt));
  }, [enc, mode, sync.status]);

  const setPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (pw.length < 10) return setError('Użyj co najmniej 10 znaków – najlepiej wygeneruj hasło w menedżerze haseł.');
    if (pw !== pw2) return setError('Hasła się różnią.');
    setBusy(true);
    try {
      const k = await deriveKey(pw, newSalt(), ITERATIONS);
      await beginEnabling();
      await rememberKey(k);
      update((d, stamp) => ({
        ...d,
        settings: { ...d.settings, main: { ...(d.settings.main ?? { id: 'main' }), id: 'main', encryption: { salt: k.salt, iterations: k.iterations }, ...stamp() } },
      }));
      setPw(''); setPw2(''); setMode('idle');
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    if (!confirm('Wyłączyć szyfrowanie? Plik na Dysku zostanie zapisany jawnym tekstem (JSON).')) return;
    await beginDisabling();
    update((d, stamp) => {
      const main = { ...(d.settings.main ?? { id: 'main' }), id: 'main' };
      delete main.encryption;
      return { ...d, settings: { ...d.settings, main: { ...main, ...stamp() } } };
    });
  };

  return (
    <section className="panel">
      <h2>Hasło do danych na Dysku <HelpLink topic="bezpieczeństwo-i-prywatność" /></h2>
      {waiting ? (
        <p className="muted">
          Plik na Dysku jest zaszyfrowany, a to urządzenie nie zna jeszcze hasła. Podaj hasło ustawione na pierwszym
          urządzeniu – nie ustawiaj tutaj nowego.
        </p>
      ) : !enc ? (
        <p className="muted">
          Plik na Dysku Google jest teraz zwykłym JSON-em – widzi go każdy, kto ma do niego dostęp. Po ustawieniu hasła
          aplikacja szyfruje go (AES-256). Hasło wpisujesz raz na każdym urządzeniu – potem jest zapamiętane.
        </p>
      ) : (
        <p className="muted">
          Dane na Dysku są szyfrowane. {knows ? 'To urządzenie zna hasło.' : knows === false ? 'To urządzenie nie zna jeszcze hasła.' : ''}
          {' '}Druga osoba wpisuje to samo hasło raz na swoim telefonie.
        </p>
      )}

      {mode === 'set' ? (
        <form onSubmit={setPassword} className="password-form">
          <input type="text" name="username" autoComplete="username" value="Budżet domowy" readOnly className="visually-hidden" tabIndex={-1} aria-hidden="true" />
          <label className="field">
            <span className="field-label">Nowe hasło</span>
            <input type="password" name="new-password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
          </label>
          <label className="field">
            <span className="field-label">Powtórz hasło</span>
            <input type="password" name="new-password-2" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
            <span className="field-hint">Zapisz je w Bitdefender SecurePass (albo innym menedżerze). Bez hasła danych z Dysku nie da się odczytać – nie ma przypomnienia.</span>
          </label>
          {error && <p className="error">{error}</p>}
          <p className="row-actions">
            <button type="submit" className="primary" disabled={busy}>{busy ? 'Szyfruję…' : enc ? 'Zmień hasło' : 'Włącz szyfrowanie'}</button>
            <button type="button" onClick={() => { setMode('idle'); setError(''); }}>Anuluj</button>
          </p>
        </form>
      ) : (
        <p className="row-actions">
          {waiting && <button type="button" className="primary" onClick={() => setMode('unlock')}>Podaj hasło</button>}
          {!enc && !blocked && <button type="button" className="primary" onClick={() => setMode('set')}>Ustaw hasło</button>}
          {enc && knows === false && !waiting && <button type="button" className="primary" onClick={() => setMode('unlock')}>Podaj hasło</button>}
          {enc && knows && !blocked && <button type="button" onClick={() => setMode('set')}>Zmień hasło</button>}
          {enc && knows && <button type="button" onClick={() => { void forgetKey().then(() => setKnows(false)); }}>Zapomnij na tym urządzeniu</button>}
          {enc && knows && !blocked && <button type="button" className="danger" onClick={() => void disable()}>Wyłącz szyfrowanie</button>}
        </p>
      )}
      {mode === 'unlock' && <PasswordSheet onClose={() => setMode('idle')} />}
      {enc && <p className="muted small-text">Kopia zapasowa pobierana z Ustawień jest jawnym JSON-em – trzymaj ją u siebie. Stare miesięczne kopie na Dysku sprzed włączenia hasła możesz usunąć ręcznie.</p>}
    </section>
  );
}

const AFTER = [
  { v: 0, label: 'zawsze po powrocie' },
  { v: 1, label: 'po 1 min' },
  { v: 5, label: 'po 5 min' },
  { v: 15, label: 'po 15 min' },
];

function LockPanel() {
  const { user } = useStore();
  const [supported, setSupported] = useState<boolean | null>(null);
  const [conf, setConf] = useState(lockConf);
  const [after, setAfter] = useState(conf?.after ?? 1);
  const [error, setError] = useState('');

  useEffect(() => { void lockSupported().then(setSupported); }, []);
  if (supported === false) {
    return (
      <section className="panel">
        <h2>Blokada Face ID / Touch ID <HelpLink topic="bezpieczeństwo-i-prywatność" /></h2>
        <p className="muted">Ta przeglądarka nie udostępnia biometrii urządzenia stronom internetowym.</p>
      </section>
    );
  }

  const enable = async () => {
    setError('');
    try {
      await enableLock(user, after);
      setConf(lockConf());
    } catch (e) {
      setError((e as Error).name === 'NotAllowedError' ? 'Anulowano albo urządzenie nie pozwoliło – spróbuj jeszcze raz.' : (e as Error).message);
    }
  };
  const disable = async () => {
    if (!(await verifyLock())) return setError('Wyłączenie wymaga potwierdzenia Face ID / Touch ID.');
    disableLock();
    setConf(null);
  };

  return (
    <section className="panel">
      <h2>Blokada Face ID / Touch ID <HelpLink topic="bezpieczeństwo-i-prywatność" /></h2>
      <p className="muted">Przy otwarciu aplikacji (i po powrocie do niej) trzeba potwierdzić tożsamość. Ustawienie dotyczy tylko tego urządzenia.</p>
      <label className="account-pick">
        <span>Blokuj</span>
        <select value={after} onChange={(e) => { const v = Number(e.target.value); setAfter(v); if (conf) { setLockAfter(v); setConf(lockConf()); } }}>
          {AFTER.map((a) => <option key={a.v} value={a.v}>{a.label}</option>)}
        </select>
      </label>
      {error && <p className="error">{error}</p>}
      <p className="row-actions">
        {conf
          ? <button type="button" className="danger" onClick={() => void disable()}>Wyłącz blokadę</button>
          : <button type="button" className="primary" onClick={() => void enable()} disabled={supported === null}>Włącz blokadę</button>}
      </p>
    </section>
  );
}
