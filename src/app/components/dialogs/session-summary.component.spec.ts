import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TuiRoot, provideTaiga } from '@taiga-ui/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { itemFixture } from '../../domain/test-fixtures';
import { DataStore, UiStateService } from '../../services';
import { MemoryAdapter, STORAGE_ADAPTER } from '../../storage';
import type { ILogSteps, ITimeLog } from '../../types';
import { formatTime } from '../../utils';
import { LogListComponent } from '../log-list/log-list.component';
import { SessionSummaryComponent } from './session-summary.component';

const NOW = Date.parse('2026-10-12T18:00:00.000Z');
const MIN = 60_000;
const at = (ms: number): string => new Date(ms).toISOString();

const own = itemFixture({ id: 'own', topicId: 'topic', kind: 'study' });

/** Лог только что остановленной сессии с шагами: конец — «сейчас», начало — «сейчас» минус минуты, как пишет «Стоп». */
function justStopped(patch: Partial<ILogSteps> = {}): ITimeLog {
  const steps: ILogSteps = {
    minutes: [10, 15, 0, 0],
    startIndex: 0,
    stopIndex: 1,
    continuesCircle: false,
    circleId: 'c1',
    limitMin: 45,
    stepCount: 4,
    firstMinuteIndex: 0,
    ...patch,
  };
  const durationMin = steps.minutes.reduce((sum, value) => sum + value, 0);
  return {
    id: 'log',
    createdAt: at(NOW),
    updatedAt: at(NOW),
    itemId: 'own',
    type: 'study',
    startedAt: at(NOW - durationMin * MIN),
    endedAt: at(NOW),
    durationMin,
    source: 'timer',
    editedAt: null,
    steps,
  };
}

/** Прошлая сессия, записанная «Переключиться»: кончилась там, где началась остановленная (17:00–17:35). */
const previous: ITimeLog = {
  id: 'prev',
  createdAt: at(NOW - 25 * MIN),
  updatedAt: at(NOW - 25 * MIN),
  itemId: null,
  type: 'creative',
  startedAt: at(NOW - 60 * MIN),
  endedAt: at(NOW - 25 * MIN),
  durationMin: 35,
  source: 'timer',
  editedAt: null,
  steps: null,
};

/** Текст предупреждения FR-14 о пересечении с прошлой сессией — знак в знак. */
const OVERLAP_TEXT = `Пересекается с сессией ${formatTime(previous.startedAt)}–${formatTime(previous.endedAt)}. Сохранить обе?`;

/** Оболочка с карточкой итога и списком логов тех же данных — как в приложении, под `tui-root`. */
@Component({
  imports: [TuiRoot, SessionSummaryComponent, LogListComponent],
  template: '<tui-root><app-session-summary /><app-log-list [logs]="store.logs()" /></tui-root>',
})
class SummaryHostComponent {
  protected readonly store = inject(DataStore);
}

/** В jsdom нет `matchMedia`, а Taiga по нему читает тему и настройку движения: ни один запрос не совпадает. */
function stubMatchMedia(): void {
  const view = document.defaultView;
  const existing: unknown = view ? Reflect.get(view, 'matchMedia') : undefined;
  if (view && typeof existing !== 'function') {
    view.matchMedia = (media: string): MediaQueryList =>
      Object.assign(new EventTarget(), {
        matches: false,
        media,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
      });
  }
}

/** Карточка итога лога `log` открыта, как после «Стоп». */
async function render(logs: readonly ITimeLog[]): Promise<DataStore> {
  stubMatchMedia();
  const adapter = new MemoryAdapter();
  await adapter.putMany('items', [own]);
  await adapter.putMany('timeLogs', logs);
  TestBed.configureTestingModule({ providers: [provideTaiga({ mode: 'dark' }), { provide: STORAGE_ADAPTER, useValue: adapter }] });
  const store = TestBed.inject(DataStore);
  await store.init();
  const fixture = TestBed.createComponent(SummaryHostComponent);
  document.body.appendChild(fixture.nativeElement);
  TestBed.tick();
  TestBed.inject(UiStateService).summaryLogId.set('log');
  TestBed.tick();
  return store;
}

const text = (element: Element | null): string => element?.textContent?.trim().replace(/\s+/gu, ' ') ?? '';
const dialog = (): HTMLElement | null => document.querySelector<HTMLElement>('[role="dialog"]');

/** Имя окна для читалки — текст элемента, на который ссылается aria-labelledby. */
function heading(): string {
  const id = dialog()?.getAttribute('aria-labelledby') ?? '';
  return text(id ? document.getElementById(id) : null);
}

const minutesField = (): HTMLInputElement | null => dialog()?.querySelector<HTMLInputElement>('input[type="number"]') ?? null;

/** Ввести минуты и уйти из поля — `change`, как Tab или Enter. */
function enterMinutes(value: string): void {
  const field = minutesField();
  if (field) {
    field.value = value;
    field.dispatchEvent(new Event('input'));
    field.dispatchEvent(new Event('change'));
  }
  TestBed.tick();
}

const button = (label: string): HTMLButtonElement | null =>
  [...(dialog()?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find((entry) => text(entry) === label) ?? null;

function click(label: string): void {
  button(label)?.click();
  TestBed.tick();
}

/** Окно Taiga убирается из DOM после макрозадачи. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  TestBed.tick();
}

const alerts = (): readonly string[] => [...(dialog()?.querySelectorAll('[role="alert"]') ?? [])].map((node) => text(node));

const logOf = (store: DataStore): ITimeLog | undefined => store.data().timeLogs.find((log) => log.id === 'log');

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
});

afterEach(() => {
  TestBed.resetTestingModule();
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('заголовок карточки итога сразу после правки минут (Q-049; FR-13, FR-64)', () => {
  it('открытая карточка: имя окна — «Сессия записана · 25 мин»', async () => {
    await render([justStopped()]);
    expect(heading()).toBe('Сессия записана · 25 мин');
  });

  it('увеличение 25 → 40: заголовок сразу «Сессия записана · 40 мин», записано 40 мин', async () => {
    const store = await render([justStopped()]);
    enterMinutes('40');
    expect(logOf(store)?.durationMin).toBe(40);
    expect(heading()).toBe('Сессия записана · 40 мин');
  });

  it('уменьшение 25 → 20 и снова 20 → 90: заголовок каждый раз с новым числом, как его пишет 1.5', async () => {
    const store = await render([justStopped()]);
    enterMinutes('20');
    expect(logOf(store)?.durationMin).toBe(20);
    expect(heading()).toBe('Сессия записана · 20 мин');
    enterMinutes('90');
    expect(logOf(store)?.durationMin).toBe(90);
    expect(heading()).toBe('Сессия записана · 1 ч 30 м');
  });

  it('0 мин — ошибка у поля, лог и заголовок прежние', async () => {
    const original = justStopped();
    const store = await render([original]);
    enterMinutes('0');
    expect(alerts()).toEqual(['Длительность — от 1 до 720 минут.']);
    expect(logOf(store)).toEqual(original);
    expect(heading()).toBe('Сессия записана · 25 мин');
  });
});

describe('пересечение после правки минут в карточке итога (Q-050; FR-14, FR-64)', () => {
  it('после «Переключиться»: 25 → 30 сдвигает начало на прошлую сессию — предупреждение role="alert", кнопки «Исправить время» и «Сохранить обе»; лог ждёт', async () => {
    const original = justStopped();
    const store = await render([previous, original]);
    enterMinutes('30');
    expect(alerts()).toEqual([OVERLAP_TEXT]);
    expect(button('Исправить время')).not.toBeNull();
    expect(button('Сохранить обе')).not.toBeNull();
    expect(logOf(store)).toEqual(original);
    expect(heading()).toBe('Сессия записана · 25 мин');
  });

  it('тот же текст и те же кнопки, что в списке логов при той же правке (FR-14)', async () => {
    await render([previous, justStopped()]);
    enterMinutes('30');
    const root = document.querySelector<HTMLElement>('app-log-list');
    if (!root) {
      throw new Error('нет списка логов');
    }
    // Список — от новых к старым: первая строка — остановленная сессия; та же правка: 25 → 30 при прежнем начале
    root.querySelector<HTMLButtonElement>('.logs__main')?.click();
    TestBed.tick();
    const field = root.querySelector<HTMLInputElement>('.logEdit input[type="number"]');
    if (field) {
      field.value = '30';
      field.dispatchEvent(new Event('input'));
    }
    TestBed.tick();
    const actions = [...root.querySelectorAll<HTMLButtonElement>('.logEdit__actions button')];
    actions[actions.length - 1]?.click();
    TestBed.tick();
    const listAlerts = [...root.querySelectorAll('[role="alert"]')].map((node) => text(node));
    const listButtons = [...root.querySelectorAll('.logEdit__actions button')].map((node) => text(node));
    expect(listAlerts).toEqual([OVERLAP_TEXT]);
    expect(alerts()).toEqual(listAlerts);
    for (const label of listButtons) {
      expect(button(label), label).not.toBeNull();
    }
    expect(listButtons).toEqual(['Исправить время', 'Сохранить обе']);
  });

  it('«Сохранить обе» — записано 30 мин: начало раньше, конец «сейчас», +5 мин шагу остановки (Д-7), шаг первой минуты прежний (Q-025); заголовок 30 мин, фокус в поле минут', async () => {
    const store = await render([previous, justStopped()]);
    enterMinutes('30');
    click('Сохранить обе');
    const log = logOf(store);
    expect(log).toMatchObject({ durationMin: 30, steps: { minutes: [10, 20, 0, 0], stopIndex: 1, firstMinuteIndex: 0 } });
    expect(log?.startedAt).toBe(at(NOW - 30 * MIN));
    expect(log?.endedAt).toBe(at(NOW));
    expect(log?.editedAt).not.toBeNull();
    expect(store.data().timeLogs.find((entry) => entry.id === 'prev')).toEqual(previous);
    expect(heading()).toBe('Сессия записана · 30 мин');
    expect(alerts()).toEqual([]);
    expect(button('Сохранить обе')).toBeNull();
    expect(document.activeElement).toBe(minutesField());
    expect(minutesField()?.value).toBe('30');
  });

  it('«Исправить время» — лог не изменён, в поле снова записанные 25 мин, фокус в поле; 28 — снова предупреждение, ввод убирает его, 20 без пересечения пишется сразу', async () => {
    const original = justStopped();
    const store = await render([previous, original]);
    enterMinutes('30');
    click('Исправить время');
    expect(logOf(store)).toEqual(original);
    expect(alerts()).toEqual([]);
    expect(button('Исправить время')).toBeNull();
    expect(document.activeElement).toBe(minutesField());
    expect(minutesField()?.value).toBe('25');
    expect(heading()).toBe('Сессия записана · 25 мин');
    // 28 мин: начало 17:32 — раньше, чем кончилась прошлая (17:35), пересечение снова
    enterMinutes('28');
    expect(alerts()).toEqual([OVERLAP_TEXT]);
    // Ввод в поле убирает предупреждение, как правка поля в списке логов
    const field = minutesField();
    if (field) {
      field.value = '2';
      field.dispatchEvent(new Event('input'));
    }
    TestBed.tick();
    expect(alerts()).toEqual([]);
    enterMinutes('20');
    expect(logOf(store)).toMatchObject({ durationMin: 20, steps: { minutes: [10, 10, 0, 0] } });
    expect(heading()).toBe('Сессия записана · 20 мин');
  });

  it('закрытие карточки с предупреждением ничего не пишет, следующая карточка открывается без него', async () => {
    const original = justStopped();
    const store = await render([previous, original]);
    enterMinutes('30');
    click('Готово');
    await settle();
    expect(dialog()).toBeNull();
    expect(logOf(store)).toEqual(original);
    TestBed.inject(UiStateService).summaryLogId.set('log');
    TestBed.tick();
    expect(heading()).toBe('Сессия записана · 25 мин');
    expect(alerts()).toEqual([]);
    expect(minutesField()?.value).toBe('25');
  });

  it('уменьшение без пересечения пишется сразу, предупреждения нет', async () => {
    const store = await render([previous, justStopped()]);
    enterMinutes('20');
    expect(alerts()).toEqual([]);
    expect(logOf(store)?.durationMin).toBe(20);
  });
});

describe('сессии подряд через «Переключиться» — без предупреждения о пересечении (Q-051; FR-14, FR-64)', () => {
  /** «Переключиться» за 10 мин 40 с до «Стоп»: прошлая сессия 17:19:20–17:49:20. */
  const SWITCHED_AT = NOW - (10 * MIN + 40_000);
  const switchedFrom: ITimeLog = {
    ...previous,
    id: 'switchedFrom',
    createdAt: at(SWITCHED_AT),
    updatedAt: at(SWITCHED_AT),
    startedAt: at(SWITCHED_AT - 30 * MIN),
    endedAt: at(SWITCHED_AT),
    durationMin: 30,
  };
  /** Остановленная сессия 10 мин 40 с: записано 11 мин, начало 17:49:00 — на 20 с раньше конца прошлой, как пишет «Стоп». */
  const stopped = (): ITimeLog => justStopped({ minutes: [11, 0, 0, 0], stopIndex: 0 });
  const switchedText = `Пересекается с сессией ${formatTime(switchedFrom.startedAt)}–${formatTime(switchedFrom.endedAt)}. Сохранить обе?`;

  /** «Сохранить» в списке логов у строки `row` (0 — новая сессия) без изменений; что список показал. */
  function saveInList(row: number): { readonly alerts: readonly string[]; readonly editorOpen: boolean } {
    const root = document.querySelector<HTMLElement>('app-log-list');
    root?.querySelectorAll<HTMLButtonElement>('.logs__main').item(row)?.click();
    TestBed.tick();
    const actions = [...(root?.querySelectorAll<HTMLButtonElement>('.logEdit__actions button') ?? [])];
    actions[actions.length - 1]?.click();
    TestBed.tick();
    return {
      alerts: [...(root?.querySelectorAll('[role="alert"]') ?? [])].map((node) => text(node)),
      editorOpen: root?.querySelector('.logEdit') !== null,
    };
  }

  it('карточка итога: 11 → 10 записано сразу, предупреждения нет; минуты шагов по Д-7, шаг первой минуты прежний', async () => {
    const store = await render([switchedFrom, stopped()]);
    expect(Date.parse(switchedFrom.endedAt) - Date.parse(stopped().startedAt)).toBe(20_000);
    enterMinutes('10');
    expect(alerts()).toEqual([]);
    expect(button('Сохранить обе')).toBeNull();
    expect(logOf(store)).toMatchObject({ durationMin: 10, steps: { minutes: [10, 0, 0, 0], stopIndex: 0, firstMinuteIndex: 0 } });
    expect(heading()).toBe('Сессия записана · 10 мин');
  });

  it('список логов: «Сохранить» у новой и у прошлой сессии без предупреждения — правка записана', async () => {
    const store = await render([switchedFrom, stopped()]);
    expect(saveInList(0)).toEqual({ alerts: [], editorOpen: false });
    expect(logOf(store)).toMatchObject({ durationMin: 11, editedAt: at(NOW) });
    expect(saveInList(1)).toEqual({ alerts: [], editorOpen: false });
    expect(store.data().timeLogs.find((log) => log.id === 'switchedFrom')).toMatchObject({ durationMin: 30, editedAt: at(NOW) });
  });

  it('настоящее пересечение — 11 → 13 ставит начало на 2 мин 20 с раньше конца прошлой: предупреждение, лог ждёт', async () => {
    const original = stopped();
    const store = await render([switchedFrom, original]);
    enterMinutes('13');
    expect(alerts()).toEqual([switchedText]);
    expect(logOf(store)).toEqual(original);
  });
});

describe('правка минут в карточке итога и шаги (Д-7, Q-025; US-31)', () => {
  it('ТК-Q021.7 в итоге: 6 → 3 → 8 — шаг первой минуты прежний, хотя у шага 2 стало 0 мин; заголовок за каждым числом', async () => {
    const store = await render([justStopped({ minutes: [3, 1, 2, 0], stopIndex: 2, firstMinuteIndex: 1 })]);
    enterMinutes('3');
    expect(logOf(store)).toMatchObject({ durationMin: 3, steps: { minutes: [3, 0, 0, 0], firstMinuteIndex: 1 } });
    expect(heading()).toBe('Сессия записана · 3 мин');
    enterMinutes('8');
    expect(logOf(store)).toMatchObject({ durationMin: 8, steps: { minutes: [3, 0, 5, 0], firstMinuteIndex: 1 } });
    expect(heading()).toBe('Сессия записана · 8 мин');
  });
});
