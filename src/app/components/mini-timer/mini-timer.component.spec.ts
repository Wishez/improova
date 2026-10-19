import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { itemFixture } from '../../domain/test-fixtures';
import { DataStore, TimerService } from '../../services';
import { MemoryAdapter, STORAGE_ADAPTER } from '../../storage';
import type { IItem } from '../../types';
import { MiniTimerComponent } from './mini-timer.component';

const START = Date.parse('2026-10-12T10:00:00.000Z');
const min = (value: number): number => value * 60_000;
const NBSP = ' ';

/** «Изучение двух художников» из ТД-1: шаги 10 / 20 / 20 / 10 мин. */
const artists: IItem = {
  ...itemFixture({ id: 'artists', topicId: 'topic', kind: 'study' }),
  title: 'Изучение двух художников',
  guide: {
    goal: '',
    task: '',
    steps: [
      { title: 'Контекст: годы, школа, техника', minutes: 10 },
      { title: '10 работ в высоком разрешении', minutes: 20 },
      { title: '3 штудии по 6 минут', minutes: 20 },
      { title: 'Заметка', minutes: 10 },
    ],
    stopCriterion: '',
    links: [],
    references: [],
    imageIds: [],
    pitfalls: [],
  },
};

interface IHarness {
  readonly fixture: ComponentFixture<MiniTimerComponent>;
  readonly timer: TimerService;
}

async function render(items: readonly IItem[]): Promise<IHarness> {
  const adapter = new MemoryAdapter();
  await adapter.putMany('items', items);
  TestBed.configureTestingModule({ providers: [{ provide: STORAGE_ADAPTER, useValue: adapter }] });
  await TestBed.inject(DataStore).init();
  const timer = TestBed.inject(TimerService);
  const fixture = TestBed.createComponent(MiniTimerComponent);
  TestBed.tick();
  return { fixture, timer };
}

async function at(ms: number): Promise<void> {
  const target = START + ms;
  if (target - Date.now() > 2000) {
    vi.setSystemTime(target - 1000);
  }
  await vi.advanceTimersByTimeAsync(Math.max(0, target - Date.now()));
  TestBed.tick();
}

const root = (h: IHarness): HTMLElement => h.fixture.nativeElement;
const text = (h: IHarness, selector: string): string => root(h).querySelector(selector)?.textContent?.trim() ?? '';

beforeEach(() => {
  vi.useFakeTimers({ now: START, toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
});

afterEach(() => {
  TestBed.resetTestingModule();
  vi.useRealTimers();
});

describe('мини-таймер: активный шаг и его минуты (FR-53)', () => {
  it('ТК-23.2: название активного шага и «X из Y мин»; после плана вместо него «+N сверх плана» (US-23, критерий 2)', async () => {
    const h = await render([artists]);
    h.timer.start({ itemId: 'artists', type: 'study', plannedMin: 45 });
    await at(min(10));
    h.timer.nextStep();
    await at(min(22));
    expect(text(h, '.miniTimer__stepName')).toBe('10 работ в высоком разрешении');
    expect(text(h, '.miniTimer__stepProgress')).toBe(`12${NBSP}из${NBSP}20${NBSP}мин`);
    await at(min(37));
    expect(text(h, '.miniTimer__stepName')).toBe('10 работ в высоком разрешении');
    expect(text(h, '.miniTimer__stepProgress')).toBe(`+7${NBSP}сверх${NBSP}плана`);
    expect(root(h).querySelector('.miniTimer__stepProgress')?.classList.contains('miniTimer__stepProgress_over')).toBe(true);
  });

  it('имя строки шага для читалки — полное название и минуты: «Текущий шаг: …, 12 из 20 мин», после плана — «…, +7 сверх плана»', async () => {
    const h = await render([artists]);
    h.timer.start({ itemId: 'artists', type: 'study', plannedMin: 45 });
    h.timer.selectStep(1);
    await at(min(12));
    const label = (): string => text(h, '.miniTimer__step .visuallyHidden');
    expect(label()).toBe(`Текущий шаг: 10 работ в высоком разрешении, 12${NBSP}из${NBSP}20${NBSP}мин`);
    // Видимые части скрыты от читалки: имя строки не читается дважды
    expect(root(h).querySelector('.miniTimer__stepName')?.getAttribute('aria-hidden')).toBe('true');
    expect(root(h).querySelector('.miniTimer__stepProgress')?.getAttribute('aria-hidden')).toBe('true');
    await at(min(27));
    expect(label()).toBe(`Текущий шаг: 10 работ в высоком разрешении, +7${NBSP}сверх${NBSP}плана`);
  });

  it('ТК-Н11: часы и минуты шага не объявляются — вслух только старт: в области объявлений лишь название сессии (НФТ «Доступность интерфейса»)', async () => {
    const h = await render([artists]);
    const status = (): Element | null => root(h).querySelector('[role="status"]');
    expect(status()?.textContent?.trim()).toBe('');
    h.timer.start({ itemId: 'artists', type: 'study', plannedMin: 45 });
    await at(min(3));
    expect(root(h).querySelectorAll('[aria-live], [role="status"], [role="alert"]')).toHaveLength(1);
    expect(status()?.textContent?.trim()).toBe('Изучение двух художников');
    expect(status()?.contains(root(h).querySelector('.miniTimer__clock'))).toBe(false);
    await h.timer.stop();
    TestBed.tick();
    expect(status()?.textContent?.trim()).toBe('');
  });

  it('ТК-Q010.1: после «Время сессии вышло» в мини-таймере нет продления — пауза, режим фокуса и «Стоп» (US-24, критерий 7)', async () => {
    const h = await render([artists]);
    h.timer.start({ itemId: 'artists', type: 'study', plannedMin: 5 });
    await at(min(6));
    const labels = [...root(h).querySelectorAll('button')].map((button) => button.textContent?.trim() ?? '');
    expect(labels).toEqual(['Пауза', 'Режим фокуса', 'Стоп']);
  });

  it('сессия без шагов — вторая строка с фазой шаблона FR-12, как в 1.5', async () => {
    const h = await render([]);
    h.timer.start({ itemId: null, type: 'creative', plannedMin: 30 });
    TestBed.tick();
    expect(root(h).querySelector('.miniTimer__step')).toBeNull();
    expect(text(h, '.miniTimer__phase')).toBe('Разминка');
  });
});
