/** Форматирование чисел и длительностей для интерфейса. */

export function formatMinutes(total: number): string {
  const minutes = Math.max(0, Math.round(total));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) {
    return `${rest} мин`;
  }
  return rest === 0 ? `${hours} ч` : `${hours} ч ${rest} м`;
}

export function formatHours(totalMinutes: number): string {
  const hours = totalMinutes / 60;
  return `${hours >= 10 ? Math.round(hours) : Math.round(hours * 10) / 10} ч`.replace('.', ',');
}

export function formatClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function formatPercent(ratio: number): string {
  return `${Math.round(Math.max(0, Math.min(1, ratio)) * 100)} %`;
}

/** Склонение: plural(5, ['топик', 'топика', 'топиков']). */
export function plural(count: number, forms: readonly [string, string, string]): string {
  const n = Math.abs(count) % 100;
  const last = n % 10;
  if (n > 10 && n < 20) {
    return forms[2];
  }
  if (last > 1 && last < 5) {
    return forms[1];
  }
  return last === 1 ? forms[0] : forms[2];
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
