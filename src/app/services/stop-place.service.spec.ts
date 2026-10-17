import { signal, type Provider } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { EMPTY_GUIDE, editLogSteps, stepStart, type IDayPlan, type IPlannedBlock } from '../domain';
import {
  budgetFixture,
  itemFixture,
  logFixture,
  sectionFixture,
  topicFixture,
} from '../domain/test-fixtures';
import { MemoryAdapter, STORAGE_ADAPTER, checkSnapshot } from '../storage';
import type {
  IItem,
  IMeta,
  IPlanBlock,
  IRouteBlock,
  ITimeLog,
  ITimerState,
  TItemKind,
  TRouteRole,
  TSessionType,
} from '../types';
import { addDays, fromDayKey } from '../utils';
import { BackupService } from './backup.service';
import { ClockService } from './clock.service';
import { DataStore, defaultChallenge, defaultMeta } from './data.store';
import { LogsService } from './logs.service';
import { PlanService } from './plan.service';
import { ProgramService } from './program.service';
import { StopPlaceService, type IStartHint } from './stop-place.service';
import { ToastService } from './toast.service';

// Данные тестов собраны здесь, без правки domain/test-fixtures.ts (ADR-007, «Слои правил и файлы задач»)
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
/** «Сейчас» по умолчанию — воскресенье недели 6, полдень. */
const NOW = at(weekDay(6, 6), 12);

/** Топик с ориентиром; по умолчанию 4 шага 10 / 20 / 20 / 10 мин, как «Изучение двух художников». */
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
      topicId: 't1',
      kind: params.kind ?? 'study',
      checkpointDay: params.checkpointDay,
      doneAt: params.doneAt,
      recurrenceWeeks: params.recurrenceWeeks,
    }),
    routeRole: params.routeRole ?? null,
    guide: {
      ...EMPTY_GUIDE,
      goal: 'Цель',
      steps: steps.map((minutes, index) => ({ title: `Шаг ${index + 1}`, minutes })),
    },
  };
}

/** Лог сессии таймера со сведениями о шагах (ADR-007): длина лога — сумма минут шагов. */
function session(params: {
  readonly id: string;
  readonly startedAt: string;
  readonly minutes: readonly number[];
  readonly stopIndex: number;
  readonly circleId: string;
  readonly itemId?: string;
  readonly type?: TSessionType;
  readonly startIndex?: number;
  readonly continuesCircle?: boolean;
}): ITimeLog {
  const durationMin = params.minutes.reduce((sum, value) => sum + value, 0);
  return {
    ...logFixture({
      id: params.id,
      itemId: params.itemId ?? 'item',
      type: params.type ?? 'study',
      startedAt: params.startedAt,
      minutes: durationMin,
    }),
    steps: {
      minutes: params.minutes,
      startIndex: params.startIndex ?? 0,
      stopIndex: params.stopIndex,
      continuesCircle: params.continuesCircle ?? false,
      circleId: params.circleId,
      limitMin: 90,
      stepCount: params.minutes.length,
      firstMinuteIndex: 0,
    },
  };
}

/** Место «шаг 3 · 12 из 20» (US-25): одна сессия нового круга недели 6, остановка на шаге 3. */
const placeLog = (
  patch: {
    readonly id?: string;
    readonly startedAt?: string;
    readonly itemId?: string;
    readonly type?: TSessionType;
  } = {},
): ITimeLog =>
  session({
    id: patch.id ?? 'm1',
    itemId: patch.itemId,
    type: patch.type,
    startedAt: patch.startedAt ?? at(weekDay(6), 18),
    minutes: [0, 0, 12, 0],
    stopIndex: 2,
    circleId: 'c1',
  });

/** Закреплённый блок «Сегодня»: его ключ в плане — `pin:<id>`. */
function pinned(params: {
  readonly id: string;
  readonly itemId: string;
  readonly type: TSessionType;
}): IPlanBlock {
  return {
    id: params.id,
    createdAt: NOW,
    updatedAt: NOW,
    date: weekDay(6, 6),
    itemId: params.itemId,
    type: params.type,
    plannedMin: params.type === 'review' ? 15 : 45,
    pinned: true,
    status: 'planned',
  };
}

function routeBlock(id: string, fromWeek: number, toWeek: number): IRouteBlock {
  return {
    id,
    createdAt: NOW,
    updatedAt: NOW,
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

/** Идущая сессия с шагами: запись `meta.timer`, как при старте и смене шага. */
function runningTimer(activeIndex = 2): ITimerState {
  return {
    itemId: 'item',
    type: 'study',
    startedAt: at(weekDay(6, 6), 11, 50),
    pausedAt: null,
    pausedMs: 0,
    plannedMin: 45,
    stepMinutes: null,
    legacySchedule: false,
    steps: {
      activeIndex,
      spentMs: [0, 0, 300_000, 0],
      startIndex: 2,
      continuesCircle: true,
      circleId: 'c1',
      stepCount: 4,
      firstMinuteIndex: 2,
      planSignaled: [],
      limitSignaled: false,
    },
  };
}

interface IContext {
  readonly adapter: MemoryAdapter;
  readonly store: DataStore;
  readonly service: StopPlaceService;
  readonly clock: ClockService;
  readonly routeBlocks: readonly IRouteBlock[];
}

/** Очередь записи DataStore досылает изменения в хранилище за микрозадачи. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** Приложение на хранилище в памяти: тот же путь загрузки и записи, что в браузере. */
async function open(params: {
  readonly adapter: MemoryAdapter;
  readonly now?: string;
  /** Подмена сервисов приложения. */
  readonly providers?: readonly Provider[];
}): Promise<IContext> {
  const { adapter } = params;
  TestBed.configureTestingModule({
    providers: [{ provide: STORAGE_ADAPTER, useValue: adapter }, ...(params.providers ?? [])],
  });
  const clock = TestBed.inject(ClockService);
  clock.now.set(Date.parse(params.now ?? NOW));
  const store = TestBed.inject(DataStore);
  await store.init();
  await settle();
  const routeBlocks = store.data().routeBlocks;
  return { adapter, store, service: TestBed.inject(StopPlaceService), clock, routeBlocks };
}

async function setup(params: {
  readonly items: readonly IItem[];
  readonly logs?: readonly ITimeLog[];
  readonly blocks?: readonly IPlanBlock[];
  readonly routeBlocks?: readonly IRouteBlock[];
  readonly now?: string;
  readonly providers?: readonly Provider[];
}): Promise<IContext> {
  const adapter = new MemoryAdapter();
  await adapter.init();
  await adapter.putMany('budgets', [budgetFixture()]);
  await adapter.putMany('challenges', [{ ...defaultChallenge(NOW, START) }]);
  await adapter.putMany('meta', [defaultMeta()]);
  await adapter.putMany('sections', [sectionFixture('s1', 0)]);
  await adapter.putMany('topics', [topicFixture('t1', 's1')]);
  await adapter.putMany('items', params.items);
  await adapter.putMany('timeLogs', params.logs ?? []);
  await adapter.putMany('planBlocks', params.blocks ?? []);
  await adapter.putMany('routeBlocks', params.routeBlocks ?? []);
  return open({ adapter, now: params.now, providers: params.providers });
}

afterEach(() => TestBed.resetTestingModule());

const hint = (kind: IStartHint['kind'], stepNumber = 1, doneMin = 0, planMin = 10): IStartHint => ({
  kind,
  stepNumber,
  doneMin,
  planMin,
});
const CONTINUE_3 = hint('continue', 3, 12, 20);

/**
 * Таймер берёт шаг старта прямо из домена — `stepStart` по всем логам, дню старта и календарю челленджа (Д-27).
 * Сервис обязан давать тот же результат: тогда подсказка и фактический старт не расходятся.
 */
function expectSameAsTimer(
  ctx: IContext,
  params: { readonly itemId: string; readonly type?: TSessionType },
): void {
  const item = ctx.store.data().items.find((entry) => entry.id === params.itemId);
  expect(item).toBeDefined();
  if (!item) {
    return;
  }
  const timer = stepStart({
    item,
    type: params.type ?? item.kind,
    logs: ctx.store.data().timeLogs,
    day: ctx.store.today(),
    calendar: { challengeStart: START, routeBlocks: ctx.routeBlocks, boundaryHour: BOUNDARY_HOUR },
  });
  expect(ctx.service.startOf(params)?.start ?? null).toEqual(timer);
}

describe('подсказка и шаг старта по восьми правилам FR-58', () => {
  it('ТК-А26: пункт 1 — контрольная: шаг 1, подсказки нет ни у блока «Сегодня», ни в карточке, ни в быстром выборе (US-27, критерии 1, 3)', async () => {
    const item = topic({ checkpointDay: 66, steps: [15, 25, 65, 15] });
    const logs = [
      session({
        id: 's1',
        startedAt: at(weekDay(6), 10),
        minutes: [15, 10, 0, 0],
        stopIndex: 1,
        circleId: 'c1',
      }),
    ];
    const ctx = await setup({
      items: [item],
      logs,
      blocks: [pinned({ id: 'b1', itemId: 'item', type: 'study' })],
    });
    const expected = {
      rule: 'checkpoint',
      startIndex: 0,
      continuesCircle: false,
      circleId: null,
      accumulated: [0, 0, 0, 0],
    };
    expect(ctx.service.today().get('pin:b1')).toEqual({
      hint: hint('none', 1, 0, 15),
      start: expected,
    });
    expect(ctx.service.byItem().get('item')).toEqual({
      hint: hint('none', 1, 0, 15),
      start: expected,
    });
    expect(ctx.service.startOf({ itemId: 'item' })?.hint.kind).toBe('none');
    expectSameAsTimer(ctx, { itemId: 'item' });
  });

  it('ТК-А26: пункт 2 — «Повторение»: блок без подсказки с шага 1, место топика не меняется (US-29, критерий 1)', async () => {
    const blocks = [
      pinned({ id: 'r1', itemId: 'item', type: 'review' }),
      pinned({ id: 'b1', itemId: 'item', type: 'study' }),
    ];
    const ctx = await setup({ items: [topic({})], logs: [placeLog()], blocks });
    expect(ctx.service.today().get('pin:r1')).toMatchObject({
      hint: hint('none'),
      start: { rule: 'review', startIndex: 0, continuesCircle: false },
    });
    expect(ctx.service.today().get('pin:b1')?.hint).toEqual(CONTINUE_3);
    expectSameAsTimer(ctx, { itemId: 'item', type: 'review' });

    // Сессия «Повторение» 15 мин записана — подсказка топика прежняя
    ctx.store.upsert(
      'timeLogs',
      session({
        id: 'rv',
        type: 'review',
        startedAt: at(weekDay(6, 6), 9),
        minutes: [15, 0, 0, 0],
        stopIndex: 0,
        circleId: 'r',
      }),
    );
    expect(ctx.service.byItem().get('item')?.hint).toEqual(CONTINUE_3);
    expect(ctx.service.today().get('pin:b1')?.hint).toEqual(CONTINUE_3);
  });

  it('ТК-А26: пункт 3 — топик пройден: подсказки нет, шаг 1 новым кругом (US-29, критерий 2)', async () => {
    const ctx = await setup({
      items: [topic({ doneAt: at(weekDay(6, 1), 12) })],
      logs: [placeLog()],
    });
    expect(ctx.service.startOf({ itemId: 'item' })).toEqual({
      hint: hint('none'),
      start: {
        rule: 'itemDone',
        startIndex: 0,
        continuesCircle: false,
        circleId: null,
        accumulated: [0, 0, 0, 0],
      },
    });
    expectSameAsTimer(ctx, { itemId: 'item' });
  });

  it('ТК-А26: пункт 4 — новый период: первая сессия недели 7 у «Изучения» — шаг 1 без подсказки, у всех шагов 0 (US-28, критерии 1, 2)', async () => {
    const study = topic({ recurrenceWeeks: 1, routeRole: 'study' });
    const week6 = await setup({ items: [study], logs: [placeLog()] });
    expect(week6.service.startOf({ itemId: 'item' })?.hint).toEqual(CONTINUE_3);
    TestBed.resetTestingModule();

    const week7 = await setup({ items: [study], logs: [placeLog()], now: at(weekDay(7), 10) });
    expect(week7.service.startOf({ itemId: 'item' })).toMatchObject({
      hint: hint('none'),
      start: { rule: 'newPeriod', startIndex: 0, accumulated: [0, 0, 0, 0] },
    });
    expectSameAsTimer(week7, { itemId: 'item' });
  });

  it('ТК-А26: пункт 4 — граница дня 04:00: в 01:30 первого дня недели 7 сессия относится к неделе 6 и продолжает с шага 3 (US-28, критерий 4)', async () => {
    const study = topic({ recurrenceWeeks: 1, routeRole: 'study' });
    const ctx = await setup({
      items: [study],
      logs: [placeLog({ startedAt: at(weekDay(6, 6), 18) })],
      now: at(weekDay(7), 1, 30),
    });
    expect(ctx.store.today()).toBe(weekDay(6, 6));
    expect(ctx.service.startOf({ itemId: 'item' })?.hint).toEqual(CONTINUE_3);
    expectSameAsTimer(ctx, { itemId: 'item' });
  });

  it('ТК-А26: пункт 4 — «Копия»: блок маршрута недель 9–13 продолжает в неделю 12, новый блок недели 14 — с шага 1 (US-28, критерий 3)', async () => {
    const copy = topic({
      recurrenceWeeks: 4,
      routeRole: 'copy',
      kind: 'practice',
      steps: [15, 20, 70, 15],
    });
    const logs = [
      session({
        id: 'k1',
        type: 'practice',
        startedAt: at(weekDay(10, 2), 18),
        minutes: [15, 20, 40, 0],
        stopIndex: 2,
        circleId: 'k',
      }),
    ];
    const routeBlocks = [routeBlock('b3', 9, 13), routeBlock('b4', 14, 17)];
    const week12 = await setup({ items: [copy], logs, routeBlocks, now: at(weekDay(12, 1), 12) });
    expect(week12.service.startOf({ itemId: 'item' })?.hint).toEqual(hint('continue', 3, 40, 70));
    expectSameAsTimer(week12, { itemId: 'item' });

    // Без перезагрузки: наступила неделя 14 — новый блок маршрута
    week12.clock.now.set(Date.parse(at(weekDay(14), 12)));
    expect(week12.service.startOf({ itemId: 'item' })).toMatchObject({
      hint: hint('none', 1, 0, 15),
      start: { rule: 'newPeriod' },
    });
    expectSameAsTimer(week12, { itemId: 'item' });
  });

  it('ТК-А26: пункт 5 — другое число шагов ориентира: подсказки нет, шаг 1 новым кругом (US-30, критерий 2)', async () => {
    const ctx = await setup({ items: [topic({ steps: [10, 20, 10] })], logs: [placeLog()] });
    expect(ctx.service.startOf({ itemId: 'item' })).toEqual({
      hint: hint('none'),
      start: {
        rule: 'stepCountChanged',
        startIndex: 0,
        continuesCircle: false,
        circleId: null,
        accumulated: [0, 0, 0],
      },
    });
    expectSameAsTimer(ctx, { itemId: 'item' });
  });

  it('ТК-А26: пункт 6 — круг пройден: «Все шаги пройдены · начнём с шага 1», новый круг (US-26, критерии 1, 2)', async () => {
    const logs = [
      session({
        id: 's1',
        startedAt: at(weekDay(6), 10),
        minutes: [10, 20, 20, 10],
        stopIndex: 3,
        circleId: 'c1',
      }),
    ];
    const ctx = await setup({
      items: [topic({})],
      logs,
      blocks: [pinned({ id: 'b1', itemId: 'item', type: 'study' })],
    });
    const expected = {
      hint: hint('cycleDone'),
      start: {
        rule: 'circleDone',
        startIndex: 0,
        continuesCircle: false,
        circleId: null,
        accumulated: [0, 0, 0, 0],
      },
    };
    expect(ctx.service.today().get('pin:b1')).toEqual(expected);
    expect(ctx.service.byItem().get('item')).toEqual(expected);
    expect(ctx.store.data().items[0]?.doneAt).toBeNull();
    expectSameAsTimer(ctx, { itemId: 'item' });
  });

  it('ТК-А26: пункт 6, негативный: на шаге 4 с 6 из 10 — «Продолжить с шага 4 · уже 6 из 10 мин» (US-26, критерий 3)', async () => {
    const logs = [
      session({
        id: 's1',
        startedAt: at(weekDay(6), 10),
        minutes: [10, 20, 20, 6],
        stopIndex: 3,
        circleId: 'c1',
      }),
    ];
    const ctx = await setup({ items: [topic({})], logs });
    expect(ctx.service.startOf({ itemId: 'item' })?.hint).toEqual(hint('continue', 4, 6, 10));
  });

  it('ТК-А26: пункт 6, негативный: все шаги по плану, но остановка на шаге 2 с 25 из 20 — круг не закрыт (US-26, критерий 4)', async () => {
    const logs = [
      session({
        id: 's1',
        startedAt: at(weekDay(6), 10),
        minutes: [10, 25, 20, 10],
        stopIndex: 1,
        circleId: 'c1',
      }),
    ];
    const ctx = await setup({ items: [topic({})], logs });
    expect(ctx.service.startOf({ itemId: 'item' })?.hint).toEqual(hint('continue', 2, 25, 20));
  });

  it('ТК-А26: пункт 7 — место остановки: «Продолжить с шага 3 · уже 12 из 20 мин» у блока, в карточке и в быстром выборе (US-25, критерий 1)', async () => {
    const ctx = await setup({
      items: [topic({})],
      logs: [placeLog()],
      blocks: [pinned({ id: 'b1', itemId: 'item', type: 'study' })],
    });
    const expected = {
      hint: CONTINUE_3,
      start: {
        rule: 'continue',
        startIndex: 2,
        continuesCircle: true,
        circleId: 'c1',
        accumulated: [0, 0, 12, 0],
      },
    };
    expect(ctx.service.today().get('pin:b1')).toEqual(expected);
    expect(ctx.service.byItem().get('item')).toEqual(expected);
    expect(ctx.service.startOf({ itemId: 'item' })).toEqual(expected);
    expectSameAsTimer(ctx, { itemId: 'item' });
  });

  it('ТК-А26: пункт 7 — накоплено 0 мин: «Продолжить с шага N» без чисел (вид continueZero)', async () => {
    const logs = [
      session({
        id: 's1',
        startedAt: at(weekDay(6), 10),
        minutes: [10, 0, 0, 0],
        stopIndex: 2,
        circleId: 'c1',
      }),
    ];
    const ctx = await setup({ items: [topic({})], logs });
    expect(ctx.service.startOf({ itemId: 'item' })).toMatchObject({
      hint: hint('continueZero', 3, 0, 20),
      start: { rule: 'continue', startIndex: 2 },
    });
    expectSameAsTimer(ctx, { itemId: 'item' });
  });

  it('ТК-А26: пункт 7 — практический топик с ориентиром тоже продолжает: «Продолжить с шага 2…» (US-25, критерий 4)', async () => {
    const logs = [
      session({
        id: 's1',
        type: 'practice',
        startedAt: at(weekDay(6), 10),
        minutes: [10, 5, 0, 0],
        stopIndex: 1,
        circleId: 'c1',
      }),
    ];
    const ctx = await setup({ items: [topic({ kind: 'practice' })], logs });
    expect(ctx.service.startOf({ itemId: 'item' })?.hint).toEqual(hint('continue', 2, 5, 20));
    expectSameAsTimer(ctx, { itemId: 'item' });
  });

  it('ТК-А26: пункт 7 — шаг 2 недобран (5 из 20), остановка на шаге 3 — подсказка ведёт на шаг 3 (US-25, критерий 8; Д-6)', async () => {
    const logs = [
      session({
        id: 's1',
        startedAt: at(weekDay(6), 10),
        minutes: [10, 5, 12, 0],
        stopIndex: 2,
        circleId: 'c1',
      }),
    ];
    const ctx = await setup({ items: [topic({})], logs });
    expect(ctx.service.startOf({ itemId: 'item' })).toMatchObject({
      hint: CONTINUE_3,
      start: { accumulated: [10, 5, 12, 0] },
    });
  });

  it('ТК-А26: пункт 7 — вторая сессия того же дня продолжает с места первой (US-25, критерий 5; Д-8)', async () => {
    const ctx = await setup({
      items: [topic({})],
      logs: [placeLog({ startedAt: at(weekDay(6, 6), 9) })],
    });
    expect(ctx.service.startOf({ itemId: 'item' })?.hint).toEqual(CONTINUE_3);
  });

  it('ТК-А26: пункт 8 — учитываемых сессий нет: логов нет, только логи до 1.6 или ручной лог — подсказки нет (US-32, критерий 2; US-25, критерий 7)', async () => {
    const before16 = Array.from({ length: 30 }, (_, index) =>
      logFixture({
        id: `old${index}`,
        itemId: 'item',
        type: 'study',
        startedAt: at(addDays(START, index), 10),
        minutes: 45,
      }),
    );
    const manual: ITimeLog = {
      ...logFixture({
        id: 'manual',
        itemId: 'item',
        type: 'study',
        startedAt: at(weekDay(6, 1), 10),
        minutes: 30,
      }),
      source: 'manual',
      steps: null,
    };
    const ctx = await setup({
      items: [topic({}), topic({ id: 'empty' })],
      logs: [...before16, manual],
    });
    for (const itemId of ['item', 'empty']) {
      expect(ctx.service.startOf({ itemId })).toEqual({
        hint: hint('none'),
        start: {
          rule: 'noSessions',
          startIndex: 0,
          continuesCircle: false,
          circleId: null,
          accumulated: [0, 0, 0, 0],
        },
      });
      expectSameAsTimer(ctx, { itemId });
    }
  });

  it('ТК-А26: срабатывает первое правило по порядку FR-58', async () => {
    const circleDone = session({
      id: 's1',
      startedAt: at(weekDay(6), 10),
      minutes: [10, 20, 20, 10],
      stopIndex: 3,
      circleId: 'c1',
    });
    const items = [
      topic({ id: 'checkpointDone', checkpointDay: 66, doneAt: NOW }),
      topic({ id: 'done', doneAt: NOW }),
      topic({ id: 'doneRecurring', doneAt: NOW, recurrenceWeeks: 1, routeRole: 'study' }),
    ];
    const logs = items.map((item) => ({ ...circleDone, id: `log-${item.id}`, itemId: item.id }));
    const ctx = await setup({ items, logs });
    expect(ctx.service.startOf({ itemId: 'checkpointDone', type: 'review' })?.start.rule).toBe(
      'checkpoint',
    );
    expect(ctx.service.startOf({ itemId: 'done', type: 'review' })?.start.rule).toBe('review');
    expect(ctx.service.startOf({ itemId: 'done' })?.start.rule).toBe('itemDone');
    expect(ctx.service.startOf({ itemId: 'doneRecurring' })?.start.rule).toBe('itemDone');
    for (const item of items) {
      expectSameAsTimer(ctx, { itemId: item.id });
      expectSameAsTimer(ctx, { itemId: item.id, type: 'review' });
    }
  });

  it('ТК-А26: у топика без шагов ориентира и у сессии без топика шагов нет — подсказки нет (Д-1)', async () => {
    const plain: IItem = { ...topic({}), guide: null };
    const ctx = await setup({
      items: [plain],
      logs: [placeLog()],
      blocks: [pinned({ id: 'b1', itemId: 'item', type: 'study' })],
    });
    expect(ctx.service.startOf({ itemId: 'item' })).toBeNull();
    expect(ctx.service.startOf({ itemId: null, type: 'creative' })).toBeNull();
    expect(ctx.service.startOf({ itemId: 'gone' })).toBeNull();
    expect(ctx.service.byItem().has('item')).toBe(false);
    expect(ctx.service.today().has('pin:b1')).toBe(false);
  });
});

describe('обновление подсказки без перезагрузки', () => {
  it('ТК-А26: сессия короче минуты, «Удалить сессию» и ручной лог подсказку не меняют (US-25, критерии 6, 7, 9)', async () => {
    const ctx = await setup({
      items: [topic({})],
      logs: [placeLog()],
      blocks: [pinned({ id: 'b1', itemId: 'item', type: 'study' })],
    });
    const before = ctx.service.startOf({ itemId: 'item' });
    expect(before?.hint).toEqual(CONTINUE_3);

    // Таймер очищен без лога: так заканчиваются сессия короче минуты и «Удалить сессию» в диалоге забытого таймера
    ctx.store.updateMeta({ timer: runningTimer() });
    ctx.store.updateMeta({ timer: null });
    expect(ctx.service.startOf({ itemId: 'item' })).toEqual(before);

    const manual: ITimeLog = {
      ...logFixture({
        id: 'manual',
        itemId: 'item',
        type: 'study',
        startedAt: at(weekDay(6, 6), 9),
        minutes: 30,
      }),
      source: 'manual',
      steps: null,
    };
    ctx.store.upsert('timeLogs', manual);
    expect(ctx.service.startOf({ itemId: 'item' })).toEqual(before);
    expect(ctx.service.today().get('pin:b1')).toEqual(before);
    expectSameAsTimer(ctx, { itemId: 'item' });
  });

  it('ТК-А26: «Стоп» — лог и очистка таймера одной транзакцией, подсказка сразу по новой сессии', async () => {
    const ctx = await setup({
      items: [topic({})],
      blocks: [pinned({ id: 'b1', itemId: 'item', type: 'study' })],
    });
    expect(ctx.service.startOf({ itemId: 'item' })?.hint).toEqual(hint('none'));
    ctx.store.updateMeta({ timer: runningTimer() });
    await settle();

    const meta: IMeta = { ...ctx.store.meta(), timer: null };
    await ctx.store.commit({
      puts: [
        { collection: 'timeLogs', entity: placeLog({ startedAt: at(weekDay(6, 6), 11, 50) }) },
        { collection: 'meta', entity: meta },
      ],
      removes: [],
    });
    expect(ctx.service.startOf({ itemId: 'item' })?.hint).toEqual(CONTINUE_3);
    expect(ctx.service.today().get('pin:b1')?.hint).toEqual(CONTINUE_3);
    expectSameAsTimer(ctx, { itemId: 'item' });
  });

  it('ТК-А26: правка минут: «Сколько засчитать?» 45 вместо 300 — «Продолжить с шага 2 · уже 35 из 20 мин» (US-31, критерий 1)', async () => {
    const forgotten = session({
      id: 'f1',
      startedAt: at(weekDay(6, 5), 10),
      minutes: [10, 290, 0, 0],
      stopIndex: 1,
      circleId: 'c1',
    });
    const ctx = await setup({ items: [topic({})], logs: [forgotten] });
    expect(ctx.service.startOf({ itemId: 'item' })?.hint).toEqual(hint('continue', 2, 290, 20));

    const steps = forgotten.steps ?? null;
    expect(steps).not.toBeNull();
    if (steps) {
      ctx.store.upsert('timeLogs', {
        ...forgotten,
        durationMin: 45,
        steps: editLogSteps(steps, 45),
        editedAt: NOW,
      });
    }
    expect(ctx.service.startOf({ itemId: 'item' })?.hint).toEqual(hint('continue', 2, 35, 20));
    expectSameAsTimer(ctx, { itemId: 'item' });
  });

  it('ТК-А26: правка минут лога без пересчёта шагов (правка в 1.5 после отката) — подсказка по Д-7, те же числа', async () => {
    const forgotten = session({
      id: 'f1',
      startedAt: at(weekDay(6, 5), 10),
      minutes: [10, 290, 0, 0],
      stopIndex: 1,
      circleId: 'c1',
    });
    const ctx = await setup({ items: [topic({})], logs: [forgotten] });
    ctx.store.upsert('timeLogs', { ...forgotten, durationMin: 45, editedAt: NOW });
    expect(ctx.service.startOf({ itemId: 'item' })?.hint).toEqual(hint('continue', 2, 35, 20));
  });

  it('ТК-А26: удаление последнего лога — подсказка как до этой сессии; «Отменить» — как до удаления (US-31, критерий 3)', async () => {
    const first = session({
      id: 's1',
      startedAt: at(weekDay(6), 10),
      minutes: [10, 5, 0, 0],
      stopIndex: 1,
      circleId: 'c1',
    });
    const second = session({
      id: 's2',
      startedAt: at(weekDay(6, 1), 10),
      minutes: [0, 10, 3, 0],
      stopIndex: 2,
      circleId: 'c1',
      startIndex: 1,
      continuesCircle: true,
    });
    const ctx = await setup({
      items: [topic({})],
      logs: [first, second],
      blocks: [pinned({ id: 'b1', itemId: 'item', type: 'study' })],
    });
    const before = ctx.service.startOf({ itemId: 'item' });
    expect(before?.hint).toEqual(hint('continue', 3, 3, 20));

    // Удаление из списка логов — сразу, без мягкого удаления; «Отменить» в тосте возвращает копию лога целиком (Q-022)
    TestBed.inject(LogsService).remove('s2');
    expect(ctx.store.data().timeLogs.some((log) => log.id === 's2')).toBe(false);
    expect(ctx.service.startOf({ itemId: 'item' })?.hint).toEqual(hint('continue', 2, 5, 20));
    expect(ctx.service.today().get('pin:b1')?.hint).toEqual(hint('continue', 2, 5, 20));
    expectSameAsTimer(ctx, { itemId: 'item' });

    const toasts = TestBed.inject(ToastService);
    const undo = toasts.toasts().find((toast) => toast.action?.label === 'Отменить');
    expect(undo).toBeDefined();
    if (undo) {
      toasts.runAction(undo);
    }
    expect(ctx.service.startOf({ itemId: 'item' })).toEqual(before);
    expect(ctx.service.today().get('pin:b1')).toEqual(before);
    expectSameAsTimer(ctx, { itemId: 'item' });
  });

  it('ТК-А26: тип лога сменили на «Повторение» — лог перестаёт задавать место (FR-64)', async () => {
    const later = session({
      id: 's2',
      startedAt: at(weekDay(6, 1), 10),
      minutes: [3, 0, 0, 0],
      stopIndex: 0,
      circleId: 'c2',
    });
    const ctx = await setup({ items: [topic({})], logs: [placeLog(), later] });
    expect(ctx.service.startOf({ itemId: 'item' })?.hint).toEqual(hint('continue', 1, 3, 10));
    ctx.store.upsert('timeLogs', { ...later, type: 'review' });
    expect(ctx.service.startOf({ itemId: 'item' })?.hint).toEqual(CONTINUE_3);
  });

  it('ТК-А26: импорт «Объединить» приносит сессию из другого браузера — подсказка сразу по ней', async () => {
    const ctx = await setup({ items: [topic({})] });
    expect(ctx.service.startOf({ itemId: 'item' })?.hint.kind).toBe('none');
    const snapshot = ctx.store.snapshotFromMemory();
    await TestBed.inject(BackupService).apply(
      { ...snapshot, data: { ...snapshot.data, timeLogs: [placeLog()] } },
      'merge',
    );
    expect(ctx.service.startOf({ itemId: 'item' })?.hint).toEqual(CONTINUE_3);
  });

  it('ТК-А26: импорт «Заменить» файлом без сессий — подсказки нет, без перезагрузки страницы', async () => {
    const ctx = await setup({ items: [topic({})], logs: [placeLog()] });
    const snapshot = ctx.store.snapshotFromMemory();
    expect(ctx.service.startOf({ itemId: 'item' })?.hint).toEqual(CONTINUE_3);
    // Путь BackupService.apply после скачивания копии: импорт в хранилище и перечитывание данных
    await ctx.adapter.importAll(
      { ...snapshot, data: { ...snapshot.data, timeLogs: [] } },
      'replace',
    );
    await ctx.store.reload();
    expect(ctx.service.startOf({ itemId: 'item' })?.hint).toEqual(hint('none'));
  });

  it('ТК-А26: экспорт с местом «шаг 3, 12 из 20» в чистом браузере «Заменить» даёт ту же подсказку (US-32, критерий 3)', async () => {
    const source = await setup({
      items: [topic({}), topic({ id: 'second', kind: 'practice' })],
      logs: [placeLog()],
    });
    const file = JSON.stringify(source.store.snapshotFromMemory());
    const expected = source.service.byItem();
    TestBed.resetTestingModule();

    const check = checkSnapshot(file);
    expect(check.ok).toBe(true);
    if (!check.ok) {
      return;
    }
    const adapter = new MemoryAdapter();
    await adapter.init();
    await adapter.importAll(check.snapshot, 'replace');
    const clean = await open({ adapter });
    expect(clean.service.byItem()).toEqual(expected);
    expect(clean.service.startOf({ itemId: 'item' })?.hint).toEqual(CONTINUE_3);
  });

  it('ТК-А26: отметка «Топик пройден» убирает подсказку, снятие без сессий возвращает прежнюю (US-29, критерии 2, 3; Д-4)', async () => {
    const ctx = await setup({ items: [topic({})], logs: [placeLog()] });
    const program = TestBed.inject(ProgramService);
    program.setDone('item', true);
    expect(ctx.service.startOf({ itemId: 'item' })).toMatchObject({
      hint: hint('none'),
      start: { rule: 'itemDone' },
    });
    expectSameAsTimer(ctx, { itemId: 'item' });
    program.setDone('item', false);
    expect(ctx.service.startOf({ itemId: 'item' })?.hint).toEqual(CONTINUE_3);
    expectSameAsTimer(ctx, { itemId: 'item' });
  });

  it('ТК-А26: правка ориентира: план шага 3 20 → 30 — «уже 12 из 30 мин»; удалён шаг 2 — подсказки нет, логи те же (US-30, критерии 1, 2)', async () => {
    const ctx = await setup({ items: [topic({})], logs: [placeLog()] });
    const program = TestBed.inject(ProgramService);
    const guide = ctx.store.data().items[0]?.guide ?? EMPTY_GUIDE;
    program.setGuide('item', {
      ...guide,
      steps: guide.steps.map((step, index) => (index === 2 ? { ...step, minutes: 30 } : step)),
    });
    expect(ctx.service.startOf({ itemId: 'item' })?.hint).toEqual(hint('continue', 3, 12, 30));
    expectSameAsTimer(ctx, { itemId: 'item' });

    const logs = structuredClone(ctx.store.data().timeLogs);
    program.setGuide('item', { ...guide, steps: guide.steps.filter((_, index) => index !== 1) });
    expect(ctx.service.startOf({ itemId: 'item' })).toMatchObject({
      hint: hint('none'),
      start: { rule: 'stepCountChanged', accumulated: [0, 0, 0] },
    });
    expect(ctx.store.data().timeLogs).toEqual(logs);
    expectSameAsTimer(ctx, { itemId: 'item' });
  });

  it('ТК-А26: смена недели без перезагрузки: у «Изучения» в неделю 7 подсказки нет', async () => {
    const ctx = await setup({
      items: [topic({ recurrenceWeeks: 1, routeRole: 'study' })],
      logs: [placeLog()],
    });
    expect(ctx.service.startOf({ itemId: 'item' })?.hint).toEqual(CONTINUE_3);
    ctx.clock.now.set(Date.parse(at(weekDay(7), 10)));
    expect(ctx.service.startOf({ itemId: 'item' })?.hint).toEqual(hint('none'));
  });
});

describe('пересчёт подсказок (НФТ «Время отклика»)', () => {
  it('ТК-А25: тик часов, запись таймера и черновика конспекта подсказки не пересчитывают', async () => {
    const ctx = await setup({
      items: [topic({})],
      logs: [placeLog()],
      blocks: [pinned({ id: 'b1', itemId: 'item', type: 'study' })],
    });
    const cards = ctx.service.byItem();
    const today = ctx.service.today();
    const calendar = ctx.service.calendar();

    ctx.clock.now.set(ctx.clock.now() + 15_000);
    ctx.store.updateMeta({ timer: runningTimer(2) });
    ctx.store.updateMeta({ timer: runningTimer(3) });
    ctx.store.updateMeta({
      sessionDraft: { logId: null, body: 'Черновик', worked: '', failed: '', next: '' },
    });
    await settle();
    expect(ctx.service.byItem()).toBe(cards);
    expect(ctx.service.today()).toBe(today);
    expect(ctx.service.calendar()).toBe(calendar);

    // Изменение логов пересчитывает: проверка выше не пустая
    ctx.store.upsert(
      'timeLogs',
      session({
        id: 's2',
        startedAt: at(weekDay(6, 6), 9),
        minutes: [4, 0, 0, 0],
        stopIndex: 0,
        circleId: 'c2',
      }),
    );
    expect(ctx.service.byItem()).not.toBe(cards);
    expect(ctx.service.today()).not.toBe(today);
  });

  it('ТК-А25: подсказки для всех блоков «Сегодня» и списка быстрого выбора на 3000 топиков и 10 000 логов — не дольше 100 мс', async () => {
    // Эталонный объём Э-1 (ТД-12): 3000 топиков с ориентиром из 5 шагов, 10 000 логов таймера со сведениями о шагах за 300 дней
    const day = addDays(START, 300);
    const items = Array.from({ length: 3000 }, (_, index) =>
      topic({
        id: `i${index}`,
        steps: [10, 20, 20, 30, 10],
        kind: index % 2 ? 'study' : 'practice',
        recurrenceWeeks: index % 10 === 0 ? 1 : null,
        routeRole: index % 10 === 0 ? 'study' : null,
        checkpointDay: index % 600 === 1 ? 66 : null,
      }),
    );
    const logs = Array.from({ length: 10_000 }, (_, index) => {
      const itemIndex = index % 3000;
      return session({
        id: `l${index}`,
        itemId: `i${itemIndex}`,
        type: index % 7 === 0 ? 'review' : itemIndex % 2 ? 'study' : 'practice',
        startedAt: at(addDays(START, Math.floor((index * 300) / 10_000)), 10 + (index % 8)),
        minutes: [index % 11, 12, (index * 7) % 23, 5, index % 3],
        stopIndex: index % 5,
        circleId: `c${itemIndex}-${Math.floor(index / 6000)}`,
        continuesCircle: index >= 3000,
      });
    });
    // План недели — свой сервис со своим порогом 300 мс: здесь его заменяет готовый день из 12 блоков,
    // поэтому замер и время прогона касаются только подсказок
    const types: readonly TSessionType[] = ['study', 'practice', 'review'];
    const blocks: IPlannedBlock[] = Array.from({ length: 12 }, (_, index) => ({
      key: `b${index}`,
      date: day,
      itemId: `i${index}`,
      sectionId: 's1',
      type: types[index % 3] ?? 'study',
      plannedMin: 45,
      pinned: false,
      storedId: null,
      reviewIndex: null,
    }));
    const todayPlan = signal<IDayPlan | null>({
      date: day,
      capacity: 540,
      planned: 540,
      logged: 0,
      blocks,
    });
    const ctx = await setup({
      items: [],
      now: at(day, 12),
      providers: [{ provide: PlanService, useValue: { today: todayPlan } }],
    });
    // Данные кладутся прямо в память: загрузка из хранилища к замеру не относится
    ctx.store.data.update((data) => ({ ...data, items, timeLogs: logs }));

    const measure = (): number => {
      const started = performance.now();
      const cards = ctx.service.byItem();
      const today = ctx.service.today();
      const picker = items.map((item) => ctx.service.startOf({ itemId: item.id }));
      const elapsed = performance.now() - started;
      expect(cards.size).toBe(3000);
      expect(today.size).toBe(blocks.length);
      expect(picker.filter((entry) => entry?.hint.kind === 'continue').length).toBeGreaterThan(0);
      return elapsed;
    };
    const cold = measure();
    expect(cold).toBeLessThan(100);

    // Тик часов на эталонном объёме ничего не пересчитывает
    const cards = ctx.service.byItem();
    const today = ctx.service.today();
    ctx.clock.now.set(ctx.clock.now() + 15_000);
    const tick = measure();
    expect(ctx.service.byItem()).toBe(cards);
    expect(ctx.service.today()).toBe(today);

    // После «Стоп» — пересчёт тоже не дольше 100 мс
    const meta: IMeta = { ...ctx.store.meta(), timer: null };
    const stop = session({
      id: 'stop',
      itemId: 'i2',
      type: 'practice',
      startedAt: at(day, 11),
      minutes: [3, 0, 0, 0, 0],
      stopIndex: 0,
      circleId: 'new',
    });
    await ctx.store.commit({
      puts: [
        { collection: 'timeLogs', entity: stop },
        { collection: 'meta', entity: meta },
      ],
      removes: [],
    });
    const afterStop = measure();
    expect(afterStop).toBeLessThan(100);
    expect(ctx.service.startOf({ itemId: 'i2' })?.hint).toEqual(hint('continue', 1, 3, 10));
    console.info(
      `ТК-А25: подсказки на 3000 топиков и 10 000 логов — первый расчёт ${cold.toFixed(1)} мс, после тика ${tick.toFixed(1)} мс, после «Стоп» ${afterStop.toFixed(1)} мс (порог 100)`,
    );
  });
});
