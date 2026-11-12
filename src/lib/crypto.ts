import type { BudgetDoc } from './types';
import { parseDoc } from './backup';
import { idbDelete, idbGet, idbSet } from './idb';

/**
 * Szyfrowanie pliku na Dysku hasłem: AES-GCM 256, klucz z hasła przez PBKDF2-SHA-256.
 * Hasło nie jest nigdzie zapisywane – urządzenie pamięta tylko wyprowadzony klucz
 * (niewyciągalny CryptoKey w IndexedDB), więc hasło wpisuje się raz na urządzenie.
 */

export const FORMAT = 'budzet-domowy-szyfr';
export const ITERATIONS = 600_000;
/** Dopuszczalny zakres liczby iteracji z pliku (parametry pochodzą z Dysku, więc nie można im ufać). */
export const MIN_ITERATIONS = 600_000;
export const MAX_ITERATIONS = 5_000_000;
const KEY_IDB = 'crypto-key';
const PIN_IDB = 'crypto-pin';
const PREV_IDB = 'crypto-key-prev';

export interface Envelope {
  /** 99 – starsze wersje aplikacji odmówią zapisu („nowsza wersja”), zamiast nadpisać plik jawnym tekstem. */
  schema: 99;
  format: typeof FORMAT;
  v: 1;
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; salt: string };
  iv: string;
  data: string;
}

export interface KeyInfo { salt: string; iterations: number; key: CryptoKey }

const b64 = (buf: ArrayBuffer | Uint8Array) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export const newSalt = () => b64(crypto.getRandomValues(new Uint8Array(16)));

export const deriveKey = async (password: string, salt: string, iterations = ITERATIONS): Promise<KeyInfo> => {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: unb64(salt), iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
  return { salt, iterations, key };
};

export const isEnvelope = (x: unknown): x is Envelope => !!x && typeof x === 'object' && (x as Envelope).format === FORMAT;

export class BadEnvelope extends Error {
  constructor(why: string) { super(`Zaszyfrowany plik na Dysku jest uszkodzony albo podmieniony (${why}).`); }
}

const bytesOf = (s: unknown): number => {
  if (typeof s !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(s)) return -1;
  try { return atob(s).length; } catch { return -1; }
};

/**
 * Parametry wyprowadzania klucza przychodzą z pliku na Dysku. Ktoś z dostępem do Dysku mógłby podać
 * np. 1 iterację (klucz z hasła dałoby się wtedy łamać błyskawicznie) albo miliardy (zawieszenie urządzenia).
 */
export const checkKdf = (salt: unknown, iterations: unknown, min = MIN_ITERATIONS) => {
  if (typeof iterations !== 'number' || !Number.isInteger(iterations) || iterations < min || iterations > MAX_ITERATIONS) throw new BadEnvelope('liczba iteracji');
  const n = bytesOf(salt);
  if (n < 16 || n > 64) throw new BadEnvelope('sól');
};

/** Sprawdza kształt koperty przed użyciem jej pól. */
export const checkEnvelope = (env: Envelope, min = MIN_ITERATIONS) => {
  const k = env.kdf as Envelope['kdf'] | undefined;
  if (env.v !== 1 || !k || typeof k !== 'object' || k.name !== 'PBKDF2' || k.hash !== 'SHA-256') throw new BadEnvelope('format');
  checkKdf(k.salt, k.iterations, min);
  if (bytesOf(env.iv) !== 12) throw new BadEnvelope('iv');
  if (bytesOf(env.data) < 16) throw new BadEnvelope('dane');
};

export const encryptDoc = async (doc: BudgetDoc, k: KeyInfo): Promise<Envelope> => {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k.key, new TextEncoder().encode(JSON.stringify(doc)));
  return { schema: 99, format: FORMAT, v: 1, kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: k.iterations, salt: k.salt }, iv: b64(iv), data: b64(data) };
};

export class WrongPassword extends Error {
  constructor() { super('Złe hasło do danych.'); }
}

export const decryptEnvelope = async (env: Envelope, k: KeyInfo): Promise<BudgetDoc> => {
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(env.iv) }, k.key, unb64(env.data));
  } catch {
    throw new WrongPassword();
  }
  return parseDoc(new TextDecoder().decode(plain));
};

/* ---------- klucz zapamiętany na urządzeniu ---------- */

let current: KeyInfo | null | undefined;

export const loadKey = async (): Promise<KeyInfo | null> => {
  if (current === undefined) current = (await idbGet<KeyInfo>(KEY_IDB).catch(() => undefined)) ?? null;
  return current;
};

/**
 * Poprzedni klucz – potrzebny tylko przez chwilę po zmianie hasła: jeśli druga osoba zdążyła zapisać plik
 * starym kluczem, trzeba go jeszcze odczytać i scalić, zanim pójdzie wersja zaszyfrowana nowym.
 */
let previous: KeyInfo | null | undefined;
const loadPrevious = async (): Promise<KeyInfo | null> => {
  if (previous === undefined) previous = (await idbGet<KeyInfo>(PREV_IDB).catch(() => undefined)) ?? null;
  return previous;
};
const dropPrevious = async () => {
  previous = null;
  await idbDelete(PREV_IDB).catch(() => undefined);
};

export const rememberKey = async (k: KeyInfo) => {
  const old = await loadKey();
  if (old && old.salt !== k.salt) {
    previous = old;
    await idbSet(PREV_IDB, old).catch(() => undefined);
  }
  current = k;
  // niektóre przeglądarki nie zapiszą CryptoKey – wtedy hasło będzie potrzebne po ponownym uruchomieniu
  await idbSet(KEY_IDB, k).catch(() => undefined);
};

/** Zapomina klucz, ale nie to, że plik ma być zaszyfrowany (do tego służy unpinEncryption). */
export const forgetKey = async () => {
  if (await isPinned()) await savePin('pinned');
  current = null;
  await idbDelete(KEY_IDB).catch(() => undefined);
  await dropPrevious();
};

/* ---------- ochrona przed wyłączeniem szyfrowania z zewnątrz ---------- */

/**
 * „Przypięcie” szyfrowania: urządzenie, które choć raz widziało zaszyfrowany plik albo dostało klucz, pamięta
 * (lokalnie, poza synchronizowanymi danymi), że wspólny plik ma być zaszyfrowany. Od tej chwili jawny plik
 * na Dysku nie jest ani scalany, ani nadpisywany jawnymi danymi bez wyraźnej decyzji użytkownika – inaczej
 * ktoś z dostępem do Dysku mógłby podmienić plik na jawny z „nowszymi” ustawieniami bez szyfrowania
 * i dostać cały budżet jawnym tekstem przy następnej synchronizacji.
 */
type PinState = 'enabling' | 'pinned' | 'disabling' | null;
let pin: PinState | undefined;

const loadPin = async (): Promise<PinState> => {
  if (pin === undefined) {
    const v = await idbGet<unknown>(PIN_IDB).catch(() => null);
    pin = v === 'enabling' || v === 'pinned' || v === 'disabling' ? v : null;
  }
  return pin;
};
const savePin = async (v: PinState) => {
  pin = v;
  await (v ? idbSet(PIN_IDB, v) : idbDelete(PIN_IDB)).catch(() => undefined);
};

/**
 * Urządzenie z kluczem (sprzed tej ochrony) też liczy się jako przypięte – chyba że właśnie włącza
 * albo wyłącza szyfrowanie (stany przejściowe, do pierwszego udanego zapisu na Dysku).
 */
export const isPinned = async (): Promise<boolean> => {
  const p = await loadPin();
  return p === 'pinned' || (p === null && !!(await loadKey()));
};

/** Zaszyfrowany plik był na Dysku (pobrany albo właśnie wysłany). */
export const pinEncryption = async () => {
  if ((await loadPin()) !== 'pinned') await savePin('pinned');
};

/**
 * Po udanym zapisie na Dysku. Poszła wersja zaszyfrowana – od teraz jawny plik jest podejrzany.
 * Poszła jawna w trakcie wyłączania szyfrowania – wyłączanie zakończone, klucz nie jest już potrzebny.
 */
export const confirmUploaded = async (doc: BudgetDoc) => {
  if (doc.settings.main?.encryption) {
    await pinEncryption();
    await dropPrevious();
  } else if ((await loadPin()) === 'disabling') await unpinEncryption();
};

/**
 * Wyłączanie szyfrowania na tym urządzeniu. Klucz zostaje do pierwszego udanego jawnego zapisu:
 * jeśli druga osoba zdążyła w międzyczasie zapisać zaszyfrowany plik, trzeba go jeszcze odczytać i scalić.
 */
export const beginDisabling = async () => {
  await savePin('disabling');
};

/**
 * Włączanie szyfrowania na tym urządzeniu: plik na Dysku jest jeszcze jawny, więc do pierwszego
 * udanego wysłania zaszyfrowanej wersji wolno go czytać.
 */
export const beginEnabling = async () => {
  if ((await loadPin()) !== 'pinned') await savePin('enabling');
};

/** Świadome wyłączenie szyfrowania na tym urządzeniu (albo potwierdzenie, że wyłączono je na innym). */
export const unpinEncryption = async () => {
  await savePin(null);
  current = null;
  await idbDelete(KEY_IDB).catch(() => undefined);
  await dropPrevious();
};

/** Plik na Dysku jest jawny, choć to urządzenie zna go jako zaszyfrowany (albo dane do wysłania straciły ustawienie szyfrowania). */
export class EncryptionDowngrade extends Error {
  constructor() { super('Plik na Dysku nie jest zaszyfrowany, choć powinien być.'); }
}

/** Plik na Dysku jest zaszyfrowany innym hasłem / klucza nie ma na tym urządzeniu. */
export class PasswordNeeded extends Error {
  /** Koperta z Dysku (do sprawdzenia hasła); brak – trzeba ją pobrać. */
  constructor(public envelope?: Envelope) { super('Dane na Dysku są zaszyfrowane – podaj hasło.'); }
}

/** Sprawdza hasło na kopercie z Dysku i zapamiętuje klucz na urządzeniu. Zwraca odszyfrowane dane. */
export const unlockWith = async (password: string, env: Envelope, min = MIN_ITERATIONS): Promise<BudgetDoc> => {
  checkEnvelope(env, min);
  const k = await deriveKey(password, env.kdf.salt, env.kdf.iterations);
  const doc = await decryptEnvelope(env, k);
  await rememberKey(k);
  return doc;
};

/** Odczyt treści pliku z Dysku: jawny JSON albo koperta zaszyfrowana. */
export const readRemote = async (text: string): Promise<BudgetDoc> => {
  let data: unknown;
  try { data = JSON.parse(text); } catch { throw new Error('Plik na Dysku nie jest poprawnym JSON-em.'); }
  if (!isEnvelope(data)) {
    if (await isPinned()) throw new EncryptionDowngrade();
    return parseDoc(text);
  }
  checkEnvelope(data, 1); // śmieci udające kopertę nie przypinają szyfrowania i nie pytają o hasło
  if ((await loadPin()) !== 'disabling') await pinEncryption();
  const salt = data.kdf.salt;
  const k = [await loadKey(), await loadPrevious()].find((x) => x && x.salt === salt);
  if (!k) throw new PasswordNeeded(data);
  return decryptEnvelope(data, k);
};

/** Klucz z hasła i soli zapisanej w ustawieniach (plik na Dysku jeszcze jawny) – z kontrolą parametrów. */
export const keyFromSettings = async (password: string, enc: { salt: string; iterations: number }, min = MIN_ITERATIONS): Promise<KeyInfo> => {
  checkKdf(enc.salt, enc.iterations, min);
  return deriveKey(password, enc.salt, enc.iterations);
};

/**
 * Kopia zapasowa wczytywana z pliku nie może zmienić szyfrowania: w jej ustawieniach zostaje to,
 * co jest na urządzeniu (stara kopia sprzed włączenia hasła nie wyłączy szyfrowania pliku na Dysku).
 */
export const keepEncryption = (current: BudgetDoc, incoming: BudgetDoc): BudgetDoc => {
  const enc = current.settings.main?.encryption;
  const main = incoming.settings.main ?? current.settings.main;
  if (!main) return incoming;
  const next = { ...main };
  if (enc) next.encryption = enc;
  else delete next.encryption;
  return { ...incoming, settings: { ...incoming.settings, main: next } };
};

/**
 * Treść do zapisu na Dysku. Gdy w ustawieniach szyfrowanie jest włączone – zawsze szyfrujemy,
 * a bez właściwego klucza odmawiamy zapisu (nigdy nie nadpisujemy pliku jawnym tekstem).
 */
export const writeRemote = async (doc: BudgetDoc): Promise<string> => {
  const enc = doc.settings.main?.encryption;
  if (!enc) {
    if (await isPinned()) throw new EncryptionDowngrade();
    return JSON.stringify(doc);
  }
  const k = await loadKey();
  if (!k || k.salt !== enc.salt) throw new PasswordNeeded();
  return JSON.stringify(await encryptDoc(doc, k));
};
