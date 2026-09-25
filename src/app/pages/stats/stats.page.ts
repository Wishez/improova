import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { TuiBarChart, TuiRingChart } from '@taiga-ui/addon-charts';
import { TuiSegmented } from '@taiga-ui/kit';
import { EmptyStateComponent, HeatmapComponent, LogListComponent } from '../../components';
import { estimateAccuracy, minutesByDay, minutesBySection, minutesByType, weeklyPlan } from '../../domain';
import { DayShortPipe, MinutesPipe, Percent100Pipe } from '../../pipes';
import { DataStore, InsightsService, UiStateService } from '../../services';
import type { ITimeLog, TSessionType } from '../../types';
import { RESOURCE_TYPE_LABEL, SESSION_TYPE_LABEL, addDays, formatDayShort, toDayKey, weekStart, weekdayShort } from '../../utils';

type TPeriod = 'week' | 'month' | 'all';

interface IColumn {
  readonly label: string;
  readonly from: string;
  readonly to: string;
  readonly plan: number;
  readonly fact: number;
}

const PERIODS: readonly { readonly id: TPeriod; readonly label: string }[] = [
  { id: 'week', label: 'Неделя' },
  { id: 'month', label: 'Месяц' },
  { id: 'all', label: 'Весь челлендж' },
];

/** Статистика: план/факт, метрики, тепловая карта, доли, прогноз (FR-24…FR-26). */
@Component({
  selector: 'app-stats-page',
  imports: [TuiBarChart, TuiRingChart, TuiSegmented, HeatmapComponent, LogListComponent, EmptyStateComponent, MinutesPipe, Percent100Pipe, DayShortPipe],
  templateUrl: './stats.page.html',
  styleUrl: './stats.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StatsPage {
  protected readonly store = inject(DataStore);
  protected readonly insights = inject(InsightsService);
  protected readonly ui = inject(UiStateService);

  protected readonly periods = PERIODS;
  protected readonly period = signal<TPeriod>('month');
  protected readonly periodIndex = computed(() => PERIODS.findIndex((entry) => entry.id === this.period()));
  protected readonly selected = signal<number | null>(null);
  protected readonly typeLabel = SESSION_TYPE_LABEL;
  protected readonly resourceTypeLabel: Readonly<Record<string, string>> = { ...RESOURCE_TYPE_LABEL, none: 'Без ресурса' };
  protected readonly hasLogs = computed(() => this.store.logs().length > 0);
  private readonly boundary = computed(() => this.store.settings().dayBoundaryHour);

  private readonly dayOf = (log: ITimeLog): string => toDayKey(new Date(log.startedAt), this.boundary());

  protected readonly columns = computed<IColumn[]>(() => {
    const today = this.store.today();
    const budget = this.store.budget();
    const byDay = minutesByDay(this.store.logs(), this.boundary());
    const sumRange = (from: string, to: string): number => {
      let total = 0;
      for (let day = from; day <= to; day = addDays(day, 1)) {
        total += byDay.get(day) ?? 0;
      }
      return total;
    };
    if (this.period() === 'week') {
      const start = weekStart(today);
      return Array.from({ length: 7 }, (_, index) => {
        const day = addDays(start, index);
        return { label: weekdayShort(index), from: day, to: day, plan: budget.dayCapacity[index] ?? 0, fact: byDay.get(day) ?? 0 };
      });
    }
    const plan = weeklyPlan(budget);
    const lastWeek = weekStart(today);
    const firstWeek = this.period() === 'month' ? addDays(lastWeek, -28) : weekStart(this.store.challenge().startDate);
    const columns: IColumn[] = [];
    for (let week = firstWeek; week <= lastWeek; week = addDays(week, 7)) {
      const to = addDays(week, 6);
      columns.push({ label: formatDayShort(week), from: week, to, plan, fact: sumRange(week, to) });
    }
    return columns.slice(-53);
  });
  protected readonly chartValue = computed(() => [this.columns().map((column) => column.plan), this.columns().map((column) => column.fact)]);
  protected readonly chartMax = computed(() => Math.max(60, ...this.columns().flatMap((column) => [column.plan, column.fact])));
  protected readonly periodFrom = computed(() => this.columns()[0]?.from ?? this.store.today());
  protected readonly periodLogs = computed(() => {
    const from = this.periodFrom();
    return this.store.logs().filter((log) => this.dayOf(log) >= from);
  });
  protected readonly selectedLogs = computed(() => {
    const index = this.selected();
    const column = index === null ? null : this.columns()[index];
    return column ? this.store.logs().filter((log) => this.dayOf(log) >= column.from && this.dayOf(log) <= column.to) : [];
  });
  protected readonly selectedColumn = computed(() => {
    const index = this.selected();
    return index === null ? null : (this.columns()[index] ?? null);
  });

  protected readonly bySection = computed(() => {
    const tree = this.store.tree();
    const map = minutesBySection(tree, this.periodLogs());
    return [...map.entries()]
      .map(([id, minutes]) => {
        const section = id ? tree.sectionById.get(id) : undefined;
        return { id: id ?? 'creative', title: section?.title ?? (id ? 'Архив' : 'Творчество'), color: section ? section.colorToken : 0, minutes };
      })
      .sort((a, b) => b.minutes - a.minutes);
  });
  /** Цвета кольца совпадают с цветами разделов. */
  protected readonly ringStyle = computed(() =>
    this.bySection()
      .map((entry, index) => `--tui-chart-categorical-${String(index).padStart(2, '0')}: var(${entry.color ? `--color-section-${entry.color}` : '--color-accent'})`)
      .join('; '),
  );
  protected readonly weeksToFact = computed(() => {
    const first = this.store.logs()[0];
    const days = first ? Math.max(0, Math.round((Date.now() - Date.parse(first.startedAt)) / 86_400_000)) : 0;
    return Math.max(1, 4 - Math.floor(days / 7));
  });
  protected readonly ringValue = computed(() => this.bySection().map((entry) => entry.minutes));
  protected readonly ringTotal = computed(() => this.ringValue().reduce((sum, value) => sum + value, 0));
  protected readonly byType = computed(() => {
    const values = minutesByType(this.periodLogs());
    const total = Object.values(values).reduce((sum, value) => sum + value, 0);
    const types: readonly TSessionType[] = ['study', 'practice', 'creative', 'review'];
    return types.map((type) => ({ type, minutes: values[type], share: total > 0 ? values[type] / total : 0 }));
  });
  protected readonly accuracy = computed(() =>
    estimateAccuracy({ items: this.store.data().items, logs: this.store.logs(), resources: this.store.resourcesById() }),
  );
  protected readonly byDay = computed(() => minutesByDay(this.store.logs(), this.boundary()));
  protected readonly sectionEtas = computed(() => {
    const tree = this.store.tree();
    return [...this.insights.forecast().bySection.entries()].map(([id, eta]) => ({ id, title: tree.sectionById.get(id)?.title ?? '', eta }));
  });

  protected setPeriod(index: number): void {
    this.period.set(PERIODS[index]?.id ?? 'month');
    this.selected.set(null);
  }

  protected tap(index: number): void {
    this.selected.set(this.selected() === index ? null : index);
  }
}
