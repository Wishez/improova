import type { IItem, IResource, ISection, ITopic } from '../types';
import { createId } from '../utils';
import { SEED_RESOURCES, SEED_SECTIONS } from './program.seed';

export interface ISeedResult {
  readonly sections: ISection[];
  readonly topics: ITopic[];
  readonly items: IItem[];
  readonly resources: IResource[];
}

/** Создаёт стартовую программу с новыми id (ТЗ 9, FR-01). */
export function buildSeed(nowIso: string): ISeedResult {
  const base = { createdAt: nowIso, updatedAt: nowIso };
  const resourceIds = new Map<string, string>();
  const resources: IResource[] = SEED_RESOURCES.map((seed) => {
    const id = createId();
    resourceIds.set(seed.key, id);
    return {
      ...base,
      id,
      title: seed.title,
      type: seed.type,
      author: seed.author,
      url: seed.url,
      unit: seed.unit,
      unitCount: seed.unitCount,
      minPerUnit: seed.minPerUnit,
      archived: false,
    };
  });
  const resourceById = new Map(resources.map((resource) => [resource.id, resource]));

  const sections: ISection[] = [];
  const topics: ITopic[] = [];
  const items: IItem[] = [];
  SEED_SECTIONS.forEach((seedSection, sectionIndex) => {
    const sectionId = createId();
    sections.push({
      ...base,
      id: sectionId,
      title: seedSection.title,
      colorToken: (sectionIndex % 6) + 1,
      order: sectionIndex,
      weight: seedSection.weight,
      archived: false,
    });
    seedSection.topics.forEach((seedTopic, topicIndex) => {
      const topicId = createId();
      topics.push({
        ...base,
        id: topicId,
        sectionId,
        title: seedTopic.title,
        description: seedTopic.description,
        order: topicIndex,
        archived: false,
      });
      seedTopic.items.forEach((seedItem, itemIndex) => {
        const resourceId = seedItem.resource ? resourceIds.get(seedItem.resource) : undefined;
        const resource = resourceId ? resourceById.get(resourceId) : undefined;
        items.push({
          ...base,
          id: createId(),
          topicId,
          title: seedItem.title,
          kind: seedItem.kind,
          estimateMin: seedItem.estimateMin,
          resourceRefs:
            resourceId && resource
              ? [
                  {
                    resourceId,
                    range: seedItem.range ?? '',
                    units: resource.minPerUnit > 0 ? Math.round(seedItem.estimateMin / resource.minPerUnit) : 0,
                  },
                ]
              : [],
          weakSpot: false,
          recurrenceWeeks: seedItem.recurrenceWeeks ?? null,
          selfCheck: seedItem.selfCheck ?? '',
          order: itemIndex,
          doneAt: null,
          archived: false,
        });
      });
    });
  });
  return { sections, topics, items, resources };
}
