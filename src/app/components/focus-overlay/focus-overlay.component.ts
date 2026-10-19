import { ChangeDetectionStrategy, Component, HostListener, computed, inject } from '@angular/core';
import { TuiButton } from '@taiga-ui/core';
import { CourseService, SessionDraftService, TimerService, UiStateService, type ITimerStepView } from '../../services';
import { SESSION_TYPE_LABEL } from '../../utils';
import { GuideCardComponent } from '../guide-card/guide-card.component';
import { LessonInfoComponent } from '../lesson-info/lesson-info.component';
import { MarkdownEditorComponent } from '../markdown-editor/markdown-editor.component';
import { SESSION_TEXTS, stepProgressText } from './session-texts';

/**
 * Режим фокуса: таймер, шаги ориентира, задание, конспект в markdown и ориентир рядом —
 * всё для сессии на одном экране (FR-35, FR-38). В сессии с шагами — список шагов с накопленным за круг (FR-53);
 * без шагов — фазы шаблона FR-12, как в 1.5 (Д-1).
 */
@Component({
  selector: 'app-focus-overlay',
  imports: [TuiButton, GuideCardComponent, LessonInfoComponent, MarkdownEditorComponent],
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
  protected readonly texts = SESSION_TEXTS;
  protected readonly over = computed(() => this.timer.totalMin() > 0 && this.timer.elapsed() >= this.timer.totalMin() * 60_000);
  /** Строка под часами: лимит — длина при старте (FR-55); после лимита кнопки продления нет, только «Стоп» (Q-010). */
  protected readonly limitText = computed(() => {
    const limit = this.timer.totalMin();
    return this.over() ? this.texts['focus.session.over'](limit) : this.texts['focus.session.limit'](limit);
  });
  /** Активный шаг и соседи для строки у кнопок смены шага; null — сессия без шагов ориентира. */
  protected readonly bar = computed(() => {
    const views = this.timer.stepViews();
    const active = views.find((view) => view.active);
    return active ? { active, prev: views[active.index - 1] ?? null, next: views[active.index + 1] ?? null, count: views.length } : null;
  });
  protected readonly isStudy = computed(() => this.timer.state()?.type === 'study');

  protected progress(step: ITimerStepView): string {
    return stepProgressText(step);
  }

  @HostListener('document:keydown.escape')
  protected close(): void {
    this.drafts.flush();
    this.ui.focusMode.set(false);
  }
}
