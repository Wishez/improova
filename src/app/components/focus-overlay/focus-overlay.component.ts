import { ChangeDetectionStrategy, Component, HostListener, computed, inject } from '@angular/core';
import { TuiButton } from '@taiga-ui/core';
import { CourseService, SessionDraftService, TimerService, UiStateService, stepEnd } from '../../services';
import { SESSION_TYPE_LABEL } from '../../utils';
import { GuideCardComponent } from '../guide-card/guide-card.component';
import { MarkdownEditorComponent } from '../markdown-editor/markdown-editor.component';

/**
 * Режим фокуса: таймер, шаги ориентира, задание, конспект в markdown и ориентир рядом —
 * всё для сессии на одном экране (FR-35, FR-38).
 */
@Component({
  selector: 'app-focus-overlay',
  imports: [TuiButton, GuideCardComponent, MarkdownEditorComponent],
  templateUrl: './focus-overlay.component.html',
  styleUrl: './focus-overlay.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FocusOverlayComponent {
  protected readonly timer = inject(TimerService);
  protected readonly ui = inject(UiStateService);
  protected readonly drafts = inject(SessionDraftService);
  private readonly course = inject(CourseService);

  protected readonly open = computed(() => this.ui.focusMode() && this.timer.running());
  protected readonly item = this.timer.item;
  protected readonly title = computed(() => {
    const state = this.timer.state();
    const item = this.timer.item();
    return item ? this.course.titleOf(item) : state ? SESSION_TYPE_LABEL[state.type] : '';
  });
  protected readonly task = computed(() => {
    const item = this.timer.item();
    return item ? this.course.taskOf(item) : '';
  });
  protected readonly over = computed(() => this.timer.totalMin() > 0 && this.timer.elapsed() >= this.timer.totalMin() * 60_000);
  protected readonly step = computed(() => {
    const index = this.timer.phaseIndex();
    const phases = this.timer.phases();
    if (!this.timer.guideSteps() || index < 0) {
      return null;
    }
    return {
      remaining: Math.max(0, Math.ceil(stepEnd(phases, index) - this.timer.elapsed() / 60_000)),
      next: phases[index + 1]?.title ?? null,
      hasPrevious: index > 0,
    };
  });
  protected readonly isStudy = computed(() => this.timer.state()?.type === 'study');

  /** После смены шагов длительности дробные — показываем целые минуты. */
  protected round(minutes: number): number {
    return Math.round(minutes);
  }

  @HostListener('document:keydown.escape')
  protected close(): void {
    this.drafts.flush();
    this.ui.focusMode.set(false);
  }
}
