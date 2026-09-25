import { Injectable, computed, inject, signal } from '@angular/core';
import { buildProgramTree, spentByItem } from '../domain';
import { SCHEMA_VERSION, STORAGE_ADAPTER, emptyCollections, normalizeCollections } from '../storage';
import type { IBudget, IChallenge, ICollections, IEntity, IMeta, ISettings, ISnapshot, TCollection } from '../types';
import { addDays, configureTimeZone, downloadText, toDayKey } from '../utils';
import { ClockService } from './clock.service';
import { ToastService } from './toast.service';

export type TStoreStatus = 'loading' | 'ready' | 'readError';

export const META_ID = 'app';

export const DEFAULT_SETTINGS: ISettings = {
  dayBoundaryHour: 4,
  timeZone: '',
  reviewWeekday: 6,
  sound: true,
  phases: true,
  tipsEnabled: true,
  disabledTips: [],
};

const RETRY_DELAYS_MS = [2000, 4000, 8000];

type TEntityOf<K extends TCollection> = ICollections[K][number];

/** Единый источник данных: сигналы в памяти + запись через адаптер хранилища. */
@Injectable({ providedIn: 'root' })
export class DataStore {
  private readonly adapter = inject(STORAGE_ADAPTER);
  private readonly toasts = inject(ToastService);
  private readonly clock = inject(ClockService);

  readonly status = signal<TStoreStatus>('loading');
  readonly data = signal<ICollections>(emptyCollections());
  readonly unsaved = signal(0);

  readonly meta = computed<IMeta>(() => this.data().meta.find((entry) => entry.id === META_ID) ?? defaultMeta());
  readonly settings = computed<ISettings>(() => {
    const settings = { ...DEFAULT_SETTINGS, ...this.meta().settings };
    // Все расчёты дней читают settings() до toDayKey, поэтому пояс синхронен с ними
    configureTimeZone(settings.timeZone);
    return settings;
  });
  readonly budget = computed<IBudget>(() => this.data().budgets[0] ?? defaultBudget(new Date().toISOString()));
  readonly challenge = computed<IChallenge>(
    () => this.data().challenges[0] ?? defaultChallenge(new Date().toISOString(), this.today()),
  );
  readonly today = computed(() => toDayKey(new Date(this.clock.now()), this.settings().dayBoundaryHour));
  readonly tree = computed(() =>
    buildProgramTree({ sections: this.data().sections, topics: this.data().topics, items: this.data().items }),
  );
  readonly logs = computed(() =>
    this.data()
      .timeLogs.filter((log) => !log.deletedAt)
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt)),
  );
  readonly spent = computed(() => spentByItem(this.logs()));
  readonly resourcesById = computed(() => new Map(this.data().resources.map((resource) => [resource.id, resource])));
  readonly assetsById = computed(() => new Map(this.data().assets.map((asset) => [asset.id, asset])));

  private readonly pending = new Map<string, { readonly collection: TCollection; readonly entity: IEntity | null; readonly id: string }>();
  private retryIndex = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private writeErrorToast: number | null = null;

  async init(): Promise<void> {
    this.status.set('loading');
    try {
      await this.adapter.init();
      const data = await this.adapter.loadAll();
      this.data.set(normalizeCollections(data));
      await this.ensureDefaults();
      this.status.set('ready');
    } catch {
      this.status.set('readError');
    }
  }

  /** Записывает сущность: сначала в память, затем в хранилище с повторами (ТЗ 7.6 common.writeError). */
  upsert<K extends TCollection>(collection: K, entity: TEntityOf<K>): void {
    this.upsertMany(collection, [entity]);
  }

  upsertMany<K extends TCollection>(collection: K, entities: readonly TEntityOf<K>[]): void {
    if (entities.length === 0) {
      return;
    }
    this.data.update((data) => {
      const list: IEntity[] = [...data[collection]];
      for (const entity of entities) {
        const index = list.findIndex((existing) => existing.id === entity.id);
        if (index >= 0) {
          list[index] = entity;
        } else {
          list.push(entity);
        }
      }
      return { ...data, [collection]: list };
    });
    for (const entity of entities) {
      this.pending.set(`${collection}:${entity.id}`, { collection, entity, id: entity.id });
    }
    void this.flush();
  }

  remove(collection: TCollection, ids: readonly string[]): void {
    if (ids.length === 0) {
      return;
    }
    const idSet = new Set(ids);
    this.data.update((data) => ({
      ...data,
      [collection]: data[collection].filter((entity: IEntity) => !idSet.has(entity.id)),
    }));
    for (const id of ids) {
      this.pending.set(`${collection}:${id}`, { collection, entity: null, id });
    }
    void this.flush();
  }

  updateMeta(patch: Partial<Omit<IMeta, keyof IEntity>>): void {
    const meta = this.meta();
    this.upsert('meta', { ...meta, ...patch, updatedAt: new Date().toISOString() });
  }

  updateSettings(patch: Partial<ISettings>): void {
    this.updateMeta({ settings: { ...this.settings(), ...patch } });
  }

  async reload(): Promise<void> {
    const data = await this.adapter.loadAll();
    this.data.set(data);
    await this.ensureDefaults();
  }

  /** Снимок из памяти — доступен, даже когда хранилище не принимает запись. */
  snapshotFromMemory(): ISnapshot {
    return {
      app: 'improva',
      kind: 'full',
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      data: this.data(),
    };
  }

  downloadMemoryCopy(): void {
    downloadText({
      filename: `improva-${this.today()}.json`,
      content: JSON.stringify(this.snapshotFromMemory()),
      mime: 'application/json',
    });
  }

  retryNow(): void {
    this.retryIndex = 0;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    void this.flush();
  }

  private flushing: Promise<void> | null = null;
  private flushAgain = false;

  /** Записи выполняются строго последовательно: иначе старая версия может перезаписать новую. */
  private flush(): Promise<void> {
    if (this.flushing) {
      this.flushAgain = true;
      return this.flushing;
    }
    this.flushing = this.writePending().finally(() => {
      this.flushing = null;
      if (this.flushAgain) {
        this.flushAgain = false;
        void this.flush();
      }
    });
    return this.flushing;
  }

  private async writePending(): Promise<void> {
    if (this.pending.size === 0) {
      this.unsaved.set(0);
      return;
    }
    const batch = [...this.pending.entries()];
    this.unsaved.set(batch.length);
    try {
      for (const [key, operation] of batch) {
        if (operation.entity) {
          await this.adapter.put(operation.collection, operation.entity);
        } else {
          await this.adapter.remove(operation.collection, operation.id);
        }
        if (this.pending.get(key) === operation) {
          this.pending.delete(key);
        }
      }
      this.retryIndex = 0;
      this.unsaved.set(this.pending.size);
      if (this.writeErrorToast !== null) {
        this.toasts.dismiss(this.writeErrorToast);
        this.writeErrorToast = null;
      }
    } catch {
      this.scheduleRetry();
    }
  }

  private scheduleRetry(): void {
    const exhausted = this.retryIndex >= RETRY_DELAYS_MS.length;
    if (this.writeErrorToast !== null) {
      this.toasts.dismiss(this.writeErrorToast);
    }
    this.writeErrorToast = this.toasts.show({
      text: 'Изменение не сохранено: хранилище не отвечает. Повторим автоматически.',
      kind: 'error',
      durationMs: 60_000,
      action: exhausted
        ? { label: 'Скачать копию', run: () => this.downloadMemoryCopy() }
        : { label: 'Повторить сейчас', run: () => this.retryNow() },
    });
    if (exhausted) {
      return;
    }
    const delay = RETRY_DELAYS_MS[this.retryIndex] ?? 8000;
    this.retryIndex += 1;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.flush();
    }, delay);
  }

  private async ensureDefaults(): Promise<void> {
    const now = new Date().toISOString();
    const data = this.data();
    if (!data.meta.some((entry) => entry.id === META_ID)) {
      this.upsert('meta', defaultMeta());
    }
    if (data.budgets.length === 0) {
      this.upsert('budgets', defaultBudget(now));
    }
    if (data.challenges.length === 0) {
      this.upsert('challenges', defaultChallenge(now, this.today()));
    }
    return Promise.resolve();
  }
}

export function defaultMeta(): IMeta {
  const now = new Date().toISOString();
  return {
    id: META_ID,
    createdAt: now,
    updatedAt: now,
    onboarded: false,
    timer: null,
    settings: DEFAULT_SETTINGS,
    tips: { ignored: {}, shownOn: {} },
    milestonesShown: [],
    lastExportAt: null,
    expanded: [],
    dayPlans: {},
  };
}

export function defaultBudget(now: string): IBudget {
  return {
    id: 'budget',
    createdAt: now,
    updatedAt: now,
    studyMinPerWeek: 150,
    practiceMinPerWeek: 330,
    creativeShare: 0.3,
    dayCapacity: [0, 90, 120, 90, 0, 180, 0],
    blockMin: 20,
    blockMax: 90,
    reviewIntervals: [3, 10, 30],
    seasonalWeights: true,
  };
}

export function defaultChallenge(now: string, today: string): IChallenge {
  return {
    id: 'challenge',
    createdAt: now,
    updatedAt: now,
    title: 'Годовой челлендж',
    startDate: today,
    endDate: addDays(today, 365),
  };
}
