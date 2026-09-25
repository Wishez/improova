import { ChangeDetectionStrategy, Component, HostListener, computed, inject } from '@angular/core';
import { TuiButton } from '@taiga-ui/core';
import { TimerService, UiStateService } from '../../services';
import { SESSION_TYPE_LABEL } from '../../utils';

/** Режим фокуса: таймер, фаза, задача сессии и поле заметки (FR-35). */
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

  protected readonly open = computed(() => this.ui.focusMode() && this.timer.running());
  protected readonly title = computed(() => {
    const state = this.timer.state();
    return this.timer.item()?.title ?? (state ? SESSION_TYPE_LABEL[state.type] : '');
  });
  protected readonly isStudy = computed(() => this.timer.state()?.type === 'study');

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
