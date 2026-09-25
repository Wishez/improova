import { Injectable, inject } from '@angular/core';
import { GUIDE_LIMITS, estimateFromResource } from '../domain';
import { buildSeed } from '../seed';
import type { IAsset, IGuide, IItem, IResource, ISection, ITopic, TItemKind, TSectionWeight } from '../types';
import { compressImage, createId } from '../utils';
import { DataStore } from './data.store';
import { ToastService } from './toast.service';

export type TProgramEntity = 'section' | 'topic' | 'item';

export interface IBulkLine {
  readonly title: string;
  readonly estimateMin: number;
}

const DEFAULT_ESTIMATE = 60;

/** Разбор строки массового добавления: «название · 60» (FR-29). */
export function parseBulkLines(text: string): IBulkLine[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const match = /^(.*?)[\s]*[·|;]\s*(\d{1,4})\s*$/.exec(line);
      const title = (match?.[1] ?? line).trim();
      const minutes = match?.[2] ? Number(match[2]) : DEFAULT_ESTIMATE;
      return { title: title.length > 0 ? title : line, estimateMin: Math.min(Math.max(minutes, 5), 6000) };
    });
}

/** Редактор программы и закрытие топиков (FR-05…FR-09, FR-27…FR-31). */
@Injectable({ providedIn: 'root' })
export class ProgramService {
  private readonly store = inject(DataStore);
  private readonly toasts = inject(ToastService);

  private now(): string {
    return new Date().toISOString();
  }

  installSeed(): void {
    const seed = buildSeed(this.now());
    this.store.upsertMany('resources', seed.resources);
    this.store.upsertMany('sections', seed.sections);
    this.store.upsertMany('topics', seed.topics);
    this.store.upsertMany('items', seed.items);
    this.store.upsertMany('routeBlocks', seed.routeBlocks);
  }

  addSection(title: string): ISection {
    const sections = this.store.data().sections;
    const now = this.now();
    const section: ISection = {
      id: createId(),
      createdAt: now,
      updatedAt: now,
      title: title.trim(),
      colorToken: (sections.length % 6) + 1,
      order: nextOrder(sections),
      weight: 2,
      quarterWeights: null,
      archived: false,
    };
    this.store.upsert('sections', section);
    return section;
  }

  addTopic(sectionId: string, title: string): ITopic {
    const siblings = this.store.data().topics.filter((topic) => topic.sectionId === sectionId);
    const now = this.now();
    const topic: ITopic = {
      id: createId(),
      createdAt: now,
      updatedAt: now,
      sectionId,
      title: title.trim(),
      description: '',
      order: nextOrder(siblings),
      archived: false,
    };
    this.store.upsert('topics', topic);
    return topic;
  }

  addItems(topicId: string, lines: readonly IBulkLine[], kind: TItemKind = 'practice'): IItem[] {
    const siblings = this.store.data().items.filter((item) => item.topicId === topicId);
    let order = nextOrder(siblings);
    const now = this.now();
    const items = lines.map<IItem>((line) => ({
      id: createId(),
      createdAt: now,
      updatedAt: now,
      topicId,
      title: line.title,
      kind,
      estimateMin: line.estimateMin,
      resourceRefs: [],
      weakSpot: false,
      recurrenceWeeks: null,
      selfCheck: '',
      order: order++,
      doneAt: null,
      archived: false,
      guide: null,
      routeRole: null,
    }));
    this.store.upsertMany('items', items);
    return items;
  }

  updateSection(id: string, patch: Partial<Pick<ISection, 'title' | 'weight' | 'colorToken'>>): void {
    const section = this.store.data().sections.find((entry) => entry.id === id);
    if (section && !(patch.title !== undefined && patch.title.trim() === '')) {
      this.store.upsert('sections', { ...section, ...patch, updatedAt: this.now() });
    }
  }

  setSectionWeight(id: string, weight: TSectionWeight): void {
    this.updateSection(id, { weight });
  }

  updateTopic(id: string, patch: Partial<Pick<ITopic, 'title' | 'description'>>): void {
    const topic = this.store.data().topics.find((entry) => entry.id === id);
    if (topic && !(patch.title !== undefined && patch.title.trim() === '')) {
      this.store.upsert('topics', { ...topic, ...patch, updatedAt: this.now() });
    }
  }

  updateItem(id: string, patch: Partial<Omit<IItem, 'id' | 'createdAt' | 'updatedAt'>>): void {
    const item = this.store.data().items.find((entry) => entry.id === id);
    if (item && !(patch.title !== undefined && patch.title.trim() === '')) {
      this.store.upsert('items', { ...item, ...patch, updatedAt: this.now() });
    }
  }

  /** Галочка — единственный способ закрыть топик (ТЗ 3, правило 1). */
  setDone(itemId: string, done: boolean): void {
    this.updateItem(itemId, { doneAt: done ? this.now() : null });
  }

  reorder(entity: TProgramEntity, orderedIds: readonly string[]): void {
    const now = this.now();
    const orderOf = new Map(orderedIds.map((id, index) => [id, index]));
    if (entity === 'section') {
      this.store.upsertMany('sections', this.store.data().sections.filter((e) => orderOf.has(e.id)).map((e) => ({ ...e, order: orderOf.get(e.id) ?? e.order, updatedAt: now })));
    } else if (entity === 'topic') {
      this.store.upsertMany('topics', this.store.data().topics.filter((e) => orderOf.has(e.id)).map((e) => ({ ...e, order: orderOf.get(e.id) ?? e.order, updatedAt: now })));
    } else {
      this.store.upsertMany('items', this.store.data().items.filter((e) => orderOf.has(e.id)).map((e) => ({ ...e, order: orderOf.get(e.id) ?? e.order, updatedAt: now })));
    }
  }

  /** Перенос топика в другую тему: логи и заметки ссылаются на топик и едут вместе с ним (US-06). */
  moveItem(itemId: string, toTopicId: string, index: number): void {
    const item = this.store.data().items.find((entry) => entry.id === itemId);
    if (!item) {
      return;
    }
    const target = this.store
      .data()
      .items.filter((entry) => entry.topicId === toTopicId && entry.id !== itemId && !entry.archived)
      .sort((a, b) => a.order - b.order);
    target.splice(Math.max(0, Math.min(index, target.length)), 0, { ...item, topicId: toTopicId });
    const now = this.now();
    this.store.upsertMany(
      'items',
      target.map((entry, order) => ({ ...entry, order, updatedAt: now })),
    );
  }

  /** Все топики поддерева и число их логов — для выбора «в архив / удалить» (FR-30). */
  subtree(entity: TProgramEntity, id: string): { readonly itemIds: string[]; readonly topicIds: string[]; readonly logCount: number } {
    const data = this.store.data();
    const topicIds =
      entity === 'section' ? data.topics.filter((t) => t.sectionId === id).map((t) => t.id) : entity === 'topic' ? [id] : [];
    const itemIds =
      entity === 'item' ? [id] : data.items.filter((item) => topicIds.includes(item.topicId)).map((item) => item.id);
    const itemSet = new Set(itemIds);
    const logCount = data.timeLogs.filter((log) => log.itemId && itemSet.has(log.itemId)).length;
    return { itemIds, topicIds, logCount };
  }

  archive(entity: TProgramEntity, id: string): void {
    const now = this.now();
    const data = this.store.data();
    const { itemIds, topicIds } = this.subtree(entity, id);
    const before = {
      sections: data.sections.filter((s) => entity === 'section' && s.id === id),
      topics: data.topics.filter((t) => topicIds.includes(t.id)),
      items: data.items.filter((i) => itemIds.includes(i.id)),
    };
    this.store.upsertMany('sections', before.sections.map((s) => ({ ...s, archived: true, updatedAt: now })));
    this.store.upsertMany('topics', before.topics.map((t) => ({ ...t, archived: true, updatedAt: now })));
    this.store.upsertMany('items', before.items.map((i) => ({ ...i, archived: true, updatedAt: now })));
    this.toasts.undo({
      text: 'Перенесено в архив',
      onUndo: () => {
        this.store.upsertMany('sections', before.sections);
        this.store.upsertMany('topics', before.topics);
        this.store.upsertMany('items', before.items);
      },
    });
  }

  /** Удаление поддерева вместе с логами, заметками и блоками плана; отменяется 10 секунд. */
  remove(entity: TProgramEntity, id: string): void {
    const data = this.store.data();
    const { itemIds, topicIds } = this.subtree(entity, id);
    const itemSet = new Set(itemIds);
    const removed = {
      sections: data.sections.filter((s) => entity === 'section' && s.id === id),
      topics: data.topics.filter((t) => topicIds.includes(t.id)),
      items: data.items.filter((i) => itemSet.has(i.id)),
      timeLogs: data.timeLogs.filter((l) => l.itemId !== null && itemSet.has(l.itemId)),
      notes: data.notes.filter((n) => n.itemId !== null && itemSet.has(n.itemId)),
      planBlocks: data.planBlocks.filter((b) => b.itemId !== null && itemSet.has(b.itemId)),
    };
    this.store.remove('sections', removed.sections.map((e) => e.id));
    this.store.remove('topics', removed.topics.map((e) => e.id));
    this.store.remove('items', removed.items.map((e) => e.id));
    this.store.remove('timeLogs', removed.timeLogs.map((e) => e.id));
    this.store.remove('notes', removed.notes.map((e) => e.id));
    this.store.remove('planBlocks', removed.planBlocks.map((e) => e.id));
    const label = entity === 'section' ? 'Раздел удалён' : entity === 'topic' ? 'Тема удалена' : 'Топик удалён';
    this.toasts.undo({
      text: label,
      onUndo: () => {
        this.store.upsertMany('sections', removed.sections);
        this.store.upsertMany('topics', removed.topics);
        this.store.upsertMany('items', removed.items);
        this.store.upsertMany('timeLogs', removed.timeLogs);
        this.store.upsertMany('notes', removed.notes);
        this.store.upsertMany('planBlocks', removed.planBlocks);
      },
    });
  }

  addResource(draft: Omit<IResource, 'id' | 'createdAt' | 'updatedAt' | 'archived'>): IResource {
    const now = this.now();
    const resource: IResource = { ...draft, id: createId(), createdAt: now, updatedAt: now, archived: false };
    this.store.upsert('resources', resource);
    return resource;
  }

  updateResource(id: string, patch: Partial<Omit<IResource, 'id' | 'createdAt' | 'updatedAt'>>): void {
    const resource = this.store.data().resources.find((entry) => entry.id === id);
    if (resource) {
      this.store.upsert('resources', { ...resource, ...patch, updatedAt: this.now() });
    }
  }

  removeResource(id: string): void {
    const data = this.store.data();
    const resource = data.resources.find((entry) => entry.id === id);
    if (!resource) {
      return;
    }
    const affected = data.items.filter((item) => item.resourceRefs.some((ref) => ref.resourceId === id));
    const now = this.now();
    this.store.remove('resources', [id]);
    this.store.upsertMany(
      'items',
      affected.map((item) => ({ ...item, resourceRefs: item.resourceRefs.filter((ref) => ref.resourceId !== id), updatedAt: now })),
    );
    this.toasts.undo({
      text: 'Ресурс удалён',
      onUndo: () => {
        this.store.upsert('resources', resource);
        this.store.upsertMany('items', affected);
      },
    });
  }

  /** «Разбить на части по ~60 мин» (FR-31). */
  splitResource(params: { readonly resourceId: string; readonly topicId: string; readonly partMin: number; readonly kind: TItemKind }): number {
    const resource = this.store.data().resources.find((entry) => entry.id === params.resourceId);
    if (!resource || resource.unitCount <= 0 || resource.minPerUnit <= 0) {
      return 0;
    }
    const total = resource.unitCount * resource.minPerUnit;
    const partsCount = Math.max(1, Math.round(total / params.partMin));
    const unitsPerPart = resource.unitCount / partsCount;
    const unitWord = resource.unit === 'page' ? 'стр.' : resource.unit === 'lesson' ? 'уроки' : resource.unit === 'minute' ? 'мин' : 'шт.';
    const siblings = this.store.data().items.filter((item) => item.topicId === params.topicId);
    let order = nextOrder(siblings);
    const now = this.now();
    const items: IItem[] = Array.from({ length: partsCount }, (_, index) => {
      const from = Math.round(index * unitsPerPart) + 1;
      const to = Math.round((index + 1) * unitsPerPart);
      const units = Math.max(1, to - from + 1);
      return {
        id: createId(),
        createdAt: now,
        updatedAt: now,
        topicId: params.topicId,
        title: `${resource.title} · ${unitWord} ${from}–${to}`,
        kind: params.kind,
        estimateMin: estimateFromResource(resource, units),
        resourceRefs: [{ resourceId: resource.id, range: `${unitWord} ${from}–${to}`, units }],
        weakSpot: false,
        recurrenceWeeks: null,
        selfCheck: '',
        order: order++,
        doneAt: null,
        archived: false,
        guide: null,
        routeRole: null,
      };
    });
    this.store.upsertMany('items', items);
    return items.length;
  }

  // ——— Ориентир топика (FR-37) ———

  setGuide(itemId: string, guide: IGuide | null): void {
    this.updateItem(itemId, { guide });
  }

  /** Фото-референсы ориентира: сжатие до 1600 px WebP, до 4 штук (как у заметок, FR-17). */
  async addGuidePhotos(itemId: string, files: readonly File[]): Promise<void> {
    const item = this.store.data().items.find((entry) => entry.id === itemId);
    if (!item?.guide) {
      return;
    }
    const free = GUIDE_LIMITS.photos - item.guide.imageIds.length;
    if (free <= 0) {
      this.toasts.show({ text: `К ориентиру можно прикрепить до ${GUIDE_LIMITS.photos} фото.` });
      return;
    }
    try {
      const assets: IAsset[] = [];
      for (const file of files.slice(0, free)) {
        if (!file.type.startsWith('image/')) {
          continue;
        }
        const image = await compressImage(file);
        const now = this.now();
        assets.push({ id: createId(), createdAt: now, updatedAt: now, ...image });
      }
      this.store.upsertMany('assets', assets);
      const fresh = this.store.data().items.find((entry) => entry.id === itemId)?.guide ?? item.guide;
      this.setGuide(itemId, { ...fresh, imageIds: [...fresh.imageIds, ...assets.map((asset) => asset.id)] });
    } catch {
      this.toasts.show({ text: 'Не удалось обработать фото. Попробуй JPEG или PNG.', kind: 'error' });
    }
  }

  removeGuidePhoto(itemId: string, assetId: string): void {
    const item = this.store.data().items.find((entry) => entry.id === itemId);
    if (!item?.guide) {
      return;
    }
    this.setGuide(itemId, { ...item.guide, imageIds: item.guide.imageIds.filter((id) => id !== assetId) });
    this.store.remove('assets', [assetId]);
  }
}

function nextOrder(list: readonly { readonly order: number }[]): number {
  return list.reduce((max, entry) => Math.max(max, entry.order + 1), 0);
}
