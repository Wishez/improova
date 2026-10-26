import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataStore } from '../../services';
import { MemoryAdapter, STORAGE_ADAPTER } from '../../storage';
import type { ILogSteps, ITimeLog } from '../../types';
import { toLocalInputValue } from '../../utils';
import { LogListComponent } from './log-list.component';

const NOW = Date.parse('2026-10-12T18:00:00.000Z');
const MIN = 60_000;
/** Текст ошибки — знак в знак из FR-14. */
const FUTURE_TEXT = 'Нельзя записать сессию в будущем.';

/** Лог только что остановленной сессии с шагами: конец — «сейчас», как пишет «Стоп» (ТК-31.2: шаг 1 — 20, шаг 2 — 15). */
function justStopped(patch: Partial<ILogSteps> = {}): ITimeLog {
  const steps: ILogSteps = {
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
  const durationMin = steps.minutes.reduce((sum, value) => sum + value, 0);
  return {
    id: 'log',
    createdAt: new Date(NOW).toISOString(),
    updatedAt: new Date(NOW).toISOString(),
    itemId: 'own',
    type: 'study',
    startedAt: new Date(NOW - durationMin * MIN).toISOString(),
    endedAt: new Date(NOW).toISOString(),
    durationMin,
    source: 'timer',
    editedAt: null,
    steps,
  };
}

interface IView {
  readonly fixture: ComponentFixture<LogListComponent>;
  readonly store: DataStore;
  readonly root: HTMLElement;
}

async function render(logs: readonly ITimeLog[]): Promise<IView> {
  const adapter = new MemoryAdapter();
  await adapter.putMany('timeLogs', logs);
  TestBed.configureTestingModule({ providers: [{ provide: STORAGE_ADAPTER, useValue: adapter }] });
  const store = TestBed.inject(DataStore);
  await store.init();
  const fixture = TestBed.createComponent(LogListComponent);
  fixture.componentRef.setInput('logs', store.logs());
  fixture.detectChanges();
  const root: HTMLElement = fixture.nativeElement;
  return { fixture, store, root };
}

/** Правка лога в списке: нажать на строку лога. */
function openEditor(view: IView): void {
  view.root.querySelector<HTMLButtonElement>('.logs__main')?.click();
  view.fixture.detectChanges();
}

function minutesField(view: IView): HTMLInputElement | null {
  return view.root.querySelector<HTMLInputElement>('.logEdit input[type="number"]');
}

function startField(view: IView): HTMLInputElement | null {
  return view.root.querySelector<HTMLInputElement>('.logEdit input[type="datetime-local"]');
}

function typeInto(view: IView, field: HTMLInputElement | null, value: string, event: 'input' | 'change' = 'input'): void {
  if (field) {
    field.value = value;
    field.dispatchEvent(new Event(event));
  }
  view.fixture.detectChanges();
}

function save(view: IView): void {
  const buttons = view.root.querySelectorAll<HTMLButtonElement>('.logEdit__actions button');
  buttons.item(buttons.length - 1).click();
  view.fixture.detectChanges();
}

const logOf = (view: IView): ITimeLog | undefined => view.store.data().timeLogs.find((log) => log.id === 'log');

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
});

afterEach(() => {
  TestBed.resetTestingModule();
  vi.useRealTimers();
});

describe('правка минут лога в списке логов сразу после «Стоп» (Д-1 прогона З-13; FR-14, FR-64)', () => {
  it('ТК-31.2 в списке: 35 → 40 при прежнем начале — сохраняется, шаг 2 — 20, конец не в будущем, начало раньше', async () => {
    const view = await render([justStopped()]);
    openEditor(view);
    typeInto(view, minutesField(view), '40');
    save(view);
    expect(view.root.querySelector('.logEdit')).toBeNull();
    const log = logOf(view);
    expect(log).toMatchObject({ durationMin: 40, steps: { minutes: [20, 20, 0, 0], stopIndex: 1, firstMinuteIndex: 0 } });
    expect(log?.endedAt).toBe(new Date(NOW).toISOString());
    expect(log?.startedAt).toBe(new Date(NOW - 40 * MIN).toISOString());
    expect(log?.editedAt).not.toBeNull();
  });

  it('ТК-Q021.7, шаг 7: 8 → 7 — шаг первой минуты прежний, хотя у шага 2 0 мин (Q-025, Д-28)', async () => {
    const view = await render([justStopped({ minutes: [3, 0, 5, 0], stopIndex: 2, firstMinuteIndex: 1 })]);
    openEditor(view);
    typeInto(view, minutesField(view), '7');
    save(view);
    expect(logOf(view)).toMatchObject({ durationMin: 7, steps: { minutes: [3, 0, 4, 0], firstMinuteIndex: 1 } });
  });

  it('начало, которое ввели сами, в будущем — по-прежнему «Нельзя записать сессию в будущем.», лог не меняется (FR-14)', async () => {
    const original = justStopped();
    const view = await render([original]);
    openEditor(view);
    typeInto(view, startField(view), toLocalInputValue(new Date(NOW + 60 * MIN).toISOString()), 'change');
    save(view);
    expect(view.root.querySelector('.logEdit__message')?.textContent?.trim()).toBe(FUTURE_TEXT);
    expect(logOf(view)).toEqual(original);
  });
});
