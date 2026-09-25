import { Injectable, computed, inject } from '@angular/core';
import { challengeWeek, planCourseUpdate, quarterOfWeek, routeFocus, routeTitle, sectionWeightsFor, type ICourseSyncPlan, type IRouteFocus } from '../domain';
import { COURSE } from '../seed';
import type { ICollections, ICourseRelease, IEntity, IItem, IMeta, IRouteBlock, TCollection } from '../types';
import { createId } from '../utils';
import { DataStore } from './data.store';
import { ToastService } from './toast.service';

/** Курс: квартальные веса, маршрут по мастерам, версии курса и обновление (FR-39, FR-40, FR-44…FR-46). */
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
      courseKey: null,
    });
  }

  removeBlock(id: string): void {
    const block = this.store.data().routeBlocks.find((entry) => entry.id === id);
    if (!block) {
      return;
    }
    this.store.remove('routeBlocks', [id]);
    const dismissedBefore = this.store.meta().dismissedCourseKeys;
    if (block.courseKey) {
      this.store.updateMeta({ dismissedCourseKeys: [...new Set([...dismissedBefore, block.courseKey])] });
    }
    this.toasts.undo({
      text: 'Блок маршрута удалён',
      onUndo: () => {
        this.store.upsert('routeBlocks', block);
        this.store.updateMeta({ dismissedCourseKeys: dismissedBefore });
      },
    });
  }

  // ——— Версии курса и обновление (FR-45, FR-46) ———

  /** Версия курса в этом релизе. */
  readonly latestVersion = COURSE.version;
  /** Версия курса в данных; null — челлендж без курса. */
  readonly version = computed(() => this.store.meta().courseVersion);
  readonly hasUpdate = computed(() => (this.version() ?? 0) < this.latestVersion);
  /** «Что нового» по всем версиям новее той, что в данных. */
  readonly releases = computed<readonly ICourseRelease[]>(() =>
    COURSE.releases.filter((release) => release.version > (this.version() ?? 0)).sort((a, b) => b.version - a.version),
  );
  /** Баннер на «Сегодня»: только у челленджа с курсом и пока не закрыт для этой версии. */
  readonly bannerVisible = computed(
    () => this.version() !== null && this.hasUpdate() && (this.store.meta().courseBannerDismissed ?? 0) < this.latestVersion,
  );

  dismissBanner(): void {
    this.store.updateMeta({ courseBannerDismissed: this.latestVersion });
  }

  /** План обновления без записи: для предпросмотра. */
  plan(): ICourseSyncPlan {
    const data = this.store.data();
    return planCourseUpdate({
      data,
      course: COURSE,
      dismissedKeys: this.store.meta().dismissedCourseKeys,
      activeItemId: this.store.meta().timer?.itemId ?? null,
      currentWeek: this.week(),
      nowIso: new Date().toISOString(),
      createId: () => createId(),
    });
  }

  /**
   * Применяет курс одной транзакцией (НФТ 1.3). Прогресс, логи, заметки и план не меняются.
   * Возвращает план; при отказе хранилища данные не меняются и ошибка уходит вызывающему.
   */
  async apply(): Promise<ICourseSyncPlan> {
    const plan = this.plan();
    const before = this.store.data();
    const metaBefore = this.store.meta();
    const metaNext: IMeta = { ...metaBefore, courseVersion: plan.version, updatedAt: new Date().toISOString() };
    const puts: { collection: TCollection; entity: IEntity }[] = [
      ...plan.puts.resources.map((entity) => ({ collection: 'resources' as const, entity })),
      ...plan.puts.sections.map((entity) => ({ collection: 'sections' as const, entity })),
      ...plan.puts.topics.map((entity) => ({ collection: 'topics' as const, entity })),
      ...plan.puts.items.map((entity) => ({ collection: 'items' as const, entity })),
      ...plan.puts.routeBlocks.map((entity) => ({ collection: 'routeBlocks' as const, entity })),
      { collection: 'meta', entity: metaNext },
    ];
    const removes = plan.removes.routeBlocks.map((id) => ({ collection: 'routeBlocks' as const, id }));
    await this.store.commit({ puts, removes });
    this.toasts.show({
      text: `Курс обновлён до v${plan.version}`,
      kind: 'success',
      durationMs: 10_000,
      action: { label: 'Отменить', run: () => void this.revert({ before, puts, removes }) },
    });
    return plan;
  }

  /** Отмена обновления: изменённое возвращается к прежнему виду, добавленное удаляется. */
  private async revert(params: {
    readonly before: ICollections;
    readonly puts: readonly { readonly collection: TCollection; readonly entity: IEntity }[];
    readonly removes: readonly { readonly collection: TCollection; readonly id: string }[];
  }): Promise<void> {
    const previous = (collection: TCollection, id: string): IEntity | undefined =>
      params.before[collection].find((entity: IEntity) => entity.id === id);
    const restore: { collection: TCollection; entity: IEntity }[] = [];
    const drop: { collection: TCollection; id: string }[] = [];
    for (const { collection, entity } of params.puts) {
      const old = previous(collection, entity.id);
      if (old) {
        restore.push({ collection, entity: old });
      } else {
        drop.push({ collection, id: entity.id });
      }
    }
    for (const { collection, id } of params.removes) {
      const old = previous(collection, id);
      if (old) {
        restore.push({ collection, entity: old });
      }
    }
    try {
      await this.store.commit({ puts: restore, removes: drop });
      this.toasts.show({ text: 'Обновление курса отменено' });
    } catch {
      this.toasts.show({ text: 'Не удалось отменить обновление: хранилище не отвечает.', kind: 'error' });
    }
  }
}
