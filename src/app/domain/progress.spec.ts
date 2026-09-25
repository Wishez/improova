import { describe, expect, it } from 'vitest';
import { remainingMinutes } from './estimate';
import { progressOfItems } from './progress';
import { reviewState } from './reviews';
import { itemFixture, logFixture } from './test-fixtures';

describe('progressOfItems (ТЗ 3, правила прогресса)', () => {
  it('процент взвешен по оценке, счётчик — по штукам', () => {
    const items = [
      itemFixture({ id: 'a', topicId: 't', estimateMin: 300, doneAt: '2026-01-01T10:00:00Z' }),
      itemFixture({ id: 'b', topicId: 't', estimateMin: 100 }),
    ];
    const progress = progressOfItems(items, new Map());
    expect(progress.ratio).toBeCloseTo(0.75);
    expect(progress.doneCount).toBe(1);
    expect(progress.totalCount).toBe(2);
    expect(progress.status).toBe('inProgress');
  });

  it('тема закрыта, когда закрыты все разовые топики; повторяющиеся не считаются', () => {
    const items = [
      itemFixture({ id: 'a', topicId: 't', doneAt: '2026-01-01T10:00:00Z' }),
      itemFixture({ id: 'r', topicId: 't', recurrenceWeeks: 1 }),
    ];
    expect(progressOfItems(items, new Map()).status).toBe('done');
  });

  it('время без галочки делает тему «в работе», но не закрывает её', () => {
    const items = [itemFixture({ id: 'a', topicId: 't', estimateMin: 60 })];
    const progress = progressOfItems(items, new Map([['a', 500]]));
    expect(progress.status).toBe('inProgress');
    expect(progress.ratio).toBe(0);
  });
});

describe('remainingMinutes (ТЗ 5.2)', () => {
  it('остаток не обнуляется, пока нет галочки', () => {
    expect(remainingMinutes({ estimateMin: 60, spentMin: 200, factor: 1, blockMin: 20 })).toBe(20);
    expect(remainingMinutes({ estimateMin: 200, spentMin: 190, factor: 1, blockMin: 20 })).toBe(50);
    expect(remainingMinutes({ estimateMin: 100, spentMin: 30, factor: 1.5, blockMin: 20 })).toBe(120);
  });
});

describe('reviewState (ТЗ 5.6)', () => {
  const item = itemFixture({ id: 'a', topicId: 't', doneAt: '2026-01-05T10:00:00.000Z' });

  it('первое повторение — через Δ1 от закрытия', () => {
    const state = reviewState({ item, logs: [], intervals: [3, 10, 30], boundaryHour: 4 });
    expect(state.pending).toEqual({ itemId: 'a', index: 0, dueDate: '2026-01-08' });
  });

  it('следующее считается от фактической даты предыдущего', () => {
    const log = logFixture({ id: 'l', itemId: 'a', type: 'review', startedAt: '2026-01-12T10:00:00.000Z', minutes: 15 });
    const state = reviewState({ item, logs: [log], intervals: [3, 10, 30], boundaryHour: 4 });
    expect(state.pending?.index).toBe(1);
    expect(state.pending?.dueDate).toBe('2026-01-22');
  });

  it('лог короче 10 минут повторением не считается', () => {
    const log = logFixture({ id: 'l', itemId: 'a', type: 'review', startedAt: '2026-01-08T10:00:00.000Z', minutes: 5 });
    expect(reviewState({ item, logs: [log], intervals: [3], boundaryHour: 4 }).pending?.index).toBe(0);
  });
});
