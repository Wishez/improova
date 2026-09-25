import { describe, expect, it } from 'vitest';
import { logFixture } from '../domain/test-fixtures';
import { findOverlap, validateLog } from './logs.service';
import { parseBulkLines } from './program.service';

describe('validateLog (FR-14)', () => {
  const now = Date.parse('2026-01-05T12:00:00Z');
  it('конец раньше начала', () => {
    expect(validateLog({ startedAt: '2026-01-05T10:00:00Z', endedAt: '2026-01-05T09:00:00Z' }, now)).toBe('endBeforeStart');
  });
  it('длительность 1–720', () => {
    expect(validateLog({ startedAt: '2026-01-04T10:00:00Z', endedAt: '2026-01-05T10:00:00Z' }, now)).toBe('duration');
  });
  it('в будущем нельзя', () => {
    expect(validateLog({ startedAt: '2026-01-05T13:00:00Z', endedAt: '2026-01-05T14:00:00Z' }, now)).toBe('future');
  });
  it('корректный лог', () => {
    expect(validateLog({ startedAt: '2026-01-05T10:00:00Z', endedAt: '2026-01-05T10:45:00Z' }, now)).toBeNull();
  });
  it('пересечение — предупреждение, собственный лог не считается', () => {
    const log = logFixture({ id: 'a', itemId: null, type: 'creative', startedAt: '2026-01-05T10:00:00.000Z', minutes: 60 });
    expect(findOverlap({ startedAt: '2026-01-05T10:30:00.000Z', endedAt: '2026-01-05T11:30:00.000Z' }, [log], null)?.id).toBe('a');
    expect(findOverlap({ startedAt: '2026-01-05T10:30:00.000Z', endedAt: '2026-01-05T11:30:00.000Z' }, [log], 'a')).toBeNull();
  });
});

describe('parseBulkLines (FR-29)', () => {
  it('«название · 60» и строки без оценки', () => {
    expect(parseBulkLines('Глава 1 · 45\n\n  Видео про свет  \nКоробки | 90')).toEqual([
      { title: 'Глава 1', estimateMin: 45 },
      { title: 'Видео про свет', estimateMin: 60 },
      { title: 'Коробки', estimateMin: 90 },
    ]);
  });
});
