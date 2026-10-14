import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { buildProgramTree, minutesByDay, minutesBySection, minutesByType, planWeek, progressOfItems, spentByItem } from '../domain';
import { budgetFixture, itemFixture, logFixture, programFixture, sectionFixture, topicFixture } from '../domain/test-fixtures';
import { DataStore, defaultChallenge, defaultMeta } from '../services/data.store';
import type { ICollections, IItem, ILogSteps, IMeta, ITimeLog, ITimerState, ITimerSteps } from '../types';
import { createId } from '../utils';
import { MemoryAdapter } from './memory.adapter';
import { checkSnapshot, normalizeCollections } from './snapshot';
import { SCHEMA_VERSION, STORAGE_ADAPTER } from './storage-adapter';

// Сведения о шагах по ADR-007 собраны здесь, без правки domain/test-fixtures.ts (ТД-15)
const CIRCLE = '0192f5c4-6a1b-7c2d-8e3f-a1b2c3d4e5f6';
const STARTED = '2026-01-05T10:00:00.000Z';

/** Сессия «Сфера и куб» (20 / 10 / 60): 25 мин, шаг 1 — 20, шаг 2 — 5, остановка на шаге 2. */
function logSteps(patch: Partial<ILogSteps> = {}): ILogSteps {
  return {
    minutes: [20, 5, 0],
    startIndex: 0,
    stopIndex: 1,
    continuesCircle: false,
    circleId: CIRCLE,
    limitMin: 90,
    stepCount: 3,
    firstMinuteIndex: 0,
    ...patch,
  };
}

/** Идущая сессия: шаг 1 отдал 20 мин, активен шаг 2. */
function timerSteps(patch: Partial<ITimerSteps> = {}): ITimerSteps {
  return {
    activeIndex: 1,
    spentMs: [1_200_000, 0, 0],
    startIndex: 0,
    continuesCircle: false,
    circleId: CIRCLE,
    stepCount: 3,
    firstMinuteIndex: 0,
    planSignaled: [0],
    limitSignaled: false,
    ...patch,
  };
}

function steppedLog(id: string, steps: ILogSteps | null = logSteps(), startedAt = STARTED): ITimeLog {
  return { ...logFixture({ id, itemId: 'i1', type: 'practice', startedAt, minutes: 25 }), steps };
}

/** Таймер 1.5 «Сфера и куб»: длина 90, расписание после «+5 мин» на шаге 2. */
function legacyTimer(): ITimerState {
  return { itemId: 'i1', type: 'practice', startedAt: STARTED, pausedAt: null, pausedMs: 0, plannedMin: 90, stepMinutes: [20, 15, 60] };
}

function metaWith(timer: ITimerState | null): IMeta {
  return { ...defaultMeta(), timer };
}

/**
 * Лог, который «Стоп» пишет из идущей сессии (ADR-007, ITimerSteps): startIndex, continuesCircle, circleId, stepCount
 * и записанный firstMinuteIndex переходят без изменений, мс шагов — в целые минуты той же длины, остановка — на активном шаге,
 * лимит — plannedMin. Раскладка минут по правилу 7 здесь не важна: импорт не сверяет сумму шагов с durationMin.
 */
function stopLikeLog(timer: ITimerState, steps: ITimerSteps): ITimeLog {
  const minutes = steps.spentMs.map((ms) => Math.round(ms / 60_000));
  const durationMin = minutes.reduce((sum, value) => sum + value, 0);
  return {
    ...logFixture({ id: 'stopped', itemId: timer.itemId, type: timer.type, startedAt: timer.startedAt, minutes: durationMin }),
    steps: {
      minutes,
      startIndex: steps.startIndex,
      stopIndex: steps.activeIndex,
      continuesCircle: steps.continuesCircle,
      circleId: steps.circleId,
      limitMin: timer.plannedMin,
      stepCount: steps.stepCount,
      firstMinuteIndex: steps.firstMinuteIndex,
    },
  };
}

function snapshotFile(schemaVersion: number, data: object): string {
  return JSON.stringify({ app: 'improva', kind: 'full', schemaVersion, exportedAt: '2026-01-05T10:25:00.000Z', data });
}

/** Файлы копии схем 1–5: у каждой версии — поля её релиза; таймер 1.5 идёт, у схемы 5 — шаги лога и таймера. */
function schemaFiles(): readonly string[] {
  const { guide: _guide, routeRole: _role, courseKey: _key, courseHash: _hash, checkpointDay: _day, ...itemV1 } = itemFixture({ id: 'i1', topicId: 't1' });
  const { courseKey: _key2, courseHash: _hash2, checkpointDay: _day2, ...itemV2 } = itemFixture({ id: 'i1', topicId: 't1' });
  const { seasonalWeights: _seasonal, ...budgetV1 } = budgetFixture();
  const { courseVersion: _version, dismissedCourseKeys: _dismissed, courseBannerDismissed: _banner, sessionDraft: _draft, ...metaV2 } = metaWith(legacyTimer());
  const { sessionDraft: _draft3, ...metaV3 } = metaWith(legacyTimer());
  const { stepMinutes: _schedule, ...timerV1 } = legacyTimer();
  const log = logFixture({ id: 'l1', itemId: 'i1', type: 'practice', startedAt: STARTED, minutes: 25 });
  return [
    snapshotFile(1, { items: [itemV1], budgets: [budgetV1], meta: [{ ...metaV2, timer: timerV1 }], timeLogs: [log] }),
    snapshotFile(2, { items: [itemV2], budgets: [budgetFixture()], meta: [metaV2], timeLogs: [log] }),
    snapshotFile(3, { items: [itemFixture({ id: 'i1', topicId: 't1' })], meta: [metaV3], timeLogs: [log] }),
    snapshotFile(4, { items: [itemFixture({ id: 'i1', topicId: 't1' })], meta: [metaWith(legacyTimer())], timeLogs: [log] }),
    snapshotFile(5, {
      items: [itemFixture({ id: 'i1', topicId: 't1' })],
      meta: [metaWith({ ...legacyTimer(), stepMinutes: null, steps: timerSteps(), legacySchedule: false })],
      timeLogs: [steppedLog('l1'), steppedLog('l2', logSteps({ firstMinuteIndex: null })), { ...log, id: 'l3', source: 'manual', steps: null }],
    }),
  ];
}

/** Данные 1.5 (схема 4) в хранилище: программа и логи без шагов — таймер, ночная сессия до границы дня, ручной, творчество, повторение. */
async function schema4Storage(timer: ITimerState | null): Promise<MemoryAdapter> {
  const program = programFixture();
  const adapter = new MemoryAdapter();
  await adapter.putMany('sections', program.sections);
  await adapter.putMany('topics', program.topics);
  await adapter.putMany('items', program.items);
  await adapter.put('budgets', budgetFixture());
  await adapter.put('challenges', defaultChallenge(STARTED, '2026-01-05'));
  await adapter.put('meta', metaWith(timer));
  const logs: ITimeLog[] = [
    logFixture({ id: 'l1', itemId: 'a0-0', type: 'study', startedAt: '2026-01-05T10:00:00.000Z', minutes: 45 }),
    logFixture({ id: 'l2', itemId: 'a0-1', type: 'practice', startedAt: '2026-01-06T02:30:00.000Z', minutes: 90 }),
    { ...logFixture({ id: 'l3', itemId: 'b1-1', type: 'practice', startedAt: '2026-01-06T12:00:00.000Z', minutes: 30 }), source: 'manual', editedAt: '2026-01-06T13:00:00.000Z' },
    logFixture({ id: 'l4', itemId: null, type: 'creative', startedAt: '2026-01-07T18:00:00.000Z', minutes: 60 }),
    logFixture({ id: 'l5', itemId: 'a0-0', type: 'review', startedAt: '2026-01-08T09:00:00.000Z', minutes: 15 }),
  ];
  await adapter.putMany('timeLogs', logs);
  return adapter;
}

/** Минуты, которые считают «Статистика», прогресс и план (FR-65: до и после обновления совпадают). */
function countedMinutes(data: ICollections): object {
  const tree = buildProgramTree(data);
  const spent = spentByItem(data.timeLogs);
  return {
    byDay: [...minutesByDay(data.timeLogs, 4)],
    byType: minutesByType(data.timeLogs),
    bySection: [...minutesBySection(tree, data.timeLogs)],
    spent: [...spent],
    progress: progressOfItems(data.items, spent),
    plan: planWeek({ today: '2026-01-12', horizonDays: 7, budget: budgetFixture(), tree, resources: new Map(), logs: data.timeLogs, blocks: [], boundaryHour: 4 }),
  };
}

/** Очередь записи DataStore досылает изменения в хранилище за микрозадачи. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** DataStore на хранилище в памяти: тот же путь загрузки и записи, что в приложении. */
async function storeOn(adapter: MemoryAdapter): Promise<DataStore> {
  TestBed.configureTestingModule({ providers: [{ provide: STORAGE_ADAPTER, useValue: adapter }] });
  const store = TestBed.inject(DataStore);
  await store.init();
  await settle();
  return store;
}

afterEach(() => TestBed.resetTestingModule());

describe('импорт и экспорт (ТЗ 8.2, US-08)', () => {
  it('битый JSON и чужой файл отклоняются без изменений', () => {
    expect(checkSnapshot('{oops')).toEqual({ ok: false, reason: 'parse', path: '' });
    expect(checkSnapshot('{"app":"other","data":{}}')).toEqual({ ok: false, reason: 'parse', path: '' });
  });

  it('ошибка схемы указывает путь поля', () => {
    const broken = { app: 'improva', kind: 'full', schemaVersion: 1, exportedAt: '', data: { items: [itemFixture({ id: 'a', topicId: 't' }), { ...itemFixture({ id: 'b', topicId: 't' }), estimateMin: 'сорок' }] } };
    expect(checkSnapshot(JSON.stringify(broken))).toEqual({ ok: false, reason: 'schema', path: 'items[1].estimateMin' });
  });

  it('файл новее приложения отклоняется', () => {
    expect(checkSnapshot(JSON.stringify({ app: 'improva', schemaVersion: 99, data: {} }))).toMatchObject({ ok: false, path: 'schemaVersion' });
  });

  it('round-trip: экспорт → импорт «Заменить» даёт те же данные', async () => {
    const source = new MemoryAdapter();
    await source.init();
    await source.put('budgets', budgetFixture());
    await source.put('items', itemFixture({ id: 'i1', topicId: 't1' }));
    // Экспорт идёт из нормализованных данных в памяти: у лога без шагов поле steps: null (схема 5)
    const log: ITimeLog = { ...logFixture({ id: 'l1', itemId: 'i1', type: 'practice', startedAt: '2026-01-05T10:00:00.000Z', minutes: 45 }), steps: null };
    await source.put('timeLogs', log);
    const exported = await source.exportAll();
    const check = checkSnapshot(JSON.stringify(exported));
    expect(check.ok).toBe(true);
    const target = new MemoryAdapter();
    await target.init();
    if (check.ok) {
      await target.importAll(check.snapshot, 'replace');
    }
    expect(await target.loadAll()).toEqual(await source.loadAll());
  });

  it('файл v1 мигрирует в v2: поля ориентира и весов добавляются по умолчанию (FR-42)', () => {
    const { guide: _guide, routeRole: _role, ...legacyItem } = itemFixture({ id: 'a', topicId: 't' });
    const { seasonalWeights: _seasonal, ...legacyBudget } = budgetFixture();
    const file = { app: 'improva', kind: 'full', schemaVersion: 1, exportedAt: '', data: { items: [legacyItem], budgets: [legacyBudget] } };
    const check = checkSnapshot(JSON.stringify(file));
    expect(check.ok).toBe(true);
    if (check.ok) {
      expect(check.snapshot.schemaVersion).toBe(SCHEMA_VERSION);
      expect(check.snapshot.data.items?.[0]).toMatchObject({ guide: null, routeRole: null });
      expect(check.snapshot.data.budgets?.[0]?.seasonalWeights).toBe(false);
      expect(check.snapshot.data.routeBlocks).toBeUndefined();
    }
  });

  it('файл v2 мигрирует в v3: стартовые получают ключи курса по пути названий, версия курса 1 (FR-44)', () => {
    const { courseVersion: _version, dismissedCourseKeys: _dismissed, courseBannerDismissed: _banner, ...legacyMeta } = defaultMeta();
    const section = { ...sectionFixture('s', 0), title: 'Форма' };
    const topic = { ...topicFixture('t', 's'), title: 'Линия и разминка' };
    const starter = { ...itemFixture({ id: 'a', topicId: 't' }), title: 'Линии и эллипсы от плеча' };
    const custom = { ...itemFixture({ id: 'b', topicId: 't' }), title: 'Мой топик' };
    const strip = ({ courseKey: _key, courseHash: _hash, checkpointDay: _day, ...rest }: IItem): object => rest;
    const file = {
      app: 'improva',
      kind: 'full',
      schemaVersion: 2,
      exportedAt: '',
      data: { meta: [legacyMeta], sections: [section], topics: [topic], items: [strip(starter), strip(custom)] },
    };
    const check = checkSnapshot(JSON.stringify(file));
    expect(check.ok).toBe(true);
    if (check.ok) {
      expect(check.snapshot.data.meta?.[0]).toMatchObject({ courseVersion: 1, dismissedCourseKeys: [], courseBannerDismissed: null });
      expect(check.snapshot.data.sections?.[0]?.courseKey).toBe('section:Форма');
      expect(check.snapshot.data.items?.find((item) => item.id === 'a')?.courseKey).toBe('item:Форма/Линия и разминка/Линии и эллипсы от плеча');
      expect(check.snapshot.data.items?.find((item) => item.id === 'b')).toMatchObject({ courseKey: null, checkpointDay: null });
    }
    const empty = checkSnapshot(JSON.stringify({ ...file, data: { meta: [legacyMeta] } }));
    expect(empty.ok && empty.snapshot.data.meta?.[0]?.courseVersion).toBeNull();
  });

  it('чужой доступ ресурса и дробный день контрольной отклоняются (негативный)', () => {
    const resource = { id: 'r', createdAt: '', updatedAt: '', title: 'R', type: 'book', author: '', url: '', unit: 'page', unitCount: 1, minPerUnit: 1, archived: false, access: 'stolen' };
    expect(checkSnapshot(JSON.stringify({ app: 'improva', schemaVersion: 3, data: { resources: [resource] } }))).toMatchObject({ path: 'resources[0].access' });
    const item = { ...itemFixture({ id: 'a', topicId: 't' }), checkpointDay: 6.5 };
    expect(checkSnapshot(JSON.stringify({ app: 'improva', schemaVersion: 3, data: { items: [item] } }))).toMatchObject({ path: 'items[0].checkpointDay' });
  });

  it('черновик конспекта переживает экспорт; битый черновик сбрасывается, а не ломает импорт (v4)', () => {
    const draft = { logId: null, body: '## Штудии', worked: '', failed: '', next: '' };
    const good = checkSnapshot(JSON.stringify({ app: 'improva', schemaVersion: 4, data: { meta: [{ ...defaultMeta(), sessionDraft: draft }] } }));
    expect(good.ok && good.snapshot.data.meta?.[0]?.sessionDraft).toEqual(draft);
    const bad = checkSnapshot(JSON.stringify({ app: 'improva', schemaVersion: 4, data: { meta: [{ ...defaultMeta(), sessionDraft: { body: 5 } }] } }));
    expect(bad.ok && bad.snapshot.data.meta?.[0]?.sessionDraft).toBeNull();
  });

  it('пакетная запись применяет изменения и удаления вместе (НФТ 1.3)', async () => {
    const adapter = new MemoryAdapter();
    await adapter.put('items', itemFixture({ id: 'old', topicId: 't' }));
    await adapter.writeBatch({
      puts: [{ collection: 'items', entity: itemFixture({ id: 'new', topicId: 't' }) }],
      removes: [{ collection: 'items', id: 'old' }],
    });
    expect((await adapter.loadAll()).items.map((item) => item.id)).toEqual(['new']);
  });

  it('битый ориентир и чужая роль маршрута отклоняются с путём поля (негативный)', () => {
    const badGuide = { ...itemFixture({ id: 'a', topicId: 't' }), guide: { goal: 'Цель', steps: [{ title: 'Шаг', minutes: -5 }] } };
    expect(checkSnapshot(JSON.stringify({ app: 'improva', schemaVersion: 2, data: { items: [badGuide] } }))).toEqual({
      ok: false,
      reason: 'schema',
      path: 'items[0].guide',
    });
    const badRole = { ...itemFixture({ id: 'a', topicId: 't' }), routeRole: 'teacher' };
    expect(checkSnapshot(JSON.stringify({ app: 'improva', schemaVersion: 2, data: { items: [badRole] } }))).toMatchObject({ path: 'items[0].routeRole' });
  });

  it('«Объединить» берёт запись с большим updatedAt', async () => {
    const adapter = new MemoryAdapter();
    const old: IItem = { ...itemFixture({ id: 'i1', topicId: 't' }), title: 'старое', updatedAt: '2026-01-01T00:00:00Z' };
    await adapter.put('items', old);
    const report = await adapter.importAll(
      {
        app: 'improva',
        kind: 'full',
        schemaVersion: 1,
        exportedAt: '',
        data: {
          items: [
            { ...itemFixture({ id: 'i1', topicId: 't' }), title: 'новое', updatedAt: '2026-02-01T00:00:00Z' },
            itemFixture({ id: 'i2', topicId: 't' }),
          ],
        },
      },
      'merge',
    );
    expect(report).toMatchObject({ added: 1, updated: 1 });
    const data = await adapter.loadAll();
    expect(data.items.find((item) => item.id === 'i1')?.title).toBe('новое');
  });
});

describe('схема 5: сведения о шагах сессии (ADR-007, FR-56, FR-66)', () => {
  it('ТК-А20: файлы схем 1–5 проходят проверку и приводятся к текущей схеме', () => {
    const files = schemaFiles();
    files.forEach((text, index) => {
      const check = checkSnapshot(text);
      expect(check.ok, `схема ${index + 1}`).toBe(true);
      expect(check.ok && check.snapshot.schemaVersion).toBe(SCHEMA_VERSION);
    });
  });

  it('ТК-А20: логи схемы 5 с шагом, первым набравшим 1 мин, и без него проходят без изменений (Q-021, Q-025)', () => {
    const logs = [
      steppedLog('first', logSteps({ firstMinuteIndex: 1, startIndex: 1, continuesCircle: true })),
      // Ни один шаг не набрал 1 мин
      steppedLog('none', logSteps({ minutes: [0, 1, 0], firstMinuteIndex: null })),
      // Правка минут обнулила шаг, первым набравший 1 мин: правило 8 ADR-007 его не меняет
      steppedLog('edited', logSteps({ minutes: [0, 25, 0], firstMinuteIndex: 0 })),
      // Лог, исправленный в 1.5 после отката: сумма шагов ≠ минутам лога, домен выравнивает её сам (правило 4)
      steppedLog('rollback', logSteps({ minutes: [20, 15, 0] })),
      // Шаг, добавленный в ориентир во время сессии, удлиняет массив минут сверх stepCount
      steppedLog('grown', logSteps({ minutes: [20, 0, 0, 5], stopIndex: 3 })),
    ];
    const check = checkSnapshot(snapshotFile(5, { timeLogs: logs }));
    expect(check.ok).toBe(true);
    expect(check.ok && check.snapshot.data.timeLogs).toEqual(logs);
  });

  it('ТК-А20: файл схемы 6 отклоняется', () => {
    expect(checkSnapshot(snapshotFile(6, { timeLogs: [steppedLog('l1')] }))).toEqual({ ok: false, reason: 'schema', path: 'schemaVersion' });
  });

  const brokenLogs: readonly (readonly [string, object, string])[] = [
    ['шаги строкой', { ...steppedLog('l'), steps: 'шаг 2' }, '.steps'],
    ['шаги массивом', { ...steppedLog('l'), steps: [20, 5, 0] }, '.steps'],
    ['шаги у ручного лога', { ...steppedLog('l'), source: 'manual' }, '.steps'],
    ['шаги у лога без топика', { ...steppedLog('l'), itemId: null }, '.steps'],
    ['пустые минуты', steppedLog('l', logSteps({ minutes: [] })), '.steps.minutes'],
    ['дробная минута', steppedLog('l', logSteps({ minutes: [20, 4.5, 0] })), '.steps.minutes'],
    ['отрицательная минута', steppedLog('l', logSteps({ minutes: [26, -1, 0] })), '.steps.minutes'],
    ['шаг старта за пределами минут', steppedLog('l', logSteps({ startIndex: 3 })), '.steps.startIndex'],
    ['отрицательный шаг остановки', steppedLog('l', logSteps({ stopIndex: -1 })), '.steps.stopIndex'],
    ['число шагов 0', steppedLog('l', logSteps({ stepCount: 0 })), '.steps.stepCount'],
    ['число шагов больше минут', steppedLog('l', logSteps({ stepCount: 4 })), '.steps.stepCount'],
    ['лимит 0', steppedLog('l', logSteps({ limitMin: 0 })), '.steps.limitMin'],
    ['продолжение круга строкой', { ...steppedLog('l'), steps: { ...logSteps(), continuesCircle: 'да' } }, '.steps.continuesCircle'],
    ['пустой круг', steppedLog('l', logSteps({ circleId: '' })), '.steps.circleId'],
    ['нет поля firstMinuteIndex', { ...steppedLog('l'), steps: { ...logSteps(), firstMinuteIndex: undefined } }, '.steps.firstMinuteIndex'],
    ['firstMinuteIndex за пределами минут', steppedLog('l', logSteps({ firstMinuteIndex: 3 })), '.steps.firstMinuteIndex'],
    ['дробный firstMinuteIndex', steppedLog('l', logSteps({ firstMinuteIndex: 0.5 })), '.steps.firstMinuteIndex'],
  ];

  const brokenTimers: readonly (readonly [string, object, string])[] = [
    ['таймер строкой', { ...defaultMeta(), timer: 'идёт' }, '.timer'],
    ['legacySchedule строкой', { ...defaultMeta(), timer: { ...legacyTimer(), legacySchedule: 'да' } }, '.timer.legacySchedule'],
    ['legacySchedule null', { ...defaultMeta(), timer: { ...legacyTimer(), legacySchedule: null } }, '.timer.legacySchedule'],
    ['шаги таймера строкой', { ...defaultMeta(), timer: { ...legacyTimer(), steps: 'шаг 2' } }, '.timer.steps'],
    ['отрицательные мс шага', metaWith({ ...legacyTimer(), steps: timerSteps({ spentMs: [1_200_000, -1, 0] }) }), '.timer.steps.spentMs'],
    ['мс шага не числом', { ...defaultMeta(), timer: { ...legacyTimer(), steps: { ...timerSteps(), spentMs: [1_200_000, null, 0] } } }, '.timer.steps.spentMs'],
    ['активный шаг за пределами', metaWith({ ...legacyTimer(), steps: timerSteps({ activeIndex: 3 }) }), '.timer.steps.activeIndex'],
    ['отрицательный шаг старта', metaWith({ ...legacyTimer(), steps: timerSteps({ startIndex: -1 }) }), '.timer.steps.startIndex'],
    ['шаг старта за пределами мс шагов', metaWith({ ...legacyTimer(), steps: timerSteps({ startIndex: 3 }) }), '.timer.steps.startIndex'],
    ['число шагов 0', metaWith({ ...legacyTimer(), steps: timerSteps({ stepCount: 0 }) }), '.timer.steps.stepCount'],
    ['число шагов больше мс шагов', metaWith({ ...legacyTimer(), steps: timerSteps({ stepCount: 4 }) }), '.timer.steps.stepCount'],
    ['дробный сигнал шага', metaWith({ ...legacyTimer(), steps: timerSteps({ planSignaled: [0.5] }) }), '.timer.steps.planSignaled'],
    ['нет поля continuesCircle', { ...defaultMeta(), timer: { ...legacyTimer(), steps: { ...timerSteps(), continuesCircle: undefined } } }, '.timer.steps.continuesCircle'],
    ['сигнал лимита строкой', { ...defaultMeta(), timer: { ...legacyTimer(), steps: { ...timerSteps(), limitSignaled: 'нет' } } }, '.timer.steps.limitSignaled'],
    ['круг числом', { ...defaultMeta(), timer: { ...legacyTimer(), steps: { ...timerSteps(), circleId: 7 } } }, '.timer.steps.circleId'],
    ['пустой круг', metaWith({ ...legacyTimer(), steps: timerSteps({ circleId: '' }) }), '.timer.steps.circleId'],
    ['нет поля firstMinuteIndex', { ...defaultMeta(), timer: { ...legacyTimer(), steps: { ...timerSteps(), firstMinuteIndex: undefined } } }, '.timer.steps.firstMinuteIndex'],
    ['firstMinuteIndex за пределами', metaWith({ ...legacyTimer(), steps: timerSteps({ firstMinuteIndex: 3 }) }), '.timer.steps.firstMinuteIndex'],
  ];

  // Целый файл отклоняется по первому битому полю: годные записи из него тоже не применяются, данные приложения не меняются
  for (const [name, row, suffix] of brokenLogs) {
    it(`ТК-А20: битые сведения о шагах лога отклоняются с путём поля — ${name}`, () => {
      expect(checkSnapshot(snapshotFile(5, { timeLogs: [steppedLog('ok'), row] }))).toEqual({ ok: false, reason: 'schema', path: `timeLogs[1]${suffix}` });
    });
  }

  for (const [name, row, suffix] of brokenTimers) {
    it(`ТК-А20: битые шаги идущего таймера отклоняются с путём поля — ${name}`, () => {
      expect(checkSnapshot(snapshotFile(5, { timeLogs: [steppedLog('ok')], meta: [row] }))).toEqual({ ok: false, reason: 'schema', path: `meta[0]${suffix}` });
    });
  }

  it('ТК-А20: импорт судит таймер и лог, который из него запишет «Стоп», одинаково — принятый файл не даёт экспорт, который не импортируется', () => {
    const candidates: readonly (readonly [string, ITimerSteps, boolean])[] = [
      ['идущая сессия', timerSteps(), true],
      ['старт и активный — последний шаг, круг продолжается', timerSteps({ spentMs: [0, 0, 0], startIndex: 2, activeIndex: 2, continuesCircle: true, firstMinuteIndex: null, planSignaled: [] }), true],
      // Шаг, добавленный в ориентир во время сессии, удлиняет мс шагов сверх stepCount
      ['мс шагов длиннее числа шагов', timerSteps({ spentMs: [1_200_000, 0, 0, 300_000], activeIndex: 3 }), true],
      ['шаг старта за пределами мс шагов', timerSteps({ startIndex: 3 }), false],
      ['число шагов больше мс шагов', timerSteps({ stepCount: 4 }), false],
      ['пустой круг', timerSteps({ circleId: '' }), false],
    ];
    // Внутрь steps нормализация не заходит: таймер после импорта — тот же, что в файле (ТК-А21)
    const verdicts = candidates.map(([name, steps]) => {
      const timer: ITimerState = { ...legacyTimer(), stepMinutes: null, steps, legacySchedule: false };
      return {
        name,
        timer: checkSnapshot(snapshotFile(5, { meta: [metaWith(timer)] })).ok,
        log: checkSnapshot(snapshotFile(5, { timeLogs: [stopLikeLog(timer, steps)] })).ok,
      };
    });
    expect(verdicts).toEqual(candidates.map(([name, , accepted]) => ({ name, timer: accepted, log: accepted })));
  });
});

describe('миграция схемы 4 → 5: данные 1.0–1.5 (FR-65, US-32)', () => {
  const timers: readonly (readonly [string, ITimerState | null])[] = [
    ['с идущим таймером 1.5', legacyTimer()],
    ['без идущего таймера', null],
  ];

  for (const [name, timer] of timers) {
    it(`ТК-А21: снимок схемы 4 ${name} нормализуется без потерь, минуты статистики, прогресса и плана те же`, async () => {
      const stored = await (await schema4Storage(timer)).loadAll();
      const normalized = normalizeCollections(stored);
      // Только добавление полей: каждая запись — прежняя плюс умолчание, остальные коллекции не меняются
      expect(normalized.timeLogs).toEqual(stored.timeLogs.map((log) => ({ ...log, steps: null })));
      expect(normalized.meta).toEqual(stored.meta.map((meta) => ({ ...meta, timer: meta.timer ? { ...meta.timer, steps: null, legacySchedule: true } : null })));
      expect({ ...normalized, timeLogs: stored.timeLogs, meta: stored.meta }).toEqual(stored);
      expect(normalizeCollections(normalized)).toEqual(normalized);
      // Таймер 1.5 после нормализации проходит проверку схемы 5
      expect(checkSnapshot(snapshotFile(SCHEMA_VERSION, normalized)).ok).toBe(true);
      expect(countedMinutes(normalized)).toEqual(countedMinutes(stored));
    });
  }

  it('ТК-А21: загрузка данных 1.5 нормализует их в памяти и не перезаписывает хранилище', async () => {
    const adapter = await schema4Storage(legacyTimer());
    const stored = await adapter.loadAll();
    const store = await storeOn(adapter);
    expect(store.data().timeLogs.map((log) => log.steps)).toEqual([null, null, null, null, null]);
    // Перевод на шаги — при первом открытии таймера (FR-65), здесь только пометка
    expect(store.meta().timer).toEqual({ ...legacyTimer(), steps: null, legacySchedule: true });
    expect(await adapter.loadAll()).toEqual(stored);
  });

  it('ТК-А21: файл экспорта 1.5 с идущим таймером импортируется «Заменить» как данные схемы 5 (US-32, кр. 4)', async () => {
    const source = await schema4Storage(legacyTimer());
    const check = checkSnapshot(JSON.stringify({ ...(await source.exportAll()), schemaVersion: 4 }));
    expect(check.ok && check.snapshot.schemaVersion).toBe(SCHEMA_VERSION);
    const target = new MemoryAdapter();
    if (check.ok) {
      await target.importAll(check.snapshot, 'replace');
    }
    expect(await target.loadAll()).toEqual(normalizeCollections(await source.loadAll()));
  });

  it('ТК-А21: в файлах схем 1–4 логи «без шагов», таймер помечен legacySchedule; файл схемы 5 — как записан', () => {
    const checks = schemaFiles().map((text) => checkSnapshot(text));
    checks.slice(0, 4).forEach((check, index) => {
      expect(check.ok && check.snapshot.data.timeLogs?.map((log) => log.steps), `схема ${index + 1}`).toEqual([null]);
      expect(check.ok && check.snapshot.data.meta?.[0]?.timer, `схема ${index + 1}`).toMatchObject({ steps: null, legacySchedule: true, plannedMin: 90 });
    });
    const current = checks[4];
    expect(current?.ok && current.snapshot.data.timeLogs?.map((log) => log.steps)).toEqual([logSteps(), logSteps({ firstMinuteIndex: null }), null]);
    expect(current?.ok && current.snapshot.data.meta?.[0]?.timer).toMatchObject({ steps: timerSteps(), legacySchedule: false });
  });
});

describe('экспорт и импорт сведений о шагах (FR-66, US-32)', () => {
  const OTHER_CIRCLE = '0192f5c4-6a1b-7c2d-8e3f-00000000beef';

  /** Данные 1.6: сессии одного круга, ручной лог, лог без шагов до 1.6 и идущий таймер с шагами. */
  async function storageWithSteps(): Promise<MemoryAdapter> {
    const adapter = new MemoryAdapter();
    const logs: ITimeLog[] = [
      steppedLog('first', logSteps({ minutes: [20, 5, 0], stopIndex: 1, firstMinuteIndex: 0 }), '2026-01-05T10:00:00.000Z'),
      steppedLog('second', logSteps({ minutes: [0, 7, 18], startIndex: 1, stopIndex: 2, continuesCircle: true, firstMinuteIndex: 1 }), '2026-01-06T10:00:00.000Z'),
      steppedLog('short', logSteps({ minutes: [0, 0, 1], startIndex: 2, stopIndex: 2, continuesCircle: true, firstMinuteIndex: null }), '2026-01-07T10:00:00.000Z'),
      { ...logFixture({ id: 'manual', itemId: 'i1', type: 'practice', startedAt: '2026-01-07T12:00:00.000Z', minutes: 30 }), source: 'manual', steps: null },
      { ...logFixture({ id: 'legacy', itemId: 'i1', type: 'study', startedAt: '2026-01-04T12:00:00.000Z', minutes: 40 }), steps: null },
    ];
    await adapter.putMany('items', [itemFixture({ id: 'i1', topicId: 't1' })]);
    await adapter.putMany('timeLogs', logs);
    await adapter.put('meta', metaWith({ ...legacyTimer(), stepMinutes: null, steps: timerSteps({ circleId: OTHER_CIRCLE, firstMinuteIndex: null }), legacySchedule: false }));
    return adapter;
  }

  it('ТК-А22: экспорт 1.6 и импорт «Заменить» в пустое хранилище возвращают те же сведения о шагах, включая firstMinuteIndex', async () => {
    const source = await storageWithSteps();
    const check = checkSnapshot(JSON.stringify(await source.exportAll()));
    expect(check.ok).toBe(true);
    const target = new MemoryAdapter();
    if (check.ok) {
      await target.importAll(check.snapshot, 'replace');
    }
    const before = await source.loadAll();
    const after = await target.loadAll();
    expect(after).toEqual(before);
    expect(after.timeLogs.map((log) => log.steps?.firstMinuteIndex)).toEqual([0, 1, null, undefined, undefined]);
    expect(after.meta[0]?.timer?.steps).toEqual(timerSteps({ circleId: OTHER_CIRCLE, firstMinuteIndex: null }));
  });

  it('ТК-А22: «Объединить» переносит шаги вместе со своим логом и не теряет их ни у одной стороны', async () => {
    const file = await storageWithSteps();
    const target = new MemoryAdapter();
    const own = steppedLog('own', logSteps({ circleId: OTHER_CIRCLE, minutes: [3, 0, 0], stopIndex: 0, firstMinuteIndex: 0 }), '2026-01-08T10:00:00.000Z');
    // Та же сессия в браузере старее, чем в файле: побеждает запись файла целиком
    const olderSecond: ITimeLog = { ...steppedLog('second', logSteps({ minutes: [0, 25, 0], startIndex: 1, continuesCircle: true, firstMinuteIndex: 1 })), updatedAt: '2026-01-01T00:00:00.000Z' };
    // Правка в браузере новее файла: остаётся запись браузера со своими шагами
    const newerFirst: ITimeLog = { ...steppedLog('first', logSteps({ minutes: [15, 0, 0], stopIndex: 0, firstMinuteIndex: 0 })), durationMin: 15, updatedAt: '2026-02-01T00:00:00.000Z' };
    await target.putMany('timeLogs', [own, olderSecond, newerFirst]);
    const check = checkSnapshot(JSON.stringify(await file.exportAll()));
    expect(check.ok).toBe(true);
    if (check.ok) {
      await target.importAll(check.snapshot, 'merge');
    }
    const fromFile = new Map((await file.loadAll()).timeLogs.map((log) => [log.id, log]));
    const merged = new Map((await target.loadAll()).timeLogs.map((log) => [log.id, log]));
    expect(merged.get('own')).toEqual(own);
    expect(merged.get('first')).toEqual(newerFirst);
    expect(merged.get('second')).toEqual(fromFile.get('second'));
    expect(merged.get('short')).toEqual(fromFile.get('short'));
    expect(merged.get('manual')?.steps).toBeNull();
    expect([...merged.keys()].sort()).toEqual(['first', 'legacy', 'manual', 'own', 'second', 'short']);
    expect((await target.loadAll()).meta[0]?.timer?.steps?.circleId).toBe(OTHER_CIRCLE);
  });

  it('ТК-А24: полный экспорт 10 000 логов со сведениями о шагах растёт не больше чем на 2 000 000 байт (ДТ-6)', async () => {
    const count = 10_000;
    const start = Date.parse('2025-03-01T10:00:00.000Z');
    // Худший случай курса: 5 шагов (больше в ориентирах курса нет), двузначные минуты, трёхзначный лимит,
    // firstMinuteIndex: null и circleId — UUIDv7, как createId. Остальные коллекции в обоих экспортах одинаковы
    const legacyLogs = Array.from({ length: count }, (_, index) =>
      logFixture({ id: createId(start + index), itemId: createId(start - index), type: 'practice', startedAt: new Date(start + index * 1_800_000).toISOString(), minutes: 100 }),
    );
    const steps = (index: number): ILogSteps => ({
      minutes: [12, 24, 18, 30, 16],
      startIndex: 0,
      stopIndex: 4,
      continuesCircle: false,
      circleId: createId(start + index),
      limitMin: 120,
      stepCount: 5,
      firstMinuteIndex: null,
    });
    const size = async (logs: readonly ITimeLog[], schemaVersion: number): Promise<number> => {
      const adapter = new MemoryAdapter();
      await adapter.putMany('timeLogs', logs);
      return new TextEncoder().encode(JSON.stringify({ ...(await adapter.exportAll()), schemaVersion })).length;
    };
    const before = await size(legacyLogs, 4);
    const after = await size(legacyLogs.map((log, index) => ({ ...log, steps: steps(index) })), SCHEMA_VERSION);
    // Замер на этих данных — в описании pull request
    expect(after - before).toBeLessThanOrEqual(2_000_000);
  });
});

// Удаление и «Отменить» идут тем же путём, что LogsService.remove: DataStore.remove и upsert копии лога из памяти
describe('удаление лога со сведениями о шагах (Q-022, НФТ «Хранение»)', () => {
  const removedSteps = logSteps({ circleId: '0192f5c4-dead-7000-8000-00000000c1c1', firstMinuteIndex: 1, startIndex: 1, continuesCircle: true });

  it('ТК-А23: удаление сразу убирает лог вместе со шагами, без мягкого удаления; «Отменить» возвращает лог целиком', async () => {
    const adapter = new MemoryAdapter();
    await adapter.putMany('timeLogs', [steppedLog('kept'), steppedLog('removed', removedSteps, '2026-01-06T10:00:00.000Z')]);
    const store = await storeOn(adapter);
    const copy = store.data().timeLogs.find((log) => log.id === 'removed');
    expect(copy?.steps).toEqual(removedSteps);

    store.remove('timeLogs', ['removed']);
    await settle();
    const afterRemove = await adapter.loadAll();
    expect(afterRemove.timeLogs.map((log) => log.id)).toEqual(['kept']);
    expect(afterRemove.timeLogs.some((log) => log.deletedAt !== undefined)).toBe(false);
    // Шагов без лога не остаётся: в полном экспорте нет ни лога, ни его круга
    const exported = JSON.stringify(await adapter.exportAll());
    expect(exported).not.toContain('"removed"');
    expect(exported).not.toContain(removedSteps.circleId);

    if (copy) {
      store.upsert('timeLogs', copy);
    }
    await settle();
    const restored = (await adapter.loadAll()).timeLogs.find((log) => log.id === 'removed');
    expect(restored).toEqual(copy);
    expect(restored?.steps?.firstMinuteIndex).toBe(1);
  });

  it('ТК-А23: «Отменить» до окончания записи удаления не оставляет лога без шагов', async () => {
    const adapter = new MemoryAdapter();
    await adapter.put('timeLogs', steppedLog('removed', removedSteps));
    const store = await storeOn(adapter);
    const copy = store.data().timeLogs.find((log) => log.id === 'removed');
    store.remove('timeLogs', ['removed']);
    if (copy) {
      store.upsert('timeLogs', copy);
    }
    await settle();
    expect((await adapter.loadAll()).timeLogs).toEqual([copy]);
    expect(store.data().timeLogs).toEqual([copy]);
  });
});
