import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTaiga } from '@taiga-ui/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './app';
import { itemFixture } from './domain/test-fixtures';
import { DataStore, TimerService, UiStateService } from './services';
import { MemoryAdapter, STORAGE_ADAPTER, type IWriteBatch } from './storage';
import type { IItem } from './types';

const START = Date.parse('2026-10-12T10:00:00.000Z');
const min = (value: number): number => value * 60_000;

/** Топик с ориентиром из двух шагов: сессия идёт в режиме фокуса со списком шагов. */
const sphere: IItem = {
  ...itemFixture({ id: 'sphere', topicId: 'topic' }),
  guide: {
    goal: '',
    task: '',
    steps: [
      { title: 'Линейное построение', minutes: 20 },
      { title: 'Тон и рефлексы', minutes: 25 },
    ],
    stopCriterion: '',
    links: [],
    references: [],
    imageIds: [],
    pitfalls: [],
  },
};

/** Хранилище, которое не принимает первый пакет записи, — отказ при «Стоп» (НФТ «Надёжность»). */
class FailingOnceAdapter extends MemoryAdapter {
  private failed = false;

  override async writeBatch(batch: IWriteBatch): Promise<void> {
    if (!this.failed && batch.puts.some((put) => put.collection === 'timeLogs')) {
      this.failed = true;
      throw new Error('Хранилище не отвечает');
    }
    return super.writeBatch(batch);
  }
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

interface IHarness {
  readonly fixture: ComponentFixture<App>;
  readonly store: DataStore;
  readonly timer: TimerService;
  readonly ui: UiStateService;
}

/** Оболочка приложения после онбординга на хранилище в памяти: тот же путь данных, что в приложении. */
async function render(adapter: MemoryAdapter = new MemoryAdapter()): Promise<IHarness> {
  stubMatchMedia();
  await adapter.putMany('items', [sphere]);
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideTaiga({ mode: 'dark' }),
      { provide: STORAGE_ADAPTER, useValue: adapter },
    ],
  });
  const store = TestBed.inject(DataStore);
  await store.init();
  store.updateMeta({ onboarded: true });
  const fixture = TestBed.createComponent(App);
  document.body.appendChild(fixture.nativeElement);
  TestBed.tick();
  return {
    fixture,
    store,
    timer: TestBed.inject(TimerService),
    ui: TestBed.inject(UiStateService),
  };
}

/** Часы до момента `ms` от START: таймер тикает раз в секунду. */
async function at(ms: number): Promise<void> {
  const target = START + ms;
  if (target - Date.now() > 2000) {
    vi.setSystemTime(target - 1000);
  }
  await vi.advanceTimersByTimeAsync(Math.max(0, target - Date.now()));
  TestBed.tick();
}

/** Дождаться записи в хранилище и перерисовки. */
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
  TestBed.tick();
}

const text = (element: Element | null): string =>
  element?.textContent?.trim().replace(/\s+/gu, ' ') ?? '';
const shell = (): HTMLElement | null => document.querySelector<HTMLElement>('.shell');
const focusDialog = (): HTMLElement | null =>
  document.querySelector<HTMLElement>('app-focus-overlay [role="dialog"]');
const button = (label: string, scope: ParentNode = document): HTMLButtonElement | null =>
  [...scope.querySelectorAll<HTMLButtonElement>('button')].find((entry) => text(entry) === label) ??
  null;
const toast = (start: string): HTMLElement | null =>
  [...document.querySelectorAll<HTMLElement>('.toast')].find((entry) =>
    text(entry.querySelector('.toast__text')).startsWith(start),
  ) ?? null;

/** Элемент выключен, если он сам или любой его предок inert: такой узел не получает фокус и не виден читалке. */
function insideInert(element: Element | null): boolean {
  for (let node = element; node; node = node.parentElement) {
    if (node instanceof HTMLElement && node.inert) {
      return true;
    }
  }
  return false;
}

/** Сессия идёт, режим фокуса открыт кнопкой мини-таймера — как это делает владелец. */
function openFocus(h: IHarness): HTMLButtonElement | null {
  h.timer.start({ itemId: 'sphere', type: 'practice', plannedMin: 45 });
  TestBed.tick();
  const opener = button('Режим фокуса', document.querySelector('app-mini-timer') ?? document);
  opener?.focus();
  opener?.click();
  TestBed.tick();
  return opener;
}

beforeEach(() => {
  vi.useFakeTimers({
    now: START,
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
  });
});

afterEach(() => {
  TestBed.resetTestingModule();
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('фон под режимом фокуса недоступен для клавиатуры и читалки (НФТ «Доступность интерфейса»)', () => {
  it('без режима фокуса фон доступен: идущая сессия сама по себе фон не выключает', async () => {
    const h = await render();
    expect(shell()).not.toBeNull();
    expect(shell()?.inert).toBe(false);
    h.timer.start({ itemId: 'sphere', type: 'practice', plannedMin: 45 });
    TestBed.tick();
    expect(shell()?.inert).toBe(false);
  });

  it('открытый режим фокуса выключает фон: навигация и мини-таймер под ним inert, сам режим — вне фона и получает фокус', async () => {
    const h = await render();
    openFocus(h);
    const dialog = focusDialog();
    expect(dialog).not.toBeNull();
    expect(shell()?.inert).toBe(true);
    expect(insideInert(document.querySelector('nav[aria-label="Разделы приложения"]'))).toBe(true);
    expect(insideInert(document.querySelector('app-mini-timer'))).toBe(true);
    expect(insideInert(dialog)).toBe(false);
    expect(document.activeElement).toBe(dialog);
    for (const entry of dialog?.querySelectorAll('button') ?? []) {
      expect(insideInert(entry)).toBe(false);
    }
  });

  it('на паузе режим фокуса открыт — фон остаётся выключенным', async () => {
    const h = await render();
    openFocus(h);
    button('Пауза', focusDialog() ?? document)?.click();
    TestBed.tick();
    expect(h.timer.paused()).toBe(true);
    expect(focusDialog()).not.toBeNull();
    expect(shell()?.inert).toBe(true);
  });

  it('режим фокуса без идущей сессии не открывается и фон не выключает', async () => {
    const h = await render();
    h.ui.focusMode.set(true);
    TestBed.tick();
    expect(focusDialog()).toBeNull();
    expect(shell()?.inert).toBe(false);
  });

  it('сигнал «Время сессии вышло» поверх режима фокуса — вне фона, «Стоп» в тосте получает фокус и останавливает сессию; фон снова доступен, итог сессии открыт', async () => {
    const h = await render();
    openFocus(h);
    await at(min(45));
    const signal = toast('Время сессии вышло');
    const stop = signal ? button('Стоп', signal) : null;
    expect(stop).not.toBeNull();
    expect(shell()?.inert).toBe(true);
    expect(insideInert(signal)).toBe(false);
    expect(insideInert(stop)).toBe(false);
    stop?.focus();
    expect(document.activeElement).toBe(stop);
    stop?.click();
    await settle();
    expect(h.timer.running()).toBe(false);
    expect(focusDialog()).toBeNull();
    expect(shell()?.inert).toBe(false);
    expect(h.ui.summaryLogId()).not.toBeNull();
  });

  it('тост об отказе хранилища при «Стоп» — вне фона и доступен; режим фокуса открыт, фон по-прежнему выключен', async () => {
    const h = await render(new FailingOnceAdapter());
    openFocus(h);
    await at(min(5));
    button('Стоп', focusDialog() ?? document)?.click();
    await settle();
    const failure = toast('Сессия не записана');
    expect(failure).not.toBeNull();
    expect(insideInert(failure)).toBe(false);
    expect(insideInert(failure?.querySelector('button.toast__close') ?? null)).toBe(false);
    expect(h.timer.running()).toBe(true);
    expect(focusDialog()).not.toBeNull();
    expect(shell()?.inert).toBe(true);
  });

  it('окна «Таймер шёл N ч» и «Идёт другая сессия» поверх режима фокуса — вне фона, их кнопки доступны', async () => {
    const h = await render();
    openFocus(h);
    h.ui.forgottenOpen.set(true);
    TestBed.tick();
    const discard = button('Удалить сессию');
    expect(discard).not.toBeNull();
    expect(shell()?.contains(discard)).toBe(false);
    expect(insideInert(discard)).toBe(false);
    h.ui.forgottenOpen.set(false);
    h.ui.pendingStart.set({ itemId: null, type: 'practice', plannedMin: 30 });
    TestBed.tick();
    const switchTo = button('Переключиться');
    expect(switchTo).not.toBeNull();
    expect(shell()?.contains(switchTo)).toBe(false);
    expect(insideInert(switchTo)).toBe(false);
    expect(shell()?.inert).toBe(true);
  });

  it('итог сессии, тосты и окна лежат вне фона: в `.shell` нет ни одного из них', async () => {
    await render();
    const outside = [
      'app-focus-overlay',
      'app-toast-host',
      'app-session-summary',
      'app-forgotten-dialog',
      'app-switch-confirm',
      'app-command-palette',
      'app-item-drawer',
    ];
    for (const selector of outside) {
      const host = document.querySelector(selector);
      expect(host, selector).not.toBeNull();
      expect(shell()?.contains(host), selector).toBe(false);
    }
  });

  it('«Выйти · Esc» закрывает режим фокуса: фон снова доступен, фокус возвращается на кнопку «Режим фокуса»', async () => {
    const h = await render();
    const opener = openFocus(h);
    expect(shell()?.inert).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    TestBed.tick();
    expect(focusDialog()).toBeNull();
    expect(shell()?.inert).toBe(false);
    expect(opener).not.toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(h.timer.running()).toBe(true);
  });
});
