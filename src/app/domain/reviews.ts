import type { IItem, ITimeLog } from '../types';
import { addDays, toDayKey } from '../utils';

export interface IReviewDue {
  readonly itemId: string;
  /** Номер повторения, с нуля. */
  readonly index: number;
  readonly dueDate: string;
}

export interface IReviewHistory {
  readonly itemId: string;
  readonly dueDate: string;
  readonly doneDate: string;
}

const MIN_REVIEW_MIN = 10;

/** Повторения выводятся из даты закрытия и логов типа review (ТЗ 5.6), отдельно не хранятся. */
export function reviewState(params: {
  readonly item: IItem;
  readonly logs: readonly ITimeLog[];
  readonly intervals: readonly number[];
  readonly boundaryHour: number;
}): { readonly pending: IReviewDue | null; readonly history: readonly IReviewHistory[] } {
  const { item, intervals, boundaryHour } = params;
  if (!item.doneAt || item.recurrenceWeeks !== null || intervals.length === 0) {
    return { pending: null, history: [] };
  }
  const doneAt = item.doneAt;
  const doneLogs = params.logs
    .filter((log) => log.itemId === item.id && log.type === 'review' && log.durationMin >= MIN_REVIEW_MIN)
    .filter((log) => log.endedAt >= doneAt)
    .sort((a, b) => a.endedAt.localeCompare(b.endedAt));
  let anchor = toDayKey(new Date(doneAt), boundaryHour);
  const history: IReviewHistory[] = [];
  for (let index = 0; index < intervals.length; index += 1) {
    const dueDate = addDays(anchor, intervals[index] ?? 0);
    const log = doneLogs[index];
    if (!log) {
      return { pending: { itemId: item.id, index, dueDate }, history };
    }
    const doneDate = toDayKey(new Date(log.endedAt), boundaryHour);
    history.push({ itemId: item.id, dueDate, doneDate });
    anchor = doneDate;
  }
  return { pending: null, history };
}
