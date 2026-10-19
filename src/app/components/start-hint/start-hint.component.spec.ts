import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { provideTaiga } from '@taiga-ui/core';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { App } from '../../app';
import { routes } from '../../app.routes';
import { EMPTY_GUIDE } from '../../domain';
import {
  budgetFixture,
  itemFixture,
  logFixture,
  sectionFixture,
  topicFixture,
} from '../../domain/test-fixtures';
import {
  ClockService,
  DataStore,
  TimerService,
  UiStateService,
  defaultChallenge,
  defaultMeta,
  type IStartHint,
} from '../../services';
import { MemoryAdapter, STORAGE_ADAPTER } from '../../storage';
import type {
  IItem,
  IMeta,
  IPlanBlock,
  IRouteBlock,
  ITimeLog,
  TItemKind,
  TRouteRole,
  TSessionType,
} from '../../types';
import { addDays, fromDayKey } from '../../utils';
import { startHintText } from './start-hint.component';

// Тексты вкладки «Тексты 1.6» дословно; в интерфейсе внутри них неразрывные пробелы («Числа не разрываются»)
const CONTINUE_3 = 'Продолжить с шага 3 · уже 12 из 20 мин';
const CYCLE_DONE = 'Все шаги пройдены · начнём с шага 1';

/** Понедельник; неделя челленджа N начинается с START + 7 × (N − 1). */
const START = '2026-08-31';
const weekDay = (week: number, offset = 0): string => addDays(START, 7 * (week - 1) + offset);
/** Момент по часам устройства: день и время, ISO UTC. */
const at = (day: string, hour: number, minute = 0): string => {
  const date = fromDayKey(day);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
};
/** «Сейчас» — воскресенье недели 6, полдень: ёмкость дня 0, на «Сегодня» только закреплённые блоки. */
const TODAY = weekDay(6, 6);
const NOW = at(TODAY, 12);
const ARTISTS = 'Изучение двух художников';

/** Топик с ориентиром; по умолчанию «Изучение двух художников» из ТД-1 — 10 / 20 / 20 / 10 мин. */
function topic(params: {
  readonly title?: string;
  readonly steps?: readonly number[];
  readonly kind?: TItemKind;
  readonly estimateMin?: number;
  readonly checkpointDay?: number | null;
  readonly recurrenceWeeks?: number | null;
  readonly routeRole?: TRouteRole | null;
}): IItem {
  const steps = params.steps ?? [10, 20, 20, 10];
  return {
    ...itemFixture({
      id: 'item',
      topicId: 't1',
      kind: params.kind ?? 'study',
      estimateMin: params.estimateMin,
      checkpointDay: params.checkpointDay,
      recurrenceWeeks: params.recurrenceWeeks,
    }),
    title: params.title ?? ARTISTS,
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
  readonly type?: TSessionType;
  readonly startedAt?: string;
  readonly minutes: readonly number[];
  readonly stopIndex: number;
}): ITimeLog {
  const durationMin = params.minutes.reduce((sum, value) => sum + value, 0);
  return {
    ...logFixture({
      id: 'm1',
      itemId: 'item',
      type: params.type ?? 'study',
      startedAt: params.startedAt ?? at(weekDay(6, 3), 18),
      minutes: durationMin,
    }),
    steps: {
      minutes: params.minutes,
      startIndex: 0,
      stopIndex: params.stopIndex,
      continuesCircle: false,
      circleId: 'c1',
      limitMin: 45,
      stepCount: params.minutes.length,
      firstMinuteIndex: 0,
    },
  };
}

/** Место М-1 «шаг 3 · 12 из 20» (ТД-4). */
const placeM1 = (startedAt?: string): ITimeLog =>
  session({ startedAt, minutes: [0, 0, 12, 0], stopIndex: 2 });

/** Закреплённый блок «Сегодня» по топику: его ключ в плане — `pin:b1`. */
function block(
  params: { readonly type?: TSessionType; readonly plannedMin?: number } = {},
): IPlanBlock {
  return {
    id: 'b1',
    createdAt: NOW,
    updatedAt: NOW,
    date: TODAY,
    itemId: 'item',
    type: params.type ?? 'study',
    plannedMin: params.plannedMin ?? 45,
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

/** У jsdom нет matchMedia, а тема Taiga его читает. */
function mediaQuery(query: string): MediaQueryList {
  return {
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  };
}

interface IShell {
  readonly fixture: ComponentFixture<App>;
  readonly root: HTMLElement;
  readonly store: DataStore;
  readonly timer: TimerService;
  readonly ui: UiStateService;
}

/** Приложение целиком на хранилище в памяти, открыт экран «Сегодня»: тот же путь загрузки, что в браузере. */
async function boot(params: {
  readonly items: readonly IItem[];
  readonly logs?: readonly ITimeLog[];
  readonly blocks?: readonly IPlanBlock[];
  readonly routeBlocks?: readonly IRouteBlock[];
  readonly now?: string;
}): Promise<IShell> {
  TestBed.resetTestingModule();
  const adapter = new MemoryAdapter();
  await adapter.init();
  const meta: IMeta = { ...defaultMeta(), onboarded: true };
  await adapter.putMany('meta', [meta]);
  await adapter.putMany('budgets', [budgetFixture()]);
  await adapter.putMany('challenges', [defaultChallenge(NOW, START)]);
  await adapter.putMany('sections', [sectionFixture('s1', 0)]);
  await adapter.putMany('topics', [topicFixture('t1', 's1')]);
  await adapter.putMany('items', params.items);
  await adapter.putMany('timeLogs', params.logs ?? []);
  await adapter.putMany('planBlocks', params.blocks ?? []);
  await adapter.putMany('routeBlocks', params.routeBlocks ?? []);
  TestBed.configureTestingModule({
    providers: [
      { provide: STORAGE_ADAPTER, useValue: adapter },
      provideRouter(routes),
      provideTaiga(),
    ],
  });
  TestBed.inject(ClockService).now.set(Date.parse(params.now ?? NOW));
  const store = TestBed.inject(DataStore);
  await store.init();
  const fixture = TestBed.createComponent(App);
  await TestBed.inject(Router).navigateByUrl('/today');
  await fixture.whenStable();
  return {
    fixture,
    root: fixture.nativeElement,
    store,
    timer: TestBed.inject(TimerService),
    ui: TestBed.inject(UiStateService),
  };
}

const normalize = (text: string | null | undefined): string =>
  (text ?? '').replace(/ /g, ' ').trim();

/** Видимый текст подсказки: скрытый элемент — подсказки нет. */
function hintOf(element: Element | null): string {
  return element instanceof HTMLElement && !element.hidden ? normalize(element.textContent) : '';
}

function byId(shell: IShell, id: string): HTMLElement | null {
  return shell.root.querySelector<HTMLElement>(`[id="${id}"]`);
}

function todayHint(shell: IShell): string {
  return hintOf(byId(shell, 'startHint-pin:b1'));
}

async function cardHint(shell: IShell): Promise<string> {
  shell.ui.openItem('item');
  await shell.fixture.whenStable();
  return hintOf(byId(shell, 'drawerStartHint'));
}

function pickerOption(shell: IShell, title: string): HTMLButtonElement | null {
  const options = [...shell.root.querySelectorAll<HTMLButtonElement>('.dlg__option')];
  return (
    options.find((option) =>
      normalize(option.querySelector('span')?.textContent).startsWith(title),
    ) ?? null
  );
}

async function pickerHint(shell: IShell): Promise<string> {
  shell.ui.pickerOpen.set('practice');
  await shell.fixture.whenStable();
  const option = pickerOption(shell, ARTISTS);
  expect(option).not.toBeNull();
  return hintOf(option?.querySelector('app-start-hint') ?? null);
}

async function closeAll(shell: IShell): Promise<void> {
  shell.ui.closeItem();
  shell.ui.pickerOpen.set(null);
  await shell.fixture.whenStable();
}

/** Подсказка в трёх местах FR-58: блок «Сегодня», карточка топика, быстрый выбор. */
async function hintsEverywhere(shell: IShell): Promise<readonly string[]> {
  const today = todayHint(shell);
  const card = await cardHint(shell);
  await closeAll(shell);
  const picker = await pickerHint(shell);
  await closeAll(shell);
  return [today, card, picker];
}

async function click(shell: IShell, element: HTMLElement | null | undefined): Promise<void> {
  expect(element).toBeInstanceOf(HTMLElement);
  element?.click();
  await shell.fixture.whenStable();
}

type TStartPoint = 'блок' | 'Space' | 'карточка' | 'быстрый выбор' | 'палитра';

const START_POINTS: readonly TStartPoint[] = [
  'блок',
  'Space',
  'карточка',
  'быстрый выбор',
  'палитра',
];

/** Старт из точки FR-58 тем действием, которое делает владелец. */
async function startFrom(shell: IShell, point: TStartPoint): Promise<void> {
  switch (point) {
    case 'блок':
      await click(
        shell,
        shell.root.querySelector<HTMLElement>('[aria-describedby="startHint-pin:b1"]'),
      );
      break;
    case 'Space':
      document.body.dispatchEvent(
        new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true }),
      );
      await shell.fixture.whenStable();
      break;
    case 'карточка':
      shell.ui.openItem('item');
      await shell.fixture.whenStable();
      await click(
        shell,
        shell.root.querySelector<HTMLElement>('[aria-describedby="drawerStartHint"]'),
      );
      break;
    case 'быстрый выбор':
      shell.ui.pickerOpen.set('practice');
      await shell.fixture.whenStable();
      await click(shell, pickerOption(shell, ARTISTS));
      break;
    case 'палитра': {
      shell.ui.paletteOpen.set(true);
      await shell.fixture.whenStable();
      const input = shell.root.querySelector<HTMLInputElement>('input[aria-label="Команда"]');
      expect(input).toBeInstanceOf(HTMLInputElement);
      if (input) {
        input.value = 'Изучение';
        input.dispatchEvent(new Event('input'));
      }
      await shell.fixture.whenStable();
      const options = [...shell.root.querySelectorAll<HTMLElement>('.dlg__option')];
      await click(
        shell,
        options.find((option) => normalize(option.textContent).startsWith(`Старт: ${ARTISTS}`)),
      );
      break;
    }
  }
}

/** Подсказка, которую владелец видит до старта из этой точки: Space — у первого блока «Сегодня», палитра — как в карточке. */
async function hintBefore(shell: IShell, point: TStartPoint): Promise<string> {
  switch (point) {
    case 'блок':
    case 'Space':
      return todayHint(shell);
    case 'карточка':
    case 'палитра': {
      const hint = await cardHint(shell);
      await closeAll(shell);
      return hint;
    }
    case 'быстрый выбор': {
      const hint = await pickerHint(shell);
      await closeAll(shell);
      return hint;
    }
  }
}

/**
 * Старт ничего не спросил, а активный шаг и «X из Y мин» в режиме фокуса — те же, что в подсказке до старта (US-25, критерий 2):
 * «Продолжить с шага N · уже X из Y мин» → активен шаг N с «X из Y мин»; «Продолжить с шага N» → шаг N с «0 из Y мин»;
 * «Все шаги пройдены · начнём с шага 1» и подсказки нет → шаг 1, у всех шагов 0 — новый круг.
 */
function expectStartMatches(shell: IShell, hint: string): void {
  expect(shell.timer.running()).toBe(true);
  expect(shell.ui.pendingStart()).toBeNull();
  expect(shell.ui.pickerOpen()).toBeNull();
  expect(shell.ui.paletteOpen()).toBe(false);
  const active = shell.timer.activeStep();
  expect(active).not.toBeNull();
  const progress = active ? `${active.doneMin} из ${active.planMin} мин` : '';
  const continued = /^Продолжить с шага (\d+)(?: · уже (.+))?$/.exec(hint);
  if (continued) {
    expect((active?.index ?? -1) + 1).toBe(Number(continued[1]));
    expect(progress).toBe(continued[2] ?? `0 из ${active?.planMin ?? 0} мин`);
    return;
  }
  expect([CYCLE_DONE, '']).toContain(hint);
  expect(active?.index).toBe(0);
  expect(shell.timer.stepViews().map((view) => view.doneMin)).toEqual(
    shell.timer.stepViews().map(() => 0),
  );
}

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: mediaQuery });
});

afterEach(() => {
  TestBed.resetTestingModule();
});

describe('текст подсказки по виду из сервиса подсказки (вкладка «Тексты 1.6»)', () => {
  const hint = (
    kind: IStartHint['kind'],
    stepNumber = 3,
    doneMin = 12,
    planMin = 20,
  ): IStartHint => ({ kind, stepNumber, doneMin, planMin });

  it('четыре вида: startHint.continue, startHint.continueZero, startHint.cycleDone и «нет подсказки» без заглушек', () => {
    expect(normalize(startHintText(hint('continue')))).toBe(CONTINUE_3);
    expect(normalize(startHintText(hint('continueZero', 3, 0)))).toBe('Продолжить с шага 3');
    expect(normalize(startHintText(hint('cycleDone', 1, 0, 10)))).toBe(CYCLE_DONE);
    expect(startHintText(hint('none', 1, 0, 10))).toBeNull();
    expect(startHintText(null)).toBeNull();
  });

  it('числа не разрываются: перенос возможен только после « · », трёхзначные минуты — целиком', () => {
    const text = startHintText(hint('continue', 2, 250, 15)) ?? '';
    expect(normalize(text)).toBe('Продолжить с шага 2 · уже 250 из 15 мин');
    expect(text.split(' ')).toEqual(['Продолжить с шага 2 ·', 'уже 250 из 15 мин']);
    expect((startHintText(hint('cycleDone')) ?? '').split(' ')).toEqual([
      'Все шаги пройдены ·',
      'начнём с шага 1',
    ]);
  });
});

describe('подсказка у блока «Сегодня», в карточке топика и в быстром выборе (FR-58, Д-9)', () => {
  it('US-25, критерий 1: место «шаг 3 · 12 из 20» на этой неделе — везде «Продолжить с шага 3 · уже 12 из 20 мин»', async () => {
    const shell = await boot({
      items: [topic({ recurrenceWeeks: 1, routeRole: 'study' })],
      logs: [placeM1()],
      blocks: [block()],
    });
    expect(await hintsEverywhere(shell)).toEqual([CONTINUE_3, CONTINUE_3, CONTINUE_3]);
  });

  it('US-25, критерий 4: практический топик, не контрольная — в карточке «Продолжить с шага 2 · уже 2 из 10 мин», не только у «Учёбы»', async () => {
    const sphere = topic({
      title: 'Сфера и куб под одним светом',
      kind: 'practice',
      steps: [20, 10, 60],
    });
    const logs = [session({ type: 'practice', minutes: [0, 2, 0], stopIndex: 1 })];
    const shell = await boot({ items: [sphere], logs, blocks: [block({ type: 'practice' })] });
    expect(todayHint(shell)).toBe('Продолжить с шага 2 · уже 2 из 10 мин');
    expect(await cardHint(shell)).toBe('Продолжить с шага 2 · уже 2 из 10 мин');
  });

  it('US-25, критерий 5: вторая сессия того же дня — подсказка и старт с места первой', async () => {
    const shell = await boot({
      items: [topic({})],
      logs: [placeM1(at(TODAY, 9))],
      blocks: [block()],
    });
    const hint = await hintBefore(shell, 'карточка');
    expect(hint).toBe(CONTINUE_3);
    await startFrom(shell, 'карточка');
    expectStartMatches(shell, hint);
  });

  it('место есть, накоплено 0 мин — «Продолжить с шага N» без чисел (startHint.continueZero)', async () => {
    const logs = [session({ minutes: [10, 0, 0, 0], stopIndex: 1 })];
    const shell = await boot({ items: [topic({})], logs, blocks: [block()] });
    expect(await hintsEverywhere(shell)).toEqual([
      'Продолжить с шага 2',
      'Продолжить с шага 2',
      'Продолжить с шага 2',
    ]);
  });

  it('US-26, критерий 1: остановка на шаге 4 с 10 из 10 — везде «Все шаги пройдены · начнём с шага 1»', async () => {
    const logs = [session({ minutes: [10, 20, 20, 10], stopIndex: 3 })];
    const shell = await boot({ items: [topic({})], logs, blocks: [block()] });
    expect(await hintsEverywhere(shell)).toEqual([CYCLE_DONE, CYCLE_DONE, CYCLE_DONE]);
  });

  it('US-26, критерий 3: остановка на шаге 4 с 6 из 10 — «Продолжить с шага 4 · уже 6 из 10 мин», а не «Все шаги пройдены»', async () => {
    const logs = [session({ minutes: [10, 20, 20, 6], stopIndex: 3 })];
    const shell = await boot({ items: [topic({})], logs, blocks: [block()] });
    const expected = 'Продолжить с шага 4 · уже 6 из 10 мин';
    expect(await hintsEverywhere(shell)).toEqual([expected, expected, expected]);
  });

  it('US-26, критерий 4: все шаги набрали план, остановка на шаге 2 с 25 из 20 — «Продолжить с шага 2 · уже 25 из 20 мин»', async () => {
    const logs = [session({ minutes: [10, 25, 20, 10], stopIndex: 1 })];
    const shell = await boot({ items: [topic({})], logs, blocks: [block()] });
    const expected = 'Продолжить с шага 2 · уже 25 из 20 мин';
    expect(await hintsEverywhere(shell)).toEqual([expected, expected, expected]);
  });

  it('US-27, критерий 3: у контрольной есть прошлая сессия — текста «Продолжить…» нет ни у блока, ни в карточке, ни в быстром выборе', async () => {
    const checkpoint = topic({ kind: 'practice', checkpointDay: 66, steps: [15, 25, 65, 15] });
    const logs = [session({ type: 'practice', minutes: [15, 10, 0, 0], stopIndex: 1 })];
    const shell = await boot({ items: [checkpoint], logs, blocks: [block({ type: 'practice' })] });
    expect(await hintsEverywhere(shell)).toEqual(['', '', '']);
    expect(shell.root.textContent).not.toContain('Продолжить');
  });

  it('US-28, критерии 1, 2: «Изучение» — вторая сессия недели 6 продолжает с места, в неделю 7 подсказки нет', async () => {
    const item = topic({ recurrenceWeeks: 1, routeRole: 'study' });
    const week6 = await boot({ items: [item], logs: [placeM1(at(TODAY, 9))] });
    expect(await cardHint(week6)).toBe(CONTINUE_3);
    const week7 = await boot({
      items: [item],
      logs: [placeM1(at(TODAY, 9))],
      now: at(weekDay(7), 5),
    });
    expect(await cardHint(week7)).toBe('');
    await closeAll(week7);
    expect(await pickerHint(week7)).toBe('');
  });

  it('US-28, критерий 3: «Копия фрагмента» — в неделю 12 блока маршрута 9–13 продолжает, в неделю 14 подсказки нет', async () => {
    const copy = topic({
      title: 'Копия фрагмента',
      kind: 'practice',
      steps: [15, 20, 70, 15],
      recurrenceWeeks: 1,
      routeRole: 'copy',
    });
    const logs = [
      session({
        type: 'practice',
        minutes: [0, 0, 40, 0],
        stopIndex: 2,
        startedAt: at(weekDay(10), 18),
      }),
    ];
    const routeBlocks = [routeBlock('r3', 9, 13), routeBlock('r4', 14, 17)];
    const week12 = await boot({ items: [copy], logs, routeBlocks, now: at(weekDay(12, 2), 12) });
    expect(await cardHint(week12)).toBe('Продолжить с шага 3 · уже 40 из 70 мин');
    const week14 = await boot({ items: [copy], logs, routeBlocks, now: at(weekDay(14, 2), 12) });
    expect(await cardHint(week14)).toBe('');
  });

  it('US-28, критерий 4: граница дня 04:00 — в 01:30 первого дня недели 7 сессия ещё в неделе 6 и продолжает с шага 3', async () => {
    const item = topic({ recurrenceWeeks: 1, routeRole: 'study' });
    const shell = await boot({
      items: [item],
      logs: [placeM1(at(TODAY, 9))],
      now: at(weekDay(7), 1, 30),
    });
    expect(await cardHint(shell)).toBe(CONTINUE_3);
  });

  it('US-29, критерий 1: у блока «Повторение» подсказки нет, он стартует с шага 1 с лимитом 15 мин, подсказка топика прежняя', async () => {
    const shell = await boot({
      items: [topic({})],
      logs: [placeM1()],
      blocks: [block({ type: 'review', plannedMin: 15 })],
    });
    expect(todayHint(shell)).toBe('');
    expect(await cardHint(shell)).toBe(CONTINUE_3);
    await closeAll(shell);
    await startFrom(shell, 'блок');
    expectStartMatches(shell, '');
    expect(shell.timer.state()?.type).toBe('review');
    expect(shell.timer.state()?.plannedMin).toBe(15);
  });

  it('US-29, критерии 2, 3: топик отмечен пройденным — подсказки нет; отметку сняли без сессий — снова «Продолжить с шага 3 · уже 12 из 20 мин»', async () => {
    const shell = await boot({ items: [topic({})], logs: [placeM1()], blocks: [block()] });
    expect(await cardHint(shell)).toBe(CONTINUE_3);
    const done = shell.root.querySelector<HTMLInputElement>('.drawer__done input');
    await click(shell, done);
    expect(shell.store.items()[0]?.doneAt).not.toBeNull();
    expect(hintOf(byId(shell, 'drawerStartHint'))).toBe('');
    expect(todayHint(shell)).toBe('');
    await click(shell, done);
    expect(shell.store.items()[0]?.doneAt).toBeNull();
    expect(hintOf(byId(shell, 'drawerStartHint'))).toBe(CONTINUE_3);
  });

  it('US-29, критерий 2: старт пройденного топика из карточки — подсказки нет, активен шаг 1', async () => {
    const shell = await boot({ items: [{ ...topic({}), doneAt: NOW }], logs: [placeM1()] });
    const hint = await hintBefore(shell, 'карточка');
    expect(hint).toBe('');
    await startFrom(shell, 'карточка');
    expectStartMatches(shell, hint);
  });

  it('US-30, критерий 1: план шага 3 изменили с 20 на 30 — «Продолжить с шага 3 · уже 12 из 30 мин» без перезагрузки', async () => {
    const shell = await boot({ items: [topic({})], logs: [placeM1()], blocks: [block()] });
    const item = shell.store.items()[0];
    expect(item?.guide).toBeTruthy();
    if (item?.guide) {
      const steps = item.guide.steps.map((step, index) =>
        index === 2 ? { ...step, minutes: 30 } : step,
      );
      shell.store.upsert('items', { ...item, guide: { ...item.guide, steps } });
    }
    await shell.fixture.whenStable();
    const expected = 'Продолжить с шага 3 · уже 12 из 30 мин';
    expect(await hintsEverywhere(shell)).toEqual([expected, expected, expected]);
  });

  it('US-30, критерий 2: из ориентира удалили шаг 2 — подсказки нет нигде, старт с шага 1', async () => {
    const shell = await boot({ items: [topic({})], logs: [placeM1()], blocks: [block()] });
    const item = shell.store.items()[0];
    if (item?.guide) {
      shell.store.upsert('items', {
        ...item,
        guide: { ...item.guide, steps: item.guide.steps.filter((_, index) => index !== 1) },
      });
    }
    await shell.fixture.whenStable();
    expect(await hintsEverywhere(shell)).toEqual(['', '', '']);
    await startFrom(shell, 'блок');
    expectStartMatches(shell, '');
  });

  it('во время сессии топика подсказки до старта нет: у блока, в карточке («Идёт сессия») и в быстром выборе', async () => {
    const shell = await boot({ items: [topic({})], logs: [placeM1()], blocks: [block()] });
    await startFrom(shell, 'блок');
    expect(await hintsEverywhere(shell)).toEqual(['', '', '']);
  });
});

describe('старт без вопросов из пяти точек: шаг и «X из Y мин» после старта — как в подсказке (US-25, критерий 2; Д-27)', () => {
  const cases: readonly {
    readonly name: string;
    readonly logs: readonly ITimeLog[];
    readonly hint: string;
  }[] = [
    { name: 'место «шаг 3 · 12 из 20»', logs: [placeM1()], hint: CONTINUE_3 },
    {
      name: 'место с 0 мин',
      logs: [session({ minutes: [10, 0, 0, 0], stopIndex: 1 })],
      hint: 'Продолжить с шага 2',
    },
    {
      name: 'круг пройден',
      logs: [session({ minutes: [10, 20, 20, 10], stopIndex: 3 })],
      hint: CYCLE_DONE,
    },
    { name: 'сессий нет', logs: [], hint: '' },
  ];
  for (const point of START_POINTS) {
    for (const entry of cases) {
      it(`${point}: ${entry.name} — подсказка «${entry.hint || 'нет'}», после старта тот же шаг и те же минуты`, async () => {
        const shell = await boot({ items: [topic({})], logs: entry.logs, blocks: [block()] });
        const hint = await hintBefore(shell, point);
        expect(hint).toBe(entry.hint);
        await startFrom(shell, point);
        expectStartMatches(shell, hint);
      });
    }
  }

  it('US-27, критерий 1: контрольная из любой из пяти точек — подсказки нет, активен шаг 1, у всех шагов 0', async () => {
    for (const point of START_POINTS) {
      const checkpoint = topic({ checkpointDay: 66, steps: [15, 25, 65, 15] });
      const shell = await boot({
        items: [checkpoint],
        logs: [session({ minutes: [15, 10, 0, 0], stopIndex: 1 })],
        blocks: [block()],
      });
      const hint = await hintBefore(shell, point);
      expect(hint).toBe('');
      await startFrom(shell, point);
      expectStartMatches(shell, hint);
    }
  });
});

describe('лимит сессии при старте — как в FR-55 (Q-006)', () => {
  it('блок и Space — минуты блока', async () => {
    const points: readonly TStartPoint[] = ['блок', 'Space'];
    for (const point of points) {
      const shell = await boot({
        items: [topic({})],
        logs: [placeM1()],
        blocks: [block({ plannedMin: 45 })],
      });
      await startFrom(shell, point);
      expect(shell.timer.state()?.plannedMin).toBe(45);
      expect(shell.timer.totalMin()).toBe(45);
    }
  });

  it('карточка — остаток топика в пределах 20–90 мин: 48 при остатке 48, 90 при большом остатке, 20 при малом', async () => {
    const cases: readonly { readonly estimateMin: number; readonly limit: number }[] = [
      { estimateMin: 60, limit: 48 },
      { estimateMin: 600, limit: 90 },
      { estimateMin: 20, limit: 20 },
    ];
    for (const entry of cases) {
      const shell = await boot({
        items: [topic({ estimateMin: entry.estimateMin })],
        logs: [placeM1()],
      });
      await startFrom(shell, 'карточка');
      expect(shell.timer.state()?.plannedMin).toBe(entry.limit);
    }
  });

  it('быстрый выбор и палитра — оценка топика, не больше 90 мин', async () => {
    const points: readonly TStartPoint[] = ['быстрый выбор', 'палитра'];
    const cases: readonly { readonly estimateMin: number; readonly limit: number }[] = [
      { estimateMin: 60, limit: 60 },
      { estimateMin: 600, limit: 90 },
    ];
    for (const point of points) {
      for (const entry of cases) {
        const shell = await boot({
          items: [topic({ estimateMin: entry.estimateMin })],
          logs: [placeM1()],
        });
        await startFrom(shell, point);
        expect(shell.timer.state()?.plannedMin).toBe(entry.limit);
      }
    }
  });

  it('«Старт 20 мин» после пропущенного дня — 20 мин, шаг старта как в подсказке первого блока «Сегодня»', async () => {
    const shell = await boot({ items: [topic({})], logs: [placeM1()], blocks: [block()] });
    const hint = todayHint(shell);
    expect(hint).toBe(CONTINUE_3);
    const buttons = [...shell.root.querySelectorAll<HTMLElement>('.tip__actions button')];
    await click(
      shell,
      buttons.find((button) => normalize(button.textContent) === 'Старт 20 мин'),
    );
    expect(shell.timer.state()?.plannedMin).toBe(20);
    expectStartMatches(shell, hint);
  });
});
