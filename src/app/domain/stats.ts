import type { IBudget, IChallenge, IItem, INote, IResource, ITimeLog, TResourceType, TSessionType } from '../types';
import { addDays, diffDays, toDayKey, weekStart } from '../utils';
import { median, resourceTypeOf } from './estimate';
import { isCountable, sectionIdOfItem, spentByItem, type IProgramTree } from './program';
import { reviewState } from './reviews';

export const RHYTHM_THRESHOLD = 0.8;

export interface IWeekStat {
  readonly weekStart: string;
  readonly plannedMin: number;
  readonly factMin: number;
  readonly ratio: number;
}

export interface IMetrics {
  readonly northStar: number;
  readonly weeksInRhythm: number;
  readonly rhythmStreak: number;
  readonly reflection: number | null;
  readonly balance: number | null;
  readonly reviewsOnTime: number | null;
  /** Падение активных дней за 28 дней к предыдущим 28, 0–1; null — мало данных. */
  readonly burnoutDrop: number | null;
}

export interface IForecast {
  readonly basedOnFact: boolean;
  readonly velocityPerWeek: number;
  readonly remainingMin: number;
  readonly needPerWeek: number;
  readonly availablePerWeek: number;
  readonly eta: string | null;
  readonly weeksLeft: number;
  readonly unrealistic: boolean;
  readonly bySection: ReadonlyMap<string, string | null>;
}

export const dayOf = (log: ITimeLog, boundaryHour: number): string => toDayKey(new Date(log.startedAt), boundaryHour);

/** Плановые минуты недели: бюджет, урезанный до ёмкости (ТЗ 5.1). */
export function weeklyPlan(budget: IBudget): number {
  const capacity = budget.dayCapacity.reduce((sum, value) => sum + value, 0);
  return Math.min(capacity, budget.studyMinPerWeek + budget.practiceMinPerWeek);
}

export function weekStats(params: {
  readonly logs: readonly ITimeLog[];
  readonly budget: IBudget;
  readonly from: string;
  readonly to: string;
  readonly boundaryHour: number;
}): IWeekStat[] {
  const plan = weeklyPlan(params.budget);
  const factByWeek = new Map<string, number>();
  for (const log of params.logs) {
    const week = weekStart(dayOf(log, params.boundaryHour));
    factByWeek.set(week, (factByWeek.get(week) ?? 0) + log.durationMin);
  }
  const result: IWeekStat[] = [];
  for (let week = weekStart(params.from); week <= params.to; week = addDays(week, 7)) {
    const factMin = factByWeek.get(week) ?? 0;
    result.push({ weekStart: week, plannedMin: plan, factMin, ratio: plan > 0 ? Math.min(1, factMin / plan) : 0 });
  }
  return result;
}

export function minutesByDay(logs: readonly ITimeLog[], boundaryHour: number): ReadonlyMap<string, number> {
  const map = new Map<string, number>();
  for (const log of logs) {
    const day = dayOf(log, boundaryHour);
    map.set(day, (map.get(day) ?? 0) + log.durationMin);
  }
  return map;
}

export function minutesByType(logs: readonly ITimeLog[]): Readonly<Record<TSessionType, number>> {
  const result: Record<TSessionType, number> = { study: 0, practice: 0, creative: 0, review: 0 };
  for (const log of logs) {
    result[log.type] += log.durationMin;
  }
  return result;
}

export function minutesBySection(tree: IProgramTree, logs: readonly ITimeLog[]): ReadonlyMap<string | null, number> {
  const map = new Map<string | null, number>();
  for (const log of logs) {
    const sectionId = log.type === 'creative' ? null : sectionIdOfItem(tree, log.itemId);
    map.set(sectionId, (map.get(sectionId) ?? 0) + log.durationMin);
  }
  return map;
}

export function computeMetrics(params: {
  readonly logs: readonly ITimeLog[];
  readonly notes: readonly INote[];
  readonly items: readonly IItem[];
  readonly budget: IBudget;
  readonly challenge: IChallenge;
  readonly today: string;
  readonly boundaryHour: number;
}): IMetrics {
  const { logs, today, boundaryHour } = params;
  const weeks = weekStats({ logs, budget: params.budget, from: params.challenge.startDate, to: today, boundaryHour });
  const currentWeek = weekStart(today);
  const completed = weeks.filter((week) => week.weekStart < currentWeek);
  const current = weeks.find((week) => week.weekStart === currentWeek);
  const inRhythm = completed.filter((week) => week.ratio >= RHYTHM_THRESHOLD).length;
  let streak = current && current.ratio >= RHYTHM_THRESHOLD ? 1 : 0;
  for (let index = completed.length - 1; index >= 0; index -= 1) {
    if ((completed[index]?.ratio ?? 0) < RHYTHM_THRESHOLD) {
      break;
    }
    streak += 1;
  }

  const longSessions = logs.filter((log) => log.durationMin >= 20);
  const notedLogs = new Set(params.notes.filter((note) => note.logId && !note.deletedAt).map((note) => note.logId));
  const byType = minutesByType(logs);
  const learning = byType.study + byType.practice;
  const balanceTotal = learning + byType.creative;

  let reviewsDue = 0;
  let reviewsOnTime = 0;
  for (const item of params.items) {
    const state = reviewState({ item, logs, intervals: params.budget.reviewIntervals, boundaryHour });
    for (const entry of state.history) {
      reviewsDue += 1;
      if (diffDays(entry.dueDate, entry.doneDate) <= 2) {
        reviewsOnTime += 1;
      }
    }
    if (state.pending && diffDays(state.pending.dueDate, today) > 2) {
      reviewsDue += 1;
    }
  }

  const byDay = minutesByDay(logs, boundaryHour);
  const activeBetween = (from: string, to: string): number =>
    [...byDay.keys()].filter((day) => day > from && day <= to).length;
  const recent = activeBetween(addDays(today, -28), today);
  const previous = activeBetween(addDays(today, -56), addDays(today, -28));
  const startedLongAgo = diffDays(params.challenge.startDate, today) >= 56;

  return {
    northStar: current?.ratio ?? 0,
    weeksInRhythm: completed.length > 0 ? inRhythm / completed.length : 0,
    rhythmStreak: streak,
    reflection: longSessions.length > 0 ? longSessions.filter((log) => notedLogs.has(log.id)).length / longSessions.length : null,
    balance: balanceTotal > 0 ? learning / balanceTotal : null,
    reviewsOnTime: reviewsDue > 0 ? reviewsOnTime / reviewsDue : null,
    burnoutDrop: startedLongAgo && previous > 0 ? Math.max(0, (previous - recent) / previous) : null,
  };
}

/** Прогноз завершения (ТЗ 5.7). */
export function forecast(params: {
  readonly tree: IProgramTree;
  readonly logs: readonly ITimeLog[];
  readonly remainingByItem: ReadonlyMap<string, number>;
  readonly budget: IBudget;
  readonly challenge: IChallenge;
  readonly today: string;
  readonly boundaryHour: number;
  readonly scale: number;
  /** Минуты повторений в ближайшую неделю, уже ограниченные 25 % практики. */
  readonly reviewMinPerWeek: number;
}): IForecast {
  const { tree, today, budget } = params;
  const itemLogs = params.logs.filter((log) => log.itemId && (log.type === 'study' || log.type === 'practice'));
  const firstLog = [...params.logs].sort((a, b) => a.startedAt.localeCompare(b.startedAt))[0];
  const currentWeek = weekStart(today);
  const weeklyItems: number[] = [];
  for (let offset = 1; offset <= 4; offset += 1) {
    const week = addDays(currentWeek, -7 * offset);
    weeklyItems.push(
      itemLogs
        .filter((log) => weekStart(dayOf(log, params.boundaryHour)) === week)
        .reduce((sum, log) => sum + log.durationMin, 0),
    );
  }
  const practice = budget.practiceMinPerWeek * params.scale;
  const availablePerWeek =
    budget.studyMinPerWeek * params.scale + practice * (1 - budget.creativeShare) - params.reviewMinPerWeek;
  const basedOnFact = firstLog !== undefined && diffDays(dayOf(firstLog, params.boundaryHour), today) >= 28;
  const velocity = basedOnFact ? median(weeklyItems) : availablePerWeek;

  let remainingMin = 0;
  const remainingBySection = new Map<string, number>();
  for (const [itemId, minutes] of params.remainingByItem) {
    remainingMin += minutes;
    const sectionId = sectionIdOfItem(tree, itemId);
    if (sectionId) {
      remainingBySection.set(sectionId, (remainingBySection.get(sectionId) ?? 0) + minutes);
    }
  }
  const weeksLeft = Math.max(1, Math.ceil(diffDays(today, params.challenge.endDate) / 7));
  const needPerWeek = remainingMin / weeksLeft;
  const etaFor = (minutes: number, share: number): string | null =>
    velocity > 0 && share > 0 ? addDays(today, Math.ceil((7 * minutes) / (velocity * share))) : null;

  const totalWeight = [...remainingBySection.keys()].reduce(
    (sum, id) => sum + (tree.sectionById.get(id)?.weight ?? 1),
    0,
  );
  const bySection = new Map<string, string | null>();
  for (const [sectionId, minutes] of remainingBySection) {
    const share = (tree.sectionById.get(sectionId)?.weight ?? 1) / Math.max(1, totalWeight);
    bySection.set(sectionId, etaFor(minutes, share));
  }
  return {
    basedOnFact,
    velocityPerWeek: velocity,
    remainingMin,
    needPerWeek,
    availablePerWeek,
    eta: remainingMin > 0 ? etaFor(remainingMin, 1) : today,
    weeksLeft,
    unrealistic: needPerWeek > availablePerWeek + 1,
    bySection,
  };
}

export interface IEstimateAccuracy {
  readonly type: TResourceType | 'none';
  readonly ratio: number;
  readonly count: number;
}

export function estimateAccuracy(params: {
  readonly items: readonly IItem[];
  readonly logs: readonly ITimeLog[];
  readonly resources: ReadonlyMap<string, IResource>;
}): IEstimateAccuracy[] {
  const spent = spentByItem(params.logs);
  const groups = new Map<TResourceType | 'none', number[]>();
  for (const item of params.items) {
    const spentMin = spent.get(item.id) ?? 0;
    if (!item.doneAt || !isCountable(item) || spentMin <= 0 || item.estimateMin <= 0) {
      continue;
    }
    const type = resourceTypeOf(item, params.resources) ?? 'none';
    groups.set(type, [...(groups.get(type) ?? []), spentMin / item.estimateMin]);
  }
  return [...groups.entries()].map(([type, ratios]) => ({ type, ratio: median(ratios), count: ratios.length }));
}

/** Сетка тепловой карты: 53 недели × 7 дней, последний столбец — текущая неделя. */
export function heatmapGrid(params: {
  readonly byDay: ReadonlyMap<string, number>;
  readonly today: string;
}): { readonly date: string; readonly minutes: number; readonly future: boolean }[][] {
  const lastWeek = weekStart(params.today);
  const firstWeek = addDays(lastWeek, -52 * 7);
  const columns: { date: string; minutes: number; future: boolean }[][] = [];
  for (let week = firstWeek; week <= lastWeek; week = addDays(week, 7)) {
    columns.push(
      Array.from({ length: 7 }, (_, index) => {
        const date = addDays(week, index);
        return { date, minutes: params.byDay.get(date) ?? 0, future: date > params.today };
      }),
    );
  }
  return columns;
}

