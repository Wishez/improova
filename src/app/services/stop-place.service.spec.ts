import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { EMPTY_GUIDE, stepStart } from '../domain';
import {
  budgetFixture,
  itemFixture,
  logFixture,
  sectionFixture,
  topicFixture,
} from '../domain/test-fixtures';
import { MemoryAdapter, STORAGE_ADAPTER } from '../storage';
import type {
  IItem,
  IPlanBlock,
  IRouteBlock,
  ITimeLog,
  TItemKind,
  TRouteRole,
  TSessionType,
} from '../types';
import { addDays, fromDayKey } from '../utils';
import { ClockService } from './clock.service';
import { DataStore, defaultChallenge, defaultMeta } from './data.store';
import { StopPlaceService, type IStartHint } from './stop-place.service';

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
  readonly date?: string;
}): IPlanBlock {
  return {
    id: params.id,
    createdAt: NOW,
    updatedAt: NOW,
    date: params.date ?? weekDay(6, 6),
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
async function open(adapter: MemoryAdapter, now: string = NOW): Promise<IContext> {
  TestBed.configureTestingModule({ providers: [{ provide: STORAGE_ADAPTER, useValue: adapter }] });
  const clock = TestBed.inject(ClockService);
  clock.now.set(Date.parse(now));
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
  return open(adapter, params.now);
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
