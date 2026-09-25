import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TuiButton, TuiDialog } from '@taiga-ui/core';
import { TimerService, UiStateService, CourseService } from '../../services';
import { SESSION_TYPE_LABEL } from '../../utils';

/** Два таймера одновременно невозможны (US-02, негативный сценарий). */
@Component({
  selector: 'app-switch-confirm',
  imports: [TuiDialog, TuiButton],
  template: `
    <ng-template
      [tuiDialog]="ui.pendingStart() !== null"
      [tuiDialogOptions]="{ label: 'Идёт другая сессия', size: 's' }"
      (tuiDialogChange)="$event || ui.pendingStart.set(null)"
    >
      <div class="dlg">
        <p class="dlg__subtitle">Сейчас идёт «{{ current() }}», {{ timer.elapsedMin() }} мин. Остановить и начать новую сессию?</p>
        <div class="dlg__actions">
          <button tuiButton type="button" size="m" appearance="flat" (click)="ui.pendingStart.set(null)">Продолжить текущую</button>
          <button tuiButton type="button" size="m" (click)="timer.switchToPending()">Переключиться</button>
        </div>
      </div>
    </ng-template>
  `,
  styleUrl: './dialogs.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SwitchConfirmComponent {
  protected readonly ui = inject(UiStateService);
  protected readonly timer = inject(TimerService);
  private readonly course = inject(CourseService);
  protected readonly current = computed(() => {
    const state = this.timer.state();
    const item = this.timer.item();
    return item ? this.course.titleOf(item) : state ? SESSION_TYPE_LABEL[state.type] : '';
  });
}
