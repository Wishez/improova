/**
 * Числа с «мин» не переносятся по частям: внутри неразрывные пробелы (вкладка «Тексты 1.6», «Числа не разрываются»).
 */
const NBSP = ' ';

/** Минуты в текстах — целые, с округлением вниз, «мин» без склонения (FR-53, «Правила текстов»). */
function minutes(value: number): string {
  return `${Math.floor(value)}${NBSP}мин`;
}

/**
 * Тексты сессии 1.6 — словарь строк по ключам вкладки «Тексты 1.6» (НФТ «Локализация»).
 * Формулировки вставляются как есть, другая — только правкой вкладки.
 */
export const SESSION_TEXTS = {
  'focus.session.limit': (limitMin: number): string => `Сессия · ${minutes(limitMin)}`,
  'focus.session.over': (limitMin: number): string => `Время сессии вышло · ${minutes(limitMin)}`,
  'focus.stop': 'Стоп',
};
