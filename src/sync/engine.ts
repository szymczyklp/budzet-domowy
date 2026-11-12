import type { BudgetDoc, MonthKey } from '../lib/types';
import { countDifferences, mergeDocs } from '../lib/merge';
import type { StoreInternals } from '../lib/store';

export interface FileMeta {
  id: string;
  name: string;
  version: string;
  ownedByMe: boolean;
  parents?: string[];
  owners?: { displayName?: string; emailAddress?: string }[];
}

/** Operacje na pliku w chmurze (Google Drive albo atrapa w testach). */
export interface DriveApi {
  getMeta(fileId: string): Promise<FileMeta>;
  download(fileId: string): Promise<BudgetDoc>;
  upload(fileId: string, doc: BudgetDoc): Promise<{ version: string }>;
  createSnapshot(parentId: string | undefined, name: string, doc: BudgetDoc): Promise<void>;
}

/** Zapamiętany stan połączenia z plikiem (trzymany w IndexedDB). */
export interface SyncConf {
  fileId: string;
  fileName?: string;
  ownedByMe?: boolean;
  /** Wersja pliku na Dysku po ostatniej udanej synchronizacji. */
  version?: string;
  /** Miesiąc ostatniej miesięcznej kopii (tylko właściciel pliku). */
  snapshotMonth?: MonthKey;
}

export type Local = Pick<StoreInternals, 'getDoc' | 'changeCount' | 'isDirty' | 'mergeRemote' | 'markSynced'>;

export const snapshotName = (month: MonthKey) => `budzet-domowy kopia ${month}.json`;

/**
 * Jedna synchronizacja:
 * 1. jeśli plik na Dysku się zmienił – pobierz go i scal z lokalnymi danymi,
 * 2. jeśli po scaleniu dane różnią się od tych na Dysku (albo są lokalne zmiany) – wyślij,
 * 3. tuż przed wysłaniem sprawdź, czy ktoś w międzyczasie nie zapisał pliku; jeśli tak – powtórz.
 *
 * Scalanie jest rekord po rekordzie (nowsza zmiana wygrywa), więc nawet gdy dwie osoby
 * zapiszą w tej samej chwili, następna synchronizacja każdej z nich uzupełni brakujące zmiany.
 */
export async function syncOnce(api: DriveApi, local: Local, conf: SyncConf, month: MonthKey): Promise<SyncConf> {
  let next = { ...conf };
  let parentId: string | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    const meta = await api.getMeta(conf.fileId);
    parentId = meta.parents?.[0];
    next = { ...next, fileName: meta.name, ownedByMe: meta.ownedByMe };
    const startCount = local.changeCount();
    let outgoing = local.getDoc();
    let remote: BudgetDoc | null = null;

    if (meta.version !== next.version) {
      remote = await api.download(conf.fileId);
      outgoing = mergeDocs(outgoing, remote);
      local.mergeRemote(remote);
    }

    const needUpload = remote ? countDifferences(outgoing, remote) > 0 : local.isDirty();
    if (!needUpload) {
      next.version = meta.version;
      local.markSynced(startCount);
      break;
    }

    const fresh = await api.getMeta(conf.fileId);
    if (fresh.version !== meta.version) continue; // ktoś właśnie zapisał – pobierz jeszcze raz

    const res = await api.upload(conf.fileId, outgoing);
    next.version = res.version;
    local.markSynced(startCount);
    break;
  }

  // raz w miesiącu właściciel pliku zapisuje obok kopię całości
  if (next.ownedByMe && next.snapshotMonth !== month) {
    await api.createSnapshot(parentId, snapshotName(month), local.getDoc());
    next.snapshotMonth = month;
  }
  return next;
}
