import { describe, expect, it } from 'vitest';
import { SEED_ROUTE, SEED_SECTIONS, buildSeed } from '../seed';
import type { IRouteBlock } from '../types';
import {
  EMPTY_GUIDE,
  challengeWeek,
  quarterOfWeek,
  routeFocus,
  routeTitle,
  sectionWeightIn,
  validateGuide,
} from './course';
import { sectionFixture } from './test-fixtures';

const blocks = (): IRouteBlock[] => buildSeed('2026-01-05T00:00:00.000Z').routeBlocks;

describe('недели и кварталы (FR-40)', () => {
  it('первая неделя начинается в день старта, квартал — 13 недель', () => {
    expect(challengeWeek('2026-10-01', '2026-10-01')).toBe(1);
    expect(challengeWeek('2026-10-01', '2026-10-07')).toBe(1);
    expect(challengeWeek('2026-10-01', '2026-10-08')).toBe(2);
    expect(quarterOfWeek(13)).toBe(1);
    expect(quarterOfWeek(14)).toBe(2);
    expect(quarterOfWeek(52)).toBe(4);
    expect(quarterOfWeek(60)).toBe(4);
  });

  it('квартальный вес используется только при включённой настройке', () => {
    const section = { ...sectionFixture('s', 0, 2), quarterWeights: [3, 1, 1, 2] as const };
    expect(sectionWeightIn({ section: { ...section, quarterWeights: [3, 1, 1, 2] }, quarter: 1, seasonal: true })).toBe(3);
    expect(sectionWeightIn({ section: { ...section, quarterWeights: [3, 1, 1, 2] }, quarter: 2, seasonal: false })).toBe(2);
    expect(sectionWeightIn({ section: { ...section, quarterWeights: null }, quarter: 1, seasonal: true })).toBe(2);
  });
});

describe('маршрут по мастерам (FR-39, US-11)', () => {
  it('неделя 6 — блок 2, чётная неделя блока — второй художник (Гольбейн)', () => {
    const focus = routeFocus(blocks(), 6);
    expect(focus?.block.fromWeek).toBe(5);
    expect(focus?.artist?.name).toBe('Гольбейн');
    expect(routeTitle({ title: 'Изучение двух художников', routeRole: 'study' }, focus)).toBe('Изучение: Гольбейн');
  });

  it('первая неделя блока 3 — копия Рембрандта', () => {
    const focus = routeFocus(blocks(), 9);
    expect(focus?.copyWeek).toBe(true);
    expect(routeTitle({ title: 'Копия фрагмента', routeRole: 'copy' }, focus)).toContain('Рембрандта');
  });

  it('неделя вне маршрута — художник по выбору (негативный)', () => {
    expect(routeFocus(blocks(), 60)).toBeNull();
    expect(routeTitle({ title: 'Изучение двух художников', routeRole: 'study' }, null)).toBe('Изучение художника по выбору');
  });
});

describe('проверка ориентира (US-10)', () => {
  const valid = { ...EMPTY_GUIDE, goal: 'Цель', steps: [{ title: 'Шаг', minutes: 30 }] };
  it('корректный ориентир проходит', () => {
    expect(validateGuide(valid)).toEqual({});
  });
  it('ссылка без https — ошибка поля', () => {
    expect(validateGuide({ ...valid, links: [{ title: 'Книга', url: 'drawabox.com', locator: '', access: 'free' }] }).links).toBeDefined();
  });
  it('пустая цель, 0 или 9 шагов, минуты вне 1–240 — ошибки', () => {
    expect(validateGuide({ ...valid, goal: ' ' }).goal).toBeDefined();
    expect(validateGuide({ ...valid, steps: [] }).steps).toBeDefined();
    expect(validateGuide({ ...valid, steps: Array.from({ length: 9 }, () => ({ title: 'Шаг', minutes: 5 })) }).steps).toBeDefined();
    expect(validateGuide({ ...valid, steps: [{ title: 'Шаг', minutes: 241 }] }).steps).toBeDefined();
  });
});

describe('стартовая программа v2 заполнена корректно (FR-42)', () => {
  const seed = buildSeed('2026-01-05T00:00:00.000Z');

  it('у каждого топика есть корректный ориентир с целью, заданием, шагами и стоп-критерием', () => {
    expect(seed.items.length).toBe(79);
    for (const item of seed.items) {
      const guide = item.guide;
      expect(guide, item.title).not.toBeNull();
      if (!guide) {
        continue;
      }
      expect(validateGuide(guide), item.title).toEqual({});
      expect(guide.task.length, item.title).toBeGreaterThan(0);
      expect(guide.stopCriterion.length, item.title).toBeGreaterThan(0);
    }
  });

  it('все ссылки ориентиров — https или http с названием', () => {
    for (const item of seed.items) {
      for (const link of [...(item.guide?.links ?? []), ...(item.guide?.references ?? [])]) {
        if (link.url) {
          expect(link.url, `${item.title}: ${link.title}`).toMatch(/^https?:\/\//);
        }
      }
    }
  });

  it('практика: шаги одной сессии не длиннее оценки топика', () => {
    for (const item of seed.items.filter((entry) => entry.kind === 'practice')) {
      const total = (item.guide?.steps ?? []).reduce((sum, step) => sum + step.minutes, 0);
      expect(total, item.title).toBeLessThanOrEqual(item.estimateMin);
    }
  });

  it('серии «· N/M» получают разные задания', () => {
    const boxes = seed.items.filter((item) => item.title.startsWith('Куб, цилиндр'));
    expect(new Set(boxes.map((item) => item.guide?.task)).size).toBe(6);
  });

  it('маршрут: 12 блоков по 2 художника, недели 1–52 без пропусков и пересечений', () => {
    expect(SEED_ROUTE.length).toBe(12);
    let expected = 1;
    for (const block of SEED_ROUTE) {
      expect(block.fromWeek).toBe(expected);
      expect(block.toWeek).toBeGreaterThanOrEqual(block.fromWeek);
      expect(block.artists.length).toBe(2);
      expect(block.copyTask.length).toBeGreaterThan(0);
      expected = block.toWeek + 1;
    }
    expect(expected).toBe(53);
  });

  it('квартальные веса у всех разделов, по одному топику маршрута на роль', () => {
    for (const section of SEED_SECTIONS) {
      expect(section.quarterWeights.length).toBe(4);
    }
    expect(seed.items.filter((item) => item.routeRole === 'study').length).toBe(1);
    expect(seed.items.filter((item) => item.routeRole === 'copy').length).toBe(1);
  });
});
