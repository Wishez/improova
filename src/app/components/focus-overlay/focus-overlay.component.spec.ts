import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { itemFixture } from '../../domain/test-fixtures';
import { DataStore, TimerService, ToastService, UiStateService } from '../../services';
import { MemoryAdapter, STORAGE_ADAPTER } from '../../storage';
import type { IItem, ITimeLog } from '../../types';
import { FocusOverlayComponent } from './focus-overlay.component';

/** Начало сессии в тестах: часы сессии «12:00» = START + 12 мин. */
const START = Date.parse('2026-10-12T10:00:00.000Z');
const min = (value: number): number => value * 60_000;
const NBSP = ' ';

/** Топик с ориентиром из шагов «название — плановые минуты». */
function topic(params: { readonly id: string; readonly steps: readonly (readonly [string, number])[]; readonly kind?: IItem['kind'] }): IItem {
  return {
    ...itemFixture({ id: params.id, topicId: 'topic', kind: params.kind ?? 'practice' }),
    guide:
      params.steps.length > 0
        ? {
            goal: '',
            task: '',
            steps: params.steps.map(([title, minutes]) => ({ title, minutes })),
            stopCriterion: '',
            links: [],
            references: [],
            imageIds: [],
            pitfalls: [],
          }
        : null,
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

interface IHarness {
  readonly fixture: ComponentFixture<FocusOverlayComponent>;
  readonly store: DataStore;
  readonly timer: TimerService;
  readonly ui: UiStateService;
}

/** Режим фокуса на хранилище в памяти: тот же путь данных, что в приложении. */
async function render(items: readonly IItem[], logs: readonly ITimeLog[] = []): Promise<IHarness> {
  const adapter = new MemoryAdapter();
  await adapter.putMany('items', items);
  await adapter.putMany('timeLogs', logs);
  TestBed.configureTestingModule({ providers: [{ provide: STORAGE_ADAPTER, useValue: adapter }] });
  const store = TestBed.inject(DataStore);
  await store.init();
  const timer = TestBed.inject(TimerService);
  const ui = TestBed.inject(UiStateService);
  const fixture = TestBed.createComponent(FocusOverlayComponent);
  document.body.appendChild(fixture.nativeElement);
  TestBed.tick();
  return { fixture, store, timer, ui };
}

/** Сессия по топику открыта в режиме фокуса. */
function open(h: IHarness, params: { readonly itemId: string | null; readonly plannedMin: number }): void {
  h.timer.start({ itemId: params.itemId, type: 'practice', plannedMin: params.plannedMin });
  h.ui.focusMode.set(true);
  TestBed.tick();
}

/** Часы до момента `ms` от START: таймер тикает раз в секунду. */
async function at(h: IHarness, ms: number): Promise<void> {
  const target = START + ms;
  if (target - Date.now() > 2000) {
    vi.setSystemTime(target - 1000);
  }
  await vi.advanceTimersByTimeAsync(Math.max(0, target - Date.now()));
  TestBed.tick();
}

const root = (h: IHarness): HTMLElement => h.fixture.nativeElement;
const text = (element: Element | null): string => element?.textContent?.trim() ?? '';
const buttons = (h: IHarness): string[] => [...root(h).querySelectorAll('button')].map((button) => text(button));

beforeEach(() => {
  vi.useFakeTimers({ now: START, toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
});

afterEach(() => {
  TestBed.resetTestingModule();
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('лимит сессии в режиме фокуса (FR-55, Q-010)', () => {
  it('до лимита — «Сессия · 45 мин», после — «Время сессии вышло · 45 мин»; минуты целые, перед «мин» неразрывный пробел', async () => {
    const h = await render([sphere]);
    open(h, { itemId: 'sphere', plannedMin: 45 });
    expect(text(root(h).querySelector('.focus__total'))).toBe(`Сессия · 45${NBSP}мин`);
    await at(h, min(45));
    const total = root(h).querySelector('.focus__total');
    expect(text(total)).toBe(`Время сессии вышло · 45${NBSP}мин`);
    expect(total?.classList.contains('focus__total_over')).toBe(true);
  });

  it('дробный лимит округляется вниз, а не к ближайшему: 44,5 → «44 мин»', async () => {
    const h = await render([]);
    open(h, { itemId: null, plannedMin: 44.5 });
    expect(text(root(h).querySelector('.focus__total'))).toBe(`Сессия · 44${NBSP}мин`);
    await at(h, min(44.5));
    expect(text(root(h).querySelector('.focus__total'))).toBe(`Время сессии вышло · 44${NBSP}мин`);
  });

  it('ТК-24.7, ТК-Q010.1: после «Время сессии вышло» кнопки продления нет — ни у шага, ни в режиме фокуса; есть «Стоп», таймер идёт (US-24, критерий 7)', async () => {
    const h = await render([sphere]);
    open(h, { itemId: 'sphere', plannedMin: 45 });
    await at(h, min(20));
    h.timer.nextStep();
    await at(h, min(30));
    h.timer.nextStep();
    await at(h, min(45));
    // У сигнала — единственное действие «Стоп»
    const signal = TestBed.inject(ToastService)
      .toasts()
      .filter((toast) => toast.text.startsWith('Время сессии вышло'));
    expect(signal.map((toast) => toast.action?.label ?? null)).toEqual(['Стоп']);
    await at(h, min(50));
    expect(buttons(h)).toContain('Стоп');
    expect(buttons(h).some((label) => label.includes('+5') || /добав|продл/iu.test(label))).toBe(false);
    expect(root(h).textContent ?? '').not.toMatch(/\+\s?5\s?мин|добавь|продл/iu);
    expect(h.timer.state()?.plannedMin).toBe(45);
    expect(h.timer.clock()).toBe('50:00');
  });
});
