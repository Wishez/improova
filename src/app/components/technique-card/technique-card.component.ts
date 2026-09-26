import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MarkdownInlinePipe } from '../../pipes';
import { COURSE_VERSION } from '../../seed';
import type { ITechnique } from '../../types';
import { ACCESS_LABEL } from '../../utils';

const LANG_LABEL = { ru: 'рус.', en: 'англ.' } as const;

/**
 * Карточка приёма (FR-47, FR-48): раскрывается на месте, не уводит со страницы и не трогает таймер.
 * Нативный <details>: клавиатура и состояние «раскрыто» для экранных читалок — из коробки.
 */
@Component({
  selector: 'app-technique-card',
  imports: [MarkdownInlinePipe],
  templateUrl: './technique-card.component.html',
  styleUrl: './technique-card.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TechniqueCardComponent {
  readonly technique = input.required<ITechnique>();
  /** Подпись перед названием: «Как делать» у шага, пусто — в списке приёмов. */
  readonly prefix = input('Как делать');

  protected readonly accessLabel = ACCESS_LABEL;
  protected readonly langLabel = LANG_LABEL;
  protected readonly courseVersion = COURSE_VERSION;
}
