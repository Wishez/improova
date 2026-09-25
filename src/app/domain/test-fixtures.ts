import type { IBudget, IItem, ISection, ITimeLog, ITopic, TItemKind } from '../types';

/** Фабрики тестовых данных для доменных модулей. */
const NOW = '2026-01-05T09:00:00.000Z';

export function budgetFixture(patch: Partial<IBudget> = {}): IBudget {
  return {
    id: 'budget',
    createdAt: NOW,
    updatedAt: NOW,
    studyMinPerWeek: 120,
    practiceMinPerWeek: 240,
    creativeShare: 0.3,
    dayCapacity: [0, 60, 120, 60, 0, 120, 0],
    blockMin: 20,
    blockMax: 90,
    reviewIntervals: [3, 10, 30],
    ...patch,
  };
}

export function sectionFixture(id: string, order: number, weight: 1 | 2 | 3 = 2): ISection {
  return { id, createdAt: NOW, updatedAt: NOW, title: `Раздел ${id}`, colorToken: 1, order, weight, archived: false };
}

export function topicFixture(id: string, sectionId: string, order = 0): ITopic {
  return { id, createdAt: NOW, updatedAt: NOW, sectionId, title: `Тема ${id}`, description: '', order, archived: false };
}

export function itemFixture(params: {
  readonly id: string;
  readonly topicId: string;
  readonly kind?: TItemKind;
  readonly estimateMin?: number;
  readonly order?: number;
  readonly doneAt?: string | null;
  readonly recurrenceWeeks?: number | null;
  readonly weakSpot?: boolean;
}): IItem {
  return {
    id: params.id,
    createdAt: NOW,
    updatedAt: NOW,
    topicId: params.topicId,
    title: `Топик ${params.id}`,
    kind: params.kind ?? 'practice',
    estimateMin: params.estimateMin ?? 60,
    resourceRefs: [],
    weakSpot: params.weakSpot ?? false,
    recurrenceWeeks: params.recurrenceWeeks ?? null,
    selfCheck: '',
    order: params.order ?? 0,
    doneAt: params.doneAt ?? null,
    archived: false,
  };
}

export function logFixture(params: {
  readonly id: string;
  readonly itemId: string | null;
  readonly type: ITimeLog['type'];
  readonly startedAt: string;
  readonly minutes: number;
}): ITimeLog {
  const endedAt = new Date(Date.parse(params.startedAt) + params.minutes * 60_000).toISOString();
  return {
    id: params.id,
    createdAt: params.startedAt,
    updatedAt: params.startedAt,
    itemId: params.itemId,
    type: params.type,
    startedAt: params.startedAt,
    endedAt,
    durationMin: params.minutes,
    source: 'timer',
    editedAt: null,
  };
}

/** Программа: 3 раздела × 2 темы × 6 топиков двух видов. */
export function programFixture(): { sections: ISection[]; topics: ITopic[]; items: IItem[] } {
  const sections = [sectionFixture('a', 0, 3), sectionFixture('b', 1, 2), sectionFixture('c', 2, 1)];
  const topics: ITopic[] = [];
  const items: IItem[] = [];
  for (const section of sections) {
    for (let t = 0; t < 2; t += 1) {
      const topicId = `${section.id}${t}`;
      topics.push(topicFixture(topicId, section.id, t));
      for (let i = 0; i < 6; i += 1) {
        items.push(itemFixture({ id: `${topicId}-${i}`, topicId, kind: i % 2 === 0 ? 'study' : 'practice', estimateMin: 120, order: i }));
      }
    }
  }
  return { sections, topics, items };
}
