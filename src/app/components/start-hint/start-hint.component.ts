import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { IStartHint } from '../../services';

/** Неразрывный пробел: «шага {n}», «{done} из {plan} мин» не разрываются переносом («Тексты 1.6», «Числа не разрываются»). */
const NBSP = ' ';
/** « · » как в 1.5; строка подсказки переносится только после него («Тексты 1.6», «Правила текстов»). */
const SEPARATOR = `${NBSP}· `;

const unbroken = (text: string): string => text.replaceAll(' ', NBSP);

/**
 * Текст подсказки до старта по виду из сервиса подсказки (FR-58; вкладка «Тексты 1.6»): `startHint.continue`,
 * `startHint.continueZero`, `startHint.cycleDone`. null — подсказки нет: заглушек вроде «С шага 1» нет.
 */
export function startHintText(hint: IStartHint | null | undefined): string | null {
  switch (hint?.kind) {
    case 'continue':
      return `${unbroken(`Продолжить с шага ${hint.stepNumber}`)}${SEPARATOR}${unbroken(`уже ${hint.doneMin} из ${hint.planMin} мин`)}`;
    case 'continueZero':
      return unbroken(`Продолжить с шага ${hint.stepNumber}`);
    case 'cycleDone':
      return `${unbroken('Все шаги пройдены')}${SEPARATOR}${unbroken('начнём с шага 1')}`;
    default:
      return null;
  }
}

/**
 * Подсказка «с чего начать» у блока «Сегодня», в карточке топика и в быстром выборе (FR-58, Д-9): одна строка,
 * одинаковая в трёх местах. Без подсказки элемент скрыт, но остаётся целью `aria-describedby` кнопки «Старт».
 */
@Component({
  selector: 'app-start-hint',
  template: '{{ text() }}',
  styleUrl: './start-hint.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[hidden]': 'text() === null' },
})
export class StartHintComponent {
  readonly hint = input<IStartHint | null | undefined>(null);
  protected readonly text = computed(() => startHintText(this.hint()));
}
