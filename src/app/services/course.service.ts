import { Injectable, computed, inject } from '@angular/core';
import { challengeWeek, quarterOfWeek, routeFocus, routeTitle, sectionWeightsFor, type IRouteFocus } from '../domain';
import type { IGuide, IItem, IRouteBlock, ISection } from '../types';
import { buildSeed } from '../seed';
import { createId } from '../utils';
import { DataStore } from './data.store';
import { ToastService } from './toast.service';

export interface ICoursePreview {
  /** Топики, которым будет добавлен ориентир. */
  readonly matched: number;
  /** Топики с собственным ориентиром — не меняются. */
  readonly kept: number;
  /** Топики курса без пары в программе: «Раздел / Тема / Топик». */
  readonly notFound: readonly string[];
  readonly routeBlocks: number;
  readonly sectionWeights: number;
}

interface ICourseChanges {
  readonly preview: ICoursePreview;
  readonly items: IItem[];
  readonly sections: ISection[];
  readonly routeBlocks: IRouteBlock[];
}

const pathKey = (...parts: readonly string[]): string => parts.map((part) => part.trim().toLowerCase()).join(' / ');

/** Курс: квартальные веса, маршрут по мастерам и ориентиры стартовой программы (FR-39, FR-40, FR-42). */
@Injectable({ providedIn: 'root' })
export class CourseService {
  private readonly store = inject(DataStore);
  private readonly toasts = inject(ToastService);

  readonly week = computed(() => Math.max(1, challengeWeek(this.store.challenge().startDate, this.store.today())));
  readonly quarter = computed(() => quarterOfWeek(this.week()));
  readonly sectionWeights = computed(() =>
    sectionWeightsFor({
      sections: this.store.data().sections.filter((section) => !section.archived),
      quarter: this.quarter(),
      seasonal: this.store.budget().seasonalWeights,
    }),
  );
  readonly routeBlocks = computed(() =>
    this.store
      .data()
      .routeBlocks.filter((block) => !block.deletedAt)
      .sort((a, b) => a.order - b.order || a.fromWeek - b.fromWeek),
  );
  readonly focus = computed(() => routeFocus(this.routeBlocks(), this.week()));

  focusOn(date: string): IRouteFocus | null {
    return routeFocus(this.routeBlocks(), Math.max(1, challengeWeek(this.store.challenge().startDate, date)));
  }

  /** Название топика в плане и таймере: у топиков маршрута — художник или копия недели. */
  titleOf(item: IItem, date: string = this.store.today()): string {
    return item.routeRole ? routeTitle(item, this.focusOn(date)) : item.title;
  }

  /** Задание сессии: для топиков маршрута берётся из блока недели. */
  taskOf(item: IItem, date: string = this.store.today()): string {
    const guide = item.guide;
    if (!item.routeRole) {
      return guide?.task ?? '';
    }
    const focus = this.focusOn(date);
    if (!focus) {
      return guide?.task ?? '';
    }
    if (item.routeRole === 'copy') {
      return `${focus.block.copyTask}. Техника: ${focus.block.copyTechnique}.`;
    }
    return focus.artist ? `${focus.artist.name}: ${focus.artist.works}. Забираешь — ${focus.artist.takeaway.toLowerCase()}.` : guide?.task ?? '';
  }

  // ——— Маршрут по мастерам (FR-39) ———

  updateBlock(id: string, patch: Partial<Omit<IRouteBlock, 'id' | 'createdAt' | 'updatedAt'>>): void {
    const block = this.store.data().routeBlocks.find((entry) => entry.id === id);
    if (block) {
      this.store.upsert('routeBlocks', { ...block, ...patch, updatedAt: new Date().toISOString() });
    }
  }

  addBlock(): void {
    const blocks = this.routeBlocks();
    const last = blocks[blocks.length - 1];
    const fromWeek = last ? last.toWeek + 1 : 1;
    const now = new Date().toISOString();
    this.store.upsert('routeBlocks', {
      id: createId(),
      createdAt: now,
      updatedAt: now,
      order: last ? last.order + 1 : 0,
      fromWeek,
      toWeek: fromWeek + 3,
      artists: [
        { name: '', url: '', takeaway: '', works: '' },
        { name: '', url: '', takeaway: '', works: '' },
      ],
      copyTask: '',
      copyTechnique: '',
      links: [],
    });
  }

  removeBlock(id: string): void {
    const block = this.store.data().routeBlocks.find((entry) => entry.id === id);
    if (!block) {
      return;
    }
    this.store.remove('routeBlocks', [id]);
    this.toasts.undo({ text: 'Блок маршрута удалён', onUndo: () => this.store.upsert('routeBlocks', block) });
  }

  // ——— Ориентиры курса для начатых челленджей (FR-42) ———

  preview(): ICoursePreview {
    return this.changes(new Date().toISOString()).preview;
  }

  /** Заполняет только пустые ориентиры; прогресс, логи, заметки и оценки не меняются. Повторный запуск безопасен. */
  apply(): ICoursePreview {
    const changes = this.changes(new Date().toISOString());
    this.store.upsertMany('items', changes.items);
    this.store.upsertMany('sections', changes.sections);
    this.store.upsertMany('routeBlocks', changes.routeBlocks);
    return changes.preview;
  }

  private changes(now: string): ICourseChanges {
    const seed = buildSeed(now);
    const data = this.store.data();
    const seedSection = new Map(seed.sections.map((section) => [section.id, section]));
    const seedTopic = new Map(seed.topics.map((topic) => [topic.id, topic]));
    const sectionById = new Map(data.sections.map((section) => [section.id, section]));
    const topicById = new Map(data.topics.map((topic) => [topic.id, topic]));

    const existing = new Map<string, IItem>();
    for (const item of data.items) {
      const topic = topicById.get(item.topicId);
      const section = topic ? sectionById.get(topic.sectionId) : undefined;
      if (topic && section && !item.deletedAt) {
        existing.set(pathKey(section.title, topic.title, item.title), item);
      }
    }

    const items: IItem[] = [];
    const notFound: string[] = [];
    let kept = 0;
    let matched = 0;
    for (const seedItem of seed.items) {
      const topic = seedTopic.get(seedItem.topicId);
      const section = topic ? seedSection.get(topic.sectionId) : undefined;
      if (!topic || !section) {
        continue;
      }
      const target = existing.get(pathKey(section.title, topic.title, seedItem.title));
      if (!target) {
        notFound.push(`${section.title} / ${topic.title} / ${seedItem.title}`);
        continue;
      }
      if (target.guide) {
        kept += 1;
        if (target.routeRole === null && seedItem.routeRole !== null) {
          items.push({ ...target, routeRole: seedItem.routeRole, updatedAt: now });
        }
        continue;
      }
      const guide: IGuide | null = seedItem.guide;
      matched += 1;
      items.push({ ...target, guide, routeRole: target.routeRole ?? seedItem.routeRole, updatedAt: now });
    }

    const seedWeights = new Map(seed.sections.map((section) => [section.title.trim().toLowerCase(), section.quarterWeights]));
    const sections = data.sections
      .filter((section) => section.quarterWeights === null && seedWeights.has(section.title.trim().toLowerCase()))
      .map((section) => ({ ...section, quarterWeights: seedWeights.get(section.title.trim().toLowerCase()) ?? null, updatedAt: now }));

    const routeBlocks = data.routeBlocks.some((block) => !block.deletedAt) ? [] : seed.routeBlocks;

    return {
      preview: {
        matched,
        kept,
        notFound,
        routeBlocks: routeBlocks.length,
        sectionWeights: sections.length,
      },
      items,
      sections,
      routeBlocks,
    };
  }
}
