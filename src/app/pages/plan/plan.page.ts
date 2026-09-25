import { FormsModule } from '@angular/forms';
import { CdkDrag, CdkDropList, CdkDropListGroup, type CdkDragDrop } from '@angular/cdk/drag-drop';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { TuiButton, TuiHint } from '@taiga-ui/core';
import { TuiSwitch } from '@taiga-ui/kit';
import { EmptyStateComponent } from '../../components';
import { minutesBySection, type IDayPlan, type IPlannedBlock } from '../../domain';
import { DayShortPipe, MinutesPipe } from '../../pipes';
import { DataStore, InsightsService, PlanService, ProgramService, UiStateService } from '../../services';
import { SESSION_TYPE_LABEL, formatDayShort, formatHours, toDayKey, weekStart, weekdayIndex, weekdayShort } from '../../utils';

const WEEKLY_REVIEW_MARK = 'weeklyReview';

/** План на 7 дней: перетаскивание, пропуск, закрепление, обзор недели (FR-18…FR-21). */
@Component({
  selector: 'app-plan-page',
  imports: [FormsModule, CdkDropListGroup, CdkDropList, CdkDrag, TuiButton, TuiHint, TuiSwitch, EmptyStateComponent, MinutesPipe, DayShortPipe],
  templateUrl: './plan.page.html',
  styleUrl: './plan.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlanPage {
  protected readonly store = inject(DataStore);
  protected readonly planner = inject(PlanService);
  protected readonly ui = inject(UiStateService);
  private readonly insights = inject(InsightsService);
  private readonly program = inject(ProgramService);
  protected readonly router = inject(Router);
  protected readonly typeLabel = SESSION_TYPE_LABEL;

  protected readonly days = computed(() => this.planner.plan().days);
  protected readonly dayIds = computed(() => this.days().map((day) => `day-${day.date}`));
  protected readonly budget = this.store.budget;
  protected readonly wanted = computed(() => this.budget().studyMinPerWeek + this.budget().practiceMinPerWeek);
  protected readonly noBudget = computed(() => this.wanted() === 0);
  protected readonly noDays = computed(() => this.planner.plan().capacityPerWeek === 0);
  protected readonly overBudget = computed(() => this.planner.plan().scale < 1 && !this.noDays());
  protected readonly forecast = this.insights.forecast;
  protected readonly unrealistic = computed(() => this.forecast().unrealistic && this.store.tree().itemById.size > 0);

  protected readonly isReviewDay = computed(() => weekdayIndex(this.store.today()) === this.store.settings().reviewWeekday);
  protected readonly reviewAccepted = computed(() => (this.store.meta().tips.shownOn[this.store.today()] ?? []).includes(WEEKLY_REVIEW_MARK));
  protected readonly weekSummary = computed(() => {
    const start = weekStart(this.store.today());
    const boundary = this.store.settings().dayBoundaryHour;
    const logs = this.store.logs().filter((log) => toDayKey(new Date(log.startedAt), boundary) >= start);
    const tree = this.store.tree();
    const bySection = minutesBySection(tree, logs);
    const sections = [...bySection.entries()]
      .map(([id, minutes]) => ({ title: id ? (tree.sectionById.get(id)?.title ?? 'Архив') : 'Творчество', minutes }))
      .sort((a, b) => b.minutes - a.minutes)
      .slice(0, 4);
    const spent = this.store.spent();
    const inProgress = [...tree.itemById.values()].filter((item) => item.doneAt === null && (spent.get(item.id) ?? 0) > 0).slice(0, 6);
    return {
      fact: logs.reduce((sum, log) => sum + log.durationMin, 0),
      plan: Math.min(this.planner.plan().capacityPerWeek, this.wanted()),
      sections,
      inProgress,
    };
  });

  protected dayLabel(day: IDayPlan): string {
    return `${weekdayShort(weekdayIndex(day.date))}, ${formatDayShort(day.date)}`;
  }

  protected titleOf(block: IPlannedBlock): string {
    return block.itemId ? (this.store.tree().itemById.get(block.itemId)?.title ?? '') : 'Свободное творчество';
  }

  protected colorOf(block: IPlannedBlock): string {
    const section = block.sectionId ? this.store.tree().sectionById.get(block.sectionId) : undefined;
    return section ? `sectionDot_${section.colorToken}` : 'sectionDot_none';
  }

  protected hours(minutes: number): string {
    return formatHours(minutes);
  }

  protected drop(day: IDayPlan, event: CdkDragDrop<IDayPlan, IDayPlan, IPlannedBlock>): void {
    const block = event.item.data;
    if (event.previousContainer !== event.container) {
      this.planner.moveTo(block, day.date);
    }
  }

  protected toggleWeak(itemId: string, weak: boolean): void {
    this.program.updateItem(itemId, { weakSpot: !weak });
  }

  protected acceptReview(): void {
    const today = this.store.today();
    const stats = this.store.meta().tips;
    const shown = stats.shownOn[today] ?? [];
    this.store.updateMeta({ tips: { ...stats, shownOn: { ...stats.shownOn, [today]: [...shown, WEEKLY_REVIEW_MARK] } } });
  }
}
