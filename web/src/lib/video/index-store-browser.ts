/**
 * The browser adapter of lib/video/index-store.ts: one IndexedDB database "clips" with one object
 * store "index" keyed by id. Thin: no logic beyond request → promise.
 */
import type { ClipIndex, ClipIndexEntry } from "./index-store.ts";

const DB_NAME = "clips";
const STORE = "index";

function done<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function open(factory: IDBFactory): Promise<IDBDatabase> {
  const request = factory.open(DB_NAME, 1);
  request.onupgradeneeded = () => {
    if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: "id" });
  };
  return done(request);
}

export function indexedDbClipIndex(factory: IDBFactory = indexedDB): ClipIndex {
  const db = open(factory);
  async function store(mode: IDBTransactionMode): Promise<IDBObjectStore> {
    return (await db).transaction(STORE, mode).objectStore(STORE);
  }
  return {
    all: async () => done<ClipIndexEntry[]>((await store("readonly")).getAll()), // entries are only written by put below
    get: async (id) => (await done<ClipIndexEntry | undefined>((await store("readonly")).get(id))) ?? null,
    put: async (entry) => {
      await done((await store("readwrite")).put(entry));
    },
    remove: async (id) => {
      await done((await store("readwrite")).delete(id));
    },
  };
}
