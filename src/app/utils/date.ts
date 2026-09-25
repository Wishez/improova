/** Работа с «днями приложения»: день начинается не в 00:00, а в час границы дня (ТЗ 8.3). */

const MS_PER_DAY = 86_400_000;

const pad = (value: number): string => String(value).padStart(2, '0');

interface IWallClock {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
}

/**
 * Часовой пояс отображения (ТЗ 8.3: хранение в UTC, показ в поясе пользователя).
 * Пустая строка — пояс устройства. Задаётся из настроек через configureTimeZone.
 */
let activeTimeZone = '';
let zoneFormatter: Intl.DateTimeFormat | null = null;

export function deviceTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function isValidTimeZone(zone: string): boolean {
  if (zone === '') {
    return true;
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export function configureTimeZone(zone: string): void {
  const next = isValidTimeZone(zone) ? zone : '';
  if (next === activeTimeZone) {
    return;
  }
  activeTimeZone = next;
  zoneFormatter =
    next === ''
      ? null
      : new Intl.DateTimeFormat('en-US', {
          timeZone: next,
          hourCycle: 'h23',
          year: 'numeric',
          month: 'numeric',
          day: 'numeric',
          hour: 'numeric',
          minute: 'numeric',
        });
}

function wallClock(epochMs: number): IWallClock {
  if (!zoneFormatter) {
    const date = new Date(epochMs);
    return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate(), hour: date.getHours(), minute: date.getMinutes() };
  }
  const parts = new Map(zoneFormatter.formatToParts(epochMs).map((part) => [part.type, Number(part.value)]));
  return { year: parts.get('year') ?? 1970, month: parts.get('month') ?? 1, day: parts.get('day') ?? 1, hour: parts.get('hour') ?? 0, minute: parts.get('minute') ?? 0 };
}

/** Момент UTC для времени на часах выбранного пояса. */
function fromWallClock(clock: IWallClock): number {
  if (!zoneFormatter) {
    return new Date(clock.year, clock.month - 1, clock.day, clock.hour, clock.minute).getTime();
  }
  const target = Date.UTC(clock.year, clock.month - 1, clock.day, clock.hour, clock.minute);
  let guess = target;
  // Две итерации сходятся и на переходе на летнее время
  for (let step = 0; step < 2; step += 1) {
    const seen = wallClock(guess);
    guess += target - Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute);
  }
  return guess;
}

/** Ключ дня YYYY-MM-DD для момента времени с учётом часа границы дня. */
export function toDayKey(moment: Date, boundaryHour: number): string {
  const clock = wallClock(moment.getTime() - boundaryHour * 3_600_000);
  return `${clock.year}-${pad(clock.month)}-${pad(clock.day)}`;
}

/** Полдень дня по ключу — безопасная опорная точка без проблем с переходом на летнее время. */
export function fromDayKey(key: string): Date {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1, 12, 0, 0, 0);
}

export function addDays(key: string, days: number): string {
  const date = fromDayKey(key);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function diffDays(fromKey: string, toKey: string): number {
  return Math.round((fromDayKey(toKey).getTime() - fromDayKey(fromKey).getTime()) / MS_PER_DAY);
}

/** 0 — понедельник … 6 — воскресенье. */
export function weekdayIndex(key: string): number {
  return (fromDayKey(key).getDay() + 6) % 7;
}

export function weekStart(key: string): string {
  return addDays(key, -weekdayIndex(key));
}

export function isValidDayKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const date = fromDayKey(value);
  return !Number.isNaN(date.getTime()) && addDays(value, 0) === value;
}

const WEEKDAYS_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const WEEKDAYS_ACC = ['понедельник', 'вторник', 'среду', 'четверг', 'пятницу', 'субботу', 'воскресенье'];
const MONTHS_GEN = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

export function weekdayShort(index: number): string {
  return WEEKDAYS_SHORT[index] ?? '';
}

/** «в среду» — для текстов вида «Следующий блок — в среду». */
export function weekdayAccusative(key: string): string {
  return WEEKDAYS_ACC[weekdayIndex(key)] ?? '';
}

export function formatDayShort(key: string): string {
  const date = fromDayKey(key);
  return `${date.getDate()} ${MONTHS_GEN[date.getMonth()] ?? ''}`;
}

export function formatTime(iso: string): string {
  const clock = wallClock(Date.parse(iso));
  return `${pad(clock.hour)}:${pad(clock.minute)}`;
}

/** Значение для input[type=datetime-local] в поясе отображения. */
export function toLocalInputValue(iso: string): string {
  const clock = wallClock(Date.parse(iso));
  return `${clock.year}-${pad(clock.month)}-${pad(clock.day)}T${pad(clock.hour)}:${pad(clock.minute)}`;
}

export function fromLocalInputValue(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!match) {
    return null;
  }
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  const epoch = fromWallClock({ year: year ?? 1970, month: month ?? 1, day: day ?? 1, hour: hour ?? 0, minute: minute ?? 0 });
  return Number.isNaN(epoch) ? null : new Date(epoch).toISOString();
}
