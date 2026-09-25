import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TuiButton, TuiHint } from '@taiga-ui/core';
import { TuiProgress } from '@taiga-ui/kit';
import { EmptyStateComponent } from '../../components';
import { progressOfItems, sectionItems, weeklyPlan, type IPlannedBlock, type ITip } from '../../domain';
import { ClockTimePipe, DayShortPipe, MarkdownPipe, MinutesPipe } from '../../pipes';
import { BackupService, DataStore, InsightsService, PlanService, ProgramService, TimerService, UiStateService } from '../../services';
import type { ITimeLog } from '../../types';
import { SESSION_TYPE_LABEL, diffDays, formatDayShort, toDayKey, weekStart, weekdayAccusative, weekdayIndex, weekdayShort } from '../../utils';

const BACKUP_REMINDER_DAYS = 28;

/** Экран «Сегодня»: что делать сейчас (FR-02…FR-04). */
@Component({
  selector: 'app-today-page',
  imports: [RouterLink, TuiButton, TuiHint, TuiProgress, EmptyStateComponent, MinutesPipe, DayShortPipe, ClockTimePipe, MarkdownPipe],
  templateUrl: './today.page.html',
  styleUrl: './today.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TodayPage {
  protected readonly store = inject(DataStore);
  protected readonly planner = inject(PlanService);
  protected readonly timer = inject(TimerService);
  protected readonly ui = inject(UiStateService);
  protected readonly insights = inject(InsightsService);
  protected readonly backup = inject(BackupService);
  private readonly program = inject(ProgramService);
  protected readonly router = inject(Router);

  protected readonly typeLabel = SESSION_TYPE_LABEL;

  constructor() {
    void this.backup.refreshUsage();
  }

  protected readonly dateLabel = computed(() => {
    const today = this.store.today();
    return `${weekdayShort(weekdayIndex(today))}, ${formatDayShort(today)}`;
  });
  protected readonly totalDays = computed(() => Math.max(1, diffDays(this.store.challenge().startDate, this.store.challenge().endDate)));
  protected readonly hasProgram = computed(() => this.store.tree().itemById.size > 0);

  protected readonly weekPlan = computed(() => weeklyPlan(this.store.budget()));
  protected readonly weekFact = computed(() => {
    const start = weekStart(this.store.today());
    const boundary = this.store.settings().dayBoundaryHour;
    return this.store
      .logs()
      .filter((log) => toDayKey(new Date(log.startedAt), boundary) >= start)
      .reduce((sum, log) => sum + log.durationMin, 0);
  });

  protected readonly todayLogs = computed(() => {
    const today = this.store.today();
    const boundary = this.store.settings().dayBoundaryHour;
    return this.store.logs().filter((log) => toDayKey(new Date(log.startedAt), boundary) === today);
  });
  protected readonly blocks = computed(() => this.planner.today()?.blocks ?? []);
  protected readonly todayMinutes = computed(() => this.todayLogs().reduce((sum, log) => sum + log.durationMin, 0));
  protected readonly nextDay = computed(() => {
    const day = this.planner.plan().days.slice(1).find((entry) => entry.blocks.length > 0);
    const block = day?.blocks[0];
    return day && block ? { weekday: weekdayAccusative(day.date), title: this.titleOf(block) } : null;
  });

  protected readonly overall = computed(() => {
    const tree = this.store.tree();
    return progressOfItems([...tree.itemById.values()], this.store.spent());
  });
  protected readonly sections = computed(() => {
    const tree = this.store.tree();
    const spent = this.store.spent();
    return tree.sections.map((section) => ({ section, progress: progressOfItems(sectionItems(tree, section.id), spent) }));
  });

  protected readonly reviews = computed(() =>
    this.planner
      .plan()
      .pendingReviews.slice(0, 4)
      .map((review) => ({ review, title: this.store.tree().itemById.get(review.itemId)?.title ?? '' })),
  );
  protected readonly lastNote = computed(() =>
    [...this.store.data().notes]
      .filter((note) => note.body.trim() || note.worked.trim() || note.next.trim())
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null,
  );
  protected readonly backupDays = computed(() => {
    const logs = this.store.logs();
    if (logs.length === 0) {
      return null;
    }
    const last = this.store.meta().lastExportAt ?? logs[0]?.startedAt ?? null;
    if (!last) {
      return null;
    }
    const days = diffDays(toDayKey(new Date(last), 0), this.store.today());
    return days >= BACKUP_REMINDER_DAYS ? days : null;
  });

  protected readonly hasSide = computed(
    () =>
      this.insights.tip() !== null ||
      this.reviews().length > 0 ||
      this.lastNote() !== null ||
      this.backupDays() !== null ||
      (this.backup.usage()?.ratio ?? 0) >= 0.8,
  );

  protected titleOf(block: IPlannedBlock | ITimeLog): string {
    if (!block.itemId) {
      return 'Свободное творчество';
    }
    return this.store.tree().itemById.get(block.itemId)?.title ?? 'Топик в архиве';
  }

  protected sectionOf(block: IPlannedBlock): { readonly title: string; readonly color: string } {
    const section = block.sectionId ? this.store.tree().sectionById.get(block.sectionId) : undefined;
    return section ? { title: section.title, color: `sectionDot_${section.colorToken}` } : { title: 'Творчество', color: 'sectionDot_none' };
  }

  protected start(block: IPlannedBlock): void {
    this.timer.start({ itemId: block.itemId, type: block.type, plannedMin: block.plannedMin });
  }

  protected open(itemId: string | null): void {
    if (itemId) {
      this.ui.openItem(itemId);
    }
  }

  protected runTip(tip: ITip): void {
    this.insights.acceptTip(tip);
    switch (tip.action) {
      case 'startCreative':
        this.timer.start({ itemId: null, type: 'creative', plannedMin: 30 });
        break;
      case 'startShort': {
        const next = this.blocks()[0];
        this.timer.start(next ? { itemId: next.itemId, type: next.type, plannedMin: 20 } : { itemId: null, type: 'creative', plannedMin: 20 });
        break;
      }
      case 'openReviews':
      case 'markWeak':
        if (tip.itemId) {
          if (tip.action === 'markWeak') {
            this.program.updateItem(tip.itemId, { weakSpot: true });
          } else {
            this.ui.openItem(tip.itemId);
          }
        }
        break;
      case 'openProgram':
        void this.router.navigateByUrl('/program');
        break;
      case null:
        if (tip.itemId) {
          this.ui.openItem(tip.itemId);
        }
        break;
    }
  }

  protected tipAction(tip: ITip): string {
    switch (tip.action) {
      case 'startCreative':
        return 'Начать 30 мин';
      case 'startShort':
        return 'Старт 20 мин';
      case 'openReviews':
        return 'Открыть';
      case 'markWeak':
        return 'Отметить';
      case 'openProgram':
        return 'К программе';
      case null:
        return tip.itemId ? 'Открыть' : '';
    }
  }

  protected newNote(): void {
    this.ui.newNoteForItem.set(null);
  }
}
