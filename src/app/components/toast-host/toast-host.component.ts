import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TuiButton } from '@taiga-ui/core';
import { ToastService } from '../../services';

/** Тосты с «Отменить» и полосой оставшегося времени (ТЗ 7.4). */
@Component({
  selector: 'app-toast-host',
  imports: [TuiButton],
  template: `
    <div class="toasts" role="status" aria-live="polite">
      @for (toast of toasts.toasts(); track toast.id) {
        <div class="toast" [class.toast_error]="toast.kind === 'error'" [class.toast_success]="toast.kind === 'success'">
          <span class="toast__text">{{ toast.text }}</span>
          @if (toast.action; as action) {
            <button tuiButton type="button" size="xs" appearance="flat" class="toast__action" (click)="toasts.runAction(toast)">
              {{ action.label }}
            </button>
          }
          <button type="button" class="toast__close" aria-label="Закрыть" (click)="toasts.dismiss(toast.id)">×</button>
          <span class="toast__timer" [style.animation-duration.ms]="toast.durationMs"></span>
        </div>
      }
    </div>
  `,
  styleUrl: './toast-host.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ToastHostComponent {
  protected readonly toasts = inject(ToastService);
}
