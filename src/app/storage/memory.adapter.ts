import type { ICollections, IEntity, IImportReport, ISnapshot, TCollection } from '../types';
import {
  COLLECTIONS,
  SCHEMA_VERSION,
  emptyCollections,
  mergeEntities,
  type IStorageAdapter,
  type TImportMode,
} from './storage-adapter';

/** Хранилище в памяти: для тестов и как запасной вариант, если IndexedDB недоступна. */
export class MemoryAdapter implements IStorageAdapter {
  readonly kind = 'memory';
  private data: ICollections = emptyCollections();

  async init(): Promise<void> {
    return Promise.resolve();
  }

  async loadAll(): Promise<ICollections> {
    return structuredClone(this.data);
  }

  async put(collection: TCollection, entity: IEntity): Promise<void> {
    await this.putMany(collection, [entity]);
  }

  async putMany(collection: TCollection, entities: readonly IEntity[]): Promise<void> {
    const list: IEntity[] = this.data[collection];
    for (const entity of entities) {
      const index = list.findIndex((existing) => existing.id === entity.id);
      const copy = structuredClone(entity);
      if (index >= 0) {
        list[index] = copy;
      } else {
        list.push(copy);
      }
    }
    return Promise.resolve();
  }

  async remove(collection: TCollection, id: string): Promise<void> {
    const list: IEntity[] = this.data[collection];
    const index = list.findIndex((entity) => entity.id === id);
    if (index >= 0) {
      list.splice(index, 1);
    }
    return Promise.resolve();
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
    let added = 0;
    let updated = 0;
    let total = 0;
    const next = mode === 'replace' ? emptyCollections() : structuredClone(this.data);
    for (const collection of COLLECTIONS) {
      const incoming = structuredClone(snapshot.data[collection] ?? []);
      total += incoming.length;
      if (mode === 'replace') {
        Object.assign(next, { [collection]: incoming });
        added += incoming.length;
      } else {
        const merged = mergeEntities<IEntity>(next[collection], incoming);
        Object.assign(next, { [collection]: merged.result });
        added += merged.added;
        updated += merged.updated;
      }
    }
    this.data = next;
    return { added, updated, total };
  }

  async estimateUsage(): Promise<null> {
    return Promise.resolve(null);
  }
}
