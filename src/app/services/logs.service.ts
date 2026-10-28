import { Injectable, inject } from '@angular/core';
import { editLogSteps } from '../domain';
import type { ILogSteps, ITimeLog, TSessionType } from '../types';
import { createId, formatTime } from '../utils';
import { DataStore } from './data.store';
import { ToastService } from './toast.service';

export const MAX_LOG_MIN = 720;

export type TLogError = 'endBeforeStart' | 'duration' | 'future' | 'invalid';

export const LOG_ERROR_TEXT: Readonly<Record<TLogError, string>> = {
  endBeforeStart: 'Конец раньше начала — проверь время.',
  duration: 'Длительность — от 1 до 720 минут.',
  future: 'Нельзя записать сессию в будущем.',
  invalid: 'Проверь дату и время.',
};

export interface ILogDraft {
  readonly itemId: string | null;
  readonly type: TSessionType;
  readonly startedAt: string;
  readonly endedAt: string;
}

/**
 * Новый лог (FR-14, FR-56). Сведения о шагах обязательны в контракте записи (ADR-007): `null` — ручной лог
 * или сессия без шагов ориентира; у сессии с шагами — `logStepsAtStop` домена, сумма минут шагов равна минутам лога.
 */
export interface ILogCreate extends ILogDraft {
  readonly source: ITimeLog['source'];
  readonly steps: ILogSteps | null;
}

/** Новая длина лога до записи (FR-13, FR-14): ошибка или сессия, с которой лог пересечётся; оба null — можно писать. */
export interface IDurationCheck {
  readonly error: TLogError | null;
  readonly overlap: ITimeLog | null;
}

/** Проверка лога (FR-14). Возвращает ошибку или null. */
export function validateLog(draft: Pick<ILogDraft, 'startedAt' | 'endedAt'>, nowMs: number): TLogError | null {
  const start = Date.parse(draft.startedAt);
  const end = Date.parse(draft.endedAt);
  if (Number.isNaN(start) || Number.isNaN(end)) {
    return 'invalid';
  }
  if (end <= start) {
    return 'endBeforeStart';
  }
  if (end > nowMs + 60_000) {
    return 'future';
  }
  const minutes = Math.round((end - start) / 60_000);
  return minutes < 1 || minutes > MAX_LOG_MIN ? 'duration' : null;
}

/** Минуты лога, введённые вручную (FR-13, FR-14): от 1 до 720. Возвращает ошибку или null. */
export function validateMinutes(minutes: number): TLogError | null {
  return Number.isFinite(minutes) && minutes >= 1 && minutes <= MAX_LOG_MIN ? null : 'duration';
}

/**
 * Сколько сессии могут заходить друг на друга без предупреждения (Q-051): половина минуты. «Стоп» записывает минуты
 * лога округлением (`Math.round`, ADR-007, правило 7) и начало — как конец минус эти минуты, поэтому записанное начало
 * бывает раньше настоящего не больше чем на 30 с. У сессии, начатой сразу после другой («Переключиться»), такое начало
 * заходит на прошлую; так же записаны и логи 1.5. Пересечение длиннее — настоящее (FR-14, Q-050).
 */
const ROUNDING_OVERLAP_MS = 30_000;

/** Сессия, с которой пересекается черновик лога (FR-14); пересечение не длиннее округления минут не считается (Q-051). */
export function findOverlap(draft: Pick<ILogDraft, 'startedAt' | 'endedAt'>, logs: readonly ITimeLog[], ignoreId: string | null): ITimeLog | null {
  const start = Date.parse(draft.startedAt);
  const end = Date.parse(draft.endedAt);
  return (
    logs.find(
      (log) =>
        log.id !== ignoreId &&
        !log.deletedAt &&
        Math.min(end, Date.parse(log.endedAt)) - Math.max(start, Date.parse(log.startedAt)) > ROUNDING_OVERLAP_MS,
    ) ?? null
  );
}

export function overlapText(log: ITimeLog): string {
  return `Пересекается с сессией ${formatTime(log.startedAt)}–${formatTime(log.endedAt)}. Сохранить обе?`;
}

/**
 * Начало и конец лога новой длины (FR-13, FR-14, FR-64). Как в 1.5, длина двигает конец сессии, но конец не уходит
 * дальше текущего момента (или прежнего конца, если он позже): не поместившееся сдвигает начало раньше. Поэтому
 * увеличение минут сразу после «Стоп» не записывает сессию в будущее, а уменьшение по-прежнему двигает конец.
 * Минуты шагов зависят только от длины (Д-7, ADR-007, правило 8). Лог, который уже в будущем (часы устройства
 * переводили), там и остаётся — его, как в 1.5, отклоняет `validateLog`. Негодное начало возвращается как есть.
 */
export function spanForMinutes(params: {
  readonly startedAt: string;
  readonly endedAt: string;
  readonly minutes: number;
  readonly nowMs: number;
}): Pick<ILogDraft, 'startedAt' | 'endedAt'> {
  const lengthMs = Math.round(params.minutes) * 60_000;
  const end = Date.parse(params.startedAt) + lengthMs;
  if (!Number.isFinite(end)) {
    return { startedAt: params.startedAt, endedAt: params.endedAt };
  }
  const currentEnd = Date.parse(params.endedAt);
  const latest = Number.isNaN(currentEnd) ? params.nowMs : Math.max(currentEnd, params.nowMs);
  if (end <= latest) {
    return { startedAt: params.startedAt, endedAt: new Date(end).toISOString() };
  }
  return { startedAt: new Date(latest - lengthMs).toISOString(), endedAt: new Date(latest).toISOString() };
}

/** Минуты лога по началу и концу — как в 1.5: округление до целой минуты. */
function durationOf(draft: Pick<ILogDraft, 'startedAt' | 'endedAt'>): number {
  return Math.round((Date.parse(draft.endedAt) - Date.parse(draft.startedAt)) / 60_000);
}

/**
 * Запись лога без сохранения: её пишет `LogsService.create`, а «Стоп» таймера — вместе с очисткой таймера
 * одной транзакцией `DataStore.commit` (ADR-007, «Совместная запись лога и шагов»).
 */
export function buildLog(draft: ILogCreate, now: string): ITimeLog {
  return {
    id: createId(),
    createdAt: now,
    updatedAt: now,
    itemId: draft.itemId,
    type: draft.type,
    startedAt: draft.startedAt,
    endedAt: draft.endedAt,
    durationMin: durationOf(draft),
    source: draft.source,
    editedAt: null,
    steps: draft.steps,
  };
}

@Injectable({ providedIn: 'root' })
export class LogsService {
  private readonly store = inject(DataStore);
  private readonly toasts = inject(ToastService);

  create(draft: ILogCreate): ITimeLog {
    const log = buildLog(draft, new Date().toISOString());
    this.store.upsert('timeLogs', log);
    return log;
  }

  /**
   * Правка лога (FR-14, FR-64): минуты шагов следуют за новой длиной по Д-7 (`editLogSteps` домена), шаг, первым
   * набравший 1 мин, и остальные сведения о шагах не меняются (Д-28, Q-025). Лог и его шаги — одна запись.
   * Правка отмечает лог изменённым (`editedAt`, НФТ «Аудит»).
   */
  update(id: string, patch: Partial<ILogDraft>): TLogError | null {
    const log = this.store.data().timeLogs.find((entry) => entry.id === id);
    if (!log) {
      return 'invalid';
    }
    const next = { ...log, ...patch };
    const error = validateLog(next, Date.now());
    if (error) {
      return error;
    }
    const now = new Date().toISOString();
    const durationMin = durationOf(next);
    this.store.upsert('timeLogs', {
      ...next,
      durationMin,
      steps: log.steps ? editLogSteps(log.steps, durationMin) : null,
      updatedAt: now,
      editedAt: now,
    });
    return null;
  }

  /**
   * Меняет длительность в карточке итога (FR-13): конец сессии — по `spanForMinutes`, поэтому увеличение сразу после
   * «Стоп» сдвигает начало раньше, а не уводит конец в будущее. Минуты шагов — по Д-7 в `update`.
   */
  setDuration(id: string, minutes: number): TLogError | null {
    const log = this.store.data().timeLogs.find((entry) => entry.id === id);
    if (!log) {
      return 'invalid';
    }
    const error = validateMinutes(minutes);
    if (error) {
      return error;
    }
    return this.update(id, this.spanForDuration(log, minutes));
  }

  /**
   * Проверка новой длины из карточки итога до записи — в том же порядке, что «Сохранить» в списке логов (FR-14):
   * минуты, время, затем пересечение с другой сессией (Q-050). Начало и конец — те же, что запишет `setDuration`.
   */
  checkDuration(id: string, minutes: number): IDurationCheck {
    const log = this.store.data().timeLogs.find((entry) => entry.id === id);
    if (!log) {
      return { error: 'invalid', overlap: null };
    }
    const invalid = validateMinutes(minutes);
    if (invalid) {
      return { error: invalid, overlap: null };
    }
    const span = this.spanForDuration(log, minutes);
    const error = validateLog(span, Date.now());
    return error ? { error, overlap: null } : { error: null, overlap: findOverlap(span, this.store.logs(), id) };
  }

  /**
   * Удаление сразу, мягкого удаления и отложенной очистки нет (Q-022): лог уходит из хранилища вместе со сведениями
   * о шагах. «Отменить» в течение 10 с возвращает копию записи целиком, включая шаг, первым набравший 1 мин.
   */
  remove(id: string): void {
    const log = this.store.data().timeLogs.find((entry) => entry.id === id);
    if (!log) {
      return;
    }
    this.store.remove('timeLogs', [id]);
    this.toasts.undo({ text: 'Сессия удалена', onUndo: () => this.store.upsert('timeLogs', log) });
  }

  /** Начало и конец лога новой длины из карточки итога: одно правило для проверки и записи (`spanForMinutes`). */
  private spanForDuration(log: ITimeLog, minutes: number): Pick<ILogDraft, 'startedAt' | 'endedAt'> {
    return spanForMinutes({ startedAt: log.startedAt, endedAt: log.endedAt, minutes, nowMs: Date.now() });
  }
}
