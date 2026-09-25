import { afterRenderEffect, ChangeDetectionStrategy, Component, computed, ElementRef, input, viewChild } from '@angular/core';
import { heatmapGrid } from '../../domain';
import { formatDayShort, formatMinutes } from '../../utils';

const LEVELS = [0, 30, 60, 120] as const;

/** Тепловая карта активности за год: 53 × 7, 5 уровней (ТЗ 7.5). */
@Component({
  selector: 'app-heatmap',
  template: `
    <div #scroller class="heatmap" role="img" [attr.aria-label]="summary()">
      @for (column of grid(); track column[0]?.date) {
        <div class="heatmap__col">
          @for (cell of column; track cell.date) {
            <span
              class="heatmap__cell"
              [class.heatmap__cell_future]="cell.future"
              [class.heatmap__cell_today]="cell.date === today()"
              [attr.data-level]="level(cell.minutes)"
              [attr.title]="cell.future ? null : label(cell.date, cell.minutes)"
            ></span>
          }
        </div>
      }
    </div>
    <div class="legend" aria-hidden="true">
      <span>меньше</span>
      @for (level of legend; track level) {
        <span class="heatmap__cell" [attr.data-level]="level"></span>
      }
      <span>больше</span>
    </div>
  `,
  styleUrl: './heatmap.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HeatmapComponent {
  readonly byDay = input.required<ReadonlyMap<string, number>>();
  readonly today = input.required<string>();
  protected readonly legend = [0, 1, 2, 3, 4];
  private readonly scroller = viewChild.required<ElementRef<HTMLElement>>('scroller');
  protected readonly grid = computed(() => heatmapGrid({ byDay: this.byDay(), today: this.today() }));
  protected readonly summary = computed(() => {
    const active = [...this.byDay().values()].filter((minutes) => minutes > 0).length;
    return `Активность за год: ${active} дней с занятиями`;
  });

  constructor() {
    // На узком экране год не помещается: показываем последние недели, как в календаре активности
    afterRenderEffect(() => {
      this.grid();
      const element = this.scroller().nativeElement;
      element.scrollLeft = element.scrollWidth;
    });
  }

  protected level(minutes: number): number {
    if (minutes <= LEVELS[0]) {
      return 0;
    }
    return minutes < LEVELS[1] ? 1 : minutes < LEVELS[2] ? 2 : minutes < LEVELS[3] ? 3 : 4;
  }

  protected label(date: string, minutes: number): string {
    return `${formatDayShort(date)}: ${minutes > 0 ? formatMinutes(minutes) : 'нет занятий'}`;
  }
}
