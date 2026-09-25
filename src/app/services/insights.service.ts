import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { achievedMilestones, computeMetrics, evaluateTips, forecast, REVIEW_BLOCK_MIN, type IMilestone, type ITip } from '../domain';
import { diffDays, fromDayKey } from '../utils';
import { DataStore } from './data.store';
import { PlanService } from './plan.service';

const MAX_TIPS_PER_DAY = 2;

/** Метрики, прогноз, подсказки и вехи (FR-22…FR-25). */
@Injectable({ providedIn: 'root' })
export class InsightsService {
  private readonly store = inject(DataStore);
  private readonly planner = inject(PlanService);

  readonly celebration = signal<IMilestone | null>(null);
  private readonly dismissedToday = signal<readonly string[]>([]);

  readonly metrics = computed(() =>
    computeMetrics({
      logs: this.store.logs(),
      notes: this.store.data().notes,
      items: this.store.data().items,
      budget: this.store.budget(),
      challenge: this.store.challenge(),
      today: this.store.today(),
      boundaryHour: this.store.settings().dayBoundaryHour,
    }),
  );

  readonly forecast = computed(() => {
    const plan = this.planner.plan();
    const reviewMin = plan.days
      .flatMap((day) => day.blocks)
      .filter((block) => block.type === 'review')
      .reduce((sum) => sum + REVIEW_BLOCK_MIN, 0);
    return forecast({
      tree: this.store.tree(),
      logs: this.store.logs(),
      remainingByItem: plan.remainingByItem,
      budget: this.store.budget(),
      challenge: this.store.challenge(),
      today: this.store.today(),
      boundaryHour: this.store.settings().dayBoundaryHour,
      scale: plan.scale,
      reviewMinPerWeek: Math.min(reviewMin, this.store.budget().practiceMinPerWeek * 0.25),
    });
  });

  readonly dayNumber = computed(() => Math.max(1, diffDays(this.store.challenge().startDate, this.store.today()) + 1));

  readonly allTips = computed<ITip[]>(() =>
    evaluateTips({
      tree: this.store.tree(),
      logs: this.store.logs(),
      budget: this.store.budget(),
      challenge: this.store.challenge(),
      today: this.store.today(),
      boundaryHour: this.store.settings().dayBoundaryHour,
      pendingReviews: this.planner.plan().pendingReviews,
    }),
  );

  /** Не больше одной на экране и двух разных в день; проигнорированная 3 раза — вдвое реже (FR-22). */
  readonly tip = computed<ITip | null>(() => {
    const settings = this.store.settings();
    if (!settings.tipsEnabled) {
      return null;
    }
    const today = this.store.today();
    const stats = this.store.meta().tips;
    const shown = stats.shownOn[today] ?? [];
    const dayOfYear = Math.floor(fromDayKey(today).getTime() / 86_400_000);
    for (const tip of this.allTips()) {
      if (settings.disabledTips.includes(tip.id) || this.dismissedToday().includes(tip.id)) {
        continue;
      }
      if (!shown.includes(tip.id) && shown.length >= MAX_TIPS_PER_DAY) {
        continue;
      }
      const ignored = stats.ignored[tip.id] ?? 0;
      const period = ignored >= 3 ? 2 ** Math.floor(ignored / 3) : 1;
      if (dayOfYear % period !== 0) {
        continue;
      }
      return tip;
    }
    return null;
  });

  readonly milestones = computed(() =>
    achievedMilestones({
      tree: this.store.tree(),
      logs: this.store.logs(),
      challenge: this.store.challenge(),
      today: this.store.today(),
      rhythmStreak: this.metrics().rhythmStreak,
      sections: this.store.data().sections,
    }),
  );

  constructor() {
    effect(() => {
      const tip = this.tip();
      if (!tip || this.store.status() !== 'ready') {
        return;
      }
      const today = this.store.today();
      const stats = this.store.meta().tips;
      const shown = stats.shownOn[today] ?? [];
      if (!shown.includes(tip.id)) {
        this.store.updateMeta({ tips: { ...stats, shownOn: { [today]: [...shown, tip.id] } } });
      }
    });
    effect(() => {
      if (this.store.status() !== 'ready' || !this.store.meta().onboarded) {
        return;
      }
      const shown = new Set(this.store.meta().milestonesShown);
      const fresh = this.milestones().filter((milestone) => !shown.has(milestone.id));
      if (fresh.length === 0) {
        return;
      }
      this.store.updateMeta({ milestonesShown: [...shown, ...fresh.map((milestone) => milestone.id)] });
      const last = fresh.at(-1);
      if (last && fresh.length <= 3) {
        this.celebration.set(last);
        setTimeout(() => this.celebration.set(null), 3200);
      }
    });
  }

  /** Закрыть без действия: учитывается в частоте показа. */
  ignoreTip(tip: ITip): void {
    const stats = this.store.meta().tips;
    this.dismissedToday.update((list) => [...list, tip.id]);
    this.store.updateMeta({
      tips: { ...stats, ignored: { ...stats.ignored, [tip.id]: (stats.ignored[tip.id] ?? 0) + 1 } },
    });
  }

  acceptTip(tip: ITip): void {
    this.dismissedToday.update((list) => [...list, tip.id]);
  }
}
