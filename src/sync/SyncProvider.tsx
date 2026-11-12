import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useStore } from '../lib/store';
import { idbDelete, idbGet, idbSet } from '../lib/idb';
import { currentMonth } from '../lib/month';
import type { FileMeta, SyncConf } from './engine';
import { syncOnce } from './engine';
import * as g from './google';
import type { Envelope } from '../lib/crypto';
import { EncryptionDowngrade, isEnvelope, keyFromSettings, PasswordNeeded, rememberKey, unlockWith, unpinEncryption } from '../lib/crypto';

const CONF_KEY = 'drive-conf';
const AUTO_SYNC_MS = 2 * 60 * 1000;

export type SyncStatus = 'disabled' | 'not-connected' | 'needs-auth' | 'needs-password' | 'plain-remote' | 'syncing' | 'ok' | 'error';

interface SyncState {
  status: SyncStatus;
  conf?: SyncConf;
  user?: g.GoogleUser;
  found?: FileMeta[];
  lastSync?: Date;
  error?: string;
  signingIn?: boolean;
  /** Zaszyfrowany plik z Dysku czekający na hasło. */
  envelope?: Envelope;
}

interface SyncApi extends SyncState {
  signedIn: boolean;
  /** Logowanie (pierwsze albo ponowne) – wywołuj z kliknięcia. */
  connect: () => Promise<void>;
  syncNow: () => Promise<void>;
  useFile: (fileId: string) => Promise<void>;
  createFile: () => Promise<void>;
  pickShared: () => Promise<void>;
  share: (email: string) => Promise<void>;
  disconnect: () => Promise<void>;
  /** Wylogowanie z Google na tym urządzeniu (unieważnia też stałe logowanie). */
  signOut: () => Promise<void>;
  /** Hasło do zaszyfrowanych danych – sprawdzane na pliku z Dysku, klucz zostaje na urządzeniu. Rzuca WrongPassword. */
  unlock: (password: string) => Promise<void>;
  /** Jawny plik na Dysku, choć miał być zaszyfrowany: nadpisz go zaszyfrowanymi danymi z tego urządzenia (bez scalania). */
  keepEncrypted: () => Promise<void>;
  /** Jawny plik na Dysku: szyfrowanie wyłączono celowo na innym urządzeniu – przyjmij to także tutaj. */
  acceptPlain: () => Promise<void>;
}

const Ctx = createContext<SyncApi | null>(null);
export const useSync = () => {
  const s = useContext(Ctx);
  if (!s) throw new Error('useSync poza SyncProvider');
  return s;
};

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function SyncProvider({ children }: { children: ReactNode }) {
  const { ready, changeTick, internals, user, setUser } = useStore();
  const [state, setState] = useState<SyncState>({ status: g.isConfigured() ? 'not-connected' : 'disabled' });
  const confRef = useRef<SyncConf | undefined>(undefined);
  const running = useRef(false);
  const again = useRef(false);
  const started = useRef(false);

  const patch = useCallback((p: Partial<SyncState>) => setState((s) => ({ ...s, ...p })), []);

  const saveConf = useCallback(
    async (conf: SyncConf | undefined) => {
      confRef.current = conf;
      if (conf) await idbSet(CONF_KEY, conf);
      else await idbDelete(CONF_KEY);
      patch({ conf });
    },
    [patch],
  );

  const handleError = useCallback(
    (e: unknown) => {
      if (e instanceof g.AuthNeeded) patch({ status: 'needs-auth', error: undefined });
      else if (e instanceof PasswordNeeded) patch({ status: 'needs-password', error: undefined, envelope: e.envelope });
      else if (e instanceof EncryptionDowngrade) patch({ status: 'plain-remote', error: undefined });
      else patch({ status: 'error', error: message(e) });
    },
    [patch],
  );

  const runSync = useCallback(async () => {
    const conf = confRef.current;
    if (!conf) return;
    if (!(await g.ensureToken())) {
      // stałe logowanie jest, ale odświeżenie się nie udało (np. brak sieci) – to nie wymaga ponownego logowania
      if (g.hasSession()) return patch({ status: 'error', error: 'Nie udało się odświeżyć logowania (brak internetu?). Spróbuję ponownie.' });
      return patch({ status: 'needs-auth' });
    }
    if (running.current) {
      again.current = true;
      return;
    }
    running.current = true;
    patch({ status: 'syncing', error: undefined });
    try {
      const next = await syncOnce(g.drive, internals, conf, currentMonth());
      if (confRef.current?.fileId === conf.fileId) await saveConf(next);
      patch({ status: 'ok', lastSync: new Date(), envelope: undefined });
    } catch (e) {
      handleError(e);
    } finally {
      running.current = false;
      if (again.current) {
        again.current = false;
        void runSync();
      }
    }
  }, [internals, patch, saveConf, handleError]);

  const afterSignIn = useCallback(async () => {
    const u = await g.getUser();
    if (!user) setUser(u.displayName.split(' ')[0] || u.emailAddress);
    patch({ user: u });
    if (confRef.current) await runSync();
    else patch({ status: 'not-connected', found: await g.findFiles() });
  }, [user, setUser, patch, runSync]);

  // start: przywróć token i połączenie z plikiem
  useEffect(() => {
    if (!ready || started.current || !g.isConfigured()) return;
    started.current = true;
    (async () => {
      await g.restoreToken();
      const conf = await idbGet<SyncConf>(CONF_KEY);
      confRef.current = conf;
      patch({ conf, status: conf ? 'needs-auth' : 'not-connected', error: g.takeRedirectError() });
      if (await g.ensureToken()) await afterSignIn().catch(handleError);
    })();
  }, [ready, afterSignIn, patch, handleError]);

  // po każdej lokalnej zmianie – synchronizacja z krótkim opóźnieniem
  useEffect(() => {
    if (!changeTick || !confRef.current) return;
    const t = setTimeout(() => void runSync(), 2500);
    return () => clearTimeout(t);
  }, [changeTick, runSync]);

  // po powrocie do aplikacji i co 2 minuty, gdy jest widoczna
  useEffect(() => {
    const onVisible = () => document.visibilityState === 'visible' && confRef.current && g.hasSession() && void runSync();
    document.addEventListener('visibilitychange', onVisible);
    const i = setInterval(() => document.visibilityState === 'visible' && confRef.current && g.hasSession() && void runSync(), AUTO_SYNC_MS);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(i);
    };
  }, [runSync]);

  const api = useMemo<SyncApi>(
    () => ({
      ...state,
      signedIn: g.hasSession(),
      connect: async () => {
        patch({ error: undefined, signingIn: true });
        // chwila na zapis ostatnich zmian w przeglądarce przed przejściem do Google
        await new Promise((r) => setTimeout(r, 400));
        await g.signIn(!confRef.current);
      },
      syncNow: runSync,
      useFile: async (fileId) => {
        await saveConf({ fileId });
        await runSync();
      },
      createFile: async () => {
        try {
          patch({ status: 'syncing', error: undefined });
          const startCount = internals.changeCount();
          const meta = await g.createMainFile(internals.getDoc());
          internals.markSynced(startCount);
          await saveConf({ fileId: meta.id, fileName: meta.name, ownedByMe: true, version: meta.version, snapshotMonth: currentMonth() });
          patch({ status: 'ok', lastSync: new Date() });
        } catch (e) {
          handleError(e);
        }
      },
      pickShared: async () => {
        try {
          const id = await g.pickFile();
          if (id) {
            await saveConf({ fileId: id });
            await runSync();
          }
        } catch (e) {
          handleError(e);
        }
      },
      share: async (email) => {
        if (!confRef.current) return;
        await g.shareFile(confRef.current.fileId, email);
      },
      unlock: async (password) => {
        const conf = confRef.current;
        let env = state.envelope;
        if (!env && conf) {
          let raw: unknown;
          try { raw = JSON.parse(await g.downloadText(conf.fileId)); } catch { throw new Error('Plik na Dysku nie jest poprawnym JSON-em.'); }
          if (isEnvelope(raw)) env = raw;
        }
        if (env) await unlockWith(password, env);
        else {
          // plik na Dysku jeszcze jawny, a ustawienia wymagają szyfrowania – klucz z soli z ustawień
          const enc = internals.getDoc().settings.main?.encryption;
          if (!enc) return;
          await rememberKey(await keyFromSettings(password, enc));
        }
        patch({ envelope: undefined });
        await runSync();
      },
      keepEncrypted: async () => {
        const conf = confRef.current;
        if (!conf) return;
        try {
          patch({ status: 'syncing', error: undefined });
          const startCount = internals.changeCount();
          const res = await g.drive.upload(conf.fileId, internals.getDoc());
          internals.markSynced(startCount);
          if (confRef.current?.fileId === conf.fileId) await saveConf({ ...conf, version: res.version });
          patch({ status: 'ok', lastSync: new Date() });
        } catch (e) {
          handleError(e);
        }
      },
      acceptPlain: async () => {
        await unpinEncryption();
        await runSync();
      },
      signOut: async () => {
        await g.signOut();
        patch({ status: confRef.current ? 'needs-auth' : 'not-connected', user: undefined, found: undefined });
      },
      disconnect: async () => {
        await saveConf(undefined);
        patch({ status: 'not-connected', lastSync: undefined, found: (await g.ensureToken()) ? await g.findFiles().catch(() => []) : undefined });
      },
    }),
    [state, patch, afterSignIn, handleError, runSync, saveConf, internals],
  );

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
