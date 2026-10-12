import { describe, expect, it } from 'vitest';
import type { IItem, IRouteBlock, ITimeLog, TItemKind, TRouteRole } from '../types';
import { addDays, fromDayKey, toDayKey } from '../utils';
import { EMPTY_GUIDE } from './course';
import { stepProgress } from './step-minutes';
import {
  circleMinutes,
  countedLogsByItem,
  isCountedLog,
  recurrencePeriod,
  stepStart,
  stopPlace,
  type IStepCalendar,
  type IStepStart,
} from './stop-place';
import { itemFixture, logFixture } from './test-fixtures';

const BOUNDARY_HOUR = 4;
/** Понедельник; неделя челленджа N начинается с START + 7 × (N − 1). */
const START = '2026-08-31';
const weekDay = (week: number, offset = 0): string => addDays(START, 7 * (week - 1) + offset);
/** Момент по часам устройства: день и время, ISO UTC. */
const at = (day: string, hour: number, minute = 0): string => {
  const date = fromDayKey(day);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
};
const dayOf = (iso: string): string => toDayKey(new Date(iso), BOUNDARY_HOUR);

const calendar = (routeBlocks: readonly IRouteBlock[] = []): IStepCalendar => ({ challengeStart: START, routeBlocks, boundaryHour: BOUNDARY_HOUR });

function routeBlock(id: string, fromWeek: number, toWeek: number): IRouteBlock {
  return {
    id,
    createdAt: at(START, 9),
    updatedAt: at(START, 9),
    order: fromWeek,
    fromWeek,
    toWeek,
    artists: [],
    copyTask: 'Копия',
    copyTechnique: '',
    links: [],
    courseKey: null,
  };
}

/** Топик с ориентиром; по умолчанию 4 шага 10 / 20 / 20 / 10 мин, как «ТК: 4 шага» (ТД-2). */
function topic(params: {
  readonly id?: string;
  readonly steps?: readonly number[];
  readonly kind?: TItemKind;
  readonly checkpointDay?: number | null;
  readonly doneAt?: string | null;
  readonly recurrenceWeeks?: number | null;
  readonly routeRole?: TRouteRole | null;
}): IItem {
  const steps = params.steps ?? [10, 20, 20, 10];
  return {
    ...itemFixture({
      id: params.id ?? 'item',
      topicId: 'topic',
      kind: params.kind,
      checkpointDay: params.checkpointDay,
      doneAt: params.doneAt,
      recurrenceWeeks: params.recurrenceWeeks,
    }),
    routeRole: params.routeRole ?? null,
    guide: { ...EMPTY_GUIDE, goal: 'Цель', steps: steps.map((minutes, index) => ({ title: `Шаг ${index + 1}`, minutes })) },
  };
}

/** Лог сессии таймера со сведениями о шагах (ADR-007): `minutes` — минуты шагов, длина лога — их сумма. */
function session(params: {
  readonly id: string;
  readonly startedAt: string;
  readonly minutes: readonly number[];
  readonly stopIndex: number;
  readonly circleId: string;
  readonly itemId?: string;
  readonly type?: ITimeLog['type'];
  readonly startIndex?: number;
  readonly continuesCircle?: boolean;
  readonly stepCount?: number;
  readonly durationMin?: number;
}): ITimeLog {
  const durationMin = params.durationMin ?? params.minutes.reduce((sum, value) => sum + value, 0);
  return {
    ...logFixture({ id: params.id, itemId: params.itemId ?? 'item', type: params.type ?? 'study', startedAt: params.startedAt, minutes: durationMin }),
    steps: {
      minutes: params.minutes,
      startIndex: params.startIndex ?? 0,
      stopIndex: params.stopIndex,
      continuesCircle: params.continuesCircle ?? false,
      circleId: params.circleId,
      limitMin: 45,
      stepCount: params.stepCount ?? params.minutes.length,
      firstMinuteIndex: 0,
    },
  };
}

/** Место «шаг 3 · 12 из 20» (М-1): одна сессия нового круга, остановка на шаге 3. */
const placeLog = (patch: { readonly id?: string; readonly startedAt?: string; readonly itemId?: string } = {}): ITimeLog =>
  session({ id: patch.id ?? 'm1', itemId: patch.itemId, startedAt: patch.startedAt ?? at(weekDay(6), 18), minutes: [0, 0, 12, 0], stopIndex: 2, circleId: 'c1' });

function start(item: IItem, logs: readonly ITimeLog[], patch: { readonly day?: string; readonly type?: ITimeLog['type']; readonly routeBlocks?: readonly IRouteBlock[] } = {}): IStepStart | null {
  return stepStart({ item, type: patch.type ?? item.kind, logs, day: patch.day ?? weekDay(6, 6), calendar: calendar(patch.routeBlocks) });
}

const fresh = (rule: IStepStart['rule'], steps = 4): IStepStart => ({
  rule,
  startIndex: 0,
  continuesCircle: false,
  circleId: null,
  accumulated: Array.from({ length: steps }, () => 0),
});

describe('учитываемые логи (FR-57; ADR-007, правило 1)', () => {
  const item = topic({});

  it('учитываются сессии таймера «Учёба» и «Практика» со сведениями о шагах', () => {
    expect(isCountedLog(placeLog(), item)).toBe(true);
    expect(isCountedLog({ ...placeLog(), type: 'practice' }, item)).toBe(true);
  });

  it('не учитываются ручной лог, лог до 1.6, «Повторение», удалённый лог, чужой топик и контрольная', () => {
    const before16 = logFixture({ id: 'old', itemId: 'item', type: 'study', startedAt: at(weekDay(6), 10), minutes: 30 });
    expect(isCountedLog({ ...placeLog(), source: 'manual', steps: null }, item)).toBe(false);
    expect(isCountedLog(before16, item)).toBe(false);
    expect(isCountedLog({ ...placeLog(), steps: null }, item)).toBe(false);
    expect(isCountedLog({ ...placeLog(), type: 'review' }, item)).toBe(false);
    expect(isCountedLog({ ...placeLog(), type: 'creative' }, item)).toBe(false);
    expect(isCountedLog({ ...placeLog(), deletedAt: at(weekDay(6), 20) }, item)).toBe(false);
    expect(isCountedLog(placeLog({ itemId: 'other' }), item)).toBe(false);
    expect(isCountedLog(placeLog(), topic({ checkpointDay: 66 }))).toBe(false);
  });

  it('логи раскладываются по топикам один раз и упорядочены по началу сессии (правило 2)', () => {
    const late = session({ id: 'late', startedAt: at(weekDay(6, 2), 10), minutes: [5, 0, 0, 0], stopIndex: 0, circleId: 'c1' });
    const early = session({ id: 'early', startedAt: at(weekDay(6, 1), 10), minutes: [5, 0, 0, 0], stopIndex: 0, circleId: 'c1' });
    const other = session({ id: 'other', itemId: 'b', startedAt: at(weekDay(6), 10), minutes: [5, 0, 0, 0], stopIndex: 0, circleId: 'c2' });
    const creative = logFixture({ id: 'free', itemId: null, type: 'creative', startedAt: at(weekDay(6), 9), minutes: 30 });
    const orphan = session({ id: 'orphan', itemId: 'gone', startedAt: at(weekDay(6), 10), minutes: [5], stopIndex: 0, circleId: 'c3' });
    const grouped = countedLogsByItem({ logs: [late, other, creative, early, orphan], items: [item, topic({ id: 'b' })] });
    expect(grouped.get('item')?.map((log) => log.id)).toEqual(['early', 'late']);
    expect(grouped.get('b')?.map((log) => log.id)).toEqual(['other']);
    expect(grouped.has('gone')).toBe(false);
  });
});

describe('шаг старта и подсказка (FR-58)', () => {
  it('ТК-А15: место «шаг 3 · 12 из 20» у «Учёбы» и у «Практики» — «Продолжить с шага 3 · уже 12 из 20 мин»', () => {
    const kinds: readonly TItemKind[] = ['study', 'practice'];
    for (const kind of kinds) {
      const item = topic({ kind });
      const result = start(item, [{ ...placeLog(), type: kind }]);
      expect(result).toEqual({ rule: 'continue', startIndex: 2, continuesCircle: true, circleId: 'c1', accumulated: [0, 0, 12, 0] });
      expect(stepProgress({ circleMin: result?.accumulated[2] ?? 0, sessionMs: 0, planMin: item.guide?.steps[2]?.minutes ?? 0 })).toEqual({
        doneMin: 12,
        planMin: 20,
        overMin: 0,
      });
    }
  });

  it('ТК-А15: вторая сессия того же дня и сессия через три дня продолжают с места (Д-8)', () => {
    const item = topic({});
    expect(start(item, [placeLog()], { day: weekDay(6) })?.rule).toBe('continue');
    expect(start(item, [placeLog()], { day: weekDay(7, 2) })?.startIndex).toBe(2);
  });

  it('ТК-А15: ручной лог 30 мин подсказку не меняет', () => {
    const item = topic({});
    const manual: ITimeLog = { ...logFixture({ id: 'manual', itemId: 'item', type: 'study', startedAt: at(weekDay(6, 1), 10), minutes: 30 }), source: 'manual', steps: null };
    expect(start(item, [placeLog(), manual])).toEqual(start(item, [placeLog()]));
  });

  it('ТК-А15: только логи до 1.6 или логов нет — шаг 1 новым кругом, без подсказки', () => {
    const item = topic({});
    const before16 = Array.from({ length: 30 }, (_, index) =>
      logFixture({ id: `old${index}`, itemId: 'item', type: 'practice', startedAt: at(addDays(START, index), 10), minutes: 45 }),
    );
    expect(start(item, before16)).toEqual(fresh('noSessions'));
    expect(start(item, [])).toEqual(fresh('noSessions'));
  });

  it('ТК-А16: сессия с подсказкой копит минуты в тот же круг на любом шаге; сессия без подсказки — новый круг с нулями', () => {
    const item = topic({});
    const first = session({ id: 's1', startedAt: at(weekDay(6), 10), minutes: [10, 5, 12, 0], stopIndex: 2, circleId: 'c1' });
    const resumed = session({ id: 's2', startedAt: at(weekDay(6, 1), 10), minutes: [0, 8, 0, 0], stopIndex: 1, circleId: 'c1', startIndex: 2, continuesCircle: true });
    expect(start(item, [first, resumed])).toMatchObject({ rule: 'continue', startIndex: 1, circleId: 'c1', accumulated: [10, 13, 12, 0] });
    expect(circleMinutes({ item, logs: [first, resumed], circleId: 'c1', calendar: calendar() })).toEqual([10, 13, 12, 0]);

    const restarted = session({ id: 's3', startedAt: at(weekDay(6, 2), 10), minutes: [7, 0, 0, 0], stopIndex: 0, circleId: 'c2' });
    expect(start(item, [first, resumed, restarted])).toMatchObject({ rule: 'continue', startIndex: 0, circleId: 'c2', accumulated: [7, 0, 0, 0] });
    expect(circleMinutes({ item, logs: [first, resumed, restarted], circleId: 'new', calendar: calendar() })).toEqual([0, 0, 0, 0]);
  });

  it('ТК-А14: остановка на шаге 4 с 10 из 10 — «Все шаги пройдены», новый круг с шага 1, отметка «пройден» не ставится', () => {
    const item = topic({});
    const logs = [session({ id: 's1', startedAt: at(weekDay(6), 10), minutes: [10, 20, 20, 10], stopIndex: 3, circleId: 'c1' })];
    expect(start(item, logs)).toEqual(fresh('circleDone'));
    expect(stopPlace({ item, logs, calendar: calendar() })?.circleDone).toBe(true);
    expect(item.doneAt).toBeNull();
  });

  it('ТК-А14: круг закрывается по накопленному за несколько сессий', () => {
    const item = topic({});
    const logs = [
      session({ id: 's1', startedAt: at(weekDay(6), 10), minutes: [10, 20, 20, 4], stopIndex: 3, circleId: 'c1' }),
      session({ id: 's2', startedAt: at(weekDay(6, 1), 10), minutes: [0, 0, 0, 6], stopIndex: 3, circleId: 'c1', startIndex: 3, continuesCircle: true }),
    ];
    expect(start(item, logs)?.rule).toBe('circleDone');
  });

  it('ТК-А14: на шаге 4 с 6 из 10 — «Продолжить с шага 4 · уже 6 из 10 мин»', () => {
    const logs = [session({ id: 's1', startedAt: at(weekDay(6), 10), minutes: [10, 20, 20, 6], stopIndex: 3, circleId: 'c1' })];
    expect(start(topic({}), logs)).toMatchObject({ rule: 'continue', startIndex: 3, accumulated: [10, 20, 20, 6] });
  });

  it('ТК-А14: все шаги по плану, но остановка на шаге 2 с 25 из 20 — круг не закрыт', () => {
    const logs = [session({ id: 's1', startedAt: at(weekDay(6), 10), minutes: [10, 25, 20, 10], stopIndex: 1, circleId: 'c1' })];
    expect(start(topic({}), logs)).toMatchObject({ rule: 'continue', startIndex: 1, accumulated: [10, 25, 20, 10] });
  });

  it('ТК-А14: шаг 2 недобран (5 из 20), остановка на шаге 3 — подсказка ведёт на шаг 3, шаг 2 не предлагается (Д-6)', () => {
    const logs = [session({ id: 's1', startedAt: at(weekDay(6), 10), minutes: [10, 5, 12, 0], stopIndex: 2, circleId: 'c1' })];
    expect(start(topic({}), logs)).toMatchObject({ rule: 'continue', startIndex: 2, accumulated: [10, 5, 12, 0] });
  });

  it('ТК-А09: контрольная с прошлой сессией на шаге 2 — шаг 1, подсказки нет, у всех шагов 0', () => {
    const item = topic({ checkpointDay: 66, steps: [15, 25, 65, 15] });
    const logs = [session({ id: 's1', startedAt: at(weekDay(10), 10), minutes: [15, 10, 0, 0], stopIndex: 1, circleId: 'c1' })];
    expect(start(item, logs)).toEqual(fresh('checkpoint'));
    expect(start(item, logs, { type: 'study' })).toEqual(fresh('checkpoint'));
    expect(stopPlace({ item, logs, calendar: calendar() })).toBeNull();
  });

  it('ТК-А10: «Повторение» начинается с шага 1 без подсказки и место не меняет (Д-2)', () => {
    const item = topic({});
    const before = stopPlace({ item, logs: [placeLog()], calendar: calendar() });
    expect(start(item, [placeLog()], { type: 'review' })).toEqual(fresh('review'));
    const review = session({ id: 'r1', type: 'review', startedAt: at(weekDay(6, 1), 10), minutes: [15, 0, 0, 0], stopIndex: 0, circleId: 'r' });
    expect(stopPlace({ item, logs: [placeLog(), review], calendar: calendar() })).toEqual(before);
    expect(start(item, [placeLog(), review])).toMatchObject({ rule: 'continue', startIndex: 2, accumulated: [0, 0, 12, 0] });
  });

  it('лог, тип которого поменяли на «Повторение», перестаёт учитываться (FR-64)', () => {
    const item = topic({});
    const later = session({ id: 's2', startedAt: at(weekDay(6, 1), 10), minutes: [3, 0, 0, 0], stopIndex: 0, circleId: 'c2' });
    expect(start(item, [placeLog(), later])?.startIndex).toBe(0);
    expect(start(item, [placeLog(), { ...later, type: 'review' }])).toMatchObject({ rule: 'continue', startIndex: 2, circleId: 'c1' });
  });

  it('ТК-А11: пока топик пройден — шаг 1 новым кругом; снял отметку без сессий — прежняя подсказка (Д-4)', () => {
    const done = topic({ doneAt: at(weekDay(6, 1), 12) });
    expect(start(done, [placeLog()])).toEqual(fresh('itemDone'));
    const reopened = topic({ doneAt: null });
    expect(start(reopened, [placeLog()])).toMatchObject({ rule: 'continue', startIndex: 2, accumulated: [0, 0, 12, 0] });
  });

  it('ТК-А11: сессия по пройденному топику открывает новый круг — после снятия отметки место от неё', () => {
    const whileDone = session({ id: 's2', startedAt: at(weekDay(6, 2), 10), minutes: [8, 0, 0, 0], stopIndex: 0, circleId: 'c2' });
    expect(start(topic({}), [placeLog(), whileDone])).toMatchObject({ rule: 'continue', startIndex: 0, circleId: 'c2', accumulated: [8, 0, 0, 0] });
  });

  it('ТК-А13: план шага 3 изменили с 20 на 30 при тех же 4 шагах — «Продолжить с шага 3 · уже 12 из 30 мин»', () => {
    const item = topic({ steps: [10, 20, 30, 10] });
    const result = start(item, [placeLog()]);
    expect(result).toMatchObject({ rule: 'continue', startIndex: 2, accumulated: [0, 0, 12, 0] });
    expect(stepProgress({ circleMin: result?.accumulated[2] ?? 0, sessionMs: 0, planMin: item.guide?.steps[2]?.minutes ?? 0 })).toMatchObject({ doneMin: 12, planMin: 30 });
  });

  it('ТК-А13: план последнего шага увеличили — пройденный круг снова открыт с новым планом', () => {
    const logs = [session({ id: 's1', startedAt: at(weekDay(6), 10), minutes: [10, 20, 20, 10], stopIndex: 3, circleId: 'c1' })];
    expect(start(topic({ steps: [10, 20, 20, 15] }), logs)).toMatchObject({ rule: 'continue', startIndex: 3 });
  });

  it('ТК-А13: шаг 2 удалили, в ориентире 3 шага — шаг 1 новым кругом, логи не меняются (Д-10)', () => {
    const logs = [placeLog()];
    const copy = structuredClone(logs);
    expect(start(topic({ steps: [10, 20, 10] }), logs)).toEqual(fresh('stepCountChanged', 3));
    expect(logs).toEqual(copy);
  });

  it('шага остановки больше нет при том же числе шагов — место на последнем шаге (FR-63)', () => {
    // Шаг 4 добавили во время сессии и остановились на нём, потом удалили: шагов снова 3
    const logs = [session({ id: 's1', startedAt: at(weekDay(6), 10), minutes: [10, 5, 0, 7], stopIndex: 3, circleId: 'c1', stepCount: 3 })];
    expect(start(topic({ steps: [10, 20, 20] }), logs)).toMatchObject({ rule: 'continue', startIndex: 2, accumulated: [10, 5, 0] });
  });

  it('у топика без шагов ориентира шагов нет — шаблон фаз (Д-1)', () => {
    const plain: IItem = { ...topic({}), guide: null };
    expect(start(plain, [placeLog()])).toBeNull();
    expect(stopPlace({ item: plain, logs: [placeLog()], calendar: calendar() })).toBeNull();
    expect(circleMinutes({ item: plain, logs: [placeLog()], circleId: 'c1', calendar: calendar() })).toEqual([]);
  });

  it('минуты лога, исправленного в 1.5 после отката, выравниваются по Д-7 (правило 4)', () => {
    const edited = session({ id: 's1', startedAt: at(weekDay(6), 10), minutes: [10, 5, 12, 0], stopIndex: 2, circleId: 'c1', durationMin: 20 });
    expect(start(topic({}), [edited])?.accumulated).toEqual([10, 5, 5, 0]);
  });
});

describe('удаление и «Отменить» (FR-64, Q-022)', () => {
  const item = topic({});
  const first = session({ id: 's1', startedAt: at(weekDay(6), 10), minutes: [10, 5, 0, 0], stopIndex: 1, circleId: 'c1' });
  const second = session({ id: 's2', startedAt: at(weekDay(6, 1), 10), minutes: [0, 10, 3, 0], stopIndex: 2, circleId: 'c1', startIndex: 1, continuesCircle: true });

  it('ТК-А18: удалил последний лог — место как без этой сессии; «Отменить» — как до удаления', () => {
    const before = start(item, [first, second]);
    expect(before).toMatchObject({ startIndex: 2, accumulated: [10, 15, 3, 0] });
    expect(start(item, [first])).toMatchObject({ startIndex: 1, accumulated: [10, 5, 0, 0] });
    expect(start(item, [first, second])).toEqual(before);
  });

  it('удаление первого лога круга убирает только его минуты: остальные сессии остаются в круге', () => {
    expect(start(item, [second])).toMatchObject({ rule: 'continue', startIndex: 2, circleId: 'c1', accumulated: [0, 10, 3, 0] });
  });

  it('лог с отметкой удаления не учитывается', () => {
    expect(start(item, [first, { ...second, deletedAt: at(weekDay(6, 2), 9) }])).toEqual(start(item, [first]));
  });
});

describe('период повторяющегося топика (FR-61, Q-007, Д-18)', () => {
  const study = topic({ recurrenceWeeks: 1, routeRole: 'study' });

  it('ТК-А12: «Изучение» — вторая сессия недели 6 продолжает с шага 3 · 12 из 20', () => {
    expect(start(study, [placeLog()], { day: weekDay(6, 6) })).toMatchObject({ rule: 'continue', startIndex: 2, accumulated: [0, 0, 12, 0] });
  });

  it('ТК-А12: первая сессия недели 7 — шаг 1 без подсказки, у всех шагов 0', () => {
    expect(start(study, [placeLog({ startedAt: at(weekDay(6, 6), 18) })], { day: dayOf(at(weekDay(7), 5)) })).toEqual(fresh('newPeriod'));
  });

  it('ТК-А12: граница дня 04:00 — сессия в 01:30 первого дня недели 7 относится к неделе 6 и продолжает с шага 3', () => {
    const logs = [placeLog({ startedAt: at(weekDay(6, 6), 18) })];
    expect(dayOf(at(weekDay(7), 1, 30))).toBe(weekDay(6, 6));
    expect(start(study, logs, { day: dayOf(at(weekDay(7), 1, 30)) })).toMatchObject({ rule: 'continue', startIndex: 2 });
    // Лог, начатый в 01:30, тоже относится к прошлому дню и к неделе 6
    const lateNight = [placeLog({ startedAt: at(weekDay(7), 1, 30) })];
    expect(stopPlace({ item: study, logs: lateNight, calendar: calendar() })?.period).toBe('week:6');
    expect(start(study, lateNight, { day: weekDay(7) })?.rule).toBe('newPeriod');
  });

  it('ТК-А12: «Копия» — блок маршрута недель 9–13: неделя 10 → неделя 12 продолжает, неделя 14 — новый блок с шага 1', () => {
    const copy = topic({ recurrenceWeeks: 4, routeRole: 'copy', steps: [15, 20, 70, 15] });
    const blocks = [routeBlock('b3', 9, 13), routeBlock('b4', 14, 17)];
    const logs = [session({ id: 'k1', startedAt: at(weekDay(10, 2), 18), minutes: [15, 20, 40, 0], stopIndex: 2, circleId: 'k' })];
    const week12 = start(copy, logs, { day: weekDay(12, 1), routeBlocks: blocks });
    expect(week12).toMatchObject({ rule: 'continue', startIndex: 2, accumulated: [15, 20, 40, 0] });
    expect(stepProgress({ circleMin: week12?.accumulated[2] ?? 0, sessionMs: 0, planMin: 70 })).toMatchObject({ doneMin: 40, planMin: 70 });
    expect(start(copy, logs, { day: weekDay(14), routeBlocks: blocks })).toEqual(fresh('newPeriod'));
  });

  it('ТК-А12: копия в неделю без блока маршрута и свой повторяющийся топик — отрезки по N недель от недели 1 (Д-18)', () => {
    const copy = topic({ recurrenceWeeks: 4, routeRole: 'copy' });
    const copyLog = [session({ id: 'k1', startedAt: at(weekDay(18), 18), minutes: [5, 0, 0, 0], stopIndex: 0, circleId: 'k' })];
    expect(start(copy, copyLog, { day: weekDay(20, 6) })?.rule).toBe('continue');
    expect(start(copy, copyLog, { day: weekDay(21) })?.rule).toBe('newPeriod');

    const own = topic({ recurrenceWeeks: 2 });
    const ownLog = [session({ id: 'o1', startedAt: at(weekDay(3), 18), minutes: [5, 0, 0, 0], stopIndex: 0, circleId: 'o' })];
    expect(start(own, ownLog, { day: weekDay(4, 6) })?.rule).toBe('continue');
    expect(start(own, ownLog, { day: weekDay(5) })?.rule).toBe('newPeriod');
    expect(recurrencePeriod({ item: own, day: weekDay(1), calendar: calendar() })).toBe(recurrencePeriod({ item: own, day: weekDay(2, 6), calendar: calendar() }));
  });

  it('у неповторяющегося топика периода нет; день до старта челленджа — неделя 1', () => {
    expect(recurrencePeriod({ item: topic({}), day: weekDay(6), calendar: calendar() })).toBeNull();
    expect(recurrencePeriod({ item: study, day: addDays(START, -3), calendar: calendar() })).toBe('week:1');
  });

  it('у повторяющегося топика круг считается только в периоде последней сессии', () => {
    // Тот же круг в двух неделях бывает только после правки даты старта или блоков маршрута
    const logs = [
      session({ id: 'w5', startedAt: at(weekDay(5), 10), minutes: [10, 0, 0, 0], stopIndex: 0, circleId: 'c1' }),
      session({ id: 'w6', startedAt: at(weekDay(6), 10), minutes: [0, 5, 0, 0], stopIndex: 1, circleId: 'c1', startIndex: 1, continuesCircle: true }),
    ];
    expect(start(study, logs)).toMatchObject({ rule: 'continue', startIndex: 1, accumulated: [0, 5, 0, 0] });
    expect(circleMinutes({ item: study, logs, circleId: 'c1', calendar: calendar() })).toEqual([0, 5, 0, 0]);
  });
});

describe('отклик подсказок (НФТ «Время отклика»)', () => {
  it('ТК-А25: подсказки для всех топиков и блоков «Сегодня» на 3000 топиков и 10 000 логов — не дольше 100 мс', () => {
    const items = Array.from({ length: 3000 }, (_, index) =>
      topic({
        id: `i${index}`,
        kind: index % 2 ? 'study' : 'practice',
        recurrenceWeeks: index % 10 === 0 ? 1 : null,
        routeRole: index % 10 === 0 ? 'study' : null,
        checkpointDay: index % 600 === 1 ? 66 : null,
      }),
    );
    const logs = Array.from({ length: 10_000 }, (_, index) =>
      session({
        id: `l${index}`,
        itemId: `i${index % 3000}`,
        startedAt: at(addDays(START, index % 300), 10 + (index % 8)),
        minutes: [5, 5, 5, 5],
        stopIndex: index % 4,
        circleId: `c${index % 3000}-${Math.floor(index / 6000)}`,
        type: index % 7 === 0 ? 'review' : 'study',
      }),
    );
    const today = addDays(START, 300);
    const started = performance.now();
    const byItem = countedLogsByItem({ logs, items });
    const starts = items.map((item) => stepStart({ item, type: item.kind, logs: byItem.get(item.id) ?? [], day: today, calendar: calendar() }));
    const blocks = items.slice(0, 12).map((item) => stepStart({ item, type: 'review', logs: byItem.get(item.id) ?? [], day: today, calendar: calendar() }));
    const elapsed = performance.now() - started;
    expect(starts.filter((entry) => entry?.rule === 'continue').length).toBeGreaterThan(0);
    expect(blocks.every((entry) => entry?.rule === 'review' || entry?.rule === 'checkpoint')).toBe(true);
    expect(elapsed).toBeLessThan(100);
  });
});
