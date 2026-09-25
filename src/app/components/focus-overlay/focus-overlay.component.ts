import { ChangeDetectionStrategy, Component, HostListener, computed, inject } from '@angular/core';
import { TuiButton } from '@taiga-ui/core';
import { CourseService, TimerService, UiStateService } from '../../services';
import { SESSION_TYPE_LABEL } from '../../utils';

/** Режим фокуса: таймер, шаг ориентира или фаза, задача сессии и поле заметки (FR-35, FR-38). */
@Component({
  selector: 'app-focus-overlay',
  imports: [TuiButton],
  templateUrl: './focus-overlay.component.html',
  styleUrl: './focus-overlay.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FocusOverlayComponent {
  protected readonly timer = inject(TimerService);
  protected readonly ui = inject(UiStateService);
  private readonly course = inject(CourseService);

  protected readonly open = computed(() => this.ui.focusMode() && this.timer.running());
  protected readonly title = computed(() => {
    const state = this.timer.state();
    const item = this.timer.item();
    return item ? this.course.titleOf(item) : state ? SESSION_TYPE_LABEL[state.type] : '';
  });
  protected readonly guide = computed(() => this.timer.item()?.guide ?? null);
  protected readonly task = computed(() => {
    const item = this.timer.item();
    return item ? this.course.taskOf(item) : '';
  });
  /** Главный референс: первый референс или первая ссылка ориентира. */
  protected readonly mainRef = computed(() => {
    const guide = this.guide();
    return guide?.references[0] ?? guide?.links[0] ?? null;
  });
  protected readonly step = computed(() => {
    const index = this.timer.phaseIndex();
    const phases = this.timer.phases();
    if (!this.timer.guideSteps() || index < 0) {
      return null;
    }
    const end = phases.slice(0, index + 1).reduce((sum, phase) => sum + phase.minutes, 0);
    return {
      remaining: Math.max(0, Math.ceil(end - this.timer.elapsed() / 60_000)),
      next: phases[index + 1]?.title ?? null,
    };
  });
  protected readonly isStudy = computed(() => this.timer.state()?.type === 'study');

  /** После «Следующий шаг» длительности дробные — показываем целые минуты. */
  protected round(minutes: number): number {
    return Math.round(minutes);
  }

  @HostListener('document:keydown.escape')
  protected close(): void {
    this.ui.focusMode.set(false);
  }

  protected onDraft(event: Event): void {
    const target = event.target;
    if (target instanceof HTMLTextAreaElement) {
      this.ui.sessionDraft.set(target.value);
    }
  }
}
