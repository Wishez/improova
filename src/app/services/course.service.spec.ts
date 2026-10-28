import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_GUIDE } from '../domain';
import { budgetFixture, itemFixture, sectionFixture, topicFixture } from '../domain/test-fixtures';
import { MemoryAdapter, STORAGE_ADAPTER } from '../storage';
import type { IItem, IRouteBlock, ISection } from '../types';
import { addDays, configureTimeZone, fromDayKey } from '../utils';
import { CourseService } from './course.service';
import { DataStore, defaultChallenge, defaultMeta } from './data.store';
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
/** «Сейчас» — неделя 2 челленджа, квартал 1. */
const NOW = at(addDays(START, 10), 12);
const NOW_ISO = new Date(NOW).toISOString();

/** Раздел с квартальными весами 3 / 1 / 1 / 1: в квартале 1 вес 3. */
const SEASONAL: ISection = { ...sectionFixture('s1', 0, 2), quarterWeights: [3, 1, 1, 1] };
const PLAIN: ISection = sectionFixture('s2', 1, 1);

const ITEM: IItem = {
  ...itemFixture({ id: 'i1', topicId: 't1' }),
  guide: { ...EMPTY_GUIDE, goal: 'Цель', steps: [10, 20, 20].map((minutes, index) => ({ title: `Шаг ${index + 1}`, minutes })) },
};

function routeBlock(params: { readonly id: string; readonly order: number; readonly fromWeek: number; readonly copyTask: string }): IRouteBlock {
  return {
    id: params.id,
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
    order: params.order,
    fromWeek: params.fromWeek,
    toWeek: params.fromWeek + 3,
    artists: [
      { name: 'Сарджент', url: '', takeaway: 'Широкий мазок', works: '3 портрета' },
      { name: 'Цорн', url: '', takeaway: 'Ограниченная палитра', works: '2 портрета' },
    ],
    copyTask: params.copyTask,
    copyTechnique: 'гризайль',
    links: [],
    courseKey: null,
  };
}

const ROUTE: readonly IRouteBlock[] = [
  routeBlock({ id: 'rb1', order: 0, fromWeek: 1, copyTask: 'Копия Сарджента' }),
  routeBlock({ id: 'rb2', order: 1, fromWeek: 5, copyTask: 'Копия Цорна' }),
];

interface IHarness {
  readonly store: DataStore;
  readonly course: CourseService;
  readonly timer: TimerService;
}

/** Приложение на хранилище в памяти с часами NOW и квартальными весами в бюджете. */
async function boot(): Promise<IHarness> {
  vi.useFakeTimers({ now: NOW, toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  const adapter = new MemoryAdapter();
  await adapter.init();
  await adapter.putMany('budgets', [budgetFixture({ seasonalWeights: true })]);
  await adapter.putMany('challenges', [defaultChallenge(new Date(at(START, 9)).toISOString(), START)]);
  await adapter.putMany('meta', [defaultMeta()]);
  await adapter.putMany('sections', [SEASONAL, PLAIN]);
  await adapter.putMany('topics', [topicFixture('t1', 's1')]);
  await adapter.putMany('items', [ITEM]);
  await adapter.putMany('routeBlocks', [...ROUTE]);
  TestBed.configureTestingModule({ providers: [{ provide: STORAGE_ADAPTER, useValue: adapter }] });
  const store = TestBed.inject(DataStore);
  await store.init();
  return { store, course: TestBed.inject(CourseService), timer: TestBed.inject(TimerService) };
}

/** Все записи очереди `DataStore` дошли до хранилища. */
async function settle(store: DataStore): Promise<void> {
  await store.commit({ puts: [], removes: [] });
}

const weights = (h: IHarness): [string, number][] => [...h.course.sectionWeights()];
const routeIds = (h: IHarness): string[] => h.course.routeBlocks().map((block) => block.id);

afterEach(() => {
  TestBed.resetTestingModule();
  vi.useRealTimers();
  configureTimeZone('');
});

describe('веса разделов и маршрут не пересчитываются от записей таймера (НФТ «Время отклика»)', () => {
  it('отметка «Время шага по плану вышло», смена шага, пауза и продолжение пишут таймер, а веса, маршрут и блок недели прежние', async () => {
    const h = await boot();
    expect(h.timer.start({ itemId: 'i1', type: 'practice', plannedMin: 45 })).toBe(true);
    const sectionWeights = h.course.sectionWeights();
    const routeBlocks = h.course.routeBlocks();
    const focus = h.course.focus();
    expect(weights(h)).toEqual([
      ['s1', 3],
      ['s2', 1],
    ]);
    expect(focus?.artist?.name).toBe('Цорн');

    await vi.advanceTimersByTimeAsync(min(10) + sec(2));
    TestBed.tick();
    expect(h.timer.state()?.steps?.planSignaled).toEqual([0]);
    h.timer.selectStep(2);
    h.timer.prevStep();
    h.timer.pause();
    h.timer.resume();
    await settle(h.store);

    expect(h.timer.state()?.steps?.activeIndex).toBe(1);
    expect(h.course.sectionWeights()).toBe(sectionWeights);
    expect(h.course.routeBlocks()).toBe(routeBlocks);
    expect(h.course.focus()).toBe(focus);
  });
});

describe('веса разделов пересчитываются при изменении разделов', () => {
  it('вес раздела в текущем квартале 3 → 2 — новые веса с этим значением', async () => {
    const h = await boot();
    const before = h.course.sectionWeights();

    h.store.upsert('sections', { ...SEASONAL, quarterWeights: [2, 1, 1, 1], updatedAt: NOW_ISO });

    expect(h.course.sectionWeights()).not.toBe(before);
    expect(weights(h)).toEqual([
      ['s1', 2],
      ['s2', 1],
    ]);
  });

  it('раздел в архиве — его веса больше нет', async () => {
    const h = await boot();

    h.store.upsert('sections', { ...PLAIN, archived: true, updatedAt: NOW_ISO });

    expect(weights(h)).toEqual([['s1', 3]]);
  });

  it('новое название раздела весов не меняет — веса прежние, равны по значению', async () => {
    const h = await boot();
    const before = h.course.sectionWeights();

    h.store.upsert('sections', { ...SEASONAL, title: 'Свет и тень', updatedAt: NOW_ISO });

    expect(h.store.sections().find((section) => section.id === 's1')?.title).toBe('Свет и тень');
    expect(h.course.sectionWeights()).toBe(before);
  });
});

describe('маршрут пересчитывается при изменении блоков маршрута', () => {
  it('правка блока недели — новый маршрут, у блока недели новая копия', async () => {
    const h = await boot();
    const before = h.course.routeBlocks();

    h.course.updateBlock('rb1', { copyTask: 'Копия Веласкеса' });

    expect(h.course.routeBlocks()).not.toBe(before);
    expect(h.course.focus()?.block.copyTask).toBe('Копия Веласкеса');
    expect(h.course.taskOf({ ...ITEM, routeRole: 'copy' })).toBe('Копия Веласкеса. Техника: гризайль.');
  });

  it('удалённый блок уходит из маршрута, добавленный встаёт после последнего', async () => {
    const h = await boot();
    expect(routeIds(h)).toEqual(['rb1', 'rb2']);

    h.course.removeBlock('rb2');
    expect(routeIds(h)).toEqual(['rb1']);

    h.course.addBlock();
    expect(h.course.routeBlocks()).toHaveLength(2);
    expect(h.course.routeBlocks()[1]?.fromWeek).toBe(5);
  });
});
