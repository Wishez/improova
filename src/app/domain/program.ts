import type { IItem, ISection, ITimeLog, ITopic } from '../types';

/** Упорядоченная активная программа: разделы → темы → топики без архивных. */
export interface IProgramTree {
  readonly sections: readonly ISection[];
  readonly topicsBySection: ReadonlyMap<string, readonly ITopic[]>;
  readonly itemsByTopic: ReadonlyMap<string, readonly IItem[]>;
  readonly topicById: ReadonlyMap<string, ITopic>;
  readonly sectionById: ReadonlyMap<string, ISection>;
  readonly itemById: ReadonlyMap<string, IItem>;
}

const byOrder = <T extends { readonly order: number; readonly id: string }>(a: T, b: T): number =>
  a.order - b.order || a.id.localeCompare(b.id);

export function buildProgramTree(params: {
  readonly sections: readonly ISection[];
  readonly topics: readonly ITopic[];
  readonly items: readonly IItem[];
}): IProgramTree {
  const sections = params.sections.filter((section) => !section.archived).sort(byOrder);
  const sectionIds = new Set(sections.map((section) => section.id));
  const topics = params.topics.filter((topic) => !topic.archived && sectionIds.has(topic.sectionId)).sort(byOrder);
  const topicIds = new Set(topics.map((topic) => topic.id));
  const items = params.items.filter((item) => !item.archived && topicIds.has(item.topicId)).sort(byOrder);

  const topicsBySection = new Map<string, ITopic[]>();
  for (const topic of topics) {
    topicsBySection.set(topic.sectionId, [...(topicsBySection.get(topic.sectionId) ?? []), topic]);
  }
  const itemsByTopic = new Map<string, IItem[]>();
  for (const item of items) {
    itemsByTopic.set(item.topicId, [...(itemsByTopic.get(item.topicId) ?? []), item]);
  }
  return {
    sections,
    topicsBySection,
    itemsByTopic,
    topicById: new Map(topics.map((topic) => [topic.id, topic])),
    sectionById: new Map(sections.map((section) => [section.id, section])),
    itemById: new Map(items.map((item) => [item.id, item])),
  };
}

export function sectionIdOfItem(tree: IProgramTree, itemId: string | null): string | null {
  if (!itemId) {
    return null;
  }
  const item = tree.itemById.get(itemId);
  return item ? (tree.topicById.get(item.topicId)?.sectionId ?? null) : null;
}

/** Минуты по топику без повторений (повторения считаются отдельно). */
export function spentByItem(logs: readonly ITimeLog[]): ReadonlyMap<string, number> {
  const spent = new Map<string, number>();
  for (const log of logs) {
    if (log.itemId && log.type !== 'review' && !log.deletedAt) {
      spent.set(log.itemId, (spent.get(log.itemId) ?? 0) + log.durationMin);
    }
  }
  return spent;
}

export function isCountable(item: IItem): boolean {
  return item.recurrenceWeeks === null && !item.archived;
}
