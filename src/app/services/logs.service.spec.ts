import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stopPlace, type IStepCalendar } from '../domain';
import { itemFixture, logFixture } from '../domain/test-fixtures';
import { MemoryAdapter, STORAGE_ADAPTER } from '../storage';
import type { IItem, ILogSteps, ITimeLog } from '../types';
import { DataStore } from './data.store';
import { LOG_ERROR_TEXT, LogsService, findOverlap, validateLog } from './logs.service';
import { parseBulkLines } from './program.service';
import { ToastService } from './toast.service';

describe('validateLog (FR-14)', () => {
  const now = Date.parse('2026-01-05T12:00:00Z');
  it('конец раньше начала', () => {
    expect(validateLog({ startedAt: '2026-01-05T10:00:00Z', endedAt: '2026-01-05T09:00:00Z' }, now)).toBe('endBeforeStart');
  });
  it('длительность 1–720', () => {
    expect(validateLog({ startedAt: '2026-01-04T10:00:00Z', endedAt: '2026-01-05T10:00:00Z' }, now)).toBe('duration');
  });
  it('в будущем нельзя', () => {
    expect(validateLog({ startedAt: '2026-01-05T13:00:00Z', endedAt: '2026-01-05T14:00:00Z' }, now)).toBe('future');
  });
  it('корректный лог', () => {
    expect(validateLog({ startedAt: '2026-01-05T10:00:00Z', endedAt: '2026-01-05T10:45:00Z' }, now)).toBeNull();
  });
  it('пересечение — предупреждение, собственный лог не считается', () => {
    const log = logFixture({ id: 'a', itemId: null, type: 'creative', startedAt: '2026-01-05T10:00:00.000Z', minutes: 60 });
    expect(findOverlap({ startedAt: '2026-01-05T10:30:00.000Z', endedAt: '2026-01-05T11:30:00.000Z' }, [log], null)?.id).toBe('a');
    expect(findOverlap({ startedAt: '2026-01-05T10:30:00.000Z', endedAt: '2026-01-05T11:30:00.000Z' }, [log], 'a')).toBeNull();
  });
});

describe('parseBulkLines (FR-29)', () => {
  it('«название · 60» и строки без оценки', () => {
    expect(parseBulkLines('Глава 1 · 45\n\n  Видео про свет  \nКоробки | 90')).toEqual([
      { title: 'Глава 1', estimateMin: 45 },
      { title: 'Видео про свет', estimateMin: 60 },
      { title: 'Коробки', estimateMin: 90 },
    ]);
  });
});

const NOW = Date.parse('2026-10-12T18:00:00.000Z');
const CALENDAR: IStepCalendar = { challengeStart: '2026-10-12', routeBlocks: [], boundaryHour: 4 };

/** Свой топик ТД-2: «Контекст» 10, «10 работ» 20, «Штудии» 20, «Заметка» 10. */
const own: IItem = {
  ...itemFixture({ id: 'own', topicId: 'topic', kind: 'study' }),
  guide: {
    goal: '',
    task: '',
    steps: [
      { title: 'Контекст', minutes: 10 },
      { title: '10 работ', minutes: 20 },
      { title: 'Штудии', minutes: 20 },
      { title: 'Заметка', minutes: 10 },
    ],
    stopCriterion: '',
    links: [],
    references: [],
    imageIds: [],
    pitfalls: [],
  },
};

function logSteps(patch: Partial<ILogSteps>): ILogSteps {
  return {
    minutes: [20, 15, 0, 0],
    startIndex: 0,
    stopIndex: 1,
    continuesCircle: false,
    circleId: 'c1',
    limitMin: 45,
    stepCount: 4,
    firstMinuteIndex: 0,
    ...patch,
  };
}

function stepLog(id: string, startedAt: string, steps: ILogSteps): ITimeLog {
  const durationMin = steps.minutes.reduce((sum, value) => sum + value, 0);
  return {
    id,
    createdAt: startedAt,
    updatedAt: startedAt,
    itemId: 'own',
    type: 'study',
    startedAt,
    endedAt: new Date(Date.parse(startedAt) + durationMin * 60_000).toISOString(),
    durationMin,
    source: 'timer',
    editedAt: null,
    steps,
  };
}

interface IHarness {
  readonly adapter: MemoryAdapter;
  readonly store: DataStore;
  readonly logs: LogsService;
  readonly toasts: ToastService;
}

async function boot(logs: readonly ITimeLog[]): Promise<IHarness> {
  const adapter = new MemoryAdapter();
  await adapter.putMany('items', [own]);
  await adapter.putMany('timeLogs', logs);
  TestBed.configureTestingModule({ providers: [{ provide: STORAGE_ADAPTER, useValue: adapter }] });
  const store = TestBed.inject(DataStore);
  await store.init();
  return { adapter, store, logs: TestBed.inject(LogsService), toasts: TestBed.inject(ToastService) };
}

async function storedLogs(h: IHarness): Promise<readonly ITimeLog[]> {
  await h.store.commit({ puts: [], removes: [] });
  return (await h.adapter.loadAll()).timeLogs;
}

const logOf = (h: IHarness, id: string): ITimeLog | undefined => h.store.data().timeLogs.find((log) => log.id === id);

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
});

afterEach(() => {
  TestBed.resetTestingModule();
  vi.useRealTimers();
});

describe('правка минут лога (FR-64, US-31)', () => {
  it('US-31, критерий 2: в итоге 35 → 30 → 40 — шаг 2 — 10, затем 20, шаг 1 — 20; лог отмечен изменённым (НФТ «Аудит»)', async () => {
    const h = await boot([stepLog('log', '2026-10-12T16:00:00.000Z', logSteps({ minutes: [20, 15, 0, 0], stopIndex: 1 }))]);
    expect(h.logs.setDuration('log', 30)).toBeNull();
    expect(logOf(h, 'log')).toMatchObject({ durationMin: 30, steps: { minutes: [20, 10, 0, 0] } });
    expect(logOf(h, 'log')?.editedAt).toBe(new Date(NOW).toISOString());
    expect(h.logs.setDuration('log', 40)).toBeNull();
    expect(logOf(h, 'log')).toMatchObject({ durationMin: 40, steps: { minutes: [20, 20, 0, 0], firstMinuteIndex: 0 } });
    expect((await storedLogs(h))[0]).toMatchObject({ durationMin: 40, steps: { minutes: [20, 20, 0, 0] } });
  });

  it('US-31, критерий 5: конец сессии в списке логов на 10 мин раньше — 10 мин сняты с шага остановки, сумма шагов равна минутам лога', async () => {
    const h = await boot([stepLog('log', '2026-10-12T16:00:00.000Z', logSteps({ minutes: [0, 0, 12, 0], stopIndex: 2 }))]);
    expect(h.logs.update('log', { startedAt: '2026-10-12T16:00:00.000Z', endedAt: '2026-10-12T16:02:00.000Z' })).toBeNull();
    const log = logOf(h, 'log');
    expect(log).toMatchObject({ durationMin: 2, steps: { minutes: [0, 0, 2, 0], stopIndex: 2 } });
    expect(log?.editedAt).not.toBeNull();
    expect(stopPlace({ item: own, logs: h.store.logs(), calendar: CALENDAR })).toMatchObject({ stopIndex: 2, accumulated: [0, 0, 2, 0] });
  });

  it('начало сдвинуто без смены длины — минуты шагов прежние (ADR-007, правило 8)', async () => {
    const h = await boot([stepLog('log', '2026-10-12T16:00:00.000Z', logSteps({ minutes: [20, 15, 0, 0] }))]);
    expect(h.logs.update('log', { startedAt: '2026-10-12T15:00:00.000Z', endedAt: '2026-10-12T15:35:00.000Z' })).toBeNull();
    expect(logOf(h, 'log')?.steps?.minutes).toEqual([20, 15, 0, 0]);
  });

  it('US-31, критерий 4: 0 или 800 мин — ошибка «Длительность — от 1 до 720 минут.», минуты лога и шагов не изменились', async () => {
    const original = stepLog('log', '2026-10-12T16:00:00.000Z', logSteps({}));
    const h = await boot([original]);
    for (const minutes of [0, 800]) {
      const error = h.logs.setDuration('log', minutes);
      expect(error).toBe('duration');
      expect(error ? LOG_ERROR_TEXT[error] : '').toBe('Длительность — от 1 до 720 минут.');
    }
    expect(h.logs.update('log', { endedAt: '2026-10-12T16:00:00.000Z' })).toBe('endBeforeStart');
    expect(logOf(h, 'log')).toEqual(original);
  });

  it('ТК-А31: правка в итоге и в списке логов не меняет шаг, первым набравший 1 мин, даже когда его минуты стали 0 (ТК-Q021.7; Д-28, Q-025)', async () => {
    const h = await boot([stepLog('log', '2026-10-12T16:00:00.000Z', logSteps({ minutes: [3, 1, 2, 0], stopIndex: 2, firstMinuteIndex: 1 }))]);
    h.logs.setDuration('log', 3);
    expect(logOf(h, 'log')?.steps).toMatchObject({ minutes: [3, 0, 0, 0], firstMinuteIndex: 1 });
    h.logs.setDuration('log', 8);
    expect(logOf(h, 'log')?.steps).toMatchObject({ minutes: [3, 0, 5, 0], firstMinuteIndex: 1 });
    h.logs.update('log', { startedAt: '2026-10-12T16:00:00.000Z', endedAt: '2026-10-12T16:07:00.000Z' });
    expect(logOf(h, 'log')).toMatchObject({ durationMin: 7, steps: { minutes: [3, 0, 4, 0], firstMinuteIndex: 1 } });
    expect(logOf(h, 'log')?.editedAt).not.toBeNull();
  });

  it('ТК-А31: ручной лог — без сведений о шагах, правка его шагов не создаёт (FR-14, FR-65)', async () => {
    const h = await boot([]);
    const log = h.logs.create({ itemId: 'own', type: 'study', startedAt: '2026-10-12T16:00:00.000Z', endedAt: '2026-10-12T16:30:00.000Z', source: 'manual', steps: null });
    expect(log).toMatchObject({ durationMin: 30, source: 'manual', steps: null });
    h.logs.setDuration(log.id, 20);
    expect(logOf(h, log.id)).toMatchObject({ durationMin: 20, steps: null });
    expect(stopPlace({ item: own, logs: h.store.logs(), calendar: CALENDAR })).toBeNull();
  });

  it('лог, которому сменили тип на «Повторение», перестаёт задавать место (FR-64)', async () => {
    const h = await boot([stepLog('log', '2026-10-12T16:00:00.000Z', logSteps({}))]);
    expect(stopPlace({ item: own, logs: h.store.logs(), calendar: CALENDAR })).not.toBeNull();
    h.logs.update('log', { type: 'review' });
    expect(logOf(h, 'log')?.steps).toEqual(logSteps({}));
    expect(stopPlace({ item: own, logs: h.store.logs(), calendar: CALENDAR })).toBeNull();
  });
});

describe('удаление лога и «Отменить» (FR-64, Q-022)', () => {
  const first = stepLog('first', '2026-10-12T09:00:00.000Z', logSteps({ minutes: [10, 5, 0, 0], stopIndex: 1, circleId: 'c1' }));

  it('ТК-А23: лог уходит из хранилища сразу вместе со сведениями о шагах, deletedAt не ставится; «Отменить» в течение 10 с возвращает его целиком', async () => {
    for (const firstMinuteIndex of [1, null]) {
      const last = stepLog('last', '2026-10-12T16:00:00.000Z', logSteps({ minutes: [0, 15, 5, 0], startIndex: 1, stopIndex: 2, continuesCircle: true, circleId: 'c1', firstMinuteIndex }));
      const h = await boot([first, last]);
      const undo = vi.spyOn(h.toasts, 'undo');
      h.logs.remove('last');
      expect(logOf(h, 'last')).toBeUndefined();
      expect((await storedLogs(h)).map((log) => log.id)).toEqual(['first']);
      expect(h.store.data().timeLogs.some((log) => log.deletedAt)).toBe(false);
      const toast = h.toasts.toasts().find((entry) => entry.text === 'Сессия удалена');
      expect(toast).toMatchObject({ durationMs: 10_000, action: { label: 'Отменить' } });
      expect(undo).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(9000);
      if (toast) {
        h.toasts.runAction(toast);
      }
      expect(logOf(h, 'last')).toEqual(last);
      expect((await storedLogs(h)).find((log) => log.id === 'last')?.steps).toEqual(last.steps);
      TestBed.resetTestingModule();
    }
  });

  it('ТК-А23: без «Отменить» записи нет и через 11 с, отложенной очистки нет', async () => {
    const last = stepLog('last', '2026-10-12T16:00:00.000Z', logSteps({ minutes: [0, 15, 5, 0], stopIndex: 2, circleId: 'c1' }));
    const h = await boot([first, last]);
    h.logs.remove('last');
    vi.advanceTimersByTime(11_000);
    expect(h.toasts.toasts()).toEqual([]);
    expect(logOf(h, 'last')).toBeUndefined();
    expect((await storedLogs(h)).map((log) => log.id)).toEqual(['first']);
  });

  it('US-31, критерий 3: удаление последнего лога топика — место как без этой сессии; «Отменить» — как до удаления', async () => {
    const last = stepLog('last', '2026-10-12T16:00:00.000Z', logSteps({ minutes: [0, 15, 5, 0], startIndex: 1, stopIndex: 2, continuesCircle: true, circleId: 'c1' }));
    const h = await boot([first, last]);
    const before = stopPlace({ item: own, logs: [first], calendar: CALENDAR });
    const withLast = stopPlace({ item: own, logs: h.store.logs(), calendar: CALENDAR });
    expect(withLast).toMatchObject({ stopIndex: 2, accumulated: [10, 20, 5, 0] });
    h.logs.remove('last');
    expect(stopPlace({ item: own, logs: h.store.logs(), calendar: CALENDAR })).toEqual(before);
    const toast = h.toasts.toasts().find((entry) => entry.text === 'Сессия удалена');
    if (toast) {
      h.toasts.runAction(toast);
    }
    expect(stopPlace({ item: own, logs: h.store.logs(), calendar: CALENDAR })).toEqual(withLast);
  });
});
