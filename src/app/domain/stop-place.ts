import type { IItem, ILogSteps, IRouteBlock, ITimeLog, TSessionType } from '../types';
import { toDayKey } from '../utils';
import { challengeWeek, routeFocus } from './course';
import { logStepMinutes } from './step-minutes';

/**
 * Место остановки, круг и шаг старта (FR-57…FR-63; ADR-007, правила 1–3 и 5). Место не хранится:
 * оно всегда считается по учитываемым логам, поэтому после правки, удаления, «Отменить» и импорта
 * совпадает с расчётом заново. Шаг старта и вид подсказки даёт одна функция `stepStart` —
 * её берут и таймер, и подсказка (Д-27).
 */

/** Календарь челленджа, по которому считается период повторяющегося топика (FR-61). */
export interface IStepCalendar {
  /** Дата старта челленджа, YYYY-MM-DD: недели считаются от неё. */
  readonly challengeStart: string;
  readonly routeBlocks: readonly IRouteBlock[];
  /** Час границы дня из настроек (`settings.dayBoundaryHour`): день сессии — день её начала с этой границей. */
  readonly boundaryHour: number;
}

/** Учитываемый лог: у него всегда есть сведения о шагах. */
export type TCountedLog = ITimeLog & { readonly steps: ILogSteps };

const COUNTED_TYPES: ReadonlySet<TSessionType> = new Set<TSessionType>(['study', 'practice']);

/**
 * Учитываемый лог топика (FR-57, FR-60, FR-62, FR-65; ADR-007, правило 1): сессия таймера типа «Учёба» или «Практика»
 * со сведениями о шагах, не удалённая, у топика нет дня контрольной. Не учитываются ручные логи, логи до 1.6,
 * «Повторение» и сессии контрольных работ.
 */
export function isCountedLog(log: ITimeLog, item: Pick<IItem, 'id' | 'checkpointDay'>): log is TCountedLog {
  return (
    log.itemId === item.id &&
    item.checkpointDay === null &&
    log.source === 'timer' &&
    COUNTED_TYPES.has(log.type) &&
    log.steps != null &&
    !log.deletedAt
  );
}

const byStart = (a: ITimeLog, b: ITimeLog): number => a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id);

/**
 * Учитываемые логи по топикам, по началу сессии (ADR-007, правило 2) — один проход по логам, чтобы подсказки
 * всех топиков считались ≤ 100 мс на 3000 топиков и 10 000 логов (НФТ «Время отклика»).
 */
export function countedLogsByItem(params: {
  readonly logs: readonly ITimeLog[];
  readonly items: readonly IItem[];
}): ReadonlyMap<string, readonly TCountedLog[]> {
  const items = new Map(params.items.map((item) => [item.id, item]));
  const result = new Map<string, TCountedLog[]>();
  for (const log of params.logs) {
    const item = log.itemId === null ? undefined : items.get(log.itemId);
    if (!item || !isCountedLog(log, item)) {
      continue;
    }
    const list = result.get(item.id);
    if (list) {
      list.push(log);
    } else {
      result.set(item.id, [log]);
    }
  }
  for (const list of result.values()) {
    list.sort(byStart);
  }
  return result;
}

/**
 * Период повторяющегося топика на день (FR-61, Д-18): «изучение» — неделя челленджа, «копия» — блок маршрута,
 * свой повторяющийся топик и копия в неделю без блока — отрезок по N недель от недели 1, N — интервал повторения.
 * Возвращает ключ: равные ключи — один период. null — топик не повторяется, место от дня не зависит (Д-8).
 * `day` — ключ дня с границей дня (`toDayKey`); неделя до старта челленджа считается первой, как неделя маршрута.
 */
export function recurrencePeriod(params: {
  readonly item: Pick<IItem, 'recurrenceWeeks' | 'routeRole'>;
  readonly day: string;
  readonly calendar: IStepCalendar;
}): string | null {
  const { item, day, calendar } = params;
  if (item.recurrenceWeeks === null) {
    return null;
  }
  const week = Math.max(1, challengeWeek(calendar.challengeStart, day));
  if (item.routeRole === 'study') {
    return `week:${week}`;
  }
  if (item.routeRole === 'copy') {
    const focus = routeFocus(calendar.routeBlocks, week);
    if (focus) {
      return `route:${focus.block.id}`;
    }
  }
  const span = Math.max(1, item.recurrenceWeeks);
  return `weeks${span}:${Math.floor((week - 1) / span)}`;
}

/** Период сессии лога: день её начала с границей дня (FR-61). */
function logPeriod(log: ITimeLog, item: Pick<IItem, 'recurrenceWeeks' | 'routeRole'>, calendar: IStepCalendar): string | null {
  if (item.recurrenceWeeks === null) {
    return null;
  }
  return recurrencePeriod({ item, day: toDayKey(new Date(log.startedAt), calendar.boundaryHour), calendar });
}

/** Последний по началу учитываемый лог топика, у которого совпадает условие (ADR-007, правило 2). */
function lastCounted(item: IItem, logs: readonly ITimeLog[], match: (log: TCountedLog) => boolean): TCountedLog | null {
  let last: TCountedLog | null = null;
  for (const log of logs) {
    if (isCountedLog(log, item) && match(log) && (!last || byStart(log, last) > 0)) {
      last = log;
    }
  }
  return last;
}

/** Сумма минут шагов (правило 4) по логам круга `circleId` в периоде `period`, по шагам текущего ориентира. */
function accumulate(params: {
  readonly item: IItem;
  readonly logs: readonly ITimeLog[];
  readonly circleId: string;
  readonly period: string | null;
  readonly calendar: IStepCalendar;
  readonly stepCount: number;
}): number[] {
  const { item, circleId, period, calendar } = params;
  const accumulated = Array.from({ length: params.stepCount }, () => 0);
  for (const log of params.logs) {
    if (!isCountedLog(log, item) || log.steps.circleId !== circleId || (period !== null && logPeriod(log, item, calendar) !== period)) {
      continue;
    }
    const minutes = logStepMinutes(log) ?? [];
    for (let index = 0; index < accumulated.length; index += 1) {
      accumulated[index] = (accumulated[index] ?? 0) + (minutes[index] ?? 0);
    }
  }
  return accumulated;
}

/**
 * Накоплено каждым шагом круга `circleId`, мин (FR-57; ADR-007, правило 3): сумма минут шагов учитываемых логов круга,
 * у повторяющегося топика — только в периоде последнего лога круга. Длина — число шагов текущего ориентира.
 * Для идущей сессии — накопленное прошлых сессий её круга: к нему прибавляется время шагов сессии (`stepProgress`).
 * Новый круг без логов — нули.
 */
export function circleMinutes(params: {
  readonly item: IItem;
  readonly logs: readonly ITimeLog[];
  readonly circleId: string;
  readonly calendar: IStepCalendar;
}): number[] {
  const { item, logs, circleId, calendar } = params;
  const stepCount = item.guide?.steps.length ?? 0;
  const last = lastCounted(item, logs, (log) => log.steps.circleId === circleId);
  if (!last) {
    return Array.from({ length: stepCount }, () => 0);
  }
  return accumulate({ item, logs, circleId, period: logPeriod(last, item, calendar), calendar, stepCount });
}

export interface IStopPlace {
  /** Круг места — `circleId` последней учитываемой сессии. */
  readonly circleId: string;
  /** Шаг остановки последней учитываемой сессии, индекс с 0; шага больше нет в ориентире — последний (FR-63). */
  readonly stopIndex: number;
  /** Накоплено каждым шагом текущего ориентира за круг, мин. */
  readonly accumulated: readonly number[];
  /** Круг пройден: остановка на последнем шаге и его накопленное не меньше плана текущего ориентира (FR-59, Д-3). */
  readonly circleDone: boolean;
  /** Число шагов ориентира при старте последней сессии: другое число сейчас — новый круг (FR-63). */
  readonly stepCount: number;
  /** Период последней сессии (FR-61); null — топик не повторяется. */
  readonly period: string | null;
}

/**
 * Место остановки топика (FR-57, FR-59; ADR-007, правила 2 и 3): шаг остановки последней учитываемой сессии
 * и накопленное её круга. null — учитываемых сессий нет или у топика нет шагов ориентира.
 * `logs` — логи топика (например, из `countedLogsByItem`) или все логи: чужие и неучитываемые отбрасываются.
 */
export function stopPlace(params: { readonly item: IItem; readonly logs: readonly ITimeLog[]; readonly calendar: IStepCalendar }): IStopPlace | null {
  const { item, logs, calendar } = params;
  const plan = item.guide?.steps ?? [];
  const last = plan.length > 0 ? lastCounted(item, logs, () => true) : null;
  if (!last) {
    return null;
  }
  const period = logPeriod(last, item, calendar);
  const accumulated = accumulate({ item, logs, circleId: last.steps.circleId, period, calendar, stepCount: plan.length });
  const lastIndex = plan.length - 1;
  const stopIndex = Math.min(Math.max(0, last.steps.stopIndex), lastIndex);
  const circleDone = stopIndex === lastIndex && (accumulated[lastIndex] ?? 0) >= (plan[lastIndex]?.minutes ?? 0);
  return { circleId: last.steps.circleId, stopIndex, accumulated, circleDone, stepCount: last.steps.stepCount, period };
}

/**
 * Сработавшее правило FR-58 (первое по порядку): контрольная, «Повторение», топик пройден, новый период,
 * другое число шагов, круг пройден, продолжение с места, учитываемых сессий нет.
 */
export type TStepStartRule =
  | 'checkpoint'
  | 'review'
  | 'itemDone'
  | 'newPeriod'
  | 'stepCountChanged'
  | 'circleDone'
  | 'continue'
  | 'noSessions';

export interface IStepStart {
  /**
   * Правило FR-58. Подсказка есть только у двух: 'continue' — «Продолжить с шага N · уже X из Y мин»
   * (N = startIndex + 1, X = accumulated[startIndex], при X = 0 — «Продолжить с шага N»); 'circleDone' — «Все шаги пройдены · начнём с шага 1».
   */
  readonly rule: TStepStartRule;
  /** Шаг старта, индекс с 0. */
  readonly startIndex: number;
  /** Сессия продолжает круг места (`ITimerSteps.continuesCircle`). */
  readonly continuesCircle: boolean;
  /** Круг места при продолжении; null — новый круг: id создаёт сервис (`createId()`). */
  readonly circleId: string | null;
  /** Накоплено каждым шагом к старту, мин: у продолжения — круг места, иначе нули (новый круг). */
  readonly accumulated: readonly number[];
}

/**
 * Шаг старта сессии и вид подсказки (FR-58; ADR-007, правило 5) — единственная функция для таймера при старте (З-8)
 * и подсказки до старта (З-9), поэтому они не расходятся (Д-27). null — у топика нет шагов ориентира:
 * сессия без шагов, шаблон фаз FR-12 (Д-1).
 * `type` — тип сессии (у блока плана — его тип, у карточки и быстрого выбора — вид топика); «Творчество» по топику
 * не бывает и, как «Повторение», не учитывается (FR-57). `day` — день старта с границей дня (`toDayKey`).
 */
export function stepStart(params: {
  readonly item: IItem;
  readonly type: TSessionType;
  readonly logs: readonly ITimeLog[];
  readonly day: string;
  readonly calendar: IStepCalendar;
}): IStepStart | null {
  const { item, type, logs, day, calendar } = params;
  const steps = item.guide?.steps ?? [];
  if (steps.length === 0) {
    return null;
  }
  const fresh = (rule: TStepStartRule): IStepStart => ({
    rule,
    startIndex: 0,
    continuesCircle: false,
    circleId: null,
    accumulated: steps.map(() => 0),
  });
  if (item.checkpointDay !== null) {
    return fresh('checkpoint');
  }
  if (!COUNTED_TYPES.has(type)) {
    return fresh('review');
  }
  if (item.doneAt !== null) {
    return fresh('itemDone');
  }
  const place = stopPlace({ item, logs, calendar });
  if (!place) {
    return fresh('noSessions');
  }
  if (place.period !== recurrencePeriod({ item, day, calendar })) {
    return fresh('newPeriod');
  }
  if (place.stepCount !== steps.length) {
    return fresh('stepCountChanged');
  }
  if (place.circleDone) {
    return fresh('circleDone');
  }
  return { rule: 'continue', startIndex: place.stopIndex, continuesCircle: true, circleId: place.circleId, accumulated: place.accumulated };
}
