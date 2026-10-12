import { describe, expect, it } from 'vitest';
import type { IGuideStep, ILogSteps, ITimerState, ITimerSteps } from '../types';
import {
  MS_PER_MINUTE,
  editLogSteps,
  logStepMinutes,
  logStepsAtStop,
  migrateLegacyTimer,
  redistributeStepMinutes,
  stepMsToMinutes,
  stepProgress,
  timerFirstMinuteIndex,
  timerStepMs,
} from './step-minutes';

const min = (value: number): number => value * MS_PER_MINUTE;
const total = (values: readonly number[]): number => values.reduce((sum, value) => sum + value, 0);

function timerSteps(patch: Partial<ITimerSteps> = {}): ITimerSteps {
  return {
    activeIndex: 0,
    spentMs: [0, 0, 0],
    startIndex: 0,
    continuesCircle: false,
    circleId: 'circle',
    stepCount: 3,
    firstMinuteIndex: null,
    planSignaled: [],
    limitSignaled: false,
    ...patch,
  };
}

function timer(patch: Partial<ITimerState> = {}): ITimerState {
  return {
    itemId: 'item',
    type: 'practice',
    startedAt: '2026-10-12T10:00:00.000Z',
    pausedAt: null,
    pausedMs: 0,
    plannedMin: 45,
    stepMinutes: null,
    steps: timerSteps(),
    legacySchedule: false,
    ...patch,
  };
}

function logSteps(patch: Partial<ILogSteps> = {}): ILogSteps {
  return {
    minutes: [20, 15],
    startIndex: 0,
    stopIndex: 1,
    continuesCircle: false,
    circleId: 'circle',
    limitMin: 45,
    stepCount: 2,
    firstMinuteIndex: 0,
    ...patch,
  };
}

const guideSteps = (minutes: readonly number[]): IGuideStep[] => minutes.map((value, index) => ({ title: `Шаг ${index + 1}`, minutes: value }));

/** Детерминированный генератор для проверки свойств на многих входах. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

describe('время шагов идущей сессии (ADR-007, ITimerSteps)', () => {
  it('активному шагу идёт elapsed − Σ spentMs, сумма шагов равна часам сессии', () => {
    const steps = timerSteps({ activeIndex: 1, spentMs: [min(10), min(2), 0] });
    const ms = timerStepMs(steps, min(25));
    expect(ms).toEqual([min(10), min(15), 0]);
    expect(total(ms)).toBe(min(25));
  });

  it('шаг, добавленный в ориентир во время сессии, получает свой индекс', () => {
    expect(timerStepMs(timerSteps({ activeIndex: 4, spentMs: [min(1), min(2)] }), min(5))).toEqual([min(1), min(2), 0, 0, min(2)]);
  });

  it('у активного шага не бывает отрицательного времени', () => {
    expect(timerStepMs(timerSteps({ activeIndex: 2, spentMs: [min(3), min(3), 0] }), min(5))).toEqual([min(3), min(3), 0]);
  });
});

describe('шаг, первым набравший 1 мин (Q-021; ADR-007, правило 6)', () => {
  it('записанное значение не меняется, сколько бы ни набрал активный шаг', () => {
    expect(timerFirstMinuteIndex(timerSteps({ activeIndex: 2, spentMs: [min(1), 0, 0], firstMinuteIndex: 0 }), min(30))).toBe(0);
  });

  it('шаг сменили до первой минуты: первую минуту набирает тот, кто дошёл до неё первым', () => {
    const steps = timerSteps({ activeIndex: 1, spentMs: [30_000, 0, 0] });
    expect(timerFirstMinuteIndex(steps, 30_000 + 59_999)).toBeNull();
    expect(timerFirstMinuteIndex(steps, 30_000 + 60_000)).toBe(1);
  });

  it('ни один шаг не набрал 1 мин — null', () => {
    expect(timerFirstMinuteIndex(timerSteps({ activeIndex: 2, spentMs: [50_000, 50_000, 0] }), 150_000)).toBeNull();
  });
});

describe('мс шагов → минуты при «Стоп» (ADR-007, правило 7)', () => {
  it('ТК-А29: метод наибольшего остатка, сумма — минуты лога round(elapsed / 60 000)', () => {
    expect(stepMsToMinutes([119_999, 30_001, 30_000])).toEqual([2, 1, 0]);
    expect(stepMsToMinutes([min(20), min(10), min(15)])).toEqual([20, 10, 15]);
    expect(stepMsToMinutes([10_000, 10_000])).toEqual([0, 0]);
  });

  it('ТК-А29: на любых сменах шага в дробные секунды сумма шагов равна минутам лога, шаг отличается от своих мс меньше чем на минуту', () => {
    const next = random(7);
    for (let run = 0; run < 500; run += 1) {
      const stepMs = Array.from({ length: 1 + Math.floor(next() * 8) }, () => next() * min(40));
      const minutes = stepMsToMinutes(stepMs);
      expect(total(minutes)).toBe(Math.round(total(stepMs) / MS_PER_MINUTE));
      minutes.forEach((value, index) => expect(Math.abs(value - (stepMs[index] ?? 0) / MS_PER_MINUTE)).toBeLessThan(1));
    }
  });

  it('при равных остатках минута достаётся шагу с меньшим номером', () => {
    expect(stepMsToMinutes([30_000, 30_000])).toEqual([1, 0]);
  });
});

describe('правка минут лога по Д-7 (FR-64)', () => {
  it('ТК-А17: таймер забыт на 5 ч, 10 / 290 мин, засчитано 45 — 10 / 35', () => {
    expect(redistributeStepMinutes({ minutes: [10, 290], stopIndex: 1, totalMin: 45 })).toEqual([10, 35]);
  });

  it('ТК-А17: 35 мин (20 / 15, остановка на шаге 2) → 30 → 40', () => {
    const thirty = redistributeStepMinutes({ minutes: [20, 15], stopIndex: 1, totalMin: 30 });
    expect(thirty).toEqual([20, 10]);
    expect(redistributeStepMinutes({ minutes: thirty, stopIndex: 1, totalMin: 40 })).toEqual([20, 20]);
  });

  it('ТК-А17: конец сессии на 10 мин раньше — 10 мин сняты с шага остановки', () => {
    expect(editLogSteps(logSteps({ minutes: [20, 15], stopIndex: 1 }), 25).minutes).toEqual([20, 5]);
  });

  it('ТК-А17: не хватает шага остановки — дальше с остальных шагов от большего номера к меньшему', () => {
    expect(redistributeStepMinutes({ minutes: [5, 6, 3, 4], stopIndex: 1, totalMin: 8 })).toEqual([5, 0, 3, 0]);
    expect(redistributeStepMinutes({ minutes: [5, 6, 3, 4], stopIndex: 1, totalMin: 2 })).toEqual([2, 0, 0, 0]);
  });

  it('ТК-А17: сумма минут шагов после правки всегда равна минутам лога', () => {
    const next = random(11);
    for (let run = 0; run < 500; run += 1) {
      const minutes = Array.from({ length: 1 + Math.floor(next() * 8) }, () => Math.floor(next() * 120));
      const stopIndex = Math.floor(next() * minutes.length);
      const totalMin = 1 + Math.floor(next() * 720);
      const result = redistributeStepMinutes({ minutes, stopIndex, totalMin });
      expect(total(result)).toBe(totalMin);
      expect(result.every((value) => value >= 0)).toBe(true);
    }
  });

  it('правка не меняет шаг, первым набравший 1 мин, даже если его минуты стали 0 (Д-28, Q-025)', () => {
    const steps = logSteps({ minutes: [10, 290], stopIndex: 1, firstMinuteIndex: 1 });
    const edited = editLogSteps(steps, 5);
    expect(edited).toEqual({ ...steps, minutes: [5, 0] });
    expect(edited.firstMinuteIndex).toBe(1);
    expect(steps.minutes).toEqual([10, 290]);
  });

  it('длина не бывает отрицательной; пустые минуты остаются пустыми', () => {
    expect(redistributeStepMinutes({ minutes: [3, 4], stopIndex: 0, totalMin: -5 })).toEqual([0, 0]);
    expect(redistributeStepMinutes({ minutes: [], stopIndex: 0, totalMin: 10 })).toEqual([]);
  });
});

describe('минуты шагов лога (ADR-007, правило 4)', () => {
  it('ручной лог и лог до 1.6 — без шагов', () => {
    expect(logStepMinutes({ durationMin: 30, steps: null })).toBeNull();
    expect(logStepMinutes({ durationMin: 30 })).toBeNull();
  });

  it('сумма совпадает с минутами лога — минуты как записаны', () => {
    const steps = logSteps({ minutes: [20, 15] });
    expect(logStepMinutes({ durationMin: 35, steps })).toBe(steps.minutes);
  });

  it('лог правили в 1.5 после отката — минуты шагов выравниваются по Д-7', () => {
    expect(logStepMinutes({ durationMin: 30, steps: logSteps({ minutes: [20, 15], stopIndex: 1 }) })).toEqual([20, 10]);
    expect(logStepMinutes({ durationMin: 50, steps: logSteps({ minutes: [20, 15], stopIndex: 0 }) })).toEqual([35, 15]);
  });
});

describe('сведения о шагах при «Стоп», «Переключиться», «Засчитать» (FR-56)', () => {
  it('«Стоп» на 45-й минуте: минуты шагов 20 / 10 / 15, шаг остановки 3, лимит 45 (US-24, критерий 3)', () => {
    const steps = logStepsAtStop({
      timer: timer({ plannedMin: 45, steps: timerSteps({ activeIndex: 2, spentMs: [min(20), min(10), 0], firstMinuteIndex: 0 }) }),
      elapsedMs: min(45),
      durationMin: 45,
    });
    expect(steps).toEqual({
      minutes: [20, 10, 15],
      startIndex: 0,
      stopIndex: 2,
      continuesCircle: false,
      circleId: 'circle',
      limitMin: 45,
      stepCount: 3,
      firstMinuteIndex: 0,
    });
  });

  it('«Засчитать» 45 мин после 5 ч: шаги 10 / 35, продолжение круга и шаг старта переходят из таймера', () => {
    const steps = logStepsAtStop({
      timer: timer({
        plannedMin: 45,
        steps: timerSteps({ activeIndex: 1, spentMs: [min(10), 0], stepCount: 2, startIndex: 1, continuesCircle: true, circleId: 'c1', firstMinuteIndex: 0 }),
      }),
      elapsedMs: min(300),
      durationMin: 45,
    });
    expect(steps?.minutes).toEqual([10, 35]);
    expect(steps).toMatchObject({ startIndex: 1, stopIndex: 1, continuesCircle: true, circleId: 'c1', firstMinuteIndex: 0 });
  });

  it('ни один шаг не набрал 1 мин — шага первой минуты нет, а минута лога разложена по шагам', () => {
    const steps = logStepsAtStop({ timer: timer({ steps: timerSteps({ activeIndex: 2, spentMs: [30_000, 30_000, 0] }) }), elapsedMs: 70_000, durationMin: 1 });
    expect(steps?.firstMinuteIndex).toBeNull();
    expect(steps?.minutes).toEqual([1, 0, 0]);
  });

  it('шаг первой минуты, ещё не записанный в таймере, берётся по правилу 6 на момент «Стоп»', () => {
    const steps = logStepsAtStop({ timer: timer({ steps: timerSteps({ activeIndex: 1, spentMs: [20_000, 0, 0] }) }), elapsedMs: min(3), durationMin: 3 });
    expect(steps?.firstMinuteIndex).toBe(1);
  });

  it('минут шагов не меньше числа шагов при старте; сессия без шагов — null', () => {
    const steps = logStepsAtStop({ timer: timer({ steps: timerSteps({ activeIndex: 0, spentMs: [], stepCount: 3 }) }), elapsedMs: min(5), durationMin: 5 });
    expect(steps?.minutes).toEqual([5, 0, 0]);
    expect(logStepsAtStop({ timer: timer({ steps: null }), elapsedMs: min(5), durationMin: 5 })).toBeNull();
  });
});

describe('«X из Y мин» и «+N сверх плана» (FR-53)', () => {
  it('целые минуты с округлением вниз; переработка — только сверх плана', () => {
    expect(stepProgress({ circleMin: 12, sessionMs: 0, planMin: 20 })).toEqual({ doneMin: 12, planMin: 20, overMin: 0 });
    expect(stepProgress({ circleMin: 12, sessionMs: 59_999, planMin: 20 }).doneMin).toBe(12);
    expect(stepProgress({ circleMin: 12, sessionMs: min(15), planMin: 20 })).toEqual({ doneMin: 27, planMin: 20, overMin: 7 });
    expect(stepProgress({ circleMin: 0, sessionMs: min(20), planMin: 20 }).overMin).toBe(0);
  });
});

describe('перевод таймера 1.5 (FR-65, US-32)', () => {
  /** Таймер 1.5 — без полей `steps` и `legacySchedule`, как его хранит 1.5 (ДТ-14). */
  const legacy = (patch: Partial<ITimerState>): ITimerState => ({
    itemId: 'item',
    type: 'practice',
    startedAt: '2026-10-12T10:00:00.000Z',
    pausedAt: null,
    pausedMs: 0,
    plannedMin: 90,
    stepMinutes: null,
    ...patch,
  });

  it('ТК-А19: 20 / 10 / 60, лимит 90, 25-я минута — активен шаг 2, шаг 1 — 20 мин, шаг 2 — 5 мин', () => {
    const migrated = migrateLegacyTimer({ timer: legacy({ plannedMin: 90 }), guideSteps: guideSteps([20, 10, 60]), elapsedMs: min(25), circleId: 'new' });
    expect(migrated.legacySchedule).toBe(false);
    expect(migrated.plannedMin).toBe(90);
    expect(migrated.steps).toEqual({
      activeIndex: 1,
      spentMs: [min(20), 0, 0],
      startIndex: 0,
      continuesCircle: false,
      circleId: 'new',
      stepCount: 3,
      firstMinuteIndex: 0,
      planSignaled: [0],
      limitSignaled: false,
    });
    expect(timerStepMs(migrated.steps ?? timerSteps(), min(25))).toEqual([min(20), min(5), 0]);
  });

  it('ТК-А19: расписание после «Предыдущий шаг» и «+5 мин» — шаг расписания 1.5, лимит прежний, сумма шагов равна часам', () => {
    // 1.5: на 22-й минуте «Предыдущий шаг» (шаг 1 → 27 мин), на 23-й «+5 мин» (шаг 1 → 32 мин), длина 102
    const timer15 = legacy({ plannedMin: 102, stepMinutes: [32, 10, 60] });
    const early = migrateLegacyTimer({ timer: timer15, guideSteps: guideSteps([20, 10, 60]), elapsedMs: min(25), circleId: 'new' });
    expect(early.steps?.activeIndex).toBe(0);
    expect(early.steps?.planSignaled).toEqual([0]);
    const late = migrateLegacyTimer({ timer: timer15, guideSteps: guideSteps([20, 10, 60]), elapsedMs: min(35), circleId: 'new' });
    expect(late.plannedMin).toBe(102);
    expect(late.steps?.activeIndex).toBe(1);
    const ms = timerStepMs(late.steps ?? timerSteps(), min(35));
    expect(ms).toEqual([min(32), min(3), 0]);
    expect(total(ms)).toBe(min(35));
  });

  it('ТК-А19: 40 / 15 / 5, лимит 60, 62-я минута — шаг 3 с 7 мин, сигналы лимита и шагов уже прозвучали (Д-21)', () => {
    const migrated = migrateLegacyTimer({ timer: legacy({ plannedMin: 60 }), guideSteps: guideSteps([40, 15, 5]), elapsedMs: min(62), circleId: 'new' });
    expect(migrated.legacySchedule).toBe(false);
    expect(migrated.steps?.activeIndex).toBe(2);
    expect(timerStepMs(migrated.steps ?? timerSteps(), min(62))).toEqual([min(40), min(15), min(7)]);
    expect(migrated.steps?.limitSignaled).toBe(true);
    expect(migrated.steps?.planSignaled).toEqual([0, 1, 2]);
  });

  it('расписание другой длины, чем ориентир, не берётся — шаги по плановым минутам, как в 1.5', () => {
    const migrated = migrateLegacyTimer({ timer: legacy({ stepMinutes: [5, 5] }), guideSteps: guideSteps([20, 10, 60]), elapsedMs: min(12), circleId: 'new' });
    expect(migrated.steps?.activeIndex).toBe(0);
  });

  it('граница шага с допуском 1.5: время шагов до активного не больше прошедшего', () => {
    const elapsedMs = min(20) - 5;
    const migrated = migrateLegacyTimer({ timer: legacy({ plannedMin: 90 }), guideSteps: guideSteps([20, 10, 60]), elapsedMs, circleId: 'new' });
    expect(migrated.steps?.activeIndex).toBe(1);
    expect(total(timerStepMs(migrated.steps ?? timerSteps(), elapsedMs))).toBe(elapsedMs);
  });

  it('меньше минуты — шага первой минуты нет; топик без шагов ориентира — сессия без шагов', () => {
    expect(migrateLegacyTimer({ timer: legacy({}), guideSteps: guideSteps([20, 10]), elapsedMs: 40_000, circleId: 'new' }).steps?.firstMinuteIndex).toBeNull();
    const plain = migrateLegacyTimer({ timer: legacy({ plannedMin: 30 }), guideSteps: [], elapsedMs: min(10), circleId: 'new' });
    expect(plain.steps).toBeNull();
    expect(plain.legacySchedule).toBe(false);
    expect(plain.plannedMin).toBe(30);
  });

  it('после перевода «Стоп» пишет новый круг с шага 1 и минутами по расписанию 1.5', () => {
    const migrated = migrateLegacyTimer({ timer: legacy({ plannedMin: 90 }), guideSteps: guideSteps([20, 10, 60]), elapsedMs: min(25), circleId: 'new' });
    expect(logStepsAtStop({ timer: migrated, elapsedMs: min(25), durationMin: 25 })).toMatchObject({
      minutes: [20, 5, 0],
      startIndex: 0,
      stopIndex: 1,
      continuesCircle: false,
      circleId: 'new',
      limitMin: 90,
      stepCount: 3,
    });
  });
});
