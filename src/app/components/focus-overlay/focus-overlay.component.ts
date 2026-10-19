import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, HostListener, afterRenderEffect, computed, inject, untracked, viewChild } from '@angular/core';
import { TuiButton } from '@taiga-ui/core';
import { CourseService, SessionDraftService, TimerService, UiStateService, type ITimerStepView } from '../../services';
import { SESSION_TYPE_LABEL } from '../../utils';
import { GuideCardComponent } from '../guide-card/guide-card.component';
import { LessonInfoComponent } from '../lesson-info/lesson-info.component';
import { MarkdownEditorComponent } from '../markdown-editor/markdown-editor.component';
import { SESSION_TEXTS, stepOptionName, stepProgressText } from './session-texts';

/**
 * Режим фокуса: таймер, шаги ориентира, задание, конспект в markdown и ориентир рядом —
 * всё для сессии на одном экране (FR-35, FR-38). В сессии с шагами — список шагов с накопленным за круг (FR-53):
 * шаг выбирается в списке мышью и с клавиатуры или кнопками «Предыдущий / Следующий шаг», и на паузе тоже (FR-52).
 * Без шагов — фазы шаблона FR-12, как в 1.5 (Д-1).
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
  private readonly document = inject(DOCUMENT);
  private readonly dialog = viewChild<ElementRef<HTMLElement>>('dialog');
  /** Элемент, с которого открыли режим фокуса: фокус возвращается на него после закрытия. */
  private opener: HTMLElement | null = null;

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
  /** Активный шаг для карточки ориентира рядом; null — сессия без шагов. */
  protected readonly activeStep = computed(() => {
    const index = this.timer.activeStepIndex();
    return index >= 0 ? index : null;
  });
  protected readonly isStudy = computed(() => this.timer.state()?.type === 'study');

  constructor() {
    // Открытый режим фокуса получает фокус: с клавиатуры и для читалки работа идёт внутри него, а не под ним
    afterRenderEffect(() => {
      const dialog = this.dialog()?.nativeElement ?? null;
      untracked(() => this.moveFocus(dialog));
    });
  }

  protected progress(step: ITimerStepView): string {
    return stepProgressText(step);
  }

  protected optionName(step: ITimerStepView): string {
    return stepOptionName(step);
  }

  /** Открылся — фокус на диалог, закрылся — обратно на элемент, с которого открыли, если он ещё на странице. */
  private moveFocus(dialog: HTMLElement | null): void {
    if (dialog) {
      const active = this.document.activeElement;
      if (!dialog.contains(active)) {
        this.opener = active instanceof HTMLElement && active !== this.document.body ? active : null;
        dialog.focus();
      }
      return;
    }
    const opener = this.opener;
    this.opener = null;
    if (opener?.isConnected) {
      opener.focus();
    }
  }

  @HostListener('document:keydown.escape')
  protected close(): void {
    this.drafts.flush();
    this.ui.focusMode.set(false);
  }
}
