import { describe, expect, it } from 'vitest';
import { deriveKey, encryptDoc, forgetKey, isEnvelope, newSalt, PasswordNeeded, readRemote, rememberKey, unlockWith, unpinEncryption, WrongPassword, writeRemote } from './crypto';
import { emptyDoc } from './types';
import type { BudgetDoc } from './types';
import { parseDoc } from './backup';

const meta = { updatedAt: '2026-01-01T00:00:00Z', updatedBy: 't' };
const doc = (): BudgetDoc => ({ ...emptyDoc(), categories: { c: { id: 'c', name: 'RACHUNKI', order: 0, ...meta } } });

describe('szyfrowanie pliku na Dysku', () => {
  it('szyfruje i odszyfrowuje; złe hasło jest odrzucane', async () => {
    const k = await deriveKey('dobre hasło 123', newSalt(), 1000);
    const env = await encryptDoc(doc(), k);
    expect(isEnvelope(env)).toBe(true);
    expect(JSON.stringify(env)).not.toContain('RACHUNKI');
    await expect(unlockWith('złe hasło', env, 1000)).rejects.toBeInstanceOf(WrongPassword);
    const back = await unlockWith('dobre hasło 123', env, 1000);
    expect(back.categories.c.name).toBe('RACHUNKI');
  });

  it('starsza wersja aplikacji nie przyjmie koperty jako budżetu', async () => {
    const k = await deriveKey('x'.repeat(12), newSalt(), 1000);
    const env = await encryptDoc(doc(), k);
    expect(() => parseDoc(JSON.stringify(env))).toThrow(/nowsza wersja/);
  });

  it('bez klucza nie odczyta i nie zapisze jawnie, gdy szyfrowanie jest włączone', async () => {
    await forgetKey();
    const k = await deriveKey('hasło do danych', newSalt(), 1000);
    const env = await encryptDoc(doc(), k);
    await expect(readRemote(JSON.stringify(env))).rejects.toBeInstanceOf(PasswordNeeded);
    await unpinEncryption(); // świadome wyłączenie – inaczej jawny zapis byłby odmową (osobny test)

    const d = doc();
    expect(JSON.parse(await writeRemote(d)).schema).toBe(3); // bez szyfrowania – zwykły JSON
    d.settings = { main: { id: 'main', encryption: { salt: k.salt, iterations: 1000 }, ...meta } };
    await expect(writeRemote(d)).rejects.toBeInstanceOf(PasswordNeeded);

    await rememberKey(k);
    const out = JSON.parse(await writeRemote(d));
    expect(isEnvelope(out)).toBe(true);
    expect((await readRemote(JSON.stringify(out))).categories.c.name).toBe('RACHUNKI');
    // inny klucz (zmiana hasła na innym urządzeniu) – znowu pytamy o hasło
    await rememberKey(await deriveKey('inne', newSalt(), 1000));
    await expect(readRemote(JSON.stringify(out))).rejects.toBeInstanceOf(PasswordNeeded);
  });
});
