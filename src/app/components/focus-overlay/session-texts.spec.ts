import { describe, expect, it } from 'vitest';
import type { ITimerStepView } from '../../services';
import { SESSION_TEXTS, stepOptionName, stepProgressText } from './session-texts';

const NBSP = ' ';

function view(params: { readonly done: number; readonly plan: number; readonly active?: boolean; readonly title?: string }): ITimerStepView {
  return {
    index: 1,
    title: params.title ?? '10 работ в высоком разрешении',
    planMin: params.plan,
    doneMin: params.done,
    overMin: Math.max(0, params.done - params.plan),
    active: params.active ?? false,
  };
}

describe('тексты сессии 1.6 — по вкладке «Тексты 1.6»', () => {
  it('ТК-Н18: «мин» не склоняется, числа 1, 2, 5, 21, 250 целые, группа числа не разрывается переносом', () => {
    for (const value of [1, 2, 5, 21, 250]) {
      expect(SESSION_TEXTS['focus.steps.progress'](view({ done: value, plan: 250 }))).toBe(`${value}${NBSP}из${NBSP}250${NBSP}мин`);
      expect(SESSION_TEXTS['focus.session.limit'](value)).toBe(`Сессия · ${value}${NBSP}мин`);
      expect(SESSION_TEXTS['guide.steps.total'](value)).toBe(`Шаги сессии — ${value}${NBSP}мин по плану, шаг переключаешь сам`);
    }
  });

  it('ТД-14: «250 из 15 мин · +235 сверх плана» в списке, «+235 сверх плана» в мини-таймере', () => {
    const step = view({ done: 250, plan: 15 });
    expect(stepProgressText(step)).toBe(`250${NBSP}из${NBSP}15${NBSP}мин · +235${NBSP}сверх${NBSP}плана`);
    expect(SESSION_TEXTS['miniTimer.step.over'](step)).toBe(`+235${NBSP}сверх${NBSP}плана`);
    expect(stepProgressText(view({ done: 20, plan: 20 }))).toBe(`20${NBSP}из${NBSP}20${NBSP}мин`);
  });

  it('минуты целые, с округлением вниз: дробный лимит 59,9 → «59 мин»', () => {
    expect(SESSION_TEXTS['focus.session.over'](59.9)).toBe(`Время сессии вышло · 59${NBSP}мин`);
  });

  it('имя шага для читалки: название целиком, переработка и «текущий» через запятую', () => {
    expect(stepOptionName(view({ done: 12, plan: 20 }))).toBe(`Шаг 2: 10 работ в высоком разрешении, 12${NBSP}из${NBSP}20${NBSP}мин`);
    expect(stepOptionName(view({ done: 27, plan: 20, active: true }))).toBe(
      `Шаг 2: 10 работ в высоком разрешении, 27${NBSP}из${NBSP}20${NBSP}мин, +7${NBSP}сверх${NBSP}плана, текущий`,
    );
  });

  it('П-1 в строке «Дальше»: название до 53 знаков — целиком, длиннее — первые 52 знака без пробела на конце и «…»', () => {
    const course = 'Разбор: порядок слоёв, тёмное и светлое, жёсткие края';
    expect(course).toHaveLength(53);
    expect(SESSION_TEXTS['focus.stepBar.next'](course)).toBe(`Дальше: ${course}`);
    expect(SESSION_TEXTS['focus.stepBar.next'](`${course}!`)).toBe(`Дальше: ${course.slice(0, 52)}…`);
  });

  it('ни один текст не предлагает добавить или продлить время (Q-010)', () => {
    const step = view({ done: 27, plan: 20, active: true });
    const shown = [
      SESSION_TEXTS['focus.steps.label'],
      SESSION_TEXTS['focus.stepBar.last'],
      SESSION_TEXTS['focus.step.prev'],
      SESSION_TEXTS['focus.step.next'],
      SESSION_TEXTS['focus.stop'],
      SESSION_TEXTS['focus.session.over'](45),
      SESSION_TEXTS['focus.stepBar.next'](step.title),
      stepProgressText(step),
      stepOptionName(step),
      SESSION_TEXTS['a11y.miniTimer.stepOver'](step),
    ];
    expect(shown.filter((entry) => /\+5\s|добав|продл/iu.test(entry))).toEqual([]);
  });
});
