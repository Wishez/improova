import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastService, type IToastAction, type TToastKind } from '../../services';
import { ToastHostComponent } from './toast-host.component';

type TRgb = readonly [number, number, number];

interface IToastCase {
  readonly name: string;
  readonly text: string;
  readonly kind: TToastKind;
  readonly action?: IToastAction;
}

/** Порог WCAG 2.2, 1.4.3 для обычного текста: «×» — 16 px без жирного начертания. */
const AA_TEXT = 4.5;

const HEX = /#([0-9a-f]{6})\b/i;
const RGB = /rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i;
const TRANSPARENT = new Set(['', 'transparent', 'rgba(0, 0, 0, 0)']);

/**
 * Цвет из вычисленного значения. Глобальные переменные темы в модульных тестах не подключены, поэтому
 * действует запасное значение из `var(--color-…, #rrggbb)` — Tailwind берёт его из `src/styles/theme.css`.
 */
function rgbOf(value: string): TRgb {
  const hex = HEX.exec(value)?.[1];
  if (hex) {
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
    ];
  }
  const rgb = RGB.exec(value);
  if (rgb) {
    return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  }
  throw new Error(`Цвет не разобран: «${value}»`);
}

/** Относительная яркость sRGB (WCAG 2.2). */
function luminance([r, g, b]: TRgb): number {
  const linear = (channel: number): number => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function contrast(foreground: TRgb, background: TRgb): number {
  const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

/** Фон под элементом: ближайший предок с непрозрачным фоном. */
function backgroundOf(element: HTMLElement): string {
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const color = getComputedStyle(node).backgroundColor;
    if (!TRANSPARENT.has(color)) {
      return color;
    }
  }
  throw new Error('Фон под «×» не найден');
}

function closeButton(root: HTMLElement): HTMLButtonElement {
  const button = root.querySelector<HTMLButtonElement>('.toast__close');
  if (!button) {
    throw new Error('Кнопка «×» не отрисована');
  }
  return button;
}

const stop: IToastAction = { label: 'Стоп', run: () => undefined };

const CASES: readonly IToastCase[] = [
  { name: 'обычный тост', text: 'Сессия короче минуты не записана.', kind: 'info' },
  { name: 'тост успеха', text: 'Копия сохранена: improva-2026-10-26.json', kind: 'success' },
  {
    name: 'тост ошибки',
    text: 'Изменение не сохранено: хранилище не отвечает. Повторим автоматически.',
    kind: 'error',
  },
  { name: 'тост со «Стоп»', text: 'Время сессии вышло: 60 мин', kind: 'info', action: stop },
];

describe('ToastHostComponent — кнопка «×» (НФТ «Доступность интерфейса», Д-3)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(CASES)('$name: контраст «×» к фону тоста не ниже 4,5 : 1', ({ text, kind, action }) => {
    const fixture = TestBed.createComponent(ToastHostComponent);
    TestBed.inject(ToastService).show({ text, kind, ...(action ? { action } : {}) });
    TestBed.tick();

    const button = closeButton(fixture.nativeElement);
    const ratio = contrast(rgbOf(getComputedStyle(button).color), rgbOf(backgroundOf(button)));

    expect(ratio).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('«×» — кнопка с именем «Закрыть» и закрывает свой тост', () => {
    const fixture = TestBed.createComponent(ToastHostComponent);
    const toasts = TestBed.inject(ToastService);
    toasts.show({ text: 'Сессия короче минуты не записана.' });
    TestBed.tick();

    const button = closeButton(fixture.nativeElement);
    expect(button.type).toBe('button');
    expect(button.getAttribute('aria-label')).toBe('Закрыть');

    button.click();
    TestBed.tick();
    expect(toasts.toasts()).toEqual([]);
  });
});
