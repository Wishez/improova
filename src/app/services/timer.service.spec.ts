import { describe, expect, it } from 'vitest';
import { buildGuidePhases, stepBack, stepEnd } from './timer.service';

// «Изучение двух художников»: контекст 10, 10 работ 20, 3 штудии по 6 минут — 20, заметка 10
const steps = [
  { title: 'Контекст', minutes: 10 },
  { title: '10 работ', minutes: 20 },
  { title: '3 штудии по 6 минут', minutes: 20 },
  { title: 'Заметка', minutes: 10 },
];

describe('шаги ориентира в таймере (FR-38, баги 1 и 3)', () => {
  it('шаг длится столько, сколько в ориентире, без сжатия под блок плана', () => {
    const phases = buildGuidePhases({ steps, stepMinutes: null });
    expect(phases.map((phase) => phase.minutes)).toEqual([10, 20, 20, 10]);
    // Штудии заканчиваются на 50-й минуте, а не на 7-й
    expect(stepEnd(phases, 2)).toBe(50);
  });

  it('расписание после «Следующий шаг» берётся из таймера', () => {
    expect(buildGuidePhases({ steps, stepMinutes: [10, 5, 20, 25] }).map((phase) => phase.minutes)).toEqual([10, 5, 20, 25]);
  });

  it('битое расписание (другое число шагов) игнорируется (негативный)', () => {
    expect(buildGuidePhases({ steps, stepMinutes: [1, 2] }).map((phase) => phase.minutes)).toEqual([10, 20, 20, 10]);
  });

  it('«Предыдущий шаг» после раннего перехода возвращает недобранное время', () => {
    // Со 2-го шага ушли на 12-й минуте: 2-й шаг занял 2 мин вместо 20, 3-й идёт 3 минуты
    const minutes = stepBack({ minutes: [10, 2, 20, 28], planned: [10, 20, 20, 10], index: 2, elapsedMin: 15 });
    // Второй шаг снова активен ещё 18 мин, третий начнётся заново целиком, последний отдаёт взятые 18 мин
    expect(minutes).toEqual([10, 23, 20, 10]);
    const phases = buildGuidePhases({ steps, stepMinutes: minutes });
    expect(stepEnd(phases, 0)).toBeLessThan(15);
    expect(stepEnd(phases, 1)).toBe(33);
  });

  it('если прошлый шаг прошёл полностью — даёт 5 минут', () => {
    expect(stepBack({ minutes: [10, 20, 20, 10], planned: [10, 20, 20, 10], index: 1, elapsedMin: 12 })).toEqual([17, 20, 20, 10]);
  });

  it('с первого шага назад не уйти (негативный)', () => {
    expect(stepBack({ minutes: [10, 20], planned: [10, 20], index: 0, elapsedMin: 3 })).toEqual([10, 20]);
  });
});
