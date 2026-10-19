import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TuiButton, TuiHint } from '@taiga-ui/core';
import { TimerService, UiStateService, CourseService } from '../../services';
import { SESSION_TYPE_LABEL } from '../../utils';
import { SESSION_TEXTS } from '../focus-overlay/session-texts';

/**
 * Мини-таймер на всех экранах (FR-10). В сессии с шагами вторая строка — активный шаг и его «X из Y мин»
 * или «+N сверх плана» (FR-53); без шагов — фаза шаблона FR-12, как в 1.5.
 */
@Component({
  selector: 'app-mini-timer',
  imports: [TuiButton, TuiHint],
  templateUrl: './mini-timer.component.html',
  styleUrl: './mini-timer.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MiniTimerComponent {
  protected readonly timer = inject(TimerService);
  protected readonly ui = inject(UiStateService);
  private readonly course = inject(CourseService);

  protected readonly stopText = SESSION_TEXTS['focus.stop'];
  protected readonly title = computed(() => {
    const state = this.timer.state();
    const item = this.timer.item();
    return item ? this.course.titleOf(item) : state ? SESSION_TYPE_LABEL[state.type] : '';
  });
  /** Строка активного шага: название (обрезается по П-2), число целиком и полное имя для читалки. */
  protected readonly step = computed(() => {
    const step = this.timer.activeStep();
    if (!step) {
      return null;
    }
    const over = step.overMin > 0;
    return {
      name: SESSION_TEXTS['miniTimer.step.name'](step),
      progress: over ? SESSION_TEXTS['miniTimer.step.over'](step) : SESSION_TEXTS['miniTimer.step.progress'](step),
      over,
      label: over ? SESSION_TEXTS['a11y.miniTimer.stepOver'](step) : SESSION_TEXTS['a11y.miniTimer.step'](step),
    };
  });
  protected readonly phase = computed(() => this.timer.phases()[this.timer.phaseIndex()] ?? null);
}
