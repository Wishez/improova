import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { budgetFixture, itemFixture, logFixture, sectionFixture, topicFixture } from '../domain/test-fixtures';
import { MemoryAdapter, STORAGE_ADAPTER } from '../storage';
import type { IMeta, ITimerState } from '../types';
import { configureTimeZone } from '../utils';
import { DataStore, defaultChallenge, defaultMeta } from './data.store';

const NOW = '2026-01-05T12:00:00.000Z';

/** Идущая сессия с шагами — то, что таймер пишет в `meta` при смене шага и отметке сигнала (ADR-007). */
function timer(activeIndex: number, planSignaled: readonly number[] = []): ITimerState {
  return {
    itemId: 'i1',
    type: 'practice',
    startedAt: NOW,
    pausedAt: null,
    pausedMs: 0,
    plannedMin: 45,
    stepMinutes: null,
    legacySchedule: false,
    steps: {
      activeIndex,
      spentMs: [120_000, 60_000, 0],
      startIndex: 0,
      continuesCircle: false,
      circleId: 'c1',
      stepCount: 3,
      firstMinuteIndex: 0,
      planSignaled,
      limitSignaled: false,
    },
  };
}

async function setup(): Promise<DataStore> {
  const adapter = new MemoryAdapter();
  await adapter.init();
  await adapter.putMany('budgets', [budgetFixture()]);
  await adapter.putMany('challenges', [defaultChallenge(NOW, '2026-01-05')]);
  await adapter.putMany('meta', [defaultMeta()]);
  await adapter.putMany('sections', [sectionFixture('s1', 0)]);
  await adapter.putMany('topics', [topicFixture('t1', 's1')]);
  await adapter.putMany('items', [itemFixture({ id: 'i1', topicId: 't1' }), itemFixture({ id: 'i2', topicId: 't1', order: 1 })]);
  await adapter.putMany('timeLogs', [logFixture({ id: 'l1', itemId: 'i1', type: 'practice', startedAt: NOW, minutes: 30 })]);
  TestBed.configureTestingModule({ providers: [{ provide: STORAGE_ADAPTER, useValue: adapter }] });
  const store = TestBed.inject(DataStore);
  await store.init();
  return store;
}

/** Всё, что считается из коллекций и настроек, — по ссылкам на текущий момент. */
function derived(store: DataStore): readonly unknown[] {
  return [
    store.settings(),
    store.today(),
    store.budget(),
    store.challenge(),
    store.tree(),
    store.logs(),
    store.spent(),
    store.resourcesById(),
    store.assetsById(),
    store.sections(),
    store.items(),
    store.timeLogs(),
    store.planBlocks(),
  ];
}

afterEach(() => {
  TestBed.resetTestingModule();
  configureTimeZone('');
});

describe('DataStore: запись таймера в meta не трогает настройки и коллекции (НФТ «Время отклика»)', () => {
  it('смена шага и отметка сигнала меняют meta, но не settings, дерево программы, логи, бюджет и челлендж', async () => {
    const store = await setup();
    store.updateMeta({ timer: timer(0) });
    const before = derived(store);
    const meta = store.meta();

    store.updateMeta({ timer: timer(1) });
    store.updateMeta({ timer: timer(1, [1]) });

    expect(store.meta()).not.toBe(meta);
    expect(store.meta().timer?.steps).toMatchObject({ activeIndex: 1, planSignaled: [1] });
    const after = derived(store);
    after.forEach((value, index) => expect(value).toBe(before[index]));
  });

  it('«Стоп» одной транзакцией: новые логи — новое значение логов, программа и настройки прежние', async () => {
    const store = await setup();
    store.updateMeta({ timer: timer(2) });
    const settings = store.settings();
    const tree = store.tree();
    const logs = store.logs();
    const meta: IMeta = { ...store.meta(), timer: null };

    await store.commit({
      puts: [
        { collection: 'timeLogs', entity: logFixture({ id: 'l2', itemId: 'i1', type: 'practice', startedAt: '2026-01-05T13:00:00.000Z', minutes: 20 }) },
        { collection: 'meta', entity: meta },
      ],
      removes: [],
    });

    expect(store.logs()).not.toBe(logs);
    expect(store.logs().map((log) => log.id)).toEqual(['l1', 'l2']);
    expect(store.tree()).toBe(tree);
    expect(store.settings()).toBe(settings);
  });

  it('запись коллекции меняет её срез и то, что от неё считается; остальные срезы прежние', async () => {
    const store = await setup();
    const items = store.items();
    const tree = store.tree();
    const timeLogs = store.timeLogs();
    const logs = store.logs();

    store.upsert('items', { ...itemFixture({ id: 'i2', topicId: 't1', order: 1 }), title: 'Новое название' });

    expect(store.items()).not.toBe(items);
    expect(store.tree()).not.toBe(tree);
    expect(store.tree().itemById.get('i2')?.title).toBe('Новое название');
    expect(store.timeLogs()).toBe(timeLogs);
    expect(store.logs()).toBe(logs);
  });
});

describe('DataStore: настройки меняются только при изменении по значению', () => {
  it('граница дня, пояс и список отключённых подсказок дают новые настройки с новым значением', async () => {
    const store = await setup();
    const initial = store.settings();

    store.updateSettings({ dayBoundaryHour: 6 });
    const boundary = store.settings();
    expect(boundary).not.toBe(initial);
    expect(boundary.dayBoundaryHour).toBe(6);

    store.updateSettings({ timeZone: 'Asia/Bangkok' });
    const zone = store.settings();
    expect(zone).not.toBe(boundary);
    expect(zone.timeZone).toBe('Asia/Bangkok');

    store.updateSettings({ disabledTips: ['rhythm'] });
    expect(store.settings()).not.toBe(zone);
    expect(store.settings().disabledTips).toEqual(['rhythm']);
  });

  it('запись тех же значений настроек — прежнее значение settings', async () => {
    const store = await setup();
    store.updateSettings({ dayBoundaryHour: 5, disabledTips: ['rhythm'] });
    const settings = store.settings();

    store.updateSettings({ dayBoundaryHour: 5, disabledTips: ['rhythm'] });

    expect(store.settings()).toBe(settings);
    expect(store.settings()).toMatchObject({ dayBoundaryHour: 5, disabledTips: ['rhythm'] });
  });
});
