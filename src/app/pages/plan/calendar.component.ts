import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, input, output, signal, viewChild } from '@angular/core';
import { TuiButton } from '@taiga-ui/core';
import { calendarMonths, dayOf, type ICalendarDay, type TCalendarState } from '../../domain';
import { MinutesPipe } from '../../pipes';
import { CourseService, DataStore, PlanService, UiStateService } from '../../services';
import { addDays, formatDayLong, formatMinutes, formatMonth, weekdayIndex, weekdayShort } from '../../utils';

export type TCalendarView = 'month' | 'year';

const STATE_LABEL: Record<TCalendarState, string> = {
  done: 'выполнен',
  partial: 'частично',
  missed: 'пропущен',
  off: 'выходной',
  today: 'сегодня',
  planned: 'запланирован',
  projected: 'прогноз',
};

/** Календарь всего челленджа: вид «Месяц» и «Год» (FR-36). */
@Component({
  selector: 'app-calendar',
  imports: [TuiButton, MinutesPipe],
  templateUrl: './calendar.component.html',
  styleUrl: './calendar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CalendarComponent {
  readonly view = input.required<TCalendarView>();
  readonly viewChange = output<TCalendarView>();

  private readonly store = inject(DataStore);
  private readonly planner = inject(PlanService);
  private readonly course = inject(CourseService);
  protected readonly ui = inject(UiStateService);
  private readonly grid = viewChild<ElementRef<HTMLElement>>('grid');

  protected readonly weekdays = [0, 1, 2, 3, 4, 5, 6].map((index) => weekdayShort(index));
  protected readonly stateLabel = STATE_LABEL;
  protected readonly legendStates: readonly TCalendarState[] = ['done', 'partial', 'missed', 'today', 'planned', 'projected', 'off'];
  protected readonly days = this.planner.calendar;
  protected readonly months = computed(() => calendarMonths(this.days()));
  protected readonly byDate = computed(() => new Map(this.days().map((day) => [day.date, day])));
  protected readonly selected = signal<string>(this.store.today());
  protected readonly monthIndex = computed(() => {
    const key = this.selected().slice(0, 7);
    const index = this.months().findIndex((month) => month.key === key);
    return Math.max(0, index);
  });
  protected readonly month = computed(() => this.months()[this.monthIndex()] ?? null);
  protected readonly selectedDay = computed(() => this.byDate().get(this.selected()) ?? null);
  protected readonly summary = computed(() => {
    const today = this.store.today();
    const past = this.days().filter((day) => day.date < today && day.planMin > 0);
    const done = past.filter((day) => day.state === 'done').length;
    return { passed: past.length, done, total: this.days().length, index: Math.max(0, this.days().findIndex((day) => day.date === today)) + 1 };
  });
  private focusRequested = false;

  constructor() {
    effect(() => {
      // Выбранный день всегда в пределах периода
      const days = this.days();
      const first = days[0];
      const last = days[days.length - 1];
      const current = this.selected();
      if (first && last && (current < first.date || current > last.date)) {
        this.selected.set(current < first.date ? first.date : last.date);
      }
    });
    effect(() => {
      this.selected();
      if (this.focusRequested) {
        this.focusRequested = false;
        queueMicrotask(() => this.grid()?.nativeElement.querySelector<HTMLElement>('[tabindex="0"]')?.focus());
      }
    });
  }

  protected pads(count: number): number[] {
    return Array.from({ length: count }, (_, index) => index);
  }

  protected title(key: string): string {
    return formatMonth(key);
  }

  protected label(day: ICalendarDay): string {
    const minutes =
      day.state === 'projected' || day.state === 'planned'
        ? `план ${formatMinutes(day.planMin)}`
        : day.planMin > 0
          ? `${formatMinutes(day.factMin)} из ${formatMinutes(day.planMin)}`
          : day.factMin > 0
            ? formatMinutes(day.factMin)
            : '';
    const markers = day.markers.map((marker) => marker.label).join(', ');
    return [formatDayLong(day.date), STATE_LABEL[day.state], minutes, markers].filter((part) => part.length > 0).join(', ');
  }

  protected dayNumber(date: string): number {
    return Number(date.slice(8, 10));
  }

  protected select(date: string): void {
    if (this.byDate().has(date)) {
      this.selected.set(date);
    }
  }

  protected openMonth(date: string): void {
    this.select(date);
    this.viewChange.emit('month');
  }

  protected shiftMonth(delta: number): void {
    const target = this.months()[this.monthIndex() + delta];
    if (!target) {
      return;
    }
    const first = target.cells.find((cell) => cell.day)?.date;
    if (first) {
      this.selected.set(first);
    }
  }

  protected goToday(): void {
    this.select(this.store.today());
  }

  /** Клавиатура сетки: стрелки, Home/End — неделя, PageUp/PageDown — месяц (НФТ доступности). */
  protected onKey(event: KeyboardEvent): void {
    const steps: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    const current = this.selected();
    let next: string | null = null;
    if (event.key in steps) {
      next = addDays(current, steps[event.key] ?? 0);
    } else if (event.key === 'Home' || event.key === 'End') {
      const weekday = weekdayIndex(current);
      next = addDays(current, event.key === 'Home' ? -weekday : 6 - weekday);
    } else if (event.key === 'PageUp' || event.key === 'PageDown') {
      next = addDays(current, event.key === 'PageUp' ? -28 : 28);
    }
    if (next && this.byDate().has(next)) {
      event.preventDefault();
      this.focusRequested = true;
      this.selected.set(next);
    }
  }

  // ——— Детали дня ———

  protected readonly dayLogs = computed(() => {
    const date = this.selected();
    const boundary = this.store.settings().dayBoundaryHour;
    const tree = this.store.tree();
    return this.store
      .logs()
      .filter((log) => dayOf(log, boundary) === date)
      .map((log) => ({ id: log.id, itemId: log.itemId, title: log.itemId ? (tree.itemById.get(log.itemId)?.title ?? 'Топик в архиве') : 'Свободное творчество', minutes: log.durationMin }));
  });

  protected readonly dayBlocks = computed(() => {
    const date = this.selected();
    const day = this.planner.plan().days.find((entry) => entry.date === date);
    const tree = this.store.tree();
    return (day?.blocks ?? []).map((block) => {
      const item = block.itemId ? tree.itemById.get(block.itemId) : undefined;
      return { key: block.key, itemId: block.itemId, title: item ? this.course.titleOf(item, date) : 'Свободное творчество', minutes: block.plannedMin };
    });
  });

  protected readonly daySections = computed(() => {
    const tree = this.store.tree();
    return (this.selectedDay()?.bySection ?? [])
      .map((entry) => {
        const section = entry.sectionId ? tree.sectionById.get(entry.sectionId) : undefined;
        return {
          key: entry.sectionId ?? 'creative',
          order: section?.order ?? Number.MAX_SAFE_INTEGER,
          title: section?.title ?? 'Творчество и повторения',
          color: section ? `sectionDot_${section.colorToken}` : 'sectionDot_none',
          minutes: entry.minutes,
        };
      })
      .sort((a, b) => a.order - b.order);
  });

  protected dayTitle(date: string): string {
    return formatDayLong(date);
  }
}
