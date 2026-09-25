import { Injectable, inject } from '@angular/core';
import type { ITimeLog, TSessionType } from '../types';
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

@Injectable({ providedIn: 'root' })
export class LogsService {
  private readonly store = inject(DataStore);
  private readonly toasts = inject(ToastService);

  create(draft: ILogDraft & { readonly source: ITimeLog['source'] }): ITimeLog {
    const now = new Date().toISOString();
    const log: ITimeLog = {
      id: createId(),
      createdAt: now,
      updatedAt: now,
      itemId: draft.itemId,
      type: draft.type,
      startedAt: draft.startedAt,
      endedAt: draft.endedAt,
      durationMin: Math.round((Date.parse(draft.endedAt) - Date.parse(draft.startedAt)) / 60_000),
      source: draft.source,
      editedAt: null,
    };
    this.store.upsert('timeLogs', log);
    return log;
  }

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
    this.store.upsert('timeLogs', {
      ...next,
      durationMin: Math.round((Date.parse(next.endedAt) - Date.parse(next.startedAt)) / 60_000),
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

  remove(id: string): void {
    const log = this.store.data().timeLogs.find((entry) => entry.id === id);
    if (!log) {
      return;
    }
    this.store.remove('timeLogs', [id]);
    this.toasts.undo({ text: 'Сессия удалена', onUndo: () => this.store.upsert('timeLogs', log) });
  }
}
