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

export function findOverlap(draft: Pick<ILogDraft, 'startedAt' | 'endedAt'>, logs: readonly ITimeLog[], ignoreId: string | null): ITimeLog | null {
  return (
    logs.find(
      (log) => log.id !== ignoreId && !log.deletedAt && log.startedAt < draft.endedAt && draft.startedAt < log.endedAt,
    ) ?? null
  );
}

export function overlapText(log: ITimeLog): string {
  return `Пересекается с сессией ${formatTime(log.startedAt)}–${formatTime(log.endedAt)}. Сохранить обе?`;
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

  /** Меняет длительность, сдвигая конец сессии. */
  setDuration(id: string, minutes: number): TLogError | null {
    const log = this.store.data().timeLogs.find((entry) => entry.id === id);
    if (!log) {
      return 'invalid';
    }
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > MAX_LOG_MIN) {
      return 'duration';
    }
    return this.update(id, { endedAt: new Date(Date.parse(log.startedAt) + Math.round(minutes) * 60_000).toISOString() });
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
}
