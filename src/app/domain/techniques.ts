import type { IGuideStep, IItem, ISection, ITechnique, ITopic, TTechniqueGroup } from '../types';

/** Группы справочника приёмов в порядке курса (FR-51). */
export const TECHNIQUE_GROUPS: readonly { readonly id: TTechniqueGroup; readonly label: string }[] =
  [
    { id: 'line', label: 'Линия' },
    { id: 'construction', label: 'Конструкция' },
    { id: 'gesture', label: 'Жест' },
    { id: 'perspective', label: 'Перспектива' },
    { id: 'tone', label: 'Тон' },
    { id: 'sighting', label: 'Визирование' },
    { id: 'color', label: 'Цвет' },
    { id: 'composition', label: 'Композиция' },
    { id: 'graphics', label: 'Графика' },
    { id: 'painting', label: 'Живопись' },
    { id: 'masters', label: 'Мастера' },
    { id: 'route', label: 'Техники маршрута' },
  ];

/** Шаг ориентира, который берёт технику из блока маршрута мастеров (FR-49). */
const ROUTE_TECHNIQUE_STEP = /в технике (?:квартала|маршрута)/iu;

const normalize = (text: string): string => text.trim().toLowerCase().replace(/ё/g, 'е');

/** Приёмы, названные в тексте шага или задания, в порядке справочника (FR-48). */
export function matchTechniques(
  text: string,
  catalog: readonly ITechnique[],
): readonly ITechnique[] {
  return text.trim() === ''
    ? []
    : catalog.filter((entry) => entry.match !== null && entry.match.test(text));
}

/** Карточка техники маршрута по её названию в блоке; своя техника без карточки — null. */
export function routeTechnique(name: string, catalog: readonly ITechnique[]): ITechnique | null {
  const wanted = normalize(name);
  if (wanted === '') {
    return null;
  }
  return (
    catalog.find((entry) =>
      entry.routeNames.some((routeName) => normalize(routeName) === wanted),
    ) ?? null
  );
}

export function isRouteTechniqueStep(title: string): boolean {
  return ROUTE_TECHNIQUE_STEP.test(title);
}

/** Название шага для показа: «Исполнение в технике квартала» → «Исполнение: акрил» (FR-49). Без техники — как есть. */
export function stepLabel(title: string, routeTechniqueName: string | null): string {
  const name = routeTechniqueName?.trim() ?? '';
  if (name === '' || !isRouteTechniqueStep(title)) {
    return title;
  }
  return title.replace(ROUTE_TECHNIQUE_STEP, `: ${name.toLowerCase()}`).replace(/\s+:/u, ':');
}

/** Состояние шага с техникой маршрута: не такой шаг, техника на дату есть, блока на дату нет. */
export type TRouteTechniqueState = 'none' | 'resolved' | 'missing';

export interface IResolvedStep extends IGuideStep {
  /** Название для показа: у шага техники маршрута — с подставленной техникой. */
  readonly label: string;
  readonly techniques: readonly ITechnique[];
  readonly route: TRouteTechniqueState;
}

export interface IResolvedGuide {
  readonly steps: readonly IResolvedStep[];
  /** Приёмы из задания, которых нет ни в одном шаге. */
  readonly taskTechniques: readonly ITechnique[];
}

/**
 * Шаги ориентира с карточками приёмов (FR-48, FR-49). Карточки выводятся из текста —
 * работает и для своих ориентиров. `routeTechniqueName` — техника блока маршрута на день сессии, null — блока нет.
 */
export function resolveGuide(params: {
  readonly steps: readonly IGuideStep[];
  readonly task: string;
  readonly routeTechniqueName: string | null;
  readonly catalog: readonly ITechnique[];
}): IResolvedGuide {
  const { catalog, routeTechniqueName } = params;
  const steps = params.steps.map((step): IResolvedStep => {
    const matched = matchTechniques(step.title, catalog);
    if (!isRouteTechniqueStep(step.title)) {
      return { ...step, label: step.title, techniques: matched, route: 'none' };
    }
    const name = routeTechniqueName?.trim() ?? '';
    if (name === '') {
      return { ...step, label: step.title, techniques: matched, route: 'missing' };
    }
    const card = routeTechnique(name, catalog);
    return {
      ...step,
      label: stepLabel(step.title, name),
      techniques: card ? [card, ...matched.filter((entry) => entry.key !== card.key)] : matched,
      route: 'resolved',
    };
  });
  const inSteps = new Set(steps.flatMap((step) => step.techniques.map((entry) => entry.key)));
  return {
    steps,
    taskTechniques: matchTechniques(params.task, catalog).filter(
      (entry) => !inSteps.has(entry.key),
    ),
  };
}

/** Поиск по названию приёма (FR-51, US-22), без учёта регистра и «ё». */
export function filterTechniques(
  query: string,
  catalog: readonly ITechnique[],
): readonly ITechnique[] {
  const wanted = normalize(query);
  return wanted === ''
    ? catalog
    : catalog.filter((entry) => normalize(entry.title).includes(wanted));
}

export interface ITechniqueUsage {
  readonly topic: ITopic;
  readonly items: readonly IItem[];
}

/**
 * «Где используется» (FR-51): активные топики, чьи шаги или задание называют приём.
 * Топики маршрута мастеров считаются, если приём — техника одного из блоков маршрута.
 */
export function techniqueUsage(params: {
  readonly technique: ITechnique;
  readonly items: readonly IItem[];
  readonly topics: readonly ITopic[];
  readonly sections: readonly ISection[];
  readonly routeTechniqueNames: readonly string[];
  readonly catalog: readonly ITechnique[];
}): readonly ITechniqueUsage[] {
  const { technique, catalog } = params;
  const usedByRoute = params.routeTechniqueNames.some(
    (name) => routeTechnique(name, catalog)?.key === technique.key,
  );
  const sectionOrder = new Map(
    params.sections
      .filter((section) => !section.archived)
      .map((section) => [section.id, section.order]),
  );
  const topicById = new Map(
    params.topics
      .filter((topic) => !topic.archived && sectionOrder.has(topic.sectionId))
      .map((topic) => [topic.id, topic]),
  );
  const byTopic = new Map<string, IItem[]>();
  for (const item of params.items) {
    const topic = topicById.get(item.topicId);
    if (!topic || item.archived || !item.guide) {
      continue;
    }
    const texts = [item.guide.task, ...item.guide.steps.map((step) => step.title)];
    const named = texts.some((text) =>
      matchTechniques(text, catalog).some((entry) => entry.key === technique.key),
    );
    const viaRoute =
      usedByRoute &&
      item.routeRole === 'copy' &&
      item.guide.steps.some((step) => isRouteTechniqueStep(step.title));
    if (named || viaRoute) {
      byTopic.set(topic.id, [...(byTopic.get(topic.id) ?? []), item]);
    }
  }
  return [...byTopic.entries()]
    .flatMap(([topicId, items]) => {
      const topic = topicById.get(topicId);
      return topic ? [{ topic, items }] : [];
    })
    .sort(
      (a, b) =>
        (sectionOrder.get(a.topic.sectionId) ?? 0) - (sectionOrder.get(b.topic.sectionId) ?? 0) ||
        a.topic.order - b.topic.order ||
        a.topic.title.localeCompare(b.topic.title),
    );
}
