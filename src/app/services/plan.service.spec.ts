import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_GUIDE } from '../domain';
import { budgetFixture, itemFixture, sectionFixture, topicFixture } from '../domain/test-fixtures';
import { MemoryAdapter, STORAGE_ADAPTER } from '../storage';
import type { IItem, ISection, ITimeLog, ITopic } from '../types';
import { addDays, configureTimeZone, fromDayKey } from '../utils';
import { DataStore, defaultChallenge, defaultMeta } from './data.store';
import { PlanService } from './plan.service';
import { TimerService } from './timer.service';

/** Понедельник — старт челленджа в тестах. */
const START = '2026-01-05';
const min = (value: number): number => value * 60_000;
const sec = (value: number): number => value * 1000;
/** Момент по часам устройства: день и час, мс. */
const at = (day: string, hour: number): number => {
  const date = fromDayKey(day);
  date.setHours(hour, 0, 0, 0);
  return date.getTime();
};

/** Топик с ориентиром из шагов с плановыми минутами `steps`. */
function topic(params: {
  readonly id: string;
  readonly topicId: string;
  readonly order?: number;
  readonly steps: readonly number[];
  readonly recurrenceWeeks?: number | null;
}): IItem {
  const order = params.order ?? 0;
  return {
    ...itemFixture({ id: params.id, topicId: params.topicId, order, kind: order % 2 ? 'study' : 'practice', recurrenceWeeks: params.recurrenceWeeks }),
    guide: { ...EMPTY_GUIDE, goal: 'Цель', steps: params.steps.map((minutes, index) => ({ title: `Шаг ${index + 1}`, minutes })) },
  };
}

interface IProgram {
  readonly sections: readonly ISection[];
  readonly topics: readonly ITopic[];
  readonly items: readonly IItem[];
  readonly logs: readonly ITimeLog[];
}

/** Малая программа: раздел, тема, два топика с шагами 10 / 20 / 20 мин. */
const SMALL: IProgram = {
  sections: [sectionFixture('s1', 0)],
  topics: [topicFixture('t1', 's1')],
  items: [topic({ id: 'i1', topicId: 't1', steps: [10, 20, 20] }), topic({ id: 'i2', topicId: 't1', order: 1, steps: [10, 20, 20] })],
  logs: [],
};

/**
 * Эталонный объём Э-1 (НФТ «Время отклика», «Хранение»): 3000 топиков с ориентиром из 5 шагов
 * (20 разделов × 15 тем × 10 топиков, каждый десятый повторяется еженедельно) и 10 000 логов таймера
 * со сведениями о шагах за 300 дней.
 */
function referenceProgram(): IProgram {
  const sections = Array.from({ length: 20 }, (_, index) => sectionFixture(`s${index}`, index));
  const topics = sections.flatMap((section) => Array.from({ length: 15 }, (_, index) => topicFixture(`${section.id}t${index}`, section.id, index)));
  const items = topics.flatMap((entry) =>
    Array.from({ length: 10 }, (_, index) =>
      topic({ id: `${entry.id}i${index}`, topicId: entry.id, order: index, steps: [10, 20, 20, 30, 10], recurrenceWeeks: index === 0 ? 1 : null }),
    ),
  );
  const logs = Array.from({ length: 10_000 }, (_, index): ITimeLog => {
    const item = items[index % items.length];
    const minutes = [index % 11, 12, (index * 7) % 23, 5, index % 3];
    const durationMin = minutes.reduce((sum, value) => sum + value, 0);
    const startedAt = new Date(at(addDays(START, Math.floor((index * 300) / 10_000)), 10 + (index % 8))).toISOString();
    return {
      id: `l${index}`,
      createdAt: startedAt,
      updatedAt: startedAt,
      itemId: item?.id ?? null,
      type: item?.kind ?? 'practice',
      startedAt,
      endedAt: new Date(Date.parse(startedAt) + min(durationMin)).toISOString(),
      durationMin,
      source: 'timer',
      editedAt: null,
      steps: {
        minutes,
        startIndex: 0,
        stopIndex: index % 5,
        continuesCircle: index >= 3000,
        circleId: `c${index % 3000}-${Math.floor(index / 6000)}`,
        limitMin: 90,
        stepCount: 5,
        firstMinuteIndex: 0,
      },
    };
  });
  return { sections, topics, items, logs };
}

interface IHarness {
  readonly store: DataStore;
  readonly plan: PlanService;
  readonly timer: TimerService;
}

/** Приложение на хранилище в памяти с часами `now`: тот же путь загрузки и записи, что в браузере. */
async function boot(program: IProgram, now: number): Promise<IHarness> {
  vi.useFakeTimers({ now, toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  const adapter = new MemoryAdapter();
  await adapter.init();
  await adapter.putMany('budgets', [budgetFixture()]);
  await adapter.putMany('challenges', [defaultChallenge(new Date(at(START, 9)).toISOString(), START)]);
  await adapter.putMany('meta', [defaultMeta()]);
  await adapter.putMany('sections', [...program.sections]);
  await adapter.putMany('topics', [...program.topics]);
  await adapter.putMany('items', [...program.items]);
  await adapter.putMany('timeLogs', [...program.logs]);
  TestBed.configureTestingModule({ providers: [{ provide: STORAGE_ADAPTER, useValue: adapter }] });
  const store = TestBed.inject(DataStore);
  await store.init();
  return { store, plan: TestBed.inject(PlanService), timer: TestBed.inject(TimerService) };
}

/** Все записи очереди `DataStore` дошли до хранилища. */
async function settle(store: DataStore): Promise<void> {
  await store.commit({ puts: [], removes: [] });
}

afterEach(() => {
  TestBed.resetTestingModule();
  vi.useRealTimers();
  configureTimeZone('');
});

describe('план недели не пересчитывается от записей таймера (НФТ «Время отклика»)', () => {
  it('смена шага, пауза и продолжение пишут таймер, а план недели, день и календарь остаются прежними', async () => {
    const h = await boot(SMALL, at(addDays(START, 10), 12));
    expect(h.timer.start({ itemId: 'i1', type: 'practice', plannedMin: 45 })).toBe(true);
    const plan = h.plan.plan();
    const today = h.plan.today();
    const calendar = h.plan.calendar();

    h.timer.selectStep(1);
    expect(h.timer.state()?.steps?.activeIndex).toBe(1);
    expect(h.plan.plan()).toBe(plan);

    h.timer.nextStep();
    h.timer.pause();
    h.timer.resume();
    h.timer.prevStep();
    await settle(h.store);

    expect(h.timer.state()?.steps?.activeIndex).toBe(1);
    expect(h.plan.plan()).toBe(plan);
    expect(h.plan.today()).toBe(today);
    expect(h.plan.calendar()).toBe(calendar);
  });

  it('отметка «Время шага по плану вышло» на тике таймера пишет таймер, план недели прежний', async () => {
    const h = await boot(SMALL, at(addDays(START, 10), 12));
    h.timer.start({ itemId: 'i1', type: 'practice', plannedMin: 45 });
    const plan = h.plan.plan();

    await vi.advanceTimersByTimeAsync(min(10) + sec(2));
    TestBed.tick();

    expect(h.timer.state()?.steps?.planSignaled).toEqual([0]);
    expect(h.plan.plan()).toBe(plan);
  });

  it('«Стоп» записывает лог — план недели пересчитывается с этим логом', async () => {
    const h = await boot(SMALL, at(addDays(START, 10), 12));
    h.timer.start({ itemId: 'i1', type: 'practice', plannedMin: 45 });
    await vi.advanceTimersByTimeAsync(min(5));
    const plan = h.plan.plan();

    const logId = await h.timer.stop();

    expect(logId).not.toBeNull();
    expect(h.plan.plan()).not.toBe(plan);
    expect(h.plan.today()?.logged).toBe((plan.days[0]?.logged ?? 0) + 5);
  });
});

describe('план недели пересчитывается при смене настроек и бюджета', () => {
  it('граница дня: в 03:00 с границей 04:00 — вчерашний день, с границей 02:00 — сегодняшний', async () => {
    const day = addDays(START, 10);
    const h = await boot(SMALL, at(day, 3));
    const plan = h.plan.plan();
    expect(plan.days[0]?.date).toBe(addDays(day, -1));

    h.store.updateSettings({ dayBoundaryHour: 2 });

    expect(h.plan.plan()).not.toBe(plan);
    expect(h.plan.today()?.date).toBe(day);
  });

  it('пояс: 22:00 UTC по поясу Asia/Bangkok — уже 05:00 следующего дня', async () => {
    const day = addDays(START, 10);
    const h = await boot(SMALL, Date.parse(`${day}T22:00:00.000Z`));
    const plan = h.plan.plan();

    h.store.updateSettings({ timeZone: 'Asia/Bangkok' });

    expect(h.plan.plan()).not.toBe(plan);
    expect(h.plan.today()?.date).toBe(addDays(day, 1));
  });

  it('бюджет: новая ёмкость дней — новый план с этой ёмкостью', async () => {
    const h = await boot(SMALL, at(addDays(START, 10), 12));
    const plan = h.plan.plan();

    h.store.upsert('budgets', { ...h.store.budget(), dayCapacity: [60, 60, 60, 60, 60, 60, 60] });

    expect(h.plan.plan()).not.toBe(plan);
    expect(h.plan.plan().capacityPerWeek).toBe(420);
  });

  it('запись тех же значений настроек план не пересчитывает', async () => {
    const h = await boot(SMALL, at(addDays(START, 10), 12));
    const plan = h.plan.plan();

    h.store.updateSettings({ dayBoundaryHour: h.store.settings().dayBoundaryHour });

    expect(h.plan.plan()).toBe(plan);
  });
});

describe('смена шага на эталонном объёме Э-1 (НФТ «Время отклика»)', () => {
  // Лимит времени — настройка прогона, не требование НФТ: тест идёт 0,5–1 с, 10 с — запас на CPU, занятый соседями
  const MEASURE_TIMEOUT_MS = 10_000;

  it('3000 топиков и 10 000 логов: смена шага не пересчитывает план — запись и чтение плана не дольше 100 мс', { timeout: MEASURE_TIMEOUT_MS }, async () => {
    const program = referenceProgram();
    const h = await boot({ sections: [], topics: [], items: [], logs: [] }, at(addDays(START, 300), 12));
    // Данные кладутся прямо в память: загрузка из хранилища к замеру не относится
    h.store.data.update((data) => ({
      ...data,
      sections: [...program.sections],
      topics: [...program.topics],
      items: [...program.items],
      timeLogs: [...program.logs],
    }));
    const itemId = program.items[1]?.id ?? '';
    h.timer.start({ itemId, type: 'study', plannedMin: 90 });

    // Пересчёт плана на Э-1 — цена, которую до правки платила каждая запись таймера
    let started = performance.now();
    const plan = h.plan.plan();
    const recompute = performance.now() - started;

    const switches: number[] = [];
    for (const index of [2, 3, 4, 0]) {
      started = performance.now();
      h.timer.selectStep(index);
      h.plan.plan();
      h.plan.today();
      switches.push(performance.now() - started);
      expect(h.timer.state()?.steps?.activeIndex).toBe(index);
      expect(h.plan.plan()).toBe(plan);
    }
    const slowest = Math.max(...switches);
    expect(slowest).toBeLessThan(100);
    console.info(
      `З-22: Э-1 — пересчёт плана ${recompute.toFixed(1)} мс; смена шага с чтением плана: худшая ${slowest.toFixed(2)} мс из ${switches.length} (порог 100)`,
    );
  });
});
