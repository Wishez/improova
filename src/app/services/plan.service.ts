import { Injectable, computed, effect, inject, untracked } from '@angular/core';
import { buildCalendar, dayOf, sectionIdOfItem, sectionWeightsFor, planWeek, type IPlannedBlock } from '../domain';
import type { IPlanBlock } from '../types';
import { addDays, createId } from '../utils';
import { CourseService } from './course.service';
import { DataStore } from './data.store';
import { ToastService } from './toast.service';

export const HORIZON_DAYS = 7;

/** План на 7 дней вперёд: пересчитывается при любом изменении данных (FR-18…FR-20). */
@Injectable({ providedIn: 'root' })
export class PlanService {
  private readonly store = inject(DataStore);
  private readonly toasts = inject(ToastService);
  private readonly course = inject(CourseService);

  readonly plan = computed(() =>
    planWeek({
      today: this.store.today(),
      horizonDays: HORIZON_DAYS,
      budget: this.store.budget(),
      tree: this.store.tree(),
      resources: this.store.resourcesById(),
      logs: this.store.logs(),
      blocks: this.store.data().planBlocks,
      boundaryHour: this.store.settings().dayBoundaryHour,
      sectionWeights: this.course.sectionWeights(),
    }),
  );

  /** Календарь всего челленджа (FR-36): считается только когда открыт. */
  readonly calendar = computed(() => {
    const plan = this.plan();
    const tree = this.store.tree();
    const boundary = this.store.settings().dayBoundaryHour;
    const factByDay = new Map<string, number>();
    for (const log of this.store.logs()) {
      const day = dayOf(log, boundary);
      factByDay.set(day, (factByDay.get(day) ?? 0) + log.durationMin);
    }
    const remainingBySection = new Map<string, number>();
    for (const [itemId, minutes] of plan.remainingByItem) {
      const item = tree.itemById.get(itemId);
      const sectionId = sectionIdOfItem(tree, itemId);
      if (sectionId && item && item.recurrenceWeeks === null) {
        remainingBySection.set(sectionId, (remainingBySection.get(sectionId) ?? 0) + minutes);
      }
    }
    const sections = this.store.data().sections.filter((section) => !section.archived);
    const seasonal = this.store.budget().seasonalWeights;
    return buildCalendar({
      challenge: this.store.challenge(),
      budget: this.store.budget(),
      today: this.store.today(),
      scale: plan.scale,
      factByDay,
      dayPlans: this.store.meta().dayPlans,
      planDays: plan.days,
      sections,
      remainingBySection,
      weightsForQuarter: (quarter) => sectionWeightsFor({ sections, quarter, seasonal }),
      routeBlocks: this.course.routeBlocks(),
    });
  });

  readonly today = computed(() => this.plan().days[0] ?? null);

  constructor() {
    // План дня фиксируется при первом расчёте в этот день: прошлое в календаре не меняется от новых настроек
    effect(() => {
      const day = this.today();
      if (!day || this.store.status() !== 'ready' || !this.store.meta().onboarded) {
        return;
      }
      untracked(() => {
        const dayPlans = this.store.meta().dayPlans;
        if (dayPlans[day.date] === undefined) {
          this.store.updateMeta({ dayPlans: { ...dayPlans, [day.date]: day.planned + day.logged } });
        }
      });
    });
  }

  skip(block: IPlannedBlock): void {
    const created = this.persist({ ...block, pinned: false, status: 'skipped' });
    const removed = this.unpinStored(block);
    this.toasts.undo({
      text: 'Блок пропущен — время вернулось в очередь',
      onUndo: () => {
        this.store.remove('planBlocks', [created.id]);
        if (removed) {
          this.store.upsert('planBlocks', removed);
        }
      },
    });
  }

  toTomorrow(block: IPlannedBlock): void {
    this.moveTo(block, addDays(block.date, 1));
  }

  pin(block: IPlannedBlock): void {
    if (!block.pinned) {
      this.persist({ ...block, pinned: true, status: 'planned' });
    }
  }

  unpin(block: IPlannedBlock): void {
    this.unpinStored(block);
  }

  /** Перетаскивание между днями: блок становится закреплённым (FR-18). */
  moveTo(block: IPlannedBlock, date: string): void {
    if (date === block.date) {
      this.pin(block);
      return;
    }
    const created: IPlanBlock[] = [];
    this.unpinStored(block);
    if (!block.pinned) {
      created.push(this.persist({ ...block, pinned: false, status: 'skipped' }));
    }
    created.push(this.persist({ ...block, date, pinned: true, status: 'planned' }));
    this.toasts.undo({
      text: 'Блок перенесён',
      onUndo: () => this.store.remove('planBlocks', created.map((entry) => entry.id)),
    });
  }

  private unpinStored(block: IPlannedBlock): IPlanBlock | null {
    if (!block.storedId) {
      return null;
    }
    const stored = this.store.data().planBlocks.find((entry) => entry.id === block.storedId) ?? null;
    this.store.remove('planBlocks', [block.storedId]);
    return stored;
  }

  private persist(block: Pick<IPlannedBlock, 'date' | 'itemId' | 'type' | 'plannedMin'> & Pick<IPlanBlock, 'pinned' | 'status'>): IPlanBlock {
    const now = new Date().toISOString();
    const entity: IPlanBlock = {
      id: createId(),
      createdAt: now,
      updatedAt: now,
      date: block.date,
      itemId: block.itemId,
      type: block.type,
      plannedMin: block.plannedMin,
      pinned: block.pinned,
      status: block.status,
    };
    this.store.upsert('planBlocks', entity);
    return entity;
  }
}
