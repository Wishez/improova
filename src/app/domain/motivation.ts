import type { IBudget, IChallenge, ISection, ITimeLog } from '../types';
import { addDays, diffDays, toDayKey, weekdayIndex } from '../utils';
import { progressOfItems, sectionItems } from './progress';
import { sectionIdOfItem, spentByItem, type IProgramTree } from './program';
import type { IReviewDue } from './reviews';

export type TTipId = 'creativeLow' | 'sameSection' | 'missedDay' | 'reviewOverdue' | 'overEstimate' | 'masterCopy';

export interface ITip {
  readonly id: TTipId;
  readonly method: string;
  readonly text: string;
  readonly action: 'startCreative' | 'startShort' | 'openReviews' | 'markWeak' | 'openProgram' | null;
  readonly itemId: string | null;
}

/** Контекстные подсказки по триггерам ТЗ FR-22, по убыванию приоритета. */
export function evaluateTips(params: {
  readonly tree: IProgramTree;
  readonly logs: readonly ITimeLog[];
  readonly budget: IBudget;
  readonly challenge: IChallenge;
  readonly today: string;
  readonly boundaryHour: number;
  readonly pendingReviews: readonly IReviewDue[];
}): ITip[] {
  const { tree, logs, budget, today, boundaryHour } = params;
  const dayOf = (log: ITimeLog): string => toDayKey(new Date(log.startedAt), boundaryHour);
  const tips: ITip[] = [];

  const yesterday = addDays(today, -1);
  const plannedYesterday = (budget.dayCapacity[weekdayIndex(yesterday)] ?? 0) > 0;
  const startedBefore = params.challenge.startDate < yesterday;
  if (plannedYesterday && startedBefore && !logs.some((log) => dayOf(log) === yesterday)) {
    tips.push({
      id: 'missedDay',
      method: 'M8',
      text: 'Один пропуск ничего не ломает. Главное — не два подряд.',
      action: 'startShort',
      itemId: null,
    });
  }

  const overdue = params.pendingReviews.find((review) => review.dueDate < today);
  if (overdue) {
    tips.push({
      id: 'reviewOverdue',
      method: 'M6',
      text: 'Нарисуй по памяти, потом сверься с конспектом.',
      action: 'openReviews',
      itemId: overdue.itemId,
    });
  }

  const spent = spentByItem(logs);
  for (const item of tree.itemById.values()) {
    if (!item.doneAt && !item.weakSpot && item.recurrenceWeeks === null && item.estimateMin > 0) {
      if ((spent.get(item.id) ?? 0) >= item.estimateMin * 1.5) {
        tips.push({
          id: 'overEstimate',
          method: 'M1',
          text: `Сложно — значит растёшь. Отметить «${item.title}» как слабое место?`,
          action: 'markWeak',
          itemId: item.id,
        });
        break;
      }
    }
  }

  const recent = [...logs]
    .filter((log) => log.type === 'study' || log.type === 'practice')
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, 3);
  const sections = recent.map((log) => sectionIdOfItem(tree, log.itemId));
  if (recent.length === 3 && sections[0] && sections.every((id) => id === sections[0]) && tree.sections.length > 1) {
    tips.push({
      id: 'sameSection',
      method: 'M5',
      text: 'Смени раздел: чередование даёт больше, чем кажется.',
      action: 'openProgram',
      itemId: null,
    });
  }

  const weekAgo = addDays(today, -7);
  const creative = logs
    .filter((log) => log.type === 'creative' && dayOf(log) > weekAgo)
    .reduce((sum, log) => sum + log.durationMin, 0);
  const creativeTarget = budget.practiceMinPerWeek * budget.creativeShare;
  if (creativeTarget > 0 && creative < creativeTarget * 0.5 && diffDays(params.challenge.startDate, today) >= 7) {
    tips.push({
      id: 'creativeLow',
      method: 'M2',
      text: 'Нарисуй что-нибудь для себя — это тоже план.',
      action: 'startCreative',
      itemId: null,
    });
  }

  if (today.endsWith('-01')) {
    const master = [...tree.itemById.values()].find(
      (item) => item.recurrenceWeeks !== null && /копи/i.test(item.title),
    );
    if (master) {
      tips.push({ id: 'masterCopy', method: 'M9', text: 'Время копии мастера.', action: null, itemId: master.id });
    }
  }
  return tips;
}

export interface IMilestone {
  readonly id: string;
  readonly title: string;
}

/** Вехи FR-23. */
export function achievedMilestones(params: {
  readonly tree: IProgramTree;
  readonly logs: readonly ITimeLog[];
  readonly challenge: IChallenge;
  readonly today: string;
  readonly rhythmStreak: number;
  readonly sections: readonly ISection[];
}): IMilestone[] {
  const { tree } = params;
  const result: IMilestone[] = [];
  const spent = spentByItem(params.logs);
  const anyTopicClosed = [...tree.topicById.values()].some(
    (topic) => progressOfItems(tree.itemsByTopic.get(topic.id) ?? [], spent).status === 'done',
  );
  if (anyTopicClosed) {
    result.push({ id: 'firstTopic', title: 'Первая закрытая тема' });
  }
  for (const section of tree.sections) {
    const progress = progressOfItems(sectionItems(tree, section.id), spent);
    for (const step of [25, 50, 75, 100]) {
      if (progress.totalCount > 0 && progress.ratio * 100 >= step) {
        result.push({ id: `section:${section.id}:${step}`, title: `${section.title}: ${step} %` });
      }
    }
  }
  const hours = params.logs.reduce((sum, log) => sum + log.durationMin, 0) / 60;
  for (const step of [10, 50, 100, 250]) {
    if (hours >= step) {
      result.push({ id: `hours:${step}`, title: `${step} часов практики` });
    }
  }
  if (diffDays(params.challenge.startDate, params.today) >= 65) {
    result.push({ id: 'day66', title: 'День 66 — привычка закрепляется' });
  }
  if (params.rhythmStreak >= 4) {
    result.push({ id: 'rhythm4', title: '4 недели в ритме' });
  }
  return result;
}
