import { shortStepTitle, type ITimerStepView } from '../../services';

/**
 * Числа с «из», «мин» и «сверх плана» не переносятся по частям: внутри неразрывные пробелы
 * (вкладка «Тексты 1.6», «Числа не разрываются»).
 */
const NBSP = ' ';

/** Минуты в текстах — целые, с округлением вниз, «мин» без склонения (FR-53, «Правила текстов»). */
function minutes(value: number): string {
  return `${Math.floor(value)}${NBSP}мин`;
}

/** {done} из {plan} мин — накоплено шагом за круг из плана. */
function progress(step: ITimerStepView): string {
  return `${Math.floor(step.doneMin)}${NBSP}из${NBSP}${minutes(step.planMin)}`;
}

/** +{over} сверх плана — переработка шага. */
function over(step: ITimerStepView): string {
  return `+${Math.floor(step.overMin)}${NBSP}сверх${NBSP}плана`;
}

/**
 * Тексты сессии 1.6 — словарь строк по ключам вкладки «Тексты 1.6» (НФТ «Локализация»): режим фокуса, мини-таймер,
 * имена для читалки. Формулировки вставляются как есть, другая — только правкой вкладки.
 * Название шага — данные: без кавычек и сокращений, кроме П-1 в строке «Дальше» (`shortStepTitle`); П-2 мини-таймера —
 * обрезка многоточием в стилях, полное название остаётся в имени для читалки.
 */
export const SESSION_TEXTS = {
  'focus.steps.progress': progress,
  'focus.steps.progressOver': (step: ITimerStepView): string => `${progress(step)} · ${over(step)}`,
  'focus.stepBar.next': (nextStep: string): string => `Дальше: ${shortStepTitle(nextStep)}`,
  'focus.stepBar.last': 'Последний шаг',
  'focus.session.limit': (limitMin: number): string => `Сессия · ${minutes(limitMin)}`,
  'focus.session.over': (limitMin: number): string => `Время сессии вышло · ${minutes(limitMin)}`,
  'focus.stop': 'Стоп',
  'miniTimer.step.name': (step: ITimerStepView): string => step.title,
  'miniTimer.step.progress': progress,
  'miniTimer.step.over': over,
  'a11y.miniTimer.step': (step: ITimerStepView): string => `Текущий шаг: ${step.title}, ${progress(step)}`,
  'a11y.miniTimer.stepOver': (step: ITimerStepView): string => `Текущий шаг: ${step.title}, ${over(step)}`,
};

/** Накоплено шагом в списке режима фокуса: focus.steps.progress или focus.steps.progressOver. */
export function stepProgressText(step: ITimerStepView): string {
  return step.overMin > 0 ? SESSION_TEXTS['focus.steps.progressOver'](step) : SESSION_TEXTS['focus.steps.progress'](step);
}
