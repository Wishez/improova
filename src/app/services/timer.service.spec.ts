import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { stepStart, type IStepCalendar } from '../domain';
import { itemFixture } from '../domain/test-fixtures';
import { MemoryAdapter, STORAGE_ADAPTER, type IWriteBatch } from '../storage';
import type { IGuide, IItem, ILogSteps, ITimeLog, ITimerState, TItemKind } from '../types';
import { DataStore, defaultMeta } from './data.store';
import { ToastService } from './toast.service';
import { DEEP_WORK_LIMIT_MIN, TimerService, buildPhases, sessionEndText, shortStepTitle, stepPlanDoneText } from './timer.service';
import { UiStateService } from './ui-state.service';

/** Начало сессии в тестах: часы сессии «12:00» = START + 12 мин. */
const START = Date.parse('2026-10-12T10:00:00.000Z');
const min = (value: number): number => value * 60_000;
const sec = (value: number): number => value * 1000;
const total = (values: readonly number[]): number => values.reduce((sum, value) => sum + value, 0);

function guide(steps: readonly (readonly [string, number])[]): IGuide {
  return {
    goal: '',
    task: '',
    steps: steps.map(([title, minutes]) => ({ title, minutes })),
    stopCriterion: '',
    links: [],
    references: [],
    imageIds: [],
    pitfalls: [],
  };
}

function topic(params: {
  readonly id: string;
  readonly steps: readonly (readonly [string, number])[];
  readonly kind?: TItemKind;
  readonly checkpointDay?: number | null;
}): IItem {
  return {
    ...itemFixture({ id: params.id, topicId: 'topic', kind: params.kind ?? 'practice', checkpointDay: params.checkpointDay ?? null }),
    guide: params.steps.length > 0 ? guide(params.steps) : null,
  };
}

// Топики курса из тестовых данных ТД-1 (вкладка «Тест-кейсы 1.6»)
const sphere = topic({
  id: 'sphere',
  steps: [
    ['Линейное построение', 20],
    ['Граница света и тени, падающие тени', 10],
    ['Тон и рефлексы', 60],
  ],
});
const artists = topic({
  id: 'artists',
  kind: 'study',
  steps: [
    ['Контекст: годы, школа, техника', 10],
    ['10 работ в высоком разрешении', 20],
    ['3 штудии по 6 минут', 20],
    ['Заметка', 10],
  ],
});
const copy = topic({
  id: 'copy',
  steps: [
    ['Разбор: порядок слоёв, тёмное и светлое, жёсткие края', 15],
    ['Подмалёвок', 20],
    ['Исполнение', 70],
    ['Сравнение', 15],
  ],
});
const checkpoint = topic({
  id: 'checkpoint',
  checkpointDay: 66,
  steps: [
    ['Постановка и линейное построение', 15],
    ['Тон', 25],
    ['Детали', 65],
    ['Сравнение', 15],
  ],
});
const light = topic({
  id: 'light',
  kind: 'study',
  steps: [
    ['Свет и тень на шаре', 40],
    ['Падающие тени', 15],
    ['Ответ на самопроверку', 5],
  ],
});
const plain = topic({ id: 'plain', steps: [] });

const CALENDAR: IStepCalendar = { challengeStart: '2026-10-12', routeBlocks: [], boundaryHour: 4 };

interface IHarness {
  readonly adapter: MemoryAdapter;
  readonly store: DataStore;
  readonly timer: TimerService;
  readonly ui: UiStateService;
  readonly shows: MockInstance<ToastService['show']>;
  readonly commits: MockInstance<DataStore['commit']>;
}

/** Приложение на хранилище в памяти; новый вызов на том же хранилище — перезагрузка вкладки (ТД-15). */
async function boot(adapter: MemoryAdapter): Promise<IHarness> {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [{ provide: STORAGE_ADAPTER, useValue: adapter }] });
  const store = TestBed.inject(DataStore);
  await store.init();
  const shows = vi.spyOn(TestBed.inject(ToastService), 'show');
  const commits = vi.spyOn(store, 'commit');
  const timer = TestBed.inject(TimerService);
  TestBed.tick();
  await settle(store);
  return { adapter, store, timer, ui: TestBed.inject(UiStateService), shows, commits };
}

async function bootWith(items: readonly IItem[], logs: readonly ITimeLog[] = []): Promise<IHarness> {
  const adapter = new MemoryAdapter();
  await adapter.putMany('items', items);
  await adapter.putMany('timeLogs', logs);
  return boot(adapter);
}

/** Все записи очереди `DataStore` дошли до хранилища. */
async function settle(store: DataStore): Promise<void> {
  await store.commit({ puts: [], removes: [] });
}

async function reload(h: IHarness): Promise<IHarness> {
  await settle(h.store);
  return boot(h.adapter);
}

/** Вкладку закрыли и открыли в момент `ms` от START: тиков не было, часы ОС ушли вперёд (ТД-11). */
async function reopenAt(h: IHarness, ms: number): Promise<IHarness> {
  await settle(h.store);
  TestBed.resetTestingModule();
  vi.setSystemTime(START + ms);
  return boot(h.adapter);
}

/**
 * Часы до момента `ms` от START. Долгий промежуток проходит одним шагом часов, последняя секунда — тиком таймера:
 * сигналы зависят от состояния, а не от числа тиков, поэтому повтор сигнала виден и на последнем тике.
 */
async function at(ms: number): Promise<void> {
  const target = START + ms;
  if (target - Date.now() > sec(2)) {
    vi.setSystemTime(target - sec(1));
  }
  const delta = target - Date.now();
  if (delta > 0) {
    await vi.advanceTimersByTimeAsync(delta);
  }
  TestBed.tick();
}

async function stored(h: IHarness): Promise<{ readonly timer: ITimerState | null; readonly logs: readonly ITimeLog[] }> {
  await settle(h.store);
  const data = await h.adapter.loadAll();
  const meta = data.meta.find((entry) => entry.id === 'app');
  return { timer: meta?.timer ?? null, logs: data.timeLogs };
}

/** timer.stopFailed — знак в знак из вкладки «Тексты 1.6» (FR-56; НФТ «Надёжность»). */
const STOP_FAILED_TEXT = 'Сессия не записана: хранилище не отвечает. Таймер не остановлен — нажми «Стоп» ещё раз.';

const texts = (h: IHarness): string[] => h.shows.mock.calls.map(([params]) => params.text);
const count = (h: IHarness, text: string): number => texts(h).filter((entry) => entry === text).length;
const steps = (h: IHarness) => h.timer.state()?.steps ?? null;

/** Звук таймера: сколько раз он прозвучал (SoundService.chime через AudioContext). */
let chimes = 0;
class FakeAudioContext {
  readonly currentTime = 0;
  readonly destination = {};
  createOscillator(): object {
    return {
      type: 'sine',
      frequency: { value: 0 },
      connect: (node: unknown) => node,
      start: () => {
        chimes += 1;
      },
      stop: () => undefined,
    };
  }
  createGain(): object {
    return { gain: { setValueAtTime: () => undefined, exponentialRampToValueAtTime: () => undefined }, connect: (node: unknown) => node };
  }
}

function stepLog(params: {
  readonly id: string;
  readonly itemId: string;
  readonly startedAt: string;
  readonly steps: ILogSteps;
  readonly type?: ITimeLog['type'];
}): ITimeLog {
  const durationMin = total(params.steps.minutes);
  return {
    id: params.id,
    createdAt: params.startedAt,
    updatedAt: params.startedAt,
    itemId: params.itemId,
    type: params.type ?? 'study',
    startedAt: params.startedAt,
    endedAt: new Date(Date.parse(params.startedAt) + min(durationMin)).toISOString(),
    durationMin,
    source: 'timer',
    editedAt: null,
    steps: params.steps,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ now: START, toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  chimes = 0;
  vi.stubGlobal('AudioContext', FakeAudioContext);
});

afterEach(() => {
  TestBed.resetTestingModule();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('лимит сессии — длина при старте, шаги не сжимаются (FR-55, US-24)', () => {
  it('ТК-А01: старт с длиной блока 45 — лимит 45, активен шаг 1 с 0 мин, план шагов 20 / 10 / 60 не сжат (US-24, критерий 1)', async () => {
    const h = await bootWith([sphere]);
    expect(h.timer.start({ itemId: 'sphere', type: 'practice', plannedMin: 45 })).toBe(true);
    expect(h.timer.state()).toMatchObject({ plannedMin: 45, legacySchedule: false, stepMinutes: null });
    expect(steps(h)).toMatchObject({ activeIndex: 0, startIndex: 0, continuesCircle: false, stepCount: 3, spentMs: [0, 0, 0] });
    expect(h.timer.totalMin()).toBe(45);
    expect(h.timer.activeStep()).toMatchObject({ index: 0, title: 'Линейное построение', doneMin: 0, planMin: 20 });
    expect(h.timer.stepViews().map((view) => view.planMin)).toEqual([20, 10, 60]);
    expect(h.timer.phases().map((phase) => phase.minutes)).toEqual([20, 10, 60]);
  });

  it('ТК-А02: пять переключений вперёд и назад — лимит 45 после каждого, «Время сессии вышло» ровно один раз, на 45:00 (US-24, критерий 5)', async () => {
    const h = await bootWith([sphere]);
    h.timer.start({ itemId: 'sphere', type: 'practice', plannedMin: 45 });
    const moves: readonly (readonly [number, () => void])[] = [
      [min(7), () => h.timer.nextStep()],
      [min(12) + 400, () => h.timer.nextStep()],
      [min(20), () => h.timer.prevStep()],
      [min(28) + 700, () => h.timer.selectStep(2)],
      [min(40), () => h.timer.prevStep()],
    ];
    for (const [moment, move] of moves) {
      await at(moment);
      move();
      expect(h.timer.state()?.plannedMin).toBe(45);
      expect(h.timer.totalMin()).toBe(45);
    }
    await at(min(45) - sec(1));
    expect(count(h, sessionEndText(45))).toBe(0);
    await at(min(45));
    expect(count(h, sessionEndText(45))).toBe(1);
    await at(min(50));
    expect(count(h, sessionEndText(45))).toBe(1);
    expect(texts(h).filter((text) => text.startsWith('Время сессии вышло'))).toEqual([sessionEndText(45)]);
  });

  it('ТК-А03: старт с длиной 90 по ориентиру 15 / 20 / 70 / 15 — лимит 90, не 120; план шага 3 — 70 (US-24, критерий 6)', async () => {
    const h = await bootWith([copy]);
    h.timer.start({ itemId: 'copy', type: 'practice', plannedMin: 90 });
    expect(h.timer.state()?.plannedMin).toBe(90);
    expect(h.timer.totalMin()).toBe(90);
    expect(h.timer.stepViews()[2]).toMatchObject({ title: 'Исполнение', doneMin: 0, planMin: 70 });
    expect(h.timer.phases().map((phase) => phase.minutes)).toEqual([15, 20, 70, 15]);
  });

  it('«Повторение» по блоку — лимит 15 мин блока, шаг 1, новый круг (FR-62)', async () => {
    const h = await bootWith([artists]);
    h.timer.start({ itemId: 'artists', type: 'review', plannedMin: 15 });
    expect(h.timer.state()?.plannedMin).toBe(15);
    expect(steps(h)).toMatchObject({ activeIndex: 0, startIndex: 0, continuesCircle: false });
  });

  it('ТК-А04: сигнал лимита один раз и только со «Стоп», после перезагрузки не повторяется; минуты идут активному шагу (US-24, критерии 2, 7; Q-010; Д-21)', async () => {
    let h = await bootWith([sphere]);
    h.timer.start({ itemId: 'sphere', type: 'practice', plannedMin: 45 });
    await at(min(20));
    h.timer.nextStep();
    await at(min(30));
    h.timer.nextStep();
    await at(min(45));
    const signals = h.shows.mock.calls.filter(([params]) => params.text.startsWith('Время сессии вышло'));
    expect(signals).toHaveLength(1);
    const [signal] = signals[0] ?? [];
    expect(signal?.text).toBe('Время сессии вышло: 45 мин');
    expect(signal?.text).not.toContain('5 минут');
    // Единственное действие тоста — «Стоп»; продления нет ни у сигнала, ни у таймера (Q-010)
    expect(signal?.action?.label).toBe('Стоп');
    expect('extendStep' in h.timer).toBe(false);
    expect(steps(h)?.limitSignaled).toBe(true);
    expect((await stored(h)).timer?.steps?.limitSignaled).toBe(true);
    expect(h.timer.activeStep()).toMatchObject({ index: 2, doneMin: 15, planMin: 60 });

    await at(min(50));
    h = await reload(h);
    await at(min(60));
    expect(texts(h).filter((text) => text.startsWith('Время сессии вышло'))).toEqual([]);
    expect(h.timer.activeStep()).toMatchObject({ index: 2, doneMin: 30 });
    expect(h.timer.state()?.plannedMin).toBe(45);

    await at(min(60) + sec(15));
    const logId = await h.timer.stop();
    const log = (await stored(h)).logs.find((entry) => entry.id === logId);
    expect(log).toMatchObject({ durationMin: 60, steps: { limitMin: 45, minutes: [20, 10, 30], stopIndex: 2 } });
  });

  it('сигнал «Стоп» тоста лимита останавливает сессию и пишет лог', async () => {
    const h = await bootWith([sphere]);
    h.timer.start({ itemId: 'sphere', type: 'practice', plannedMin: 45 });
    await at(min(45));
    const signal = h.shows.mock.calls.find(([params]) => params.text === sessionEndText(45))?.[0];
    signal?.action?.run();
    await settle(h.store);
    await settle(h.store);
    expect(h.timer.state()).toBeNull();
    expect((await stored(h)).logs).toHaveLength(1);
  });

  it('сигнал на 90-й минуте (M3) не меняется', async () => {
    const h = await bootWith([copy]);
    h.timer.start({ itemId: 'copy', type: 'practice', plannedMin: 120 });
    await at(min(DEEP_WORK_LIMIT_MIN) - sec(1));
    expect(texts(h).some((text) => text.startsWith('90 минут'))).toBe(false);
    await at(min(DEEP_WORK_LIMIT_MIN));
    expect(texts(h).filter((text) => text.startsWith('90 минут'))).toHaveLength(1);
  });
});

describe('ручная смена шага (FR-52, US-23)', () => {
  it('ТК-А05: «Следующий шаг» меняет только активный шаг — часы, лимит и минуты других шагов прежние, время идёт новому (US-23, критерии 2, 3)', async () => {
    const h = await bootWith([artists]);
    h.timer.start({ itemId: 'artists', type: 'study', plannedMin: 45 });
    await at(min(10));
    h.timer.nextStep();
    await at(min(37));
    // US-23, критерий 2: у шага 2 «27 из 20 мин · +7 сверх плана»
    expect(h.timer.activeStep()).toMatchObject({ index: 1, doneMin: 27, planMin: 20, overMin: 7 });
    const before = h.timer.elapsed();
    h.timer.nextStep();
    expect(h.timer.elapsed()).toBe(before);
    expect(h.timer.state()?.plannedMin).toBe(45);
    expect(h.timer.stepViews().map((view) => view.doneMin)).toEqual([10, 27, 0, 0]);
    expect(h.timer.activeStep()?.index).toBe(2);
    await at(min(38));
    expect(h.timer.stepViews().map((view) => view.doneMin)).toEqual([10, 27, 1, 0]);
    expect(total(h.timer.stepMs())).toBe(h.timer.elapsed());
  });

  it('ТК-А05: «Предыдущий шаг» и выбор шага в списке — время сессии, лимит и минуты шагов не меняются (US-23, критерий 4)', async () => {
    const h = await bootWith([artists]);
    h.timer.start({ itemId: 'artists', type: 'study', plannedMin: 45 });
    await at(min(10));
    h.timer.nextStep();
    await at(min(37));
    h.timer.nextStep();
    const minutes = h.timer.stepViews().map((view) => view.doneMin);
    h.timer.prevStep();
    expect(h.timer.activeStep()?.index).toBe(1);
    h.timer.selectStep(0);
    expect(h.timer.activeStep()?.index).toBe(0);
    expect(h.timer.stepViews().map((view) => view.doneMin)).toEqual(minutes);
    expect(h.timer.elapsed()).toBe(min(37));
    expect(h.timer.state()?.plannedMin).toBe(45);
    // Выбор за пределами ориентира и на том же шаге ничего не меняет
    const state = h.timer.state();
    h.timer.selectStep(4);
    h.timer.selectStep(-1);
    h.timer.selectStep(0);
    h.timer.prevStep();
    expect(h.timer.state()).toBe(state);
  });

  it('ТК-А05: на паузе шаг меняется, минуты не идут; пауза 10 мин на 19 из 20 — шаг прежний, сигнала нет (US-23, критерий 6)', async () => {
    const h = await bootWith([artists]);
    h.timer.start({ itemId: 'artists', type: 'study', plannedMin: 45 });
    h.timer.nextStep();
    await at(min(19));
    h.timer.pause();
    await at(min(29));
    expect(h.timer.activeStep()).toMatchObject({ index: 1, doneMin: 19, planMin: 20 });
    expect(texts(h).some((text) => text.startsWith('Время шага'))).toBe(false);
    h.timer.nextStep();
    expect(h.timer.activeStep()?.index).toBe(2);
    h.timer.prevStep();
    expect(h.timer.activeStep()).toMatchObject({ index: 1, doneMin: 19 });
    await at(min(30));
    expect(h.timer.elapsed()).toBe(min(19));
    h.timer.resume();
    await at(min(31));
    expect(h.timer.activeStep()).toMatchObject({ index: 1, doneMin: 20 });
    expect(count(h, stepPlanDoneText({ title: '10 работ в высоком разрешении', planMin: 20 }))).toBe(1);
  });

  it('ТК-А05: шаг набрал план — сам не меняется; последний шаг набрал план до лимита — сессия идёт на нём, новый круг не начинается (US-24, критерий 4)', async () => {
    const h = await bootWith([artists]);
    h.timer.start({ itemId: 'artists', type: 'study', plannedMin: 45 });
    await at(min(15));
    expect(h.timer.activeStep()).toMatchObject({ index: 0, doneMin: 15, overMin: 5 });
    h.timer.selectStep(3);
    const circleId = steps(h)?.circleId;
    await at(min(30));
    expect(h.timer.activeStep()).toMatchObject({ index: 3, doneMin: 15, planMin: 10, overMin: 5 });
    expect(steps(h)).toMatchObject({ activeIndex: 3, startIndex: 0, circleId });
    expect(h.timer.stepViews().map((view) => view.doneMin)).toEqual([15, 0, 0, 15]);
  });

  it('ТК-А05: активный шаг и минуты шагов переживают перезагрузку; смена шага записывается сразу (НФТ «Надёжность»)', async () => {
    let h = await bootWith([artists]);
    h.timer.start({ itemId: 'artists', type: 'study', plannedMin: 45 });
    await at(min(10));
    h.timer.nextStep();
    await at(min(10) + sec(1));
    expect((await stored(h)).timer?.steps).toMatchObject({ activeIndex: 1, spentMs: [min(10), 0, 0, 0] });
    await at(min(25));
    h = await reload(h);
    expect(h.timer.activeStep()).toMatchObject({ index: 1, doneMin: 15 });
    await at(min(40));
    expect(h.timer.activeStep()).toMatchObject({ index: 1, doneMin: 30 });
    expect(h.timer.stepViews().map((view) => view.doneMin)).toEqual([10, 30, 0, 0]);
  });

  it('ТК-А28: ориентир укоротили во время сессии на шаге 4 из 4 — ошибки нет, активен шаг 3, время идёт ему (US-30, критерий 3; FR-63)', async () => {
    const h = await bootWith([artists]);
    h.timer.start({ itemId: 'artists', type: 'study', plannedMin: 45 });
    h.timer.nextStep();
    h.timer.nextStep();
    h.timer.nextStep();
    await at(min(5));
    const shortened = { ...artists, guide: guide([['Контекст', 10], ['10 работ', 20], ['3 штудии', 20]]) };
    h.store.upsert('items', shortened);
    TestBed.tick();
    expect(h.timer.activeStep()?.index).toBe(2);
    expect(steps(h)).toMatchObject({ activeIndex: 2, stepCount: 4 });
    // Массив мс шагов не укорачивается: время удалённого шага остаётся в сессии
    expect(steps(h)?.spentMs).toEqual([0, 0, 0, min(5)]);
    await at(min(6));
    expect(h.timer.stepMs()).toEqual([0, 0, min(1), min(5)]);
    expect(h.timer.stepViews().map((view) => view.doneMin)).toEqual([0, 0, 1]);
    const logId = await h.timer.stop();
    expect((await stored(h)).logs.find((log) => log.id === logId)?.steps).toMatchObject({ minutes: [0, 0, 1, 5], stopIndex: 2, stepCount: 4 });
  });

  it('сессия без шагов ориентира — шаблон фаз FR-12, смены шага нет (Д-1)', async () => {
    const h = await bootWith([plain]);
    h.timer.start({ itemId: 'plain', type: 'practice', plannedMin: 45 });
    expect(steps(h)).toBeNull();
    expect(h.timer.guideSteps()).toBeNull();
    expect(h.timer.phases()).toEqual(buildPhases(45));
    const state = h.timer.state();
    h.timer.nextStep();
    h.timer.selectStep(1);
    expect(h.timer.state()).toBe(state);
  });
});

describe('сигнал «Время шага по плану вышло» (FR-54, US-23)', () => {
  it('ТК-А06: шаг набрал план — тихий звук и тост 6 с без кнопок, шаг не меняется, у шага «20 из 20 мин» (US-23, критерий 1)', async () => {
    const h = await bootWith([artists]);
    h.timer.start({ itemId: 'artists', type: 'study', plannedMin: 45 });
    await at(sec(30));
    h.timer.nextStep();
    await at(min(20) + sec(30) - sec(1));
    expect(texts(h).filter((text) => text.startsWith('Время шага'))).toEqual([]);
    await at(min(20) + sec(30));
    const text = 'Время шага по плану вышло: 10 работ в высоком разрешении · 20 мин';
    const signal = h.shows.mock.calls.find(([params]) => params.text === text)?.[0];
    expect(signal).toMatchObject({ durationMs: 6000 });
    expect(signal?.action).toBeUndefined();
    expect(chimes).toBe(1);
    expect(h.timer.activeStep()).toMatchObject({ index: 1, doneMin: 20, planMin: 20 });
    expect(steps(h)?.planSignaled).toEqual([1]);
    // Сигнала «Шаг: …» при смене шага больше нет
    expect(texts(h).some((entry) => entry.startsWith('Шаг:'))).toBe(false);
  });

  it('ТК-А06: шаг уже подал сигнал — уход и возврат не повторяют его, в том числе после перезагрузки (US-23, критерий 5; НФТ «Надёжность»)', async () => {
    let h = await bootWith([artists]);
    h.timer.start({ itemId: 'artists', type: 'study', plannedMin: 90 });
    await at(min(11));
    expect(texts(h).filter((text) => text.startsWith('Время шага'))).toHaveLength(1);
    h.timer.nextStep();
    h.timer.prevStep();
    await at(min(13));
    h = await reload(h);
    await at(min(15));
    expect(texts(h).filter((text) => text.startsWith('Время шага'))).toEqual([]);
    expect(h.timer.activeStep()).toMatchObject({ index: 0, doneMin: 15 });
  });

  it('ТК-А06: звуки выключены — звука нет, тост есть, шаг не сменился (US-23, критерий 7)', async () => {
    const h = await bootWith([artists]);
    h.store.updateSettings({ sound: false });
    h.timer.start({ itemId: 'artists', type: 'study', plannedMin: 45 });
    await at(min(10));
    expect(count(h, stepPlanDoneText({ title: 'Контекст: годы, школа, техника', planMin: 10 }))).toBe(1);
    expect(chimes).toBe(0);
    expect(h.timer.activeStep()?.index).toBe(0);
  });

  it('ТК-А06: шаг, ставший активным с уже набранным планом, сигнала не получает (FR-54)', async () => {
    // Место: шаг 2 с 25 из 20 мин, у шага 1 — 10 из 10 (US-26, критерий 4)
    const place = stepLog({
      id: 'place',
      itemId: 'artists',
      startedAt: '2026-10-12T08:00:00.000Z',
      steps: { minutes: [10, 25, 0, 0], startIndex: 0, stopIndex: 1, continuesCircle: false, circleId: 'c1', limitMin: 45, stepCount: 4, firstMinuteIndex: 0 },
    });
    const h = await bootWith([artists], [place]);
    h.timer.start({ itemId: 'artists', type: 'study', plannedMin: 45 });
    expect(steps(h)).toMatchObject({ activeIndex: 1, continuesCircle: true, circleId: 'c1', planSignaled: [1] });
    expect(h.timer.activeStep()).toMatchObject({ doneMin: 25, overMin: 5 });
    await at(min(3));
    h.timer.selectStep(0);
    await at(min(6));
    expect(texts(h).filter((text) => text.startsWith('Время шага'))).toEqual([]);
    expect(h.timer.stepViews().map((view) => view.doneMin)).toEqual([13, 28, 0, 0]);
  });

  it('ТК-А06: продолжение круга — сигнал, когда накопленное круга достигает плана: 12 из 20 → через 8 мин (US-25, критерий 2)', async () => {
    const place = stepLog({
      id: 'place',
      itemId: 'artists',
      startedAt: '2026-10-12T08:00:00.000Z',
      steps: { minutes: [10, 20, 12, 0], startIndex: 0, stopIndex: 2, continuesCircle: false, circleId: 'c1', limitMin: 45, stepCount: 4, firstMinuteIndex: 0 },
    });
    const h = await bootWith([artists], [place]);
    h.timer.start({ itemId: 'artists', type: 'study', plannedMin: 45 });
    expect(h.timer.activeStep()).toMatchObject({ index: 2, doneMin: 12, planMin: 20 });
    await at(min(8) - sec(1));
    expect(texts(h).filter((text) => text.startsWith('Время шага'))).toEqual([]);
    await at(min(8));
    expect(count(h, stepPlanDoneText({ title: '3 штудии по 6 минут', planMin: 20 }))).toBe(1);
  });

  it('ТК-А06: контрольная работа — сигнал есть, шаг не сменился (US-27, критерий 2)', async () => {
    const h = await bootWith([checkpoint]);
    h.timer.start({ itemId: 'checkpoint', type: 'practice', plannedMin: 90 });
    await at(min(15));
    expect(count(h, stepPlanDoneText({ title: 'Постановка и линейное построение', planMin: 15 }))).toBe(1);
    expect(h.timer.activeStep()?.index).toBe(0);
    await at(min(16));
    expect(h.timer.activeStep()).toMatchObject({ index: 0, doneMin: 16 });
  });

  it('ТК-А06: сессия без ориентира с «Фазами» — фаза меняется сама с сигналом «Фаза: …», как в 1.5 (US-23, критерий 8; Д-1)', async () => {
    const h = await bootWith([]);
    h.timer.start({ itemId: null, type: 'creative', plannedMin: 30 });
    await at(sec(1));
    expect(h.timer.phaseIndex()).toBe(0);
    await at(min(3) + sec(1));
    expect(h.timer.phaseIndex()).toBe(1);
    expect(count(h, 'Фаза: Отработка')).toBe(1);
    expect(texts(h).some((text) => text.startsWith('Время шага'))).toBe(false);
    await at(min(30));
    expect(count(h, sessionEndText(30))).toBe(1);
  });

  it('название шага длиннее 53 знаков сокращается по П-1, курс не сокращается', () => {
    const long = 'Исполнение: своя техника маршрута с очень длинным названием блока';
    expect(shortStepTitle(long)).toBe(`${long.slice(0, 52).trimEnd()}…`);
    expect(shortStepTitle(long).length).toBeLessThanOrEqual(53);
    expect(shortStepTitle('Разбор: порядок слоёв, тёмное и светлое, жёсткие края')).toBe('Разбор: порядок слоёв, тёмное и светлое, жёсткие края');
  });
});

describe('запись сведений о шагах при «Стоп», «Переключиться», «Засчитать» (FR-56)', () => {
  const batchOf = (h: IHarness): IWriteBatch | undefined => h.commits.mock.calls.map(([batch]) => batch).find((batch) => batch.puts.length > 0);

  it('ТК-А07: «Стоп» на 45-й минуте — лог 45 мин, шаги 20 / 10 / 15, шаг остановки 3; лог и очистка таймера — одним commit (US-24, критерий 3)', async () => {
    const h = await bootWith([sphere]);
    h.timer.start({ itemId: 'sphere', type: 'practice', plannedMin: 45 });
    const circleId = steps(h)?.circleId;
    await at(min(20));
    h.timer.nextStep();
    await at(min(30));
    h.timer.nextStep();
    await at(min(45) + sec(15));
    const logId = await h.timer.stop();
    const batch = batchOf(h);
    expect(batch?.puts.map((entry) => entry.collection)).toEqual(['timeLogs', 'meta']);
    expect(batch?.puts.find((entry) => entry.collection === 'meta')?.entity).toMatchObject({ timer: null });
    const { timer, logs } = await stored(h);
    expect(timer).toBeNull();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      id: logId,
      itemId: 'sphere',
      source: 'timer',
      durationMin: 45,
      steps: { minutes: [20, 10, 15], startIndex: 0, stopIndex: 2, continuesCircle: false, circleId, limitMin: 45, stepCount: 3, firstMinuteIndex: 0 },
    });
    expect(h.ui.summaryLogId()).toBe(logId);
  });

  it('ТК-А07: «Переключиться» пишет лог текущей сессии со сведениями о шагах, новая сессия стартует после записи', async () => {
    const h = await bootWith([sphere, artists]);
    h.timer.start({ itemId: 'artists', type: 'study', plannedMin: 45 });
    await at(sec(20));
    h.timer.nextStep();
    await at(min(2) + sec(15));
    expect(h.timer.start({ itemId: 'sphere', type: 'practice', plannedMin: 45 })).toBe(false);
    await h.timer.switchToPending();
    const batch = batchOf(h);
    expect(batch?.puts.map((entry) => entry.collection)).toEqual(['timeLogs', 'meta']);
    const { logs } = await stored(h);
    expect(logs).toHaveLength(1);
    // ТК-Q021.2: шаг 1 до смены набрал 20 с — шаг первой минуты 2
    expect(logs[0]).toMatchObject({ itemId: 'artists', durationMin: 2, steps: { minutes: [0, 2, 0, 0], stopIndex: 1, firstMinuteIndex: 1 } });
    expect(h.timer.state()).toMatchObject({ itemId: 'sphere', plannedMin: 45 });
    expect(h.ui.summaryLogId()).toBeNull();
  });

  it('ТК-А07: «Засчитать» 45 после 5 ч — лог 45: шаг 1 — 10, шаг 2 — 35, место «шаг 2 · 35 из 20» (US-31, критерий 1)', async () => {
    let h = await bootWith([artists]);
    h.timer.start({ itemId: 'artists', type: 'study', plannedMin: 45 });
    await at(min(10));
    h.timer.nextStep();
    h = await reopenAt(h, min(300));
    h.timer.checkForgotten();
    expect(h.ui.forgottenOpen()).toBe(true);
    const logId = await h.timer.stop(45);
    const log = (await stored(h)).logs.find((entry) => entry.id === logId);
    expect(log).toMatchObject({ durationMin: 45, steps: { minutes: [10, 35, 0, 0], stopIndex: 1, firstMinuteIndex: 0 } });
    expect(stepStart({ item: artists, type: 'study', logs: h.store.logs(), day: '2026-10-12', calendar: CALENDAR })).toMatchObject({
      rule: 'continue',
      startIndex: 1,
      accumulated: [10, 35, 0, 0],
    });
  });

  it('ТК-А07: сессия 40 с и «Удалить сессию» ничего не пишут, место то же (US-25, критерии 6, 9)', async () => {
    const place = stepLog({
      id: 'place',
      itemId: 'artists',
      startedAt: '2026-10-12T08:00:00.000Z',
      steps: { minutes: [10, 20, 12, 0], startIndex: 0, stopIndex: 2, continuesCircle: false, circleId: 'c1', limitMin: 45, stepCount: 4, firstMinuteIndex: 0 },
    });
    let h = await bootWith([artists], [place]);
    const placeBefore = stepStart({ item: artists, type: 'study', logs: h.store.logs(), day: '2026-10-12', calendar: CALENDAR });
    h.timer.start({ itemId: 'artists', type: 'study', plannedMin: 45 });
    await at(sec(40));
    expect(await h.timer.stop()).toBeNull();
    expect(count(h, 'Сессия короче минуты не записана.')).toBe(1);
    expect(h.timer.state()).toBeNull();

    h.timer.start({ itemId: 'artists', type: 'study', plannedMin: 45 });
    await at(min(2));
    h = await reopenAt(h, min(300));
    h.timer.discard();
    const { timer, logs } = await stored(h);
    expect(timer).toBeNull();
    expect(logs.map((log) => log.id)).toEqual(['place']);
    expect(batchOf(h)).toBeUndefined();
    expect(stepStart({ item: artists, type: 'study', logs: h.store.logs(), day: '2026-10-12', calendar: CALENDAR })).toEqual(placeBefore);
  });

  it('ТК-А07: сессия без шагов ориентира пишет лог без шагов (FR-65)', async () => {
    const h = await bootWith([plain]);
    h.timer.start({ itemId: 'plain', type: 'practice', plannedMin: 45 });
    await at(min(12));
    await h.timer.stop();
    expect((await stored(h)).logs[0]).toMatchObject({ durationMin: 12, steps: null });
  });

  it('ТК-А08: хранилище отказало при «Стоп» — лога нет, таймер идёт со всеми шагами, тост об ошибке; повторный «Стоп» пишет один лог (НФТ «Надёжность»)', async () => {
    class FailingOnceAdapter extends MemoryAdapter {
      private failed = false;
      override async writeBatch(batch: IWriteBatch): Promise<void> {
        if (!this.failed && batch.puts.length > 0) {
          this.failed = true;
          throw new Error('Хранилище не отвечает');
        }
        return super.writeBatch(batch);
      }
    }
    const adapter = new FailingOnceAdapter();
    await adapter.putMany('items', [artists]);
    const h = await boot(adapter);
    h.timer.start({ itemId: 'artists', type: 'study', plannedMin: 45 });
    await at(min(3));
    h.timer.nextStep();
    await at(min(5));
    const running = h.timer.state();
    expect(await h.timer.stop()).toBeNull();
    expect(texts(h)).toContain(STOP_FAILED_TEXT);
    expect(h.timer.state()).toEqual(running);
    expect(h.store.data().timeLogs).toEqual([]);
    expect((await stored(h)).timer?.steps).toMatchObject({ activeIndex: 1, spentMs: [min(3), 0, 0, 0] });
    await at(min(6));
    expect(h.timer.activeStep()).toMatchObject({ index: 1, doneMin: 3 });
    const logId = await h.timer.stop();
    const { timer, logs } = await stored(h);
    expect(timer).toBeNull();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ id: logId, durationMin: 6, steps: { minutes: [3, 3, 0, 0], stopIndex: 1 } });
  });

  it('хранилище отказало при «Стоп» на паузе — тост-ошибка timer.stopFailed на 10 с без кнопок, таймер стоит на паузе, как до «Стоп» (FR-56)', async () => {
    const h = await bootWith([artists]);
    h.timer.start({ itemId: 'artists', type: 'study', plannedMin: 45 });
    await at(min(5));
    h.timer.pause();
    await at(min(7));
    const paused = h.timer.state();
    h.commits.mockRejectedValueOnce(new Error('Хранилище не отвечает'));
    expect(await h.timer.stop()).toBeNull();
    expect(h.shows).toHaveBeenCalledWith({ text: STOP_FAILED_TEXT, kind: 'error', durationMs: 10_000 });
    expect(h.timer.state()).toEqual(paused);
    expect(h.timer.paused()).toBe(true);
    expect(h.store.data().timeLogs).toEqual([]);
  });

  it('повторный «Стоп» во время записи не пишет второй лог той же сессии', async () => {
    const h = await bootWith([sphere]);
    h.timer.start({ itemId: 'sphere', type: 'practice', plannedMin: 45 });
    await at(min(5));
    const [first, second] = await Promise.all([h.timer.stop(), h.timer.stop()]);
    expect(second).toBe(first);
    expect((await stored(h)).logs).toHaveLength(1);
  });

  it('ТК-А29: смены шага в дробные секунды — время шагов в сумме равно часам сессии, сумма минут шагов лога равна минутам лога (НФТ «Точность»)', async () => {
    const h = await bootWith([artists]);
    h.timer.start({ itemId: 'artists', type: 'study', plannedMin: 45 });
    const moments = [sec(7.3), min(4) + 250, min(9) + 999, min(13) + 1, min(21) + 501, min(33) + 777];
    const targets = [1, 2, 0, 3, 1, 2];
    for (const [index, moment] of moments.entries()) {
      vi.setSystemTime(START + moment);
      h.timer.selectStep(targets[index] ?? 0);
      expect(total(h.timer.stepMs())).toBe(h.timer.elapsed());
      expect(h.timer.elapsed()).toBe(moment);
    }
    await at(min(40) + 640);
    const ms = h.timer.stepMs();
    const logId = await h.timer.stop();
    const log = (await stored(h)).logs.find((entry) => entry.id === logId);
    const minutes = log?.steps?.minutes ?? [];
    expect(total(minutes)).toBe(log?.durationMin);
    for (const [index, value] of minutes.entries()) {
      expect(Math.abs(value * 60_000 - (ms[index] ?? 0))).toBeLessThan(min(1));
    }
  });
});

describe('шаг, первым набравший 1 мин (Q-021, Q-025; ADR-007, правило 6)', () => {
  it('ТК-А31: шаг сменили до первой минуты — каждая запись шагов сохраняет значение, «Стоп» переносит его в лог (ТК-Q021.4)', async () => {
    const h = await bootWith([artists]);
    h.timer.start({ itemId: 'artists', type: 'study', plannedMin: 45 });
    await at(sec(40));
    h.timer.nextStep();
    expect(steps(h)?.firstMinuteIndex).toBeNull();
    await at(min(1) + sec(50));
    h.timer.prevStep();
    expect(steps(h)?.firstMinuteIndex).toBe(1);
    await at(min(3) + sec(15));
    const logId = await h.timer.stop();
    expect((await stored(h)).logs.find((log) => log.id === logId)?.steps).toMatchObject({
      minutes: [2, 1, 0, 0],
      startIndex: 0,
      stopIndex: 0,
      firstMinuteIndex: 1,
    });
  });

  it('ТК-А31: перезагрузки до и после первой минуты значение не теряют (ТК-Q021.5)', async () => {
    let h = await bootWith([artists]);
    h.timer.start({ itemId: 'artists', type: 'study', plannedMin: 45 });
    await at(sec(30));
    h.timer.nextStep();
    await at(min(1));
    h = await reload(h);
    expect((await stored(h)).timer?.steps?.firstMinuteIndex).toBeNull();
    await at(min(1) + sec(45));
    h = await reload(h);
    await at(min(2) + sec(40));
    h.timer.nextStep();
    expect((await stored(h)).timer?.steps?.firstMinuteIndex).toBe(1);
    await at(min(3));
    h = await reload(h);
    expect(steps(h)?.firstMinuteIndex).toBe(1);
    expect(h.timer.activeStep()?.index).toBe(2);
    await at(min(4) + sec(15));
    const logId = await h.timer.stop();
    const log = (await stored(h)).logs.find((entry) => entry.id === logId);
    expect(log?.steps?.firstMinuteIndex).toBe(1);
    expect(total(log?.steps?.minutes ?? [])).toBe(4);
    expect(log?.durationMin).toBe(4);
  });

  it('ТК-А31: запись сигнала шага сохраняет значение', async () => {
    const h = await bootWith([artists]);
    h.timer.start({ itemId: 'artists', type: 'study', plannedMin: 45 });
    await at(min(10));
    expect(steps(h)).toMatchObject({ planSignaled: [0], firstMinuteIndex: 0 });
    expect((await stored(h)).timer?.steps?.firstMinuteIndex).toBe(0);
  });

  it('ТК-А31: ни один шаг не набрал 1 мин, пауза времени не добавляет — в логе null, поле есть (ТК-Q021.6)', async () => {
    const h = await bootWith([artists]);
    h.timer.start({ itemId: 'artists', type: 'study', plannedMin: 45 });
    await at(sec(40));
    h.timer.nextStep();
    await at(min(1) + sec(20));
    h.timer.nextStep();
    await at(min(1) + sec(30));
    h.timer.pause();
    await at(min(3) + sec(30));
    h.timer.resume();
    await at(min(4));
    h.timer.nextStep();
    await at(min(4) + sec(15));
    const logId = await h.timer.stop();
    const log = (await stored(h)).logs.find((entry) => entry.id === logId);
    expect(log).toMatchObject({ durationMin: 2, steps: { stopIndex: 3, firstMinuteIndex: null } });
    expect(log?.steps && 'firstMinuteIndex' in log.steps).toBe(true);
    expect(total(log?.steps?.minutes ?? [])).toBe(2);
  });

  it('ТК-А31: «Засчитать» меньше и больше измеренного шаг первой минуты не меняет (ТК-Q021.3)', async () => {
    for (const counted of [20, 300]) {
      let h = await bootWith([artists]);
      h.timer.start({ itemId: 'artists', type: 'study', plannedMin: 45 });
      await at(sec(20));
      h.timer.nextStep();
      await at(sec(40));
      // Шаг 2 набрал 1 мин при закрытой вкладке, без записи шагов (ADR-007, правила 6 и 7)
      h = await reopenAt(h, min(250));
      expect(steps(h)?.firstMinuteIndex).toBeNull();
      const logId = await h.timer.stop(counted);
      const log = (await stored(h)).logs.find((entry) => entry.id === logId);
      expect(log).toMatchObject({ durationMin: counted, steps: { stopIndex: 1, firstMinuteIndex: 1 } });
      expect(total(log?.steps?.minutes ?? [])).toBe(counted);
      vi.setSystemTime(START);
    }
  });
});

describe('таймер, запущенный до 1.6 (FR-65, US-32)', () => {
  /** Таймер 1.5 в хранилище: без полей steps и legacySchedule (ДТ-14); поля — как их записал 1.5 или импорт. */
  async function bootLegacy(items: readonly IItem[], timer: Readonly<Record<string, unknown>>): Promise<IHarness> {
    const adapter = new MemoryAdapter();
    await adapter.putMany('items', items);
    const meta = { ...defaultMeta(), timer };
    await adapter.putMany('meta', [meta]);
    return boot(adapter);
  }

  const legacyTimer = (itemId: string, startedBeforeMs: number, patch: Readonly<Record<string, unknown>> = {}): Readonly<Record<string, unknown>> => ({
    itemId,
    type: 'practice',
    startedAt: new Date(START - startedBeforeMs).toISOString(),
    pausedAt: null,
    pausedMs: 0,
    plannedMin: 90,
    stepMinutes: null,
    ...patch,
  });

  it('ТК-А19: 20 / 10 / 60, длина 90, 25-я минута — при первом открытии активен шаг 2, шаг 1 — 20 мин, шаг 2 — 5 мин, лимит 90; результат сразу записан (US-32, критерий 1)', async () => {
    const h = await bootLegacy([sphere], legacyTimer('sphere', min(25)));
    expect(h.timer.state()).toMatchObject({ legacySchedule: false, plannedMin: 90 });
    expect(steps(h)).toMatchObject({ activeIndex: 1, spentMs: [min(20), 0, 0], startIndex: 0, continuesCircle: false, stepCount: 3, firstMinuteIndex: 0 });
    expect(h.timer.elapsed()).toBe(min(25));
    expect(h.timer.stepViews().map((view) => view.doneMin)).toEqual([20, 5, 0]);
    expect((await stored(h)).timer).toMatchObject({ legacySchedule: false, steps: { activeIndex: 1 } });
    // Дальше шаг меняется только вручную; на 30:00 — сигнал шага 2, у шага 1 сигнала нет (ТК-32.1)
    await at(min(5));
    expect(texts(h).filter((text) => text.startsWith('Время шага'))).toEqual([stepPlanDoneText({ title: 'Граница света и тени, падающие тени', planMin: 10 })]);
    await at(min(15));
    expect(h.timer.activeStep()).toMatchObject({ index: 1, doneMin: 20 });
  });

  it('ТК-А19: в 1.5 нажимали «Предыдущий шаг» и «+5 мин» — шаг расписания 1.5, лимит — сохранённая длина, сумма шагов равна часам (US-32, критерий 5)', async () => {
    const h = await bootLegacy([sphere], legacyTimer('sphere', min(35), { plannedMin: 102, stepMinutes: [32, 10, 60] }));
    expect(h.timer.state()?.plannedMin).toBe(102);
    expect(steps(h)?.activeIndex).toBe(1);
    expect(h.timer.stepMs()).toEqual([min(32), min(3), 0]);
    expect(total(h.timer.stepMs())).toBe(h.timer.elapsed());
    await at(min(2));
    expect(h.timer.activeStep()?.index).toBe(1);
    await at(min(2) + sec(15));
    const logId = await h.timer.stop();
    const log = (await stored(h)).logs.find((entry) => entry.id === logId);
    expect(log).toMatchObject({ durationMin: 37, steps: { startIndex: 0, continuesCircle: false, limitMin: 102 } });
    expect(total(log?.steps?.minutes ?? [])).toBe(37);
  });

  it('ТК-А19: 40 / 15 / 5, длина 60, 62-я минута — активен шаг 3, сигналы лимита и шагов уже прозвучали и не повторяются (ТК-FR65.2, Д-21)', async () => {
    const h = await bootLegacy([light], legacyTimer('light', min(62), { type: 'study', plannedMin: 60 }));
    expect(steps(h)).toMatchObject({ activeIndex: 2, limitSignaled: true, planSignaled: [0, 1, 2], firstMinuteIndex: 0 });
    expect(h.timer.stepMs()).toEqual([min(40), min(15), min(7)]);
    await at(min(4));
    expect(texts(h).filter((text) => text.startsWith('Время'))).toEqual([]);
  });

  it('ТК-А19: прошло 40 с — шага первой минуты ещё нет', async () => {
    const h = await bootLegacy([sphere], legacyTimer('sphere', sec(40)));
    expect(steps(h)).toMatchObject({ activeIndex: 0, firstMinuteIndex: null });
    expect(h.timer.state()?.legacySchedule).toBe(false);
  });

  it('битое расписание 1.5 не ломает перевод — шаги по плановым минутам (Q-032)', async () => {
    for (const stepMinutes of [[Number.NaN, 10, 60], [-5, 10, 60], ['20', 10, 60], 'abc']) {
      const h = await bootLegacy([sphere], legacyTimer('sphere', min(25), { stepMinutes }));
      expect(steps(h), String(stepMinutes)).toMatchObject({ activeIndex: 1, spentMs: [min(20), 0, 0] });
      expect(total(h.timer.stepMs())).toBe(min(25));
    }
  });

  it('ТК-А33: длина 0, −5, NaN, null, строка «60» или нет поля — лимит 60 = сумма шагов 10 / 20 / 30, таймер не сброшен; контроль 45 (US-32, критерий 6; Q-035)', async () => {
    const tens = topic({ id: 'tens', steps: [['Шаг 1', 10], ['Шаг 2', 20], ['Шаг 3', 30]] });
    const withoutLength = {
      itemId: 'tens',
      type: 'practice',
      startedAt: new Date(START - min(25)).toISOString(),
      pausedAt: null,
      pausedMs: 0,
      stepMinutes: null,
    };
    const cases: readonly (readonly [string, Readonly<Record<string, unknown>>, number])[] = [
      ['0', legacyTimer('tens', min(25), { plannedMin: 0 }), 60],
      ['−5', legacyTimer('tens', min(25), { plannedMin: -5 }), 60],
      ['NaN', legacyTimer('tens', min(25), { plannedMin: Number.NaN }), 60],
      ['null', legacyTimer('tens', min(25), { plannedMin: null }), 60],
      ['строка', legacyTimer('tens', min(25), { plannedMin: '60' }), 60],
      ['нет поля', withoutLength, 60],
      ['контроль', legacyTimer('tens', min(25), { plannedMin: 45 }), 45],
    ];
    for (const [name, source, limit] of cases) {
      const h = await bootLegacy([tens], source);
      expect(h.timer.state(), name).toMatchObject({ legacySchedule: false, plannedMin: limit, startedAt: source['startedAt'], pausedAt: null, pausedMs: 0 });
      expect(steps(h), name).toMatchObject({ activeIndex: 1, limitSignaled: false });
      expect(h.timer.stepMs(), name).toEqual([600_000, 900_000, 0]);
      expect((await stored(h)).timer, name).toMatchObject({ legacySchedule: false, plannedMin: limit });
    }
  });

  it('ТК-А33: после перевода с длиной 0 «Время сессии вышло: 60 мин» звучит один раз на 60:00, «Стоп» пишет лимит 60', async () => {
    const tens = topic({ id: 'tens', steps: [['Шаг 1', 10], ['Шаг 2', 20], ['Шаг 3', 30]] });
    const h = await bootLegacy([tens], legacyTimer('tens', min(25), { plannedMin: 0 }));
    await at(min(35) - sec(1));
    expect(count(h, sessionEndText(60))).toBe(0);
    await at(min(36));
    expect(count(h, sessionEndText(60))).toBe(1);
    const logId = await h.timer.stop();
    expect((await stored(h)).logs.find((log) => log.id === logId)).toMatchObject({ durationMin: 61, steps: { limitMin: 60 } });
  });

  it('ТК-А33: топик без шагов ориентира, длина 0 или NaN — сессия без шагов, лимит 90, таймер не сброшен (ТК-Q035.1)', async () => {
    for (const plannedMin of [0, Number.NaN]) {
      const source = legacyTimer('plain', min(85), { plannedMin });
      const h = await bootLegacy([plain], source);
      expect(h.timer.state()).toMatchObject({ legacySchedule: false, plannedMin: 90, steps: null, startedAt: source['startedAt'] });
      expect((await stored(h)).timer).toMatchObject({ legacySchedule: false, plannedMin: 90 });
      await at(min(5) - sec(1));
      expect(count(h, sessionEndText(90))).toBe(0);
      await at(min(5));
      expect(count(h, sessionEndText(90))).toBe(1);
      vi.setSystemTime(START);
    }
  });
});
