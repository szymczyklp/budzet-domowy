/**
 * Logowanie Google (OAuth 2.0 z przekierowaniem, bez wyskakujących okien) i Drive API v3.
 *
 * Logowanie: aplikacja przechodzi na stronę Google, a po zgodzie Google odsyła
 * użytkownika z powrotem z tokenem w adresie (#access_token=…). Działa także
 * w aplikacji dodanej do ekranu głównego telefonu i z blokerami w przeglądarce.
 *
 * Zakres drive.file: aplikacja widzi wyłącznie pliki, które sama utworzyła
 * albo które użytkownik wskazał jej w Google Picker – nie cały Dysk.
 * Bez pośrednika token jest ważny ok. godziny; po tym czasie aplikacja pokazuje przycisk
 * „Połącz z Dyskiem”. Z pośrednikiem (Cloudflare Worker, GOOGLE.tokenProxy) logowanie
 * zwraca kod, Worker wymienia go na tokeny, a aplikacja odświeża token sama – bez ponownego logowania.
 */
import { GOOGLE } from '../config';
import type { BudgetDoc } from '../lib/types';
import { confirmUploaded, readRemote, writeRemote } from '../lib/crypto';
import { idbGet, idbSet, idbDelete } from '../lib/idb';
import type { DriveApi, FileMeta } from './engine';

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    google?: any;
    gapi?: any;
  }
}

export const MAIN_FILE = 'budzet-domowy.json';
const FOLDER = 'Budżet domowy';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const STATE_KEY = 'budzet-oauth-state';
const GAPI_SRC = 'https://apis.google.com/js/api.js';
const TOKEN_KEY = 'google-token';
const VERIFIER_KEY = 'budzet-oauth-verifier';
const PROXY = (GOOGLE.tokenProxy ?? '').replace(/\/+$/, '');
const FIELDS = 'id,name,version,ownedByMe,parents,owners(displayName,emailAddress)';

export class AuthNeeded extends Error {
  constructor() {
    super('Połącz się ponownie z Dyskiem Google.');
  }
}

export const isConfigured = () => !!(GOOGLE.clientId && GOOGLE.apiKey && GOOGLE.appId);

/* ---------- ładowanie skryptów Google ---------- */

const scripts = new Map<string, Promise<void>>();
const loadScript = (src: string) => {
  if (!scripts.has(src)) {
    scripts.set(
      src,
      new Promise<void>((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.async = true;
        s.onload = () => resolve();
        s.onerror = () => {
          scripts.delete(src);
          reject(new Error('Nie udało się wczytać skryptu Google – sprawdź połączenie z internetem.'));
        };
        document.head.appendChild(s);
      }),
    );
  }
  return scripts.get(src)!;
};

/* ---------- token ---------- */

interface Token {
  value: string;
  expiresAt: number;
}
let token: Token | null = null;
let loginHint = '';
let redirectError: string | undefined;

/** Adres, na który Google odsyła po logowaniu – musi być w „Autoryzowanych URI przekierowania”. */
export const redirectUri = () => location.origin + location.pathname.replace(/index\.html$/, '');

const storage = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* brak dostępu */ } },
  del: (k: string) => { try { localStorage.removeItem(k); } catch { /* brak dostępu */ } },
};

/**
 * Odbiera wynik logowania z adresu strony. Wywołać raz, przed wyrenderowaniem aplikacji
 * (zanim widoki przeczytają #hash). Czyści adres z tokenu.
 */
let pendingCode: string | null = null;

export const handleRedirect = () => {
  const hash = location.hash.slice(1);
  const query = location.search.slice(1);
  const fromQuery = /(^|&)(code|error)=/.test(query) && /(^|&)state=/.test(query);
  if (!fromQuery && !/(^|&)(access_token|error)=/.test(hash)) return;
  const p = new URLSearchParams(fromQuery ? query : hash);
  if (fromQuery) {
    const expected = storage.get(STATE_KEY);
    storage.del(STATE_KEY);
    history.replaceState(null, '', `${location.pathname}#ustawienia`);
    if (!expected || p.get('state') !== expected) {
      redirectError = 'Logowanie nie powiodło się (niezgodny stan). Spróbuj ponownie.';
      return;
    }
    const err = p.get('error');
    if (err) {
      redirectError = err === 'access_denied'
        ? 'Logowanie anulowane albo konto nie jest na liście użytkowników testowych w Google Cloud.'
        : `Logowanie nie powiodło się (${err}).`;
      return;
    }
    if (!(p.get('scope') ?? '').split(' ').includes(SCOPE)) {
      redirectError = 'Na ekranie zgody Google zaznacz dostęp do plików na Dysku i spróbuj ponownie.';
      return;
    }
    pendingCode = p.get('code');
    return;
  }
  const expected = storage.get(STATE_KEY);
  storage.del(STATE_KEY);
  history.replaceState(null, '', `${location.pathname}${location.search}#ustawienia`);

  if (!expected || p.get('state') !== expected) {
    redirectError = 'Logowanie nie powiodło się (niezgodny stan). Spróbuj ponownie.';
    return;
  }
  const err = p.get('error');
  if (err) {
    redirectError = err === 'access_denied'
      ? 'Logowanie anulowane albo konto nie jest na liście użytkowników testowych w Google Cloud.'
      : `Logowanie nie powiodło się (${err}).`;
    return;
  }
  if (!(p.get('scope') ?? '').split(' ').includes(SCOPE)) {
    redirectError = 'Na ekranie zgody Google zaznacz dostęp do plików na Dysku i spróbuj ponownie.';
    return;
  }
  token = { value: p.get('access_token')!, expiresAt: Date.now() + (Number(p.get('expires_in') ?? 3600) - 60) * 1000 };
  void saveToken();
};

/** Komunikat z ostatniego powrotu z logowania (jednorazowo). */
export const takeRedirectError = () => {
  const e = redirectError;
  redirectError = undefined;
  return e;
};

/** Zapieczętowany refresh token (odczyta go tylko nasz Worker). */
let sealed = '';

const saveToken = () => idbSet(TOKEN_KEY, { ...(token ?? { value: '', expiresAt: 0 }), hint: loginHint, sealed }).catch(console.error);

const proxy = async <T,>(path: string, body: object): Promise<T> => {
  const r = await fetch(`${PROXY}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(`Logowanie przez pośrednika nie powiodło się (${data.error ?? r.status}).`), { code: data.error });
  return data as T;
};

type TokenResponse = { access_token: string; expires_in: number; scope?: string; sealed?: string };
const takeToken = (t: TokenResponse) => {
  token = { value: t.access_token, expiresAt: Date.now() + (Number(t.expires_in ?? 3600) - 60) * 1000 };
};

export const restoreToken = async () => {
  const t = await idbGet<Token & { hint?: string; sealed?: string }>(TOKEN_KEY);
  if (t?.hint) loginHint = t.hint;
  if (t?.sealed) sealed = t.sealed;
  if (!hasToken() && t && t.expiresAt > Date.now()) token = { value: t.value, expiresAt: t.expiresAt };
  // powrót z logowania w trybie z pośrednikiem: wymiana kodu na tokeny
  if (pendingCode && PROXY) {
    const code = pendingCode;
    pendingCode = null;
    const verifier = storage.get(VERIFIER_KEY) ?? '';
    storage.del(VERIFIER_KEY);
    try {
      const res = await proxy<TokenResponse>('/token', { code, redirect_uri: redirectUri(), code_verifier: verifier });
      takeToken(res);
      if (res.sealed) sealed = res.sealed;
      await saveToken();
    } catch (e) {
      redirectError = (e as Error).message;
    }
  }
};

export const hasToken = () => !!token && token.expiresAt > Date.now();

/** Rodzaj logowania na tym urządzeniu: stałe (przez pośrednika) albo na godzinę. */
export const sessionKind = (): 'stała' | 'godzinna' | 'brak-pośrednika' => (!PROXY ? 'brak-pośrednika' : sealed ? 'stała' : 'godzinna');

/** Czy jest sesja: ważny token albo możliwość odświeżenia przez pośrednika. */
export const hasSession = () => hasToken() || (!!PROXY && !!sealed);

let refreshing: Promise<boolean> | null = null;

/** Zapewnia ważny token (odświeża przez pośrednika, jeśli trzeba). false = trzeba się zalogować. */
export const ensureToken = async (): Promise<boolean> => {
  if (hasToken()) return true;
  if (!PROXY || !sealed) return false;
  refreshing ??= (async () => {
    try {
      takeToken(await proxy<TokenResponse>('/refresh', { sealed }));
      await saveToken();
      return true;
    } catch (e) {
      // refresh token cofnięty / wygasły – trzeba zalogować się ponownie
      if ((e as { code?: string }).code === 'invalid_grant') {
        sealed = '';
        await saveToken();
      }
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
};

const b64url = (b: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(b instanceof Uint8Array ? b : new Uint8Array(b)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Przechodzi na stronę logowania Google. Po zgodzie Google wraca do aplikacji. */
export const signIn = async (firstTime = false) => {
  const state = b64url(crypto.getRandomValues(new Uint8Array(24)));
  storage.set(STATE_KEY, state);
  const params = new URLSearchParams({
    client_id: GOOGLE.clientId,
    redirect_uri: redirectUri(),
    response_type: PROXY ? 'code' : 'token',
    scope: SCOPE,
    include_granted_scopes: 'true',
    state,
  });
  if (PROXY) {
    // PKCE: nawet przechwycony kod nie wystarczy bez weryfikatora z tego urządzenia
    const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
    storage.set(VERIFIER_KEY, verifier);
    params.set('code_challenge', b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
    params.set('code_challenge_method', 'S256');
    params.set('access_type', 'offline');
  }
  // zgoda przy pierwszym razie, a z pośrednikiem także gdy nie mamy refresh tokenu (Google wyda go tylko przy zgodzie)
  if (firstTime || (PROXY && !sealed)) params.set('prompt', 'consent select_account');
  else if (loginHint) params.set('login_hint', loginHint);
  location.assign(`${AUTH_URL}?${params}`);
};

export const signOut = async () => {
  if (sealed && PROXY) proxy('/revoke', { sealed }).catch(() => undefined);
  else if (token) fetch(`https://oauth2.googleapis.com/revoke?token=${token.value}`, { method: 'POST', mode: 'no-cors' }).catch(() => undefined);
  token = null;
  sealed = '';
  loginHint = '';
  await idbDelete(TOKEN_KEY);
};

/* ---------- Drive API ---------- */

const api = async (url: string, init: RequestInit = {}) => {
  if (!(await ensureToken())) throw new AuthNeeded();
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token!.value}`, ...(init.headers ?? {}) },
  });
  if (res.status === 401) {
    token = null;
    // z pośrednikiem: jedna próba odświeżenia i ponowienia
    if (await ensureToken()) {
      const again = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token!.value}`, ...(init.headers ?? {}) } });
      if (again.ok) return again;
    }
    throw new AuthNeeded();
  }
  if (res.status === 404) throw new Error('Nie mam dostępu do pliku na Dysku – mógł zostać usunięty albo nie jest już udostępniony.');
  if (!res.ok) throw new Error(`Dysk Google zwrócił błąd ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res;
};

const D = 'https://www.googleapis.com/drive/v3';
const U = 'https://www.googleapis.com/upload/drive/v3';

export interface GoogleUser {
  displayName: string;
  emailAddress: string;
}

export const getUser = async (): Promise<GoogleUser> => {
  const r = await api(`${D}/about?fields=user(displayName,emailAddress)`);
  const u = (await r.json()).user as GoogleUser;
  if (u.emailAddress !== loginHint) {
    loginHint = u.emailAddress;
    if (token) void saveToken();
  }
  return u;
};

/** Pliki budżetu, do których aplikacja ma dostęp (własne i wcześniej wskazane). */
export const findFiles = async (): Promise<FileMeta[]> => {
  const q = encodeURIComponent(`name='${MAIN_FILE}' and trashed=false`);
  const r = await api(`${D}/files?q=${q}&fields=files(${FIELDS})&orderBy=modifiedTime desc`);
  return (await r.json()).files ?? [];
};

const multipart = (meta: object, content: string) => {
  const boundary = `b${Math.random().toString(36).slice(2)}`;
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${content}\r\n--${boundary}--`;
  return { body, headers: { 'Content-Type': `multipart/related; boundary=${boundary}` } };
};

const createJson = async (name: string, doc: BudgetDoc, parentId?: string): Promise<FileMeta> => {
  const { body, headers } = multipart({ name, mimeType: 'application/json', ...(parentId ? { parents: [parentId] } : {}) }, await writeRemote(doc));
  const r = await api(`${U}/files?uploadType=multipart&fields=${FIELDS}`, { method: 'POST', body, headers });
  await confirmUploaded(doc);
  return r.json();
};

/** Tworzy folder „Budżet domowy” i w nim plik z danymi z tego urządzenia. */
export const createMainFile = async (doc: BudgetDoc): Promise<FileMeta> => {
  const r = await api(`${D}/files?fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: FOLDER, mimeType: 'application/vnd.google-apps.folder' }),
  });
  const folder = await r.json();
  return createJson(MAIN_FILE, doc, folder.id);
};

/** Udostępnia plik do edycji wskazanej osobie (Google wyśle jej e-mail). */
export const shareFile = async (fileId: string, email: string) => {
  await api(`${D}/files/${fileId}/permissions?sendNotificationEmail=true`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'user', role: 'writer', emailAddress: email }),
  });
};

/** Surowa treść pliku (np. koperta zaszyfrowana – do sprawdzenia hasła). */
export const downloadText = async (fileId: string) => (await api(`${D}/files/${fileId}?alt=media`)).text();

export const drive: DriveApi = {
  async getMeta(fileId) {
    const r = await api(`${D}/files/${fileId}?fields=${FIELDS}`);
    return r.json();
  },
  async download(fileId) {
    return readRemote(await downloadText(fileId));
  },
  async upload(fileId, doc) {
    const body = await writeRemote(doc);
    const r = await api(`${U}/files/${fileId}?uploadType=media&fields=version`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    await confirmUploaded(doc);
    return r.json();
  },
  async createSnapshot(parentId, name, doc) {
    await createJson(name, doc, parentId);
  },
};

/* ---------- Google Picker: wskazanie pliku udostępnionego przez kogoś ---------- */

export const pickFile = async (): Promise<string | null> => {
  if (!(await ensureToken())) throw new AuthNeeded();
  if (!hasToken()) throw new AuthNeeded();
  await loadScript(GAPI_SRC);
  await new Promise<void>((resolve) => window.gapi.load('picker', () => resolve()));
  const g = window.google.picker;
  return new Promise((resolve) => {
    const view = (ownedByMe: boolean, label: string) => {
      const v = new g.DocsView(g.ViewId.DOCS).setOwnedByMe(ownedByMe).setMimeTypes('application/json');
      return typeof v.setLabel === 'function' ? v.setLabel(label) : v;
    };
    const shared = view(false, 'Udostępnione dla mnie');
    const mine = view(true, 'Mój dysk');
    new g.PickerBuilder()
      .setAppId(GOOGLE.appId)
      .setOAuthToken(token!.value)
      .setDeveloperKey(GOOGLE.apiKey)
      .setLocale('pl')
      .setTitle(`Wybierz plik ${MAIN_FILE}`)
      .addView(shared)
      .addView(mine)
      .setCallback((data: any) => {
        if (data.action === g.Action.PICKED) resolve(data.docs?.[0]?.id ?? null);
        else if (data.action === g.Action.CANCEL) resolve(null);
      })
      .build()
      .setVisible(true);
  });
};
