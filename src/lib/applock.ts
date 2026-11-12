/**
 * Blokada aplikacji biometrią urządzenia (Face ID / Touch ID / Windows Hello) przez WebAuthn.
 * To zabezpieczenie przed kimś, kto weźmie odblokowany telefon – dane w przeglądarce nie są nim szyfrowane
 * (od tego jest hasło do danych na Dysku).
 */
const KEY = 'app-lock';

export interface LockConf {
  credId: string;
  /** Po ilu minutach w tle wymagać odblokowania (0 = zawsze). */
  after: number;
}

const b64 = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b)));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));

export const lockConf = (): LockConf | null => {
  try {
    const v = localStorage.getItem(KEY);
    return v ? (JSON.parse(v) as LockConf) : null;
  } catch {
    return null;
  }
};

const saveConf = (c: LockConf | null) => {
  try {
    if (c) localStorage.setItem(KEY, JSON.stringify(c));
    else localStorage.removeItem(KEY);
  } catch { /* brak pamięci – blokada nie zadziała */ }
};

export const lockSupported = async () => {
  try {
    return !!window.PublicKeyCredential && (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());
  } catch {
    return false;
  }
};

/** Rejestruje biometrię tego urządzenia i włącza blokadę. */
export const enableLock = async (name: string, after: number) => {
  const cred = (await navigator.credentials.create({
    publicKey: {
      rp: { name: 'Budżet domowy', id: location.hostname },
      user: { id: random(16), name: `budzet-${name || 'uzytkownik'}`, displayName: `Budżet domowy – ${name || 'blokada'}` },
      challenge: random(32),
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
      timeout: 60_000,
      attestation: 'none',
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error('Nie udało się zarejestrować biometrii.');
  saveConf({ credId: b64(cred.rawId), after });
};

export const setLockAfter = (after: number) => {
  const c = lockConf();
  if (c) saveConf({ ...c, after });
};

export const disableLock = () => saveConf(null);

/** Prosi o Face ID / Touch ID. true = odblokowano. */
export const verifyLock = async (): Promise<boolean> => {
  const c = lockConf();
  if (!c) return true;
  try {
    const res = await navigator.credentials.get({
      publicKey: {
        challenge: random(32),
        allowCredentials: [{ type: 'public-key', id: unb64(c.credId), transports: ['internal'] }],
        userVerification: 'required',
        timeout: 60_000,
        rpId: location.hostname,
      },
    });
    return !!res;
  } catch {
    return false;
  }
};
