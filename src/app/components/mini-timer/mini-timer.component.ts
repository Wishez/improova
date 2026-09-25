import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TuiButton, TuiHint } from '@taiga-ui/core';
import { TimerService, UiStateService, CourseService } from '../../services';
import { SESSION_TYPE_LABEL } from '../../utils';

/** Мини-таймер на всех экранах (FR-10). */
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

  protected readonly title = computed(() => {
    const state = this.timer.state();
    const item = this.timer.item();
    return item ? this.course.titleOf(item) : state ? SESSION_TYPE_LABEL[state.type] : '';
  });
  protected readonly phase = computed(() => this.timer.phases()[this.timer.phaseIndex()] ?? null);
}
