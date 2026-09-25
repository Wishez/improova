import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TuiButton } from '@taiga-ui/core';

/** Пустое состояние: что здесь появится и одно действие (ТЗ 7.6). */
@Component({
  selector: 'app-empty-state',
  imports: [TuiButton],
  template: `
    <div class="empty">
      <div class="empty__title">{{ title() }}</div>
      @if (body()) {
        <p class="empty__body">{{ body() }}</p>
      }
      @if (cta()) {
        <button tuiButton type="button" size="s" appearance="secondary" (click)="action.emit()">{{ cta() }}</button>
      }
    </div>
  `,
  styleUrl: './empty-state.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EmptyStateComponent {
  readonly title = input.required<string>();
  readonly body = input('');
  readonly cta = input('');
  readonly action = output<void>();
}
