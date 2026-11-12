import { beforeEach, describe, expect, it } from 'vitest';
import type { BudgetDoc } from './types';
import { emptyDoc } from './types';
import { mergeDocs } from './merge';
import {
  BadEnvelope, beginDisabling, beginEnabling, checkKdf, confirmUploaded, deriveKey, encryptDoc, EncryptionDowngrade, forgetKey, isPinned, keepEncryption, keyFromSettings,
  loadKey, newSalt, PasswordNeeded, readRemote, rememberKey, unlockWith, unpinEncryption, writeRemote,
} from './crypto';
import { parseDoc } from './backup';
import { sanitizeDoc } from './sanitize';
import { restoreDoc } from './restore';
import { linesForMonth } from './projection';
import type { DriveApi, Local, SyncConf } from '../sync/engine';
import { syncOnce } from '../sync/engine';
import { parseBankCsv } from '../import/parsers';
import { defaultPattern } from '../import/match';

const meta = { updatedAt: '2026-11-01T10:00:00.000Z', updatedBy: 'ja' };

/** Dysk przechowujący surowy tekst – tak jak prawdziwy (szyfrowanie po stronie aplikacji). */
class TextDrive implements DriveApi {
  text = '';
  version = 1;
  async getMeta(id: string) { return { id, name: 'budzet-domowy.json', version: String(this.version), ownedByMe: true, parents: ['f'] }; }
  async download() { return readRemote(this.text); }
  async upload(_id: string, doc: BudgetDoc) { this.text = await writeRemote(doc); await confirmUploaded(doc); this.version++; return { version: String(this.version) }; }
  async createSnapshot() { /* pomijamy */ }
}
class Device implements Local {
  doc: BudgetDoc = emptyDoc();
  changes = 0; dirty = false; conf: SyncConf = { fileId: 'f', snapshotMonth: '2026-11' };
  getDoc = () => this.doc; changeCount = () => this.changes; isDirty = () => this.dirty;
  mergeRemote = (r: BudgetDoc) => { this.doc = mergeDocs(this.doc, r); };
  markSynced = (n: number) => { if (n === this.changes) this.dirty = false; };
  sync = async (drive: TextDrive) => { this.conf = await syncOnce(drive, this, this.conf, '2026-11'); };
}

const secretDoc = (salt: string): BudgetDoc => ({
  ...emptyDoc(),
  categories: { c: { id: 'c', name: 'PRZYCHODY', order: 0, ...meta } },
  positions: { p: { id: 'p', name: 'TAJNA-PENSJA', categoryId: 'c', activeFrom: '2026-01', rules: [{ from: '2026-01', amount: 12345.67 }], ...meta } },
  settings: { main: { id: 'main', encryption: { salt, iterations: 1000 }, ...meta } },
});
const plainAttack = (extra: object = {}) =>
  JSON.stringify({ schema: 3, categories: {}, accounts: {}, positions: {}, entries: {}, settings: { main: { id: 'main', updatedAt: '2099-01-01T00:00:00.000Z', updatedBy: 'x', ...extra } } });

describe('podmiana zaszyfrowanego pliku na jawny (downgrade)', () => {
  beforeEach(async () => { await unpinEncryption(); });

  const encryptedSetup = async () => {
    const k = await deriveKey('tajne haslo 123', newSalt(), 1000);
    await beginEnabling();
    await rememberKey(k);
    const dev = new Device();
    dev.doc = secretDoc(k.salt);
    dev.dirty = true; dev.changes = 1;
    const drive = new TextDrive();
    drive.text = JSON.stringify(emptyDoc()); // plik sprzed włączenia szyfrowania
    drive.version = 2;
    await dev.sync(drive); // włączanie: jawny plik wolno przeczytać, wychodzi koperta
    expect(drive.text).not.toContain('TAJNA-PENSJA');
    return { k, dev, drive };
  };

  it('jawny plik z „nowszymi” ustawieniami bez szyfrowania nie jest scalany ani nadpisywany jawnymi danymi', async () => {
    const { dev, drive } = await encryptedSetup();
    drive.text = plainAttack();
    drive.version++;
    await expect(dev.sync(drive)).rejects.toBeInstanceOf(EncryptionDowngrade);
    expect(drive.text).not.toContain('TAJNA-PENSJA');
    expect(dev.doc.settings.main.encryption).toBeTruthy();
  });

  it('także gdy urządzenie zapomniało klucz – pamięta, że plik ma być zaszyfrowany', async () => {
    const { dev, drive } = await encryptedSetup();
    await forgetKey();
    drive.text = plainAttack();
    drive.version++;
    await expect(dev.sync(drive)).rejects.toBeInstanceOf(EncryptionDowngrade);
    expect(drive.text).not.toContain('TAJNA-PENSJA');
  });

  it('dane bez ustawienia szyfrowania nie wyjdą jawnie z przypiętego urządzenia', async () => {
    const { dev } = await encryptedSetup();
    const stripped = { ...dev.doc, settings: {} };
    await expect(writeRemote(stripped)).rejects.toBeInstanceOf(EncryptionDowngrade);
  });

  it('po świadomym potwierdzeniu (wyłączone na innym urządzeniu) jawny plik jest przyjmowany', async () => {
    const { dev, drive } = await encryptedSetup();
    drive.text = plainAttack();
    drive.version++;
    await unpinEncryption();
    await dev.sync(drive);
    expect(dev.doc.settings.main.encryption).toBeUndefined();
  });

  it('wyłączanie szyfrowania: zaszyfrowana zmiana drugiej osoby jest najpierw scalana, potem idzie jawny plik', async () => {
    const { k, dev, drive } = await encryptedSetup();
    // druga osoba zapisała coś tym samym kluczem tuż przed wyłączeniem
    const other = { ...dev.doc, categories: { ...dev.doc.categories, n: { id: 'n', name: 'NOWA', order: 1, ...meta } } };
    drive.text = JSON.stringify(await encryptDoc(other, k));
    drive.version++;
    await beginDisabling();
    const main = { ...dev.doc.settings.main, updatedAt: '2026-12-01T00:00:00.000Z' };
    delete main.encryption;
    dev.doc = { ...dev.doc, settings: { main } };
    dev.dirty = true; dev.changes++;
    await dev.sync(drive);
    expect(drive.text).toContain('TAJNA-PENSJA'); // jawnie – tak chciał użytkownik
    expect(dev.doc.categories.n).toBeTruthy();
    expect(await isPinned()).toBe(false);
    expect(await loadKey()).toBeNull();
  });

  it('zmiana hasła: plik zapisany starym kluczem przez drugą osobę daje się jeszcze odczytać', async () => {
    const { k, dev, drive } = await encryptedSetup();
    const other = { ...dev.doc, categories: { ...dev.doc.categories, n: { id: 'n', name: 'NOWA', order: 1, ...meta } } };
    drive.text = JSON.stringify(await encryptDoc(other, k));
    drive.version++;
    const k2 = await deriveKey('nowe haslo 456', newSalt(), 1000);
    await rememberKey(k2);
    dev.doc = { ...dev.doc, settings: { main: { ...dev.doc.settings.main, encryption: { salt: k2.salt, iterations: 1000 }, updatedAt: '2026-12-01T00:00:00.000Z' } } };
    dev.dirty = true; dev.changes++;
    await dev.sync(drive);
    expect(dev.doc.categories.n).toBeTruthy();
    const env = JSON.parse(drive.text);
    expect(env.kdf.salt).toBe(k2.salt);
    // stary klucz nie jest już potrzebny – plik zapisany nim ponownie wymaga hasła
    drive.text = JSON.stringify(await encryptDoc(other, k));
    drive.version++;
    await expect(dev.sync(drive)).rejects.toBeInstanceOf(PasswordNeeded);
  });

  it('podstawione słabe parametry klucza są odrzucane', async () => {
    expect(() => checkKdf(newSalt(), 1)).toThrow(BadEnvelope);
    expect(() => checkKdf(newSalt(), 2_000_000_000)).toThrow(BadEnvelope);
    expect(() => checkKdf(newSalt(), 600_000.5)).toThrow(BadEnvelope);
    expect(() => checkKdf('AAAA', 600_000)).toThrow(BadEnvelope);
    expect(() => checkKdf('to nie base64!', 600_000)).toThrow(BadEnvelope);
    expect(() => checkKdf(newSalt(), 600_000)).not.toThrow();
    await expect(keyFromSettings('haslo', { salt: newSalt(), iterations: 1 })).rejects.toBeInstanceOf(BadEnvelope);
    const env = await encryptDoc(emptyDoc(), await deriveKey('haslo haslo', newSalt(), 1));
    await expect(unlockWith('haslo haslo', env)).rejects.toBeInstanceOf(BadEnvelope);
  });

  it('uszkodzona koperta daje czytelny błąd, a nie wyjątek z wnętrza', async () => {
    const k = await deriveKey('haslo haslo', newSalt(), 1000);
    const env = await encryptDoc(emptyDoc(), k);
    for (const broken of [{ ...env, kdf: null }, { ...env, kdf: { ...env.kdf, hash: 'MD5' } }, { ...env, iv: 'x' }, { ...env, data: 5 }, { ...env, v: 2 }]) {
      await expect(unlockWith('haslo haslo', broken as never, 1000)).rejects.toBeInstanceOf(BadEnvelope);
    }
    await forgetKey();
    await unpinEncryption();
    await expect(readRemote(JSON.stringify({ ...env, kdf: null }))).rejects.toBeInstanceOf(BadEnvelope);
    expect(await isPinned()).toBe(false); // śmieć nie przypina szyfrowania
    await expect(readRemote(JSON.stringify(env))).rejects.toBeInstanceOf(PasswordNeeded);
    expect(await isPinned()).toBe(true);
  });

  it('kopia zapasowa nie zmienia szyfrowania', () => {
    const cur = secretDoc('c29sLXNvbC1zb2wtc29sLQ==');
    const oldBackup: BudgetDoc = { ...emptyDoc(), settings: { main: { id: 'main', amountTolerance: 2, updatedAt: '2030-01-01T00:00:00.000Z', updatedBy: 'x' } } };
    const kept = keepEncryption(cur, oldBackup);
    expect(kept.settings.main.encryption).toEqual(cur.settings.main.encryption);
    expect(kept.settings.main.amountTolerance).toBe(2);
    const restored = restoreDoc(cur, keepEncryption(cur, emptyDoc()), () => meta);
    expect(restored.settings.main.encryption).toEqual(cur.settings.main.encryption);
    // w drugą stronę: kopia z szyfrowaniem nie włączy go na urządzeniu bez hasła
    expect(keepEncryption(emptyDoc(), cur).settings.main.encryption).toBeUndefined();
  });
});

describe('plik o złym kształcie rekordów', () => {
  const wrap = (body: string) => `{"schema":3,"accounts":{},"entries":{},${body}}`;
  const cat = '"categories":{"c":{"id":"c","name":"X","order":0,"updatedAt":"2026","updatedBy":"x"}}';
  const pos = (fields: string) => `"positions":{"p":{"id":"p","name":"a","categoryId":"c","activeFrom":"2026-01","rules":[{"from":"2026-01","amount":10}],"updatedAt":"2026","updatedBy":"x"${fields}}}`;

  it('nie wywraca obliczeń', () => {
    const cases = [
      wrap(`${cat},${pos(',"rules":null')}`),
      wrap(`${cat},${pos(',"rules":[null,5,{"from":"x"},{"from":"2026-01","amount":"1e999"}]')}`),
      wrap(`${cat},${pos(',"monthly":[1,2],"loan":{"from":"2026-01","balance":1e300,"rate":1e9,"months":1e12,"kind":"rowne"}')}`),
      wrap(`${cat},${pos(',"activeFrom":"9999-99"')}`),
      wrap(`${cat},"positions":{"p":5,"q":null,"r":[1]}`),
      wrap('"categories":{"c":{"id":"c","name":7,"order":"a","updatedAt":"2026","updatedBy":"x"}},"positions":{}'),
      wrap('"categories":[],"positions":[1,2]'),
      wrap(`${cat},"positions":{},"transactions":{"t":{"id":"t","date":null,"month":5,"amount":"x","updatedAt":1}},"settings":{"main":{"id":"main","updatedAt":"2026","updatedBy":"x","firm":"tak","csvMappings":[1],"dismissedRecurring":{"a":1}}}`),
    ];
    for (const text of cases) {
      const d = mergeDocs(emptyDoc(), parseDoc(text));
      expect(() => linesForMonth(d, '2026-11', '2026-11')).not.toThrow();
      expect(() => Object.values(d.categories).sort((a, b) => a.name.localeCompare(b.name))).not.toThrow();
      for (const p of Object.values(d.positions)) expect(Array.isArray(p.rules)).toBe(true);
    }
  });

  it('jedna zła reguła nie usuwa pozycji; złe pole opcjonalne jest pomijane', () => {
    const d = parseDoc(wrap(`${cat},${pos(',"rules":[{"from":"2026-01","amount":10},{"from":"zły"}],"day":"piąty","note":"ok"')}`));
    expect(d.positions.p.rules).toHaveLength(1);
    expect(d.positions.p.day).toBeUndefined();
    expect(d.positions.p.note).toBe('ok');
  });

  it('rekord pod cudzym kluczem jest odrzucany, nieznane pola i kolekcje zostają', () => {
    const report = { dropped: 0 };
    const d = sanitizeDoc(
      { ...emptyDoc(), categories: { a: { id: 'b', name: 'X', order: 0, ...meta }, c: { id: 'c', name: 'Y', order: 1, nowePole: 1, ...meta } as never }, przyszlosc: { x: { cokolwiek: 1 } } } as never,
      report,
    );
    expect(Object.keys(d.categories)).toEqual(['c']);
    expect((d.categories.c as unknown as { nowePole: number }).nowePole).toBe(1);
    expect((d as unknown as { przyszlosc: object }).przyszlosc).toBeTruthy();
    expect(report.dropped).toBe(1);
  });

  it('poprawne rekordy przechodzą bez kopiowania', () => {
    const src = secretDoc('c29sLXNvbC1zb2wtc29sLQ==');
    const d = sanitizeDoc(src);
    expect(d.positions.p).toBe(src.positions.p);
    expect(d.settings.main).toBe(src.settings.main);
  });
});

describe('spreparowany plik z banku', () => {
  it('wiersze bez daty lub kwoty są pomijane zamiast wywracać import', () => {
    const head = '"Data operacji","Data waluty","Typ transakcji","Kwota","Waluta","Saldo po transakcji","Opis transakcji"\n';
    const { txns } = parseBankCsv(`${head}"2026-01-05","2026-01-05","Płatność kartą","-12,50","PLN","100","Tytuł: test"\n"zła data","","x","-1,00"\n"2026-01-06"\n;;;;\n"2026-13-40","","x","-1,00","PLN","1","a"\n`);
    expect(txns).toHaveLength(1);
    expect(txns[0].amount).toBe(-12.5);
  });

  it('bardzo długi kontrahent nie zawiesza podpowiedzi reguły', () => {
    const t0 = performance.now();
    defaultPattern({ id: 'x', source: 'csv', date: '2026-01-01', amount: -1, counterparty: ' '.repeat(300_000), text: '' });
    defaultPattern({ id: 'x', source: 'csv', date: '2026-01-01', amount: -1, counterparty: `${'1 '.repeat(150_000)}x`, text: '' });
    expect(performance.now() - t0).toBeLessThan(500);
  });
});
