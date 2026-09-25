import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TuiButton, TuiHint } from '@taiga-ui/core';
import { TimerService, UiStateService } from '../../services';
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

  protected readonly title = computed(() => {
    const state = this.timer.state();
    return this.timer.item()?.title ?? (state ? SESSION_TYPE_LABEL[state.type] : '');
  });
  protected readonly phase = computed(() => this.timer.phases()[this.timer.phaseIndex()] ?? null);
}
