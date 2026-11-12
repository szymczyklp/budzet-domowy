import { useState } from 'react';
import { useSync } from './SyncProvider';
import { useStore } from '../lib/store';
import PasswordSheet from './PasswordSheet';

const time = (d: Date) => d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });

/** Pasek stanu synchronizacji na górze ekranu. */
export default function SyncBar({ onlyBlocking = false }: { onlyBlocking?: boolean }) {
  const s = useSync();
  const { internals } = useStore();
  const [ask, setAsk] = useState(false);
  if (s.status === 'disabled') return null;
  if (onlyBlocking && s.status !== 'needs-password' && s.status !== 'plain-remote') return null;

  if (s.status === 'needs-password') {
    return (
      <div className="syncbar warn">
        <span>Dane na Dysku są zaszyfrowane. Podaj hasło raz – to urządzenie je zapamięta.</span>
        <button type="button" className="small primary" onClick={() => setAsk(true)}>Podaj hasło</button>
        {ask && <PasswordSheet onClose={() => setAsk(false)} />}
      </div>
    );
  }

  if (s.status === 'plain-remote') {
    return (
      <div className="syncbar error-bar" role="alert">
        <span>Plik na Dysku nie jest zaszyfrowany, a powinien. Jeśli nie wyłączaliście szyfrowania na innym urządzeniu, ktoś mógł podmienić plik – zostaw szyfrowanie.</span>
        <button type="button" className="small primary" onClick={() => void s.keepEncrypted()}>Zostaw szyfrowanie</button>
        <button
          type="button"
          className="small"
          onClick={() => confirm('Przyjąć jawny plik z Dysku i wyłączyć szyfrowanie także na tym urządzeniu? Zrób to tylko, jeśli szyfrowanie zostało celowo wyłączone na innym urządzeniu.') && void s.acceptPlain()}
        >
          Wyłączyliśmy je celowo
        </button>
      </div>
    );
  }

  if (s.status === 'not-connected') {
    return (
      <div className="syncbar">
        <span>Dane są tylko na tym urządzeniu.</span>
        <a className="button small" href="#ustawienia">Połącz wspólne dane</a>
      </div>
    );
  }
  if (s.status === 'needs-auth') {
    return (
      <div className="syncbar warn">
        <span>{internals.isDirty() ? 'Zmiany czekają na wysłanie na Dysk.' : 'Połącz się, aby zobaczyć najnowsze dane.'}</span>
        <button type="button" className="small primary" onClick={() => void s.connect()}>Połącz z Dyskiem</button>
      </div>
    );
  }
  if (s.status === 'error') {
    return (
      <div className="syncbar error-bar" role="alert">
        <span>{s.error}</span>
        <button type="button" className="small" onClick={() => void s.syncNow()}>Spróbuj ponownie</button>
      </div>
    );
  }
  return (
    <div className="syncbar quiet" aria-live="polite">
      <span>{s.status === 'syncing' ? 'Synchronizuję z Dyskiem…' : s.lastSync ? `Zsynchronizowano o ${time(s.lastSync)}` : 'Połączono z Dyskiem'}</span>
      {s.status === 'ok' && <button type="button" className="small ghost" onClick={() => void s.syncNow()}>Odśwież</button>}
    </div>
  );
}
