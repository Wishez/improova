import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TuiIcon } from '@taiga-ui/core';
import { InsightsService } from '../../services';

/** Анимация вехи ≤ 1,2 с, без конфетти на весь экран (FR-23). */
@Component({
  selector: 'app-celebration',
  imports: [TuiIcon],
  template: `
    @if (insights.celebration(); as milestone) {
      <div class="celebration" role="status" aria-live="polite">
        <span class="celebration__ring" aria-hidden="true"><tui-icon icon="@tui.sparkles" /></span>
        <div>
          <div class="celebration__label">Веха</div>
          <div class="celebration__title">{{ milestone.title }}</div>
        </div>
      </div>
    }
  `,
  styleUrl: './celebration.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CelebrationComponent {
  protected readonly insights = inject(InsightsService);
}
