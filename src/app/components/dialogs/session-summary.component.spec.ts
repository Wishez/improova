import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TuiRoot, provideTaiga } from '@taiga-ui/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { itemFixture } from '../../domain/test-fixtures';
import { DataStore, UiStateService } from '../../services';
import { MemoryAdapter, STORAGE_ADAPTER } from '../../storage';
import type { ILogSteps, ITimeLog } from '../../types';
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

/** Оболочка с карточкой итога — как в приложении, под `tui-root`. */
@Component({
  imports: [TuiRoot, SessionSummaryComponent],
  template: '<tui-root><app-session-summary /></tui-root>',
})
class SummaryHostComponent {}

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
