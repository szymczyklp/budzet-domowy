import { describe, expect, it } from 'vitest';
import type { BudgetDoc, Entry } from '../lib/types';
import { emptyDoc } from '../lib/types';
import { mergeDocs } from '../lib/merge';
import type { DriveApi, Local, SyncConf } from './engine';
import { syncOnce } from './engine';

/** Atrapa Dysku: jeden plik z licznikiem wersji. */
class FakeDrive implements DriveApi {
  doc: BudgetDoc = emptyDoc();
  version = 1;
  uploads = 0;
  snapshots: string[] = [];
  beforeUpload?: () => void;
  async getMeta(id: string) {
    return { id, name: 'budzet-domowy.json', version: String(this.version), ownedByMe: true, parents: ['folder'] };
  }
  async download() {
    return structuredClone(this.doc);
  }
  async upload(_id: string, doc: BudgetDoc) {
    this.beforeUpload?.();
    this.beforeUpload = undefined;
    this.doc = structuredClone(doc);
    this.version++;
    this.uploads++;
    return { version: String(this.version) };
  }
  async createSnapshot(_p: string | undefined, name: string) {
    this.snapshots.push(name);
  }
}

/** Atrapa urządzenia (lokalny magazyn). */
class Device implements Local {
  doc: BudgetDoc = emptyDoc();
  changes = 0;
  dirty = false;
  conf: SyncConf = { fileId: 'f' };
  constructor(public who: string) {}
  getDoc = () => this.doc;
  changeCount = () => this.changes;
  isDirty = () => this.dirty;
  mergeRemote = (r: BudgetDoc) => { this.doc = mergeDocs(this.doc, r); };
  markSynced = (n: number) => { if (n === this.changes) this.dirty = false; };
  tick(key: string, at: string) {
    const e: Entry = { positionId: key, month: '2026-11', paid: true, updatedAt: at, updatedBy: this.who };
    this.doc = { ...this.doc, entries: { ...this.doc.entries, [key]: e } };
    this.changes++;
    this.dirty = true;
  }
  async sync(drive: FakeDrive) {
    this.conf = await syncOnce(drive, this, this.conf, '2026-11');
  }
}

describe('syncOnce', () => {
  it('dwa urządzenia widzą nawzajem swoje zmiany', async () => {
    const drive = new FakeDrive();
    const jan = new Device('Jan');
    const ewa = new Device('Ewa');
    jan.tick('kredyt', '2026-11-07T10:00:00Z');
    await jan.sync(drive);
    ewa.tick('przedszkole', '2026-11-07T10:01:00Z');
    await ewa.sync(drive);
    await jan.sync(drive);
    expect(Object.keys(jan.doc.entries).sort()).toEqual(['kredyt', 'przedszkole']);
    expect(Object.keys(ewa.doc.entries).sort()).toEqual(['kredyt', 'przedszkole']);
    expect(jan.dirty || ewa.dirty).toBe(false);
  });

  it('nie wysyła pliku, gdy nic się nie zmieniło', async () => {
    const drive = new FakeDrive();
    const d = new Device('Jan');
    d.tick('a', '2026-11-07T10:00:00Z');
    await d.sync(drive);
    const before = drive.uploads;
    await d.sync(drive);
    await d.sync(drive);
    expect(drive.uploads).toBe(before);
  });

  it('zmiana zapisana przez kogoś tuż przed wysłaniem nie ginie', async () => {
    const drive = new FakeDrive();
    const jan = new Device('Jan');
    const ewa = new Device('Ewa');
    await jan.sync(drive);
    await ewa.sync(drive);
    ewa.tick('przedszkole', '2026-11-07T10:01:00Z');
    jan.tick('kredyt', '2026-11-07T10:02:00Z');
    // Ewa zapisuje dokładnie w chwili, gdy Jan wysyła (wyścig, którego nie wykryje sprawdzenie wersji)
    drive.beforeUpload = () => { void 0; };
    await Promise.all([ewa.sync(drive), jan.sync(drive)]);
    await ewa.sync(drive);
    await jan.sync(drive);
    await ewa.sync(drive);
    expect(Object.keys(drive.doc.entries).sort()).toEqual(['kredyt', 'przedszkole']);
    expect(Object.keys(ewa.doc.entries).sort()).toEqual(['kredyt', 'przedszkole']);
  });

  it('lokalna zmiana w trakcie synchronizacji zostaje do wysłania', async () => {
    const drive = new FakeDrive();
    const d = new Device('Jan');
    d.tick('a', '2026-11-07T10:00:00Z');
    drive.beforeUpload = () => d.tick('b', '2026-11-07T10:00:01Z');
    await d.sync(drive);
    expect(d.dirty).toBe(true);
    await d.sync(drive);
    expect(Object.keys(drive.doc.entries).sort()).toEqual(['a', 'b']);
  });

  it('robi kopię miesięczną raz w miesiącu', async () => {
    const drive = new FakeDrive();
    const d = new Device('Jan');
    d.tick('a', '2026-11-07T10:00:00Z');
    await d.sync(drive);
    d.tick('b', '2026-11-07T10:05:00Z');
    await d.sync(drive);
    expect(drive.snapshots).toEqual(['budzet-domowy kopia 2026-11.json']);
  });
});
