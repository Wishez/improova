import type { IBudget, IItem, IPlanBlock, IResource, ITimeLog, TItemKind, TSessionType } from '../types';
import { addDays, diffDays, toDayKey, weekStart, weekdayIndex } from '../utils';
import { calibration, remainingMinutes, resourceTypeOf } from './estimate';
import { isCountable, sectionIdOfItem, spentByItem, type IProgramTree } from './program';
import { reviewState, type IReviewDue } from './reviews';

export const REVIEW_BLOCK_MIN = 15;
const BREAK_MIN = 10;
const MAX_REVIEWS_PER_DAY = 2;
const MAX_ITEM_BLOCKS_PER_DAY = 2;
const HISTORY_DAYS = 28;

export interface IPlannedBlock {
  /** Стабильный ключ блока в рамках расчёта. */
  readonly key: string;
  readonly date: string;
  readonly itemId: string | null;
  readonly sectionId: string | null;
  readonly type: TSessionType;
  readonly plannedMin: number;
  readonly pinned: boolean;
  /** id сохранённого блока, если он закреплён пользователем. */
  readonly storedId: string | null;
  readonly reviewIndex: number | null;
}

export interface IDayPlan {
  readonly date: string;
  readonly capacity: number;
  readonly planned: number;
  readonly logged: number;
  readonly blocks: readonly IPlannedBlock[];
}

export interface IPlanResult {
  readonly days: readonly IDayPlan[];
  /** Коэффициент урезания бюджета, если ёмкость меньше S + P (ТЗ 5.1). */
  readonly scale: number;
  readonly capacityPerWeek: number;
  readonly budgetPerWeek: number;
  readonly remainingByItem: ReadonlyMap<string, number>;
  readonly pendingReviews: readonly IReviewDue[];
}

export interface IPlannerInput {
  readonly today: string;
  readonly horizonDays: number;
  readonly budget: IBudget;
  readonly tree: IProgramTree;
  readonly resources: ReadonlyMap<string, IResource>;
  readonly logs: readonly ITimeLog[];
  readonly blocks: readonly IPlanBlock[];
  readonly boundaryHour: number;
}

interface IWeekCounters {
  study: number;
  pool: number;
  creative: number;
  review: number;
  readonly studyTotal: number;
  readonly itemsPracticeTotal: number;
  readonly creativeTotal: number;
}

interface ICandidate {
  readonly item: IItem;
  readonly sectionId: string;
  readonly rank: number;
}

const floor5 = (value: number): number => Math.floor(value / 5) * 5;

/** Детерминированный планировщик на горизонт N дней (ТЗ 5). */
export function planWeek(input: IPlannerInput): IPlanResult {
  const { budget, tree, today, boundaryHour } = input;
  const logs = input.logs.filter((log) => !log.deletedAt);
  const dayOfLog = (log: ITimeLog): string => toDayKey(new Date(log.startedAt), boundaryHour);

  const capacityPerWeek = budget.dayCapacity.reduce((sum, value) => sum + value, 0);
  const wanted = budget.studyMinPerWeek + budget.practiceMinPerWeek;
  const scale = wanted > 0 && capacityPerWeek < wanted ? capacityPerWeek / wanted : 1;
  const studyBudget = budget.studyMinPerWeek * scale;
  const practiceBudget = budget.practiceMinPerWeek * scale;
  const creativeBudget = practiceBudget * budget.creativeShare;
  const reviewCap = practiceBudget * 0.25;

  const spent = spentByItem(logs);
  const allItems = [...tree.itemById.values()];
  const factors = calibration({ items: allItems, resources: input.resources, spent });

  const remaining = new Map<string, number>();
  for (const item of allItems) {
    if (!isCountable(item) || item.doneAt) {
      continue;
    }
    const type = resourceTypeOf(item, input.resources);
    remaining.set(
      item.id,
      remainingMinutes({
        estimateMin: item.estimateMin,
        spentMin: spent.get(item.id) ?? 0,
        factor: type ? (factors.get(type) ?? 1) : 1,
        blockMin: budget.blockMin,
      }),
    );
  }
  const remainingSnapshot = new Map(remaining);

  const horizon = Array.from({ length: input.horizonDays }, (_, index) => addDays(today, index));
  const lastDay = horizon[horizon.length - 1] ?? today;

  const skipped = new Set(
    input.blocks
      .filter((block) => block.status === 'skipped' && !block.deletedAt)
      .map((block) => `${block.date}|${block.itemId ?? 'creative'}`),
  );
  const pinned = input.blocks.filter(
    (block) =>
      block.pinned &&
      block.status === 'planned' &&
      !block.deletedAt &&
      block.date >= today &&
      block.date <= lastDay &&
      (block.itemId === null || isPlannable(tree.itemById.get(block.itemId))),
  );

  const kindOfLog = (log: ITimeLog): TSessionType => log.type;
  const weeks = new Map<string, IWeekCounters>();
  const weekOf = (day: string): IWeekCounters => {
    const start = weekStart(day);
    const existing = weeks.get(start);
    if (existing) {
      return existing;
    }
    const weekLogs = logs.filter((log) => weekStart(dayOfLog(log)) === start);
    const sumType = (types: readonly TSessionType[]): number =>
      weekLogs.filter((log) => types.includes(kindOfLog(log))).reduce((sum, log) => sum + log.durationMin, 0);
    const counters: IWeekCounters = {
      study: studyBudget - sumType(['study']),
      pool: practiceBudget - sumType(['practice', 'creative', 'review']),
      creative: creativeBudget - sumType(['creative']),
      review: reviewCap - sumType(['review']),
      studyTotal: Math.max(1, studyBudget),
      itemsPracticeTotal: Math.max(1, practiceBudget - creativeBudget),
      creativeTotal: Math.max(1, creativeBudget),
    };
    weeks.set(start, counters);
    return counters;
  };
  const spend = (counters: IWeekCounters, type: TSessionType, minutes: number): void => {
    if (type === 'study') {
      counters.study -= minutes;
      return;
    }
    counters.pool -= minutes;
    if (type === 'creative') {
      counters.creative -= minutes;
    }
    if (type === 'review') {
      counters.review -= minutes;
    }
  };

  const pinnedByDay = new Map<string, IPlannedBlock[]>();
  for (const block of pinned) {
    const sectionId = sectionIdOfItem(tree, block.itemId);
    const planned: IPlannedBlock = {
      key: `pin:${block.id}`,
      date: block.date,
      itemId: block.itemId,
      sectionId,
      type: block.type,
      plannedMin: block.plannedMin,
      pinned: true,
      storedId: block.id,
      reviewIndex: null,
    };
    pinnedByDay.set(block.date, [...(pinnedByDay.get(block.date) ?? []), planned]);
    spend(weekOf(block.date), block.type, block.plannedMin);
    if (block.itemId && remaining.has(block.itemId)) {
      remaining.set(block.itemId, Math.max(0, (remaining.get(block.itemId) ?? 0) - block.plannedMin));
    }
  }

  // История по разделам за 28 дней для дефицитного выбора (ТЗ 5.4).
  const historyFrom = addDays(today, -HISTORY_DAYS);
  const allocated = { study: new Map<string, number>(), practice: new Map<string, number>() };
  const allocatedTotal = { study: 0, practice: 0 };
  for (const log of logs) {
    const day = dayOfLog(log);
    const kind = log.type === 'study' ? 'study' : log.type === 'practice' ? 'practice' : null;
    const sectionId = sectionIdOfItem(tree, log.itemId);
    if (!kind || !sectionId || day < historyFrom) {
      continue;
    }
    allocated[kind].set(sectionId, (allocated[kind].get(sectionId) ?? 0) + log.durationMin);
    allocatedTotal[kind] += log.durationMin;
  }

  const candidatesOf = (kind: TItemKind): ICandidate[] => {
    const list: ICandidate[] = [];
    let rank = 0;
    for (const section of tree.sections) {
      for (const topic of tree.topicsBySection.get(section.id) ?? []) {
        for (const item of tree.itemsByTopic.get(topic.id) ?? []) {
          rank += 1;
          if (item.kind === kind && remaining.has(item.id)) {
            list.push({ item, sectionId: section.id, rank });
          }
        }
      }
    }
    return list;
  };
  const candidates = { study: candidatesOf('study'), practice: candidatesOf('practice') };

  // Повторения (ТЗ 5.6) и повторяющиеся топики (M9).
  const pendingReviews: IReviewDue[] = [];
  for (const item of allItems) {
    const state = reviewState({ item, logs, intervals: budget.reviewIntervals, boundaryHour });
    if (state.pending && state.pending.dueDate <= lastDay) {
      pendingReviews.push(state.pending);
    }
  }
  pendingReviews.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.itemId.localeCompare(b.itemId));
  const reviewQueue = [...pendingReviews];

  const recurring = allItems.filter((item) => item.recurrenceWeeks !== null && !item.archived);
  const recurringPlacedWeek = new Set<string>();
  const lastLogDayOf = (itemId: string): string | null =>
    logs
      .filter((log) => log.itemId === itemId && log.type !== 'review')
      .map(dayOfLog)
      .sort()
      .at(-1) ?? null;

  const lastSectionOfDay = new Map<string, string | null>();
  const yesterday = addDays(today, -1);
  lastSectionOfDay.set(
    yesterday,
    sectionIdOfItem(
      tree,
      logs
        .filter((log) => dayOfLog(log) === yesterday)
        .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
        .at(-1)?.itemId ?? null,
    ),
  );

  const days: IDayPlan[] = [];
  for (const day of horizon) {
    const counters = weekOf(day);
    const capacity = budget.dayCapacity[weekdayIndex(day)] ?? 0;
    const loggedToday =
      day === today ? logs.filter((log) => dayOfLog(log) === day).reduce((sum, log) => sum + log.durationMin, 0) : 0;
    const blocks: IPlannedBlock[] = [...(pinnedByDay.get(day) ?? [])];
    let free = capacity - loggedToday - blocks.reduce((sum, block) => sum + block.plannedMin, 0);
    const itemBlocksToday = new Map<string, number>();
    let previousSection: string | null =
      blocks.at(-1)?.sectionId ?? lastSectionOfDay.get(addDays(day, -1)) ?? null;

    const place = (block: Omit<IPlannedBlock, 'key' | 'date' | 'pinned' | 'storedId'>): void => {
      const withBreak = blocks.length > 0 ? BREAK_MIN : 0;
      free -= block.plannedMin + withBreak;
      blocks.push({ ...block, key: `${day}:${blocks.length}`, date: day, pinned: false, storedId: null });
      spend(counters, block.type, block.plannedMin);
      if (block.itemId) {
        itemBlocksToday.set(block.itemId, (itemBlocksToday.get(block.itemId) ?? 0) + 1);
      }
      if (block.sectionId) {
        previousSection = block.sectionId;
      }
    };
    const room = (): number => free - (blocks.length > 0 ? BREAK_MIN : 0);

    // 1) Повторения: до 2 в день, просроченные — первыми.
    let reviewsToday = 0;
    for (let index = 0; index < reviewQueue.length && reviewsToday < MAX_REVIEWS_PER_DAY; ) {
      const review = reviewQueue[index];
      if (!review || review.dueDate > day || skipped.has(`${day}|${review.itemId}`)) {
        index += 1;
        continue;
      }
      if (room() < REVIEW_BLOCK_MIN || counters.review < REVIEW_BLOCK_MIN) {
        break;
      }
      place({
        itemId: review.itemId,
        sectionId: sectionIdOfItem(tree, review.itemId),
        type: 'review',
        plannedMin: REVIEW_BLOCK_MIN,
        reviewIndex: review.index,
      });
      reviewQueue.splice(index, 1);
      reviewsToday += 1;
    }

    // 2) Повторяющиеся топики, срок которых наступил.
    for (const item of recurring) {
      const weekKey = `${weekStart(day)}|${item.id}`;
      if (recurringPlacedWeek.has(weekKey) || skipped.has(`${day}|${item.id}`) || !tree.itemById.has(item.id)) {
        continue;
      }
      const last = lastLogDayOf(item.id);
      const due = last === null || diffDays(weekStart(last), weekStart(day)) >= 7 * (item.recurrenceWeeks ?? 1);
      const length = floor5(Math.min(item.estimateMin, budget.blockMax, room()));
      if (!due || length < budget.blockMin) {
        continue;
      }
      place({ itemId: item.id, sectionId: sectionIdOfItem(tree, item.id), type: item.kind, plannedMin: length, reviewIndex: null });
      recurringPlacedWeek.add(weekKey);
    }

    // 3) Основной цикл по видам бюджета.
    const exhausted = new Set<TSessionType>();
    for (let guard = 0; guard < 50 && room() >= budget.blockMin; guard += 1) {
      const available = {
        study: counters.study,
        practice: counters.pool - Math.max(0, counters.creative),
        creative: Math.min(counters.creative, counters.pool),
      };
      const ratios: [TSessionType, number][] = (
        [
          ['study', available.study / counters.studyTotal],
          ['practice', available.practice / counters.itemsPracticeTotal],
          ['creative', available.creative / counters.creativeTotal],
        ] as const
      )
        .filter(([type]) => !exhausted.has(type))
        .filter(([type]) => available[type as 'study' | 'practice' | 'creative'] >= budget.blockMin)
        .map(([type, ratio]) => [type, ratio]);
      ratios.sort((a, b) => b[1] - a[1]);
      const next = ratios[0];
      if (!next) {
        break;
      }
      const type = next[0];
      if (type === 'creative') {
        const length = floor5(Math.min(available.creative, budget.blockMax, room()));
        if (length < budget.blockMin || skipped.has(`${day}|creative`)) {
          exhausted.add('creative');
          continue;
        }
        place({ itemId: null, sectionId: null, type: 'creative', plannedMin: length, reviewIndex: null });
        continue;
      }
      const kind: TItemKind = type === 'study' ? 'study' : 'practice';
      const pick = pickCandidate({
        kind,
        candidates: candidates[kind],
        remaining,
        tree,
        allocated: allocated[kind],
        allocatedTotal: allocatedTotal[kind],
        previousSection,
        isBlocked: (itemId) =>
          skipped.has(`${day}|${itemId}`) || (itemBlocksToday.get(itemId) ?? 0) >= MAX_ITEM_BLOCKS_PER_DAY,
      });
      if (!pick) {
        exhausted.add(type);
        continue;
      }
      const itemRemaining = remaining.get(pick.item.id) ?? 0;
      const wanted = Math.max(itemRemaining, budget.blockMin);
      const length = floor5(Math.min(wanted, budget.blockMax, room(), available[kind]));
      if (length < budget.blockMin) {
        exhausted.add(type);
        continue;
      }
      place({ itemId: pick.item.id, sectionId: pick.sectionId, type, plannedMin: length, reviewIndex: null });
      remaining.set(pick.item.id, Math.max(0, itemRemaining - length));
      if ((remaining.get(pick.item.id) ?? 0) <= 0) {
        remaining.delete(pick.item.id);
      }
      allocated[kind].set(pick.sectionId, (allocated[kind].get(pick.sectionId) ?? 0) + length);
      allocatedTotal[kind] += length;
    }

    lastSectionOfDay.set(day, previousSection);
    days.push({
      date: day,
      capacity,
      logged: loggedToday,
      planned: blocks.reduce((sum, block) => sum + block.plannedMin, 0),
      blocks,
    });
  }

  return {
    days,
    scale,
    capacityPerWeek,
    budgetPerWeek: wanted,
    remainingByItem: remainingSnapshot,
    pendingReviews,
  };
}

function isPlannable(item: IItem | undefined): boolean {
  return item !== undefined && !item.archived && (item.recurrenceWeeks !== null || item.doneAt === null);
}

/** Взвешенный дефицитный выбор раздела с чередованием (ТЗ 5.4, M5). */
function pickCandidate(params: {
  readonly kind: TItemKind;
  readonly candidates: readonly ICandidate[];
  readonly remaining: ReadonlyMap<string, number>;
  readonly tree: IProgramTree;
  readonly allocated: ReadonlyMap<string, number>;
  readonly allocatedTotal: number;
  readonly previousSection: string | null;
  readonly isBlocked: (itemId: string) => boolean;
}): ICandidate | null {
  const fronts = new Map<string, ICandidate>();
  for (const candidate of params.candidates) {
    if (!params.remaining.has(candidate.item.id) || params.isBlocked(candidate.item.id)) {
      continue;
    }
    const current = fronts.get(candidate.sectionId);
    const better =
      !current ||
      (candidate.item.weakSpot && !current.item.weakSpot) ||
      (candidate.item.weakSpot === current.item.weakSpot && candidate.rank < current.rank);
    if (better) {
      fronts.set(candidate.sectionId, candidate);
    }
  }
  if (fronts.size === 0) {
    return null;
  }
  const weightOf = (sectionId: string): number => {
    const section = params.tree.sectionById.get(sectionId);
    const weak = fronts.get(sectionId)?.item.weakSpot ? 1 : 0;
    return (section?.weight ?? 1) * (1 + 0.5 * weak);
  };
  const totalWeight = [...fronts.keys()].reduce((sum, id) => sum + weightOf(id), 0);
  const ranked = [...fronts.values()]
    .map((candidate) => {
      const sigma = weightOf(candidate.sectionId) / totalWeight;
      const deficit = sigma * params.allocatedTotal - (params.allocated.get(candidate.sectionId) ?? 0);
      return { candidate, deficit };
    })
    .sort((a, b) => b.deficit - a.deficit || a.candidate.rank - b.candidate.rank);
  const first = ranked[0];
  if (!first) {
    return null;
  }
  if (first.candidate.sectionId === params.previousSection) {
    const alternative = ranked.find(
      (entry) => entry.candidate.sectionId !== params.previousSection && entry.deficit > 0,
    );
    if (alternative) {
      return alternative.candidate;
    }
    const anyOther = ranked.find((entry) => entry.candidate.sectionId !== params.previousSection);
    if (anyOther && params.allocatedTotal === 0) {
      return anyOther.candidate;
    }
  }
  return first.candidate;
}
