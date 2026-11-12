import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { lockConf, verifyLock } from './lib/applock';
import { idbDelete } from './lib/idb';
import { unpinEncryption } from './lib/crypto';

const HIDDEN_AT = 'hidden-at';

/** Zasłania aplikację, dopóki użytkownik nie potwierdzi tożsamości biometrią urządzenia. */
export default function AppLock({ children }: { children: ReactNode }) {
  const [locked, setLocked] = useState(() => !!lockConf());
  const [failed, setFailed] = useState(false);
  const tried = useRef(false);

  useEffect(() => {
    const on = () => {
      const c = lockConf();
      if (!c) return;
      if (document.visibilityState === 'hidden') {
        try { sessionStorage.setItem(HIDDEN_AT, String(Date.now())); } catch { /* brak */ }
        // przy blokadzie „zawsze” zasłaniamy od razu – także podgląd w przełączniku aplikacji
        if (c.after === 0) setLocked(true);
        return;
      }
      let at = 0;
      try { at = Number(sessionStorage.getItem(HIDDEN_AT)) || 0; } catch { /* brak */ }
      if (at && Date.now() - at >= c.after * 60_000) setLocked(true);
    };
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);

  /** auto = próba bez stuknięcia (przy otwarciu) – jej porażka nie jest błędem, np. Safari wymaga stuknięcia. */
  const unlock = async (auto = false) => {
    setFailed(false);
    if (await verifyLock()) {
      setLocked(false);
      tried.current = false;
    } else if (!auto) setFailed(true);
  };

  // pierwsza próba od razu (część przeglądarek wymaga jednak stuknięcia – wtedy przycisk)
  useEffect(() => {
    if (locked && !tried.current && document.visibilityState === 'visible') {
      tried.current = true;
      void unlock(true);
    }
  }, [locked]); // eslint-disable-line react-hooks/exhaustive-deps

  const reset = async () => {
    if (!confirm('Usunąć dane z tego urządzenia i wyłączyć blokadę? Wspólne dane zostaną na Dysku – po ponownym połączeniu z Google (i podaniu hasła do danych, jeśli jest) wrócą. Niezsynchronizowane zmiany przepadną.')) return;
    await Promise.all(['doc', 'dirty', 'drive-conf', 'google-token'].map((k) => idbDelete(k).catch(() => undefined)));
    await unpinEncryption();
    try { localStorage.removeItem('app-lock'); } catch { /* brak */ }
    location.reload();
  };

  if (!locked) return <>{children}</>;
  return (
    <main className="page lock-screen">
      <h1>Budżet domowy</h1>
      <p className="muted">Aplikacja jest zablokowana.</p>
      <button type="button" className="primary" onClick={() => void unlock()}>Odblokuj</button>
      {failed && (
        <>
          <p className="error">Nie udało się potwierdzić tożsamości.</p>
          <button type="button" className="small ghost" onClick={() => void reset()}>Nie mogę odblokować – wyczyść to urządzenie</button>
        </>
      )}
    </main>
  );
}
