import { Injectable, inject, signal } from '@angular/core';
import { COLLECTIONS, SCHEMA_VERSION, STORAGE_ADAPTER, checkSnapshot, mergeEntities, type TImportMode } from '../storage';
import type { ICollections, IEntity, IImportReport, ISnapshot } from '../types';
import { createId, downloadText, formatTime, toCsv, toDayKey } from '../utils';
import { DataStore } from './data.store';
import { ToastService } from './toast.service';

export type TImportCheck =
  | { readonly ok: true; readonly snapshot: ISnapshot; readonly preview: IImportReport; readonly logs: number; readonly notes: number }
  | { readonly ok: false; readonly message: string };

/** Экспорт и импорт (FR-32, ТЗ 8.2). */
@Injectable({ providedIn: 'root' })
export class BackupService {
  private readonly store = inject(DataStore);
  private readonly adapter = inject(STORAGE_ADAPTER);
  private readonly toasts = inject(ToastService);

  /** Заполненность квоты браузера, 0–1; null — браузер не сообщает (ТЗ 8.3, common.quota). */
  readonly usage = signal<{ readonly ratio: number; readonly usedBytes: number; readonly quotaBytes: number } | null>(null);

  async refreshUsage(): Promise<void> {
    try {
      const estimate = await this.adapter.estimateUsage();
      this.usage.set(
        estimate && estimate.quotaBytes > 0
          ? { ratio: estimate.usedBytes / estimate.quotaBytes, usedBytes: estimate.usedBytes, quotaBytes: estimate.quotaBytes }
          : null,
      );
    } catch {
      this.usage.set(null);
    }
  }

  exportFull(): void {
    const filename = `improva-${this.store.today()}.json`;
    downloadText({ filename, content: JSON.stringify(this.store.snapshotFromMemory()), mime: 'application/json' });
    this.store.updateMeta({ lastExportAt: new Date().toISOString() });
    this.toasts.show({ text: `Копия сохранена: ${filename}`, kind: 'success' });
  }

  exportProgram(): void {
    const data = this.store.data();
    const snapshot: ISnapshot = {
      app: 'improva',
      kind: 'program',
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      data: {
        sections: data.sections.filter((entry) => !entry.archived),
        topics: data.topics.filter((entry) => !entry.archived),
        // Фото ориентиров — личные ассеты, в шаблон программы не входят
        items: data.items
          .filter((entry) => !entry.archived)
          .map((item) => ({ ...item, doneAt: null, weakSpot: false, guide: item.guide ? { ...item.guide, imageIds: [] } : null })),
        resources: data.resources.filter((entry) => !entry.archived),
        routeBlocks: data.routeBlocks.filter((entry) => !entry.deletedAt),
      },
    };
    const filename = `improva-program-${this.store.today()}.json`;
    downloadText({ filename, content: JSON.stringify(snapshot), mime: 'application/json' });
    this.toasts.show({ text: `Копия сохранена: ${filename}`, kind: 'success' });
  }

  exportCsv(): void {
    const data = this.store.data();
    const items = new Map(data.items.map((item) => [item.id, item]));
    const topics = new Map(data.topics.map((topic) => [topic.id, topic]));
    const sections = new Map(data.sections.map((section) => [section.id, section]));
    const boundary = this.store.settings().dayBoundaryHour;
    const rows = [['date', 'start', 'end', 'minutes', 'section', 'topic', 'item', 'type', 'source']];
    for (const log of this.store.logs()) {
      const item = log.itemId ? items.get(log.itemId) : undefined;
      const topic = item ? topics.get(item.topicId) : undefined;
      const section = topic ? sections.get(topic.sectionId) : undefined;
      rows.push([
        toDayKey(new Date(log.startedAt), boundary),
        formatTime(log.startedAt),
        formatTime(log.endedAt),
        String(log.durationMin),
        section?.title ?? '',
        topic?.title ?? '',
        item?.title ?? '',
        log.type,
        log.source,
      ]);
    }
    const filename = `improva-logs-${this.store.today()}.csv`;
    downloadText({ filename, content: toCsv(rows), mime: 'text/csv;charset=utf-8' });
    this.toasts.show({ text: `Копия сохранена: ${filename}`, kind: 'success' });
  }

  check(text: string): TImportCheck {
    const result = checkSnapshot(text);
    if (!result.ok) {
      return {
        ok: false,
        message:
          result.reason === 'parse'
            ? 'Это не файл копии Импрувы. Данные в приложении не изменены.'
            : `Файл не подошёл: ошибка в ${result.path}. Данные в приложении не изменены.`,
      };
    }
    const current = this.store.data();
    const hasRoute = current.routeBlocks.some((block) => !block.deletedAt);
    // Маршрут из шаблона программы добавляется, только если своего маршрута ещё нет
    const snapshot = result.snapshot.kind === 'program' ? withFreshIds(result.snapshot, hasRoute) : result.snapshot;
    let added = 0;
    let updated = 0;
    let total = 0;
    for (const collection of COLLECTIONS) {
      const incoming: readonly IEntity[] = snapshot.data[collection] ?? [];
      const merged = mergeEntities<IEntity>(current[collection], incoming);
      added += merged.added;
      updated += merged.updated;
      total += incoming.length;
    }
    return {
      ok: true,
      snapshot,
      preview: { added, updated, total },
      logs: current.timeLogs.length,
      notes: current.notes.length,
    };
  }

  /** Перед «Заменить» скачивается копия текущих данных (US-08). */
  async apply(snapshot: ISnapshot, mode: TImportMode): Promise<IImportReport> {
    const effectiveMode: TImportMode = snapshot.kind === 'program' ? 'merge' : mode;
    if (effectiveMode === 'replace') {
      downloadText({
        filename: `improva-backup-${this.store.today()}.json`,
        content: JSON.stringify(this.store.snapshotFromMemory()),
        mime: 'application/json',
      });
    }
    const report = await this.adapter.importAll(snapshot, effectiveMode);
    await this.store.reload();
    this.toasts.show({ text: `Импортировано ${report.total} записей, план пересчитан.`, kind: 'success' });
    return report;
  }
}

/** Программа-шаблон получает новые id и становится своей: курс её не обновляет (ТЗ 8.2, FR-44). */
function withFreshIds(snapshot: ISnapshot, skipRoute: boolean): ISnapshot {
  const ids = new Map<string, string>();
  const fresh = (id: string): string => {
    const existing = ids.get(id);
    if (existing) {
      return existing;
    }
    const next = createId();
    ids.set(id, next);
    return next;
  };
  const data: Partial<ICollections> = snapshot.data;
  return {
    ...snapshot,
    data: {
      resources: (data.resources ?? []).map((entry) => ({ ...entry, id: fresh(entry.id), courseKey: null })),
      sections: (data.sections ?? []).map((entry) => ({ ...entry, id: fresh(entry.id), courseKey: null })),
      topics: (data.topics ?? []).map((entry) => ({ ...entry, id: fresh(entry.id), sectionId: fresh(entry.sectionId), courseKey: null })),
      items: (data.items ?? []).map((entry) => ({
        ...entry,
        id: fresh(entry.id),
        topicId: fresh(entry.topicId),
        resourceRefs: entry.resourceRefs.map((ref) => ({ ...ref, resourceId: fresh(ref.resourceId) })),
        courseKey: null,
        courseHash: null,
      })),
      routeBlocks: skipRoute ? [] : (data.routeBlocks ?? []).map((entry) => ({ ...entry, id: fresh(entry.id), courseKey: null })),
    },
  };
}
