import type { ICourse, ICourseItem, ICourseRelease, ICourseResource, ICourseRouteBlock, ICourseSection, ICourseTopic } from '../types';
import { SEED_RESOURCES, SEED_ROUTE, SEED_SECTIONS } from './program.seed';

/** Версия курса в этом релизе (FR-45). Растёт при любом изменении содержания курса. */
export const COURSE_VERSION = 2;

/** Журнал «Что нового»; removedKeys — ключи, убранные в версии. */
export const COURSE_RELEASES: readonly ICourseRelease[] = [
  {
    version: 1,
    date: '2026-09-25',
    notes: ['Ориентиры во всех топиках: цель, шаги, стоп-критерий, ссылки', 'Маршрут по мастерам на 52 недели', 'Веса разделов по кварталам'],
    removedKeys: [],
  },
  {
    version: 2,
    date: '2026-09-25',
    notes: [
      'Тема «Контрольные работы»: 5 работ — день 66 и конец каждого квартала, в плане закреплённым блоком',
      'У ресурсов указан доступ и легальная бесплатная замена для платных книг',
    ],
    removedKeys: [],
  },
];

/** Ключи курса: префикс типа + путь названий, если автор курса не задал ключ явно. */
export const courseKey = {
  section: (title: string): string => `section:${title}`,
  topic: (section: string, topic: string): string => `topic:${section}/${topic}`,
  item: (section: string, topic: string, item: string): string => `item:${section}/${topic}/${item}`,
  resource: (key: string): string => `resource:${key}`,
  route: (index: number): string => `route:${index + 1}`,
} as const;

function buildCourse(): ICourse {
  const sections: ICourseSection[] = [];
  const topics: ICourseTopic[] = [];
  const items: ICourseItem[] = [];
  SEED_SECTIONS.forEach((section, sectionIndex) => {
    const sectionKey = section.key ?? courseKey.section(section.title);
    sections.push({ key: sectionKey, title: section.title, order: sectionIndex, weight: section.weight, quarterWeights: section.quarterWeights });
    section.topics.forEach((topic, topicIndex) => {
      const topicKey = topic.key ?? courseKey.topic(section.title, topic.title);
      topics.push({ key: topicKey, sectionKey, title: topic.title, description: topic.description, order: topicIndex });
      topic.items.forEach((item, itemIndex) => {
        items.push({
          key: item.key ?? courseKey.item(section.title, topic.title, item.title),
          topicKey,
          order: itemIndex,
          title: item.title,
          kind: item.kind,
          estimateMin: item.estimateMin,
          resourceKey: item.resource ? courseKey.resource(item.resource) : null,
          range: item.range ?? '',
          recurrenceWeeks: item.recurrenceWeeks ?? null,
          selfCheck: item.selfCheck ?? '',
          guide: item.guide,
          routeRole: item.routeRole ?? null,
          checkpointDay: item.checkpointDay ?? null,
        });
      });
    });
  });
  const resources: ICourseResource[] = SEED_RESOURCES.map((resource) => ({
    key: courseKey.resource(resource.key),
    title: resource.title,
    type: resource.type,
    author: resource.author,
    url: resource.url,
    unit: resource.unit,
    unitCount: resource.unitCount,
    minPerUnit: resource.minPerUnit,
    access: resource.access,
    freeAlternativeUrl: resource.freeAlternativeUrl ?? '',
  }));
  const routeBlocks: ICourseRouteBlock[] = SEED_ROUTE.map((block, index) => ({
    key: block.key ?? courseKey.route(index),
    order: index,
    fromWeek: block.fromWeek,
    toWeek: block.toWeek,
    artists: block.artists,
    copyTask: block.copyTask,
    copyTechnique: block.copyTechnique,
    links: [],
  }));
  return { version: COURSE_VERSION, sections, topics, items, resources, routeBlocks, releases: COURSE_RELEASES };
}

/** Курс текущего релиза. */
export const COURSE: ICourse = buildCourse();
