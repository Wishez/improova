import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { TuiButton, TuiDialog } from '@taiga-ui/core';
import { MAX_LOG_MIN, TimerService, UiStateService } from '../../services';

/** Забытый таймер > 4 ч: сколько засчитать (FR-11). */
@Component({
  selector: 'app-forgotten-dialog',
  imports: [TuiDialog, TuiButton],
  template: `
    <ng-template
      [tuiDialog]="ui.forgottenOpen()"
      [tuiDialogOptions]="{ label: 'Таймер шёл ' + hours() + ' ч', size: 's', dismissible: false, closable: false }"
      (tuiDialogChange)="ui.forgottenOpen.set($event)"
    >
      <div class="dlg">
        <p class="dlg__subtitle">Похоже, его забыли остановить. Сколько засчитать?</p>
        <label class="field dlg__short">
          <span class="field__label">Минуты</span>
          <input class="input num" type="number" min="1" [max]="max" [value]="minutes()" (input)="onInput($event)" />
        </label>
        <div class="dlg__actions">
          <button tuiButton type="button" size="m" appearance="flat" (click)="discard()">Удалить сессию</button>
          <button tuiButton type="button" size="m" [disabled]="minutes() < 1" (click)="count()">Засчитать {{ minutes() }} мин</button>
        </div>
      </div>
    </ng-template>
  `,
  styleUrl: './dialogs.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ForgottenDialogComponent {
  protected readonly ui = inject(UiStateService);
  private readonly timer = inject(TimerService);
  protected readonly max = MAX_LOG_MIN;
  protected readonly minutes = signal(45);
  protected readonly hours = computed(() => Math.floor(this.timer.elapsedMin() / 60));

  constructor() {
    effect(() => {
      if (this.ui.forgottenOpen()) {
        this.minutes.set(this.timer.state()?.plannedMin || 45);
      }
    });
  }

  protected onInput(event: Event): void {
    const target = event.target;
    if (target instanceof HTMLInputElement) {
      this.minutes.set(Math.min(MAX_LOG_MIN, Math.max(0, Math.round(Number(target.value) || 0))));
    }
  }

  protected count(): void {
    this.ui.forgottenOpen.set(false);
    this.timer.stop(this.minutes());
  }

  protected discard(): void {
    this.ui.forgottenOpen.set(false);
    this.timer.discard();
  }
}
