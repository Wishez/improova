import { InjectionToken } from '@angular/core';
import type { ICollections, IEntity, IImportReport, ISnapshot, TCollection } from '../types';

export type TImportMode = 'replace' | 'merge';

/** Контракт хранилища (ТЗ 8.1). Доменные сервисы не знают конкретной реализации. */
export interface IStorageAdapter {
  readonly kind: string;
  init(): Promise<void>;
  loadAll(): Promise<ICollections>;
  put(collection: TCollection, entity: IEntity): Promise<void>;
  putMany(collection: TCollection, entities: readonly IEntity[]): Promise<void>;
  remove(collection: TCollection, id: string): Promise<void>;
  exportAll(): Promise<ISnapshot>;
  importAll(snapshot: ISnapshot, mode: TImportMode): Promise<IImportReport>;
  estimateUsage(): Promise<{ readonly usedBytes: number; readonly quotaBytes: number } | null>;
}

export const STORAGE_ADAPTER = new InjectionToken<IStorageAdapter>('STORAGE_ADAPTER');

export const COLLECTIONS: readonly TCollection[] = [
  'challenges',
  'budgets',
  'sections',
  'topics',
  'items',
  'resources',
  'planBlocks',
  'timeLogs',
  'notes',
  'assets',
  'meta',
  'routeBlocks',
];

/** 2 — ориентиры, маршрут мастеров и квартальные веса (релиз 1.2). */
export const SCHEMA_VERSION = 2;

export function emptyCollections(): ICollections {
  return {
    challenges: [],
    budgets: [],
    sections: [],
    topics: [],
    items: [],
    resources: [],
    planBlocks: [],
    timeLogs: [],
    notes: [],
    assets: [],
    meta: [],
    routeBlocks: [],
  };
}

/** Слияние по большему updatedAt (ТЗ US-08). */
export function mergeEntities<T extends IEntity>(
  current: readonly T[],
  incoming: readonly T[],
): { readonly result: T[]; readonly added: number; readonly updated: number } {
  const byId = new Map(current.map((entity) => [entity.id, entity]));
  let added = 0;
  let updated = 0;
  for (const entity of incoming) {
    const existing = byId.get(entity.id);
    if (!existing) {
      added += 1;
      byId.set(entity.id, entity);
    } else if (entity.updatedAt > existing.updatedAt) {
      updated += 1;
      byId.set(entity.id, entity);
    }
  }
  return { result: [...byId.values()], added, updated };
}
