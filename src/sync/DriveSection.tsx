import { useState } from 'react';
import { useSync } from './SyncProvider';
import { MAIN_FILE, sessionKind } from './google';
import { Field } from '../ui';

/** Sekcja ustawień: wspólne dane na Dysku Google. */
export default function DriveSection() {
  const s = useSync();
  const [email, setEmail] = useState('');
  const [shareMsg, setShareMsg] = useState('');
  const [shareErr, setShareErr] = useState('');
  const [busy, setBusy] = useState(false);

  if (s.status === 'disabled') {
    return (
      <section className="panel">
        <h2>Wspólne dane na Dysku Google</h2>
        <p className="muted">Synchronizacja nie jest jeszcze skonfigurowana: uzupełnij identyfikatory Google w pliku <code>src/config.ts</code> (instrukcja w README).</p>
      </section>
    );
  }

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  };

  const doShare = async () => {
    setShareMsg(''); setShareErr('');
    if (!/^\S+@\S+\.\S+$/.test(email)) return setShareErr('Wpisz poprawny adres e-mail.');
    try {
      await s.share(email.trim());
      setShareMsg(`Udostępniono ${email.trim()}. Ta osoba dostanie e-mail od Google.`);
      setEmail('');
    } catch (e) {
      setShareErr((e as Error).message);
    }
  };

  return (
    <section className="panel">
      <h2>Wspólne dane na Dysku Google</h2>

      {!s.signedIn && (
        <>
          <p className="muted">
            {s.conf
              ? 'To urządzenie jest połączone z plikiem na Dysku. Zaloguj się, aby zsynchronizować dane.'
              : 'Zaloguj się kontem Google, żeby mieć te same dane na telefonie, laptopie i u drugiej osoby.'}
          </p>
          <button type="button" className="primary" onClick={() => void s.connect()}>
            Zaloguj przez Google
          </button>
          {s.signingIn && <p className="muted small-text">Przechodzę do logowania Google…</p>}
          <p className="muted small-text">Przejdziesz na stronę Google i po zgodzie wrócisz tutaj. Aplikacja widzi na Dysku tylko pliki, które sama utworzyła albo które jej wskażesz.</p>
        </>
      )}

      {s.signedIn && s.user && <p className="muted">Zalogowano jako <b>{s.user.displayName}</b> ({s.user.emailAddress}).</p>}
      {s.signedIn && sessionKind() === 'stała' && <p className="ok small-text">✓ Logowanie stałe (przez Cloudflare) – token odnawia się sam.</p>}
      {s.signedIn && sessionKind() === 'godzinna' && (
        <p className="muted small-text">
          Logowanie na godzinę (sprzed włączenia Cloudflare).{' '}
          <button type="button" className="small" onClick={() => void s.connect()}>Zaloguj ponownie na stałe</button>
        </p>
      )}

      {s.signedIn && !s.conf && (
        <>
          {s.found && s.found.length > 0 && (
            <>
              <h3>Znaleziony plik budżetu</h3>
              <ul className="plain-list">
                {s.found.map((f) => (
                  <li key={f.id} className="detail-row found">
                    <span>{f.name}<small>właściciel: {f.owners?.[0]?.displayName ?? f.owners?.[0]?.emailAddress ?? 'nieznany'}</small></span>
                    <button type="button" className="small primary" disabled={busy} onClick={() => void run(() => s.useFile(f.id))}>Połącz z tym plikiem</button>
                  </li>
                ))}
              </ul>
              <p className="muted small-text">Dane z tego urządzenia zostaną scalone z plikiem – nic nie zginie.</p>
            </>
          )}
          <h3>Pierwsze urządzenie</h3>
          <p className="muted small-text">Tworzy na Twoim Dysku folder „Budżet domowy” z plikiem {MAIN_FILE} zawierającym dane z tego urządzenia.</p>
          <button type="button" disabled={busy} onClick={() => void run(s.createFile)}>Utwórz wspólny plik na Dysku</button>
          <h3>Plik udostępniony przez kogoś</h3>
          <p className="muted small-text">Jeśli ktoś udostępnił Ci plik {MAIN_FILE}, wskaż go raz – potem aplikacja znajdzie go sama na każdym Twoim urządzeniu.</p>
          <button type="button" disabled={busy} onClick={() => void run(s.pickShared)}>Wybierz plik z Dysku</button>
        </>
      )}

      {s.conf && (
        <>
          <p className="detail-row">
            <span>Plik <b>{s.conf.fileName ?? MAIN_FILE}</b>{s.conf.ownedByMe === false && <small>udostępniony przez inną osobę</small>}</span>
            <button type="button" className="small" disabled={!s.signedIn || s.status === 'syncing'} onClick={() => void s.syncNow()}>Synchronizuj teraz</button>
          </p>
          {s.signedIn && (
            <>
              <h3>Udostępnij</h3>
              <Field label="E-mail konta Google drugiej osoby" hint="Dostanie prawo edycji pliku. Potem w swojej aplikacji wybiera „Wybierz plik z Dysku”.">
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="imie@gmail.com" />
              </Field>
              <button type="button" onClick={() => void doShare()}>Udostępnij plik</button>
              {shareMsg && <p className="ok">{shareMsg}</p>}
              {shareErr && <p className="error">{shareErr}</p>}
            </>
          )}
          {s.signedIn && (
            <>
              <h3>Wyloguj</h3>
              <p className="muted small-text">Wylogowuje z Google na tym urządzeniu i unieważnia stałe logowanie. Dane i połączenie z plikiem zostają – przy następnym logowaniu synchronizacja wróci.</p>
              <button type="button" onClick={() => confirm('Wylogować z Google na tym urządzeniu?') && void s.signOut()}>Wyloguj z Google</button>
            </>
          )}
          <h3>Odłącz</h3>
          <p className="muted small-text">Dane zostaną na tym urządzeniu, ale przestaną się synchronizować. Plik na Dysku zostaje bez zmian.</p>
          <button type="button" className="danger" onClick={() => confirm('Odłączyć to urządzenie od pliku na Dysku?') && void s.disconnect()}>Odłącz od Dysku</button>
        </>
      )}
      {s.error && <p className="error">{s.error}</p>}
    </section>
  );
}
