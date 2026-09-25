import { openDB, type IDBPDatabase } from 'idb';
import type { ICollections, IEntity, IImportReport, ISnapshot, TCollection } from '../types';
import {
  COLLECTIONS,
  SCHEMA_VERSION,
  emptyCollections,
  mergeEntities,
  type IStorageAdapter,
  type TImportMode,
} from './storage-adapter';

const DB_NAME = 'improva';
/** 2 — хранилище routeBlocks. */
const DB_VERSION = 2;

/** Хранилище по умолчанию: IndexedDB браузера, работает офлайн. */
export class IndexedDbAdapter implements IStorageAdapter {
  readonly kind = 'indexeddb';
  private database: IDBPDatabase | null = null;

  async init(): Promise<void> {
    this.database = await openDB(DB_NAME, DB_VERSION, {
      upgrade(database) {
        for (const collection of COLLECTIONS) {
          if (!database.objectStoreNames.contains(collection)) {
            database.createObjectStore(collection, { keyPath: 'id' });
          }
        }
      },
    });
    // Просим браузер не очищать данные при нехватке места; отказ не мешает работе
    void navigator.storage?.persist?.().catch(() => false);
  }

  async loadAll(): Promise<ICollections> {
    const database = this.db();
    const data = emptyCollections();
    const transaction = database.transaction([...COLLECTIONS], 'readonly');
    await Promise.all(
      COLLECTIONS.map(async (collection) => {
        const rows = await transaction.objectStore(collection).getAll();
        Object.assign(data, { [collection]: rows });
      }),
    );
    await transaction.done;
    return data;
  }

  async put(collection: TCollection, entity: IEntity): Promise<void> {
    await this.db().put(collection, entity);
  }

  async putMany(collection: TCollection, entities: readonly IEntity[]): Promise<void> {
    const transaction = this.db().transaction(collection, 'readwrite');
    await Promise.all([...entities.map((entity) => transaction.store.put(entity)), transaction.done]);
  }

  async remove(collection: TCollection, id: string): Promise<void> {
    await this.db().delete(collection, id);
  }

  async exportAll(): Promise<ISnapshot> {
    return {
      app: 'improva',
      kind: 'full',
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      data: await this.loadAll(),
    };
  }

  async importAll(snapshot: ISnapshot, mode: TImportMode): Promise<IImportReport> {
    const current = await this.loadAll();
    const database = this.db();
    const transaction = database.transaction([...COLLECTIONS], 'readwrite');
    let added = 0;
    let updated = 0;
    let total = 0;
    for (const collection of COLLECTIONS) {
      const incoming = snapshot.data[collection] ?? [];
      const store = transaction.objectStore(collection);
      if (mode === 'replace') {
        await store.clear();
        for (const entity of incoming) {
          await store.put(entity);
        }
        added += incoming.length;
      } else {
        const merged = mergeEntities<IEntity>(current[collection], incoming);
        for (const entity of merged.result) {
          await store.put(entity);
        }
        added += merged.added;
        updated += merged.updated;
      }
      total += incoming.length;
    }
    await transaction.done;
    return { added, updated, total };
  }

  async estimateUsage(): Promise<{ readonly usedBytes: number; readonly quotaBytes: number } | null> {
    if (!navigator.storage?.estimate) {
      return null;
    }
    const estimate = await navigator.storage.estimate();
    return { usedBytes: estimate.usage ?? 0, quotaBytes: estimate.quota ?? 0 };
  }

  private db(): IDBPDatabase {
    if (!this.database) {
      throw new Error('Хранилище не инициализировано');
    }
    return this.database;
  }
}
