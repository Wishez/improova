import { afterEach, describe, expect, it } from 'vitest';
import {
  addDays,
  configureTimeZone,
  diffDays,
  formatTime,
  fromLocalInputValue,
  isValidDayKey,
  toDayKey,
  toLocalInputValue,
  weekStart,
  weekdayIndex,
} from './date';
import { plural } from './format';

describe('даты приложения', () => {
  afterEach(() => configureTimeZone(''));

  it('сессия до границы дня относится к прошлому дню (ТЗ 8.3)', () => {
    expect(toDayKey(new Date(2026, 8, 26, 1, 30), 4)).toBe('2026-09-25');
    expect(toDayKey(new Date(2026, 8, 26, 4, 30), 4)).toBe('2026-09-26');
  });

  it('неделя с понедельника', () => {
    expect(weekdayIndex('2026-09-28')).toBe(0);
    expect(weekStart('2026-10-04')).toBe('2026-09-28');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(diffDays('2026-09-25', '2026-10-05')).toBe(10);
  });

  it('валидация ключа дня', () => {
    expect(isValidDayKey('2026-02-30')).toBe(false);
    expect(isValidDayKey('2026-02-28')).toBe(true);
    expect(isValidDayKey('26-2-28')).toBe(false);
  });

  it('граница дня считается в выбранном часовом поясе (FR-33)', () => {
    configureTimeZone('Asia/Bangkok');
    // 01:30 по Бангкоку 26 сентября = 18:30 UTC 25 сентября
    expect(toDayKey(new Date('2026-09-25T18:30:00Z'), 4)).toBe('2026-09-25');
    // 05:00 по Бангкоку 26 сентября
    expect(toDayKey(new Date('2026-09-25T22:00:00Z'), 4)).toBe('2026-09-26');
  });

  it('время и поле ввода показываются в поясе и переводятся обратно в UTC', () => {
    configureTimeZone('Europe/Moscow');
    const iso = '2026-09-25T10:15:00.000Z';
    expect(formatTime(iso)).toBe('13:15');
    expect(toLocalInputValue(iso)).toBe('2026-09-25T13:15');
    expect(fromLocalInputValue('2026-09-25T13:15')).toBe(iso);
  });

  it('перевод времени корректен на переходе на летнее время', () => {
    configureTimeZone('Europe/Berlin');
    expect(fromLocalInputValue('2026-03-29T03:30')).toBe('2026-03-29T01:30:00.000Z');
    expect(fromLocalInputValue('2026-10-25T12:00')).toBe('2026-10-25T11:00:00.000Z');
  });

  it('неизвестный пояс и неверный ввод не ломают расчёт', () => {
    configureTimeZone('Mars/Olympus');
    expect(formatTime('2026-09-25T10:15:00.000Z')).toMatch(/^\d{2}:\d{2}$/);
    expect(fromLocalInputValue('')).toBeNull();
    expect(fromLocalInputValue('abc')).toBeNull();
  });

  it('склонение', () => {
    expect(plural(1, ['топик', 'топика', 'топиков'])).toBe('топик');
    expect(plural(3, ['топик', 'топика', 'топиков'])).toBe('топика');
    expect(plural(11, ['топик', 'топика', 'топиков'])).toBe('топиков');
  });
});
