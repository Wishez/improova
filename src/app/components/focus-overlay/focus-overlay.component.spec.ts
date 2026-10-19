import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { itemFixture } from '../../domain/test-fixtures';
import { DataStore, TimerService, ToastService, UiStateService } from '../../services';
import { MemoryAdapter, STORAGE_ADAPTER } from '../../storage';
import type { IItem, ILogSteps, ITimeLog } from '../../types';
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

/** Лог прошлой сессии таймера со сведениями о шагах — место остановки топика (ТД-4). */
function stepLog(params: { readonly itemId: string; readonly steps: ILogSteps }): ITimeLog {
  const startedAt = '2026-10-12T08:00:00.000Z';
  const durationMin = params.steps.minutes.reduce((sum, value) => sum + value, 0);
  return {
    id: `log-${params.itemId}`,
    createdAt: startedAt,
    updatedAt: startedAt,
    itemId: params.itemId,
    type: 'study',
    startedAt,
    endedAt: new Date(Date.parse(startedAt) + min(durationMin)).toISOString(),
    durationMin,
    source: 'timer',
    editedAt: null,
    steps: params.steps,
  };
}

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
const items = (h: IHarness): HTMLElement[] => [...root(h).querySelectorAll<HTMLElement>('.stepItem')];
const progress = (h: IHarness): string[] => items(h).map((item) => text(item.querySelector('.stepItem__progress')));
/** «12 из 20 мин» с неразрывными пробелами, как в тексте вкладки. */
const of = (done: number, plan: number): string => `${done}${NBSP}из${NBSP}${plan}${NBSP}мин`;
const over = (value: number): string => `+${value}${NBSP}сверх${NBSP}плана`;

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

describe('список шагов режима фокуса — накопленное за круг (FR-53)', () => {
  it('ТК-23.1: у каждого шага «X из Y мин», у активного число растёт каждую минуту, минуты — вниз (US-23, критерий 1; US-24, критерий 1)', async () => {
    const h = await render([sphere]);
    open(h, { itemId: 'sphere', plannedMin: 45 });
    expect(items(h).map((item) => text(item.querySelector('.stepItem__title')))).toEqual([
      'Линейное построение',
      'Граница света и тени, падающие тени',
      'Тон и рефлексы',
    ]);
    expect(progress(h)).toEqual([of(0, 20), of(0, 10), of(0, 60)]);
    await at(h, min(1) - 1000);
    expect(progress(h)[0]).toBe(of(0, 20));
    await at(h, min(1));
    expect(progress(h)[0]).toBe(of(1, 20));
    await at(h, min(2) + 30_000);
    expect(progress(h)).toEqual([of(2, 20), of(0, 10), of(0, 60)]);
  });

  it('ТК-23.2: переработка — текстом «27 из 20 мин · +7 сверх плана», а не только цветом (US-23, критерий 2)', async () => {
    const h = await render([artists]);
    open(h, { itemId: 'artists', plannedMin: 45 });
    await at(h, min(10));
    h.timer.nextStep();
    await at(h, min(37));
    expect(progress(h)).toEqual([of(10, 10), `${of(27, 20)} · ${over(7)}`, of(0, 20), of(0, 10)]);
    const active = items(h)[1];
    expect(active?.classList.contains('stepItem_active')).toBe(true);
    expect(active?.querySelector('.stepItem__progress')?.classList.contains('stepItem__progress_over')).toBe(true);
  });

  it('текстов 1.5 про шаги нет: ни «Осталось N мин · дальше», ни «{шаг} · {N} мин»; у кнопок — «Дальше: …», на последнем шаге — «Последний шаг»', async () => {
    const h = await render([sphere]);
    open(h, { itemId: 'sphere', plannedMin: 45 });
    const content = (): string => root(h).textContent ?? '';
    expect(content()).not.toMatch(/Осталось|дальше:/u);
    expect(content()).not.toContain('Линейное построение · 20');
    expect(text(root(h).querySelector('.stepBar__text'))).toBe('Дальше: Граница света и тени, падающие тени');
    h.timer.selectStep(2);
    TestBed.tick();
    expect(text(root(h).querySelector('.stepBar__text'))).toBe('Последний шаг');
  });

  it('П-1: своё название следующего шага длиннее 53 знаков сокращается в строке «Дальше» — первые 52 знака и «…»; в списке — целиком', async () => {
    const long = 'Свой очень длинный шаг: штриховка, тон, контраст и мягкие края по всей форме';
    const own = topic({ id: 'own', steps: [['Начало', 5], [long, 10]] });
    const h = await render([own]);
    open(h, { itemId: 'own', plannedMin: 15 });
    expect(text(root(h).querySelector('.stepBar__text'))).toBe(`Дальше: ${long.slice(0, 52).trimEnd()}…`);
    expect(text(items(h)[1]?.querySelector('.stepItem__title') ?? null)).toBe(long);
  });

  it('ТК-25.2, ТК-25.3, ТК-25.8: продолжение круга — активен шаг места с «12 из 20 мин», у недобранного шага 2 «5 из 20 мин»; выбранный шаг 2 растёт, у шага 3 накопленное остаётся (US-25, критерии 2, 3, 8)', async () => {
    // М-2: шаг 2 — 5 мин, остановка на шаге 3 с 12 мин
    const place = stepLog({
      itemId: 'artists',
      steps: { minutes: [0, 5, 12, 0], startIndex: 0, stopIndex: 2, continuesCircle: false, circleId: 'c1', limitMin: 45, stepCount: 4, firstMinuteIndex: 1 },
    });
    const h = await render([artists], [place]);
    open(h, { itemId: 'artists', plannedMin: 45 });
    expect(items(h)[2]?.classList.contains('stepItem_active')).toBe(true);
    expect(progress(h)).toEqual([of(0, 10), of(5, 20), of(12, 20), of(0, 10)]);
    h.timer.selectStep(1);
    await at(h, min(2));
    expect(items(h)[1]?.classList.contains('stepItem_active')).toBe(true);
    expect(progress(h)).toEqual([of(0, 10), of(7, 20), of(12, 20), of(0, 10)]);
  });

  it('ТК-23.8: сессия без ориентира — фазы шаблона FR-12, как в 1.5: без списка шагов и кнопок смены шага (Д-1)', async () => {
    const h = await render([]);
    open(h, { itemId: null, plannedMin: 30 });
    expect(items(h)).toEqual([]);
    expect(root(h).querySelector('.stepBar')).toBeNull();
    expect([...root(h).querySelectorAll('.phases__title')].map((entry) => text(entry))).toEqual([
      'Разминка · 3 мин',
      'Отработка · 7 мин',
      'Глубокая работа · 15 мин',
      'Анализ · 5 мин',
    ]);
  });
});
