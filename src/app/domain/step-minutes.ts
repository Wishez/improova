import type { ILogSteps, ITimeLog, ITimerState, ITimerSteps } from '../types';

/**
 * Минуты шагов сессии (FR-53, FR-56, FR-64; ADR-007, правила 4, 6–8): время шагов идущей сессии,
 * шаг, первым набравший 1 мин, перевод мс в минуты при «Стоп» и правка минут лога по Д-7.
 */

export const MS_PER_MINUTE = 60_000;

const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0);

/**
 * Время каждого шага идущей сессии, мс (ADR-007, `ITimerSteps`): `spentMs`, а активному шагу ещё
 * `elapsed − Σ spentMs`, не меньше 0. Сумма всегда равна часам сессии без пауз.
 */
export function timerStepMs(steps: Pick<ITimerSteps, 'activeIndex' | 'spentMs'>, elapsedMs: number): number[] {
  const result = [...steps.spentMs];
  while (result.length <= steps.activeIndex) {
    result.push(0);
  }
  result[steps.activeIndex] = (result[steps.activeIndex] ?? 0) + Math.max(0, elapsedMs - sum(steps.spentMs));
  return result;
}

/**
 * Шаг, первым набравший 1 мин, на текущий момент (Q-021; ADR-007, правило 6): записанное значение,
 * а пока записан null — активный шаг, если его время в сессии ≥ 60 000 мс, иначе null.
 * Пауза времени не добавляет: `elapsedMs` — часы сессии без пауз.
 */
export function timerFirstMinuteIndex(
  steps: Pick<ITimerSteps, 'activeIndex' | 'spentMs' | 'firstMinuteIndex'>,
  elapsedMs: number,
): number | null {
  if (steps.firstMinuteIndex !== null) {
    return steps.firstMinuteIndex;
  }
  const activeMs = timerStepMs(steps, elapsedMs)[steps.activeIndex] ?? 0;
  return activeMs >= MS_PER_MINUTE ? steps.activeIndex : null;
}

/**
 * Мс шагов → целые минуты методом наибольшего остатка (ADR-007, правило 7). Сумма — `round(Σ мс / 60 000)`,
 * то есть минуты лога, как в `stop` 1.5. При равных остатках минута достаётся шагу с меньшим номером.
 */
export function stepMsToMinutes(stepMs: readonly number[]): number[] {
  const safe = stepMs.map((ms) => Math.max(0, ms));
  const minutes = safe.map((ms) => Math.floor(ms / MS_PER_MINUTE));
  const order = safe
    .map((ms, index) => ({ index, rest: ms - (minutes[index] ?? 0) * MS_PER_MINUTE }))
    .sort((a, b) => b.rest - a.rest || a.index - b.index);
  let left = Math.round(sum(safe) / MS_PER_MINUTE) - sum(minutes);
  for (const entry of order) {
    if (left <= 0) {
      break;
    }
    minutes[entry.index] = (minutes[entry.index] ?? 0) + 1;
    left -= 1;
  }
  return minutes;
}

/**
 * Минуты шагов под новую длину сессии (Д-7, FR-64): меньше — разница снимается с шага остановки, затем с остальных
 * шагов от большего номера к меньшему; больше — прибавляется к шагу остановки. Сумма результата равна `totalMin`.
 */
export function redistributeStepMinutes(params: {
  readonly minutes: readonly number[];
  readonly stopIndex: number;
  readonly totalMin: number;
}): number[] {
  const minutes = [...params.minutes];
  if (minutes.length === 0) {
    return minutes;
  }
  const stop = Math.min(Math.max(0, params.stopIndex), minutes.length - 1);
  let diff = Math.max(0, params.totalMin) - sum(minutes);
  if (diff >= 0) {
    minutes[stop] = (minutes[stop] ?? 0) + diff;
    return minutes;
  }
  const order = [stop, ...minutes.map((_, index) => minutes.length - 1 - index).filter((index) => index !== stop)];
  for (const index of order) {
    const take = Math.min(minutes[index] ?? 0, -diff);
    minutes[index] = (minutes[index] ?? 0) - take;
    diff += take;
  }
  return minutes;
}

/**
 * Минуты шагов лога (ADR-007, правило 4) — единственное чтение `steps.minutes` для места и накопленного.
 * Сумма не равна `durationMin` (лог правили в 1.5 после отката) — разница раскладывается по Д-7.
 * null — лог без шагов: ручной, до 1.6 или сессия без ориентира (FR-65).
 */
export function logStepMinutes(log: Pick<ITimeLog, 'durationMin' | 'steps'>): readonly number[] | null {
  const steps = log.steps;
  if (!steps) {
    return null;
  }
  if (sum(steps.minutes) === log.durationMin) {
    return steps.minutes;
  }
  return redistributeStepMinutes({ minutes: steps.minutes, stopIndex: steps.stopIndex, totalMin: log.durationMin });
}

/**
 * Правка минут лога (FR-64; ADR-007, правило 8): минуты шагов следуют за новой длиной по Д-7.
 * Шаг, первым набравший 1 мин, и остальные сведения не меняются, даже если минуты этого шага стали 0 (Д-28, Q-025).
 */
export function editLogSteps(steps: ILogSteps, durationMin: number): ILogSteps {
  return {
    ...steps,
    minutes: redistributeStepMinutes({ minutes: steps.minutes, stopIndex: steps.stopIndex, totalMin: durationMin }),
  };
}

/**
 * Сведения о шагах лога при «Стоп», «Переключиться» и «Засчитать» (FR-56; ADR-007, правила 6 и 7).
 * Минуты шагов — мс таймера методом наибольшего остатка; засчитано другое число (`durationMin`) — разница по Д-7.
 * Шаг остановки — активный, шаг первой минуты — по правилу 6 на момент «Стоп», лимит — `plannedMin` таймера.
 * null — сессия без шагов ориентира.
 */
export function logStepsAtStop(params: {
  readonly timer: ITimerState;
  readonly elapsedMs: number;
  /** Минуты лога: `round(elapsed / 60 000)` или засчитанное число. */
  readonly durationMin: number;
}): ILogSteps | null {
  const steps = params.timer.steps;
  if (!steps) {
    return null;
  }
  const stepMs = timerStepMs(steps, params.elapsedMs);
  while (stepMs.length < steps.stepCount) {
    stepMs.push(0);
  }
  return {
    minutes: redistributeStepMinutes({ minutes: stepMsToMinutes(stepMs), stopIndex: steps.activeIndex, totalMin: params.durationMin }),
    startIndex: steps.startIndex,
    stopIndex: steps.activeIndex,
    continuesCircle: steps.continuesCircle,
    circleId: steps.circleId,
    limitMin: params.timer.plannedMin,
    stepCount: steps.stepCount,
    firstMinuteIndex: timerFirstMinuteIndex(steps, params.elapsedMs),
  };
}

export interface IStepProgress {
  /** Накоплено шагом за круг: целые минуты с округлением вниз (FR-53). */
  readonly doneMin: number;
  /** Плановые минуты шага из текущего ориентира (FR-63). */
  readonly planMin: number;
  /** Переработка `doneMin − planMin`, когда накоплено больше плана; иначе 0 (FR-53). */
  readonly overMin: number;
}

/**
 * Числа «X из Y мин» и «+N сверх плана» шага (FR-53): одни и те же в подсказке до старта и в сессии (US-25, критерий 2).
 * `circleMin` — накоплено прошлыми сессиями круга, `sessionMs` — время шага в идущей сессии (0 до старта).
 */
export function stepProgress(params: { readonly circleMin: number; readonly sessionMs: number; readonly planMin: number }): IStepProgress {
  const doneMin = Math.floor((params.circleMin * MS_PER_MINUTE + Math.max(0, params.sessionMs)) / MS_PER_MINUTE);
  return { doneMin, planMin: params.planMin, overMin: Math.max(0, doneMin - params.planMin) };
}
