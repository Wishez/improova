import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_GUIDE } from '../domain';
import { budgetFixture, itemFixture, logFixture, sectionFixture, topicFixture } from '../domain/test-fixtures';
import { MemoryAdapter, STORAGE_ADAPTER } from '../storage';
import type { IItem, INote } from '../types';
import { addDays, configureTimeZone, fromDayKey } from '../utils';
import { DataStore, defaultChallenge, defaultMeta } from './data.store';
import { InsightsService } from './insights.service';
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
/** «Сейчас» — четверг второй недели, полдень. */
const NOW = at(addDays(START, 10), 12);

/** Топик с ориентиром из шагов 10 / 20 / 20 мин. */
function topic(params: { readonly id: string; readonly order: number; readonly doneAt?: string | null }): IItem {
  return {
    ...itemFixture({ id: params.id, topicId: 't1', order: params.order, doneAt: params.doneAt }),
    guide: { ...EMPTY_GUIDE, goal: 'Цель', steps: [10, 20, 20].map((minutes, index) => ({ title: `Шаг ${index + 1}`, minutes })) },
  };
}

/** Раздел с одной темой и двумя топиками: i1 пройден, i2 нет — у раздела вехи 25 % и 50 %. Сессия 30 мин по i1 без заметки. */
const DONE_AT = new Date(at(addDays(START, 2), 11)).toISOString();
const OPEN_ITEM = topic({ id: 'i2', order: 1 });
const ITEMS: readonly IItem[] = [topic({ id: 'i1', order: 0, doneAt: DONE_AT }), OPEN_ITEM];
const LOG = logFixture({ id: 'l1', itemId: 'i1', type: 'practice', startedAt: new Date(at(addDays(START, 2), 10)).toISOString(), minutes: 30 });

function note(params: { readonly id: string; readonly logId: string | null; readonly itemId: string }): INote {
  const now = new Date(NOW).toISOString();
  return { id: params.id, createdAt: now, updatedAt: now, itemId: params.itemId, logId: params.logId, body: 'Тени мягче', worked: '', failed: '', next: '', imageIds: [] };
}

interface IHarness {
  readonly store: DataStore;
  readonly insights: InsightsService;
  readonly timer: TimerService;
}

/** Приложение на хранилище в памяти с часами NOW: тот же путь загрузки и записи, что в браузере. */
async function boot(): Promise<IHarness> {
  vi.useFakeTimers({ now: NOW, toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  const adapter = new MemoryAdapter();
  await adapter.init();
  await adapter.putMany('budgets', [budgetFixture()]);
  await adapter.putMany('challenges', [defaultChallenge(new Date(at(START, 9)).toISOString(), START)]);
  await adapter.putMany('meta', [defaultMeta()]);
  await adapter.putMany('sections', [sectionFixture('s1', 0)]);
  await adapter.putMany('topics', [topicFixture('t1', 's1')]);
  await adapter.putMany('items', [...ITEMS]);
  await adapter.putMany('timeLogs', [LOG]);
  TestBed.configureTestingModule({ providers: [{ provide: STORAGE_ADAPTER, useValue: adapter }] });
  const store = TestBed.inject(DataStore);
  await store.init();
  return { store, insights: TestBed.inject(InsightsService), timer: TestBed.inject(TimerService) };
}

/** Все записи очереди `DataStore` дошли до хранилища. */
async function settle(store: DataStore): Promise<void> {
  await store.commit({ puts: [], removes: [] });
}

const milestoneIds = (h: IHarness): string[] => h.insights.milestones().map((milestone) => milestone.id);

afterEach(() => {
  TestBed.resetTestingModule();
  vi.useRealTimers();
  configureTimeZone('');
});

describe('метрики и вехи не пересчитываются от записей таймера (НФТ «Время отклика»)', () => {
  it('отметка «Время шага по плану вышло», смена шага, пауза и продолжение пишут таймер, а метрики и вехи прежние', async () => {
    const h = await boot();
    expect(h.timer.start({ itemId: 'i2', type: 'practice', plannedMin: 45 })).toBe(true);
    const metrics = h.insights.metrics();
    const milestones = h.insights.milestones();

    await vi.advanceTimersByTimeAsync(min(10) + sec(2));
    TestBed.tick();
    expect(h.timer.state()?.steps?.planSignaled).toEqual([0]);
    h.timer.selectStep(1);
    h.timer.nextStep();
    h.timer.pause();
    h.timer.resume();
    h.timer.prevStep();
    await settle(h.store);

    expect(h.timer.state()?.steps?.activeIndex).toBe(1);
    expect(h.insights.metrics()).toBe(metrics);
    expect(h.insights.milestones()).toBe(milestones);
  });

  it('«Стоп» записывает лог — метрики и вехи пересчитываются с этим логом', async () => {
    const h = await boot();
    h.timer.start({ itemId: 'i2', type: 'practice', plannedMin: 45 });
    await vi.advanceTimersByTimeAsync(min(25));
    const metrics = h.insights.metrics();
    const milestones = h.insights.milestones();
    expect(metrics.reflection).toBe(0);

    const logId = await h.timer.stop();

    expect(logId).not.toBeNull();
    expect(h.insights.metrics()).not.toBe(metrics);
    expect(h.insights.milestones()).not.toBe(milestones);
    // Вторая долгая сессия без заметки: доля сессий с заметкой по-прежнему 0 из 2
    expect(h.insights.metrics().reflection).toBe(0);
  });
});

describe('метрики и вехи пересчитываются при изменении заметок, топиков и разделов', () => {
  it('заметка к сессии 30 мин — «Рефлексия» 0 → 1', async () => {
    const h = await boot();
    const metrics = h.insights.metrics();
    expect(metrics.reflection).toBe(0);

    h.store.upsert('notes', note({ id: 'n1', logId: 'l1', itemId: 'i1' }));

    expect(h.insights.metrics()).not.toBe(metrics);
    expect(h.insights.metrics().reflection).toBe(1);
  });

  it('топик отмечен пройденным — метрики новые, у вех «Первая закрытая тема» и 100 % раздела', async () => {
    const h = await boot();
    const metrics = h.insights.metrics();
    expect(milestoneIds(h)).toEqual(['section:s1:25', 'section:s1:50']);

    h.store.upsert('items', { ...OPEN_ITEM, doneAt: new Date(NOW).toISOString() });

    expect(h.insights.metrics()).not.toBe(metrics);
    expect(milestoneIds(h)).toEqual(['firstTopic', 'section:s1:25', 'section:s1:50', 'section:s1:75', 'section:s1:100']);
  });

  it('новое название раздела — в названии вехи раздела', async () => {
    const h = await boot();
    expect(h.insights.milestones().map((milestone) => milestone.title)).toEqual(['Раздел s1: 25 %', 'Раздел s1: 50 %']);

    h.store.upsert('sections', { ...sectionFixture('s1', 0), title: 'Свет и тень' });

    expect(h.insights.milestones().map((milestone) => milestone.title)).toEqual(['Свет и тень: 25 %', 'Свет и тень: 50 %']);
  });
});
