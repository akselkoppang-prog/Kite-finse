import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

/**
 * IndexedDB-skjema for ekspedisjonsplanleggeren.
 *
 *  projects  – ett objekt per prosjekt (metadata)
 *  slices    – prosjektdata delt i små biter [projectId, slice] (trip, kites, camps, …) → delvise lagringer
 *  routes    – én post per rute [projectId, routeId] → å dra et punkt skriver bare den ruten
 *  caches    – data som kan hentes på nytt (NVE-polygoner, terreng, prognose, høydecache) – kan ryddes
 *  blobs     – bilder og vedlegg som Blob (ikke base64), med miniatyr og SHA-256 for duplikatkontroll
 *  backups   – fullstendige øyeblikksbilder (uten cache), aldri skrevet over aktivt prosjekt uten gjenoppretting
 *  meta      – migreringsstatus, innstillinger, siste lagring/backup
 *
 * Fremtidige endringer: øk DB_VERSION og legg til et steg i UPGRADES – eldre data bevares.
 */
export const DB_NAME = 'kite-finse-rjukan';
export const DB_VERSION = 1;

export interface ProjectRec { id: string; name: string; createdAt: string; updatedAt: string; schema: number }
export interface SliceRec { projectId: string; slice: string; value: unknown; updatedAt: string; size: number }
export interface RouteRec { projectId: string; routeId: string; value: unknown; updatedAt: string; size: number }
export interface CacheRec { projectId: string; name: string; value: unknown; updatedAt: string; size: number }
export interface BlobRec {
  id: string;
  projectId: string;
  kind: 'bilde' | 'vedlegg';
  role: 'main' | 'thumb';
  parentId?: string; // miniatyrens hovedbilde
  name: string;
  mime: string;
  size: number;
  hash: string;
  blob: Blob;
  width?: number;
  height?: number;
  createdAt: string;
}
export interface BackupRec { id: string; projectId: string; createdAt: string; reason: string; size: number; data: string; auto: boolean; keep?: boolean }
export interface MetaRec { key: string; value: unknown }

export interface KiteDB extends DBSchema {
  projects: { key: string; value: ProjectRec };
  slices: { key: [string, string]; value: SliceRec; indexes: { byProject: string } };
  routes: { key: [string, string]; value: RouteRec; indexes: { byProject: string } };
  caches: { key: [string, string]; value: CacheRec; indexes: { byProject: string } };
  blobs: { key: string; value: BlobRec; indexes: { byProject: string; byHash: [string, string] } };
  backups: { key: string; value: BackupRec; indexes: { byProject: string } };
  meta: { key: string; value: MetaRec };
}

type Upgrade = (db: IDBPDatabase<KiteDB>) => void;
const UPGRADES: Record<number, Upgrade> = {
  1: (db) => {
    db.createObjectStore('projects', { keyPath: 'id' });
    db.createObjectStore('slices', { keyPath: ['projectId', 'slice'] }).createIndex('byProject', 'projectId');
    db.createObjectStore('routes', { keyPath: ['projectId', 'routeId'] }).createIndex('byProject', 'projectId');
    db.createObjectStore('caches', { keyPath: ['projectId', 'name'] }).createIndex('byProject', 'projectId');
    const b = db.createObjectStore('blobs', { keyPath: 'id' });
    b.createIndex('byProject', 'projectId');
    b.createIndex('byHash', ['projectId', 'hash']);
    db.createObjectStore('backups', { keyPath: 'id' }).createIndex('byProject', 'projectId');
    db.createObjectStore('meta', { keyPath: 'key' });
  },
};

let dbp: Promise<IDBPDatabase<KiteDB>> | null = null;

export function getDB(): Promise<IDBPDatabase<KiteDB>> {
  if (!dbp) {
    if (typeof indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB finnes ikke i denne nettleseren'));
    dbp = openDB<KiteDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        for (let v = oldVersion + 1; v <= DB_VERSION; v++) UPGRADES[v]?.(db);
      },
      blocked() {
        console.warn('IndexedDB-oppgradering blokkert av en annen åpen fane');
      },
      blocking() {
        // en nyere versjon av appen åpnes i en annen fane – lukk vår tilkobling så den kan oppgradere
        dbp?.then((d) => d.close());
        dbp = null;
      },
    }).catch((e) => {
      dbp = null;
      throw e;
    });
  }
  return dbp;
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  const db = await getDB();
  return (await db.get('meta', key))?.value as T | undefined;
}

export async function setMeta(key: string, value: unknown) {
  const db = await getDB();
  await db.put('meta', { key, value });
}

/** Grov størrelse (bytes) av en verdi slik den lagres. */
export function sizeOf(v: unknown): number {
  if (v instanceof Blob) return v.size;
  try {
    return new Blob([JSON.stringify(v) ?? '']).size;
  } catch {
    return 0;
  }
}

/** Kun for tester: lukk og nullstill tilkoblingen. */
export async function _resetDB() {
  if (dbp) (await dbp).close();
  dbp = null;
}
