import type {
  ICollections,
  ICourse,
  ICourseItem,
  IGuide,
  IItem,
  IResource,
  IResourceRef,
  IRouteBlock,
  ISection,
  ITopic,
  TSectionWeight,
} from '../types';
import { quarterOfWeek } from './course';

/** Данные, которые читает и меняет обновление курса (FR-46). */
export type TCourseData = Pick<ICollections, 'sections' | 'topics' | 'items' | 'resources' | 'routeBlocks' | 'timeLogs'>;

export interface ICourseSyncInput {
  readonly data: TCourseData;
  readonly course: ICourse;
  readonly dismissedKeys: readonly string[];
  /** Топик, по которому идёт таймер, — начатый. */
  readonly activeItemId: string | null;
  /** Неделя челленджа, с 1: блоки маршрута и квартальные веса обновляются с неё включительно. */
  readonly currentWeek: number;
  readonly nowIso: string;
  readonly createId: () => string;
}

export interface ICourseSyncSummary {
  /** Названия «Тема / Топик» для топиков, названия — для остальных сущностей. */
  readonly added: readonly string[];
  readonly updated: readonly string[];
  /** Обновляемые топики, в которых пользователь что-то менял сам: правки заменятся. */
  readonly overwritten: readonly string[];
  readonly archived: readonly string[];
  /** Начатые стартовые топики: курс их не меняет. */
  readonly keptStarted: readonly string[];
  readonly customItems: number;
  readonly resources: { readonly added: number; readonly updated: number; readonly archived: number };
  readonly routeBlocks: { readonly added: number; readonly updated: number; readonly removed: number };
  readonly sections: { readonly added: number; readonly updated: number; readonly archived: number };
}

export interface ICourseSyncPlan {
  readonly version: number;
  readonly puts: {
    readonly sections: readonly ISection[];
    readonly topics: readonly ITopic[];
    readonly items: readonly IItem[];
    readonly resources: readonly IResource[];
    readonly routeBlocks: readonly IRouteBlock[];
  };
  readonly removes: { readonly routeBlocks: readonly string[] };
  readonly summary: ICourseSyncSummary;
  /** Есть ли что записывать: false — курс актуален. */
  readonly changed: boolean;
}

// ——— Отпечаток полей курса ———

/** JSON с отсортированными ключами: порядок полей не влияет на отпечаток. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** FNV-1a, 32 бита: короткий отпечаток для сравнения, не для защиты. */
function hashOf(value: unknown): string {
  const text = stableStringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

type TItemCourseFields = Pick<
  IItem,
  'title' | 'kind' | 'estimateMin' | 'resourceRefs' | 'recurrenceWeeks' | 'selfCheck' | 'guide' | 'routeRole' | 'checkpointDay'
>;

/** Поля топика, которыми владеет курс. Фото ориентира — данные пользователя, в отпечаток не входят. */
function courseFieldsOf(item: TItemCourseFields): TItemCourseFields {
  return {
    title: item.title,
    kind: item.kind,
    estimateMin: item.estimateMin,
    resourceRefs: item.resourceRefs,
    recurrenceWeeks: item.recurrenceWeeks,
    selfCheck: item.selfCheck,
    guide: item.guide ? { ...item.guide, imageIds: [] } : null,
    routeRole: item.routeRole,
    checkpointDay: item.checkpointDay,
  };
}

export function itemCourseHash(item: TItemCourseFields): string {
  return hashOf(courseFieldsOf(item));
}

/** Пользователь менял поля курса после последней синхронизации. */
export function isItemEdited(item: IItem): boolean {
  return item.courseHash !== null && itemCourseHash(item) !== item.courseHash;
}

/** Начатый топик: есть лог, отметка «пройден» или идёт таймер (FR-46). */
export function startedItemIds(params: {
  readonly items: readonly IItem[];
  readonly timeLogs: TCourseData['timeLogs'];
  readonly activeItemId: string | null;
}): Set<string> {
  const started = new Set<string>();
  for (const log of params.timeLogs) {
    if (log.itemId && !log.deletedAt) {
      started.add(log.itemId);
    }
  }
  for (const item of params.items) {
    if (item.doneAt) {
      started.add(item.id);
    }
  }
  if (params.activeItemId) {
    started.add(params.activeItemId);
  }
  return started;
}

/** Квартальные веса: прошедшие кварталы остаются, с текущего — из курса. */
function mergeQuarterWeights(params: {
  readonly current: readonly TSectionWeight[] | null;
  readonly course: readonly TSectionWeight[];
  readonly quarter: number;
}): TSectionWeight[] {
  const base = params.current ?? params.course;
  return params.course.map((weight, index) => (index < params.quarter - 1 ? (base[index] ?? weight) : weight));
}

const sameJson = (a: unknown, b: unknown): boolean => stableStringify(a) === stableStringify(b);

/**
 * План обновления курса (FR-46): чистая функция, данные не меняет.
 * Стартовые и не начатые — как в курсе; начатые, свои, архивные и удалённые пользователем — без изменений.
 */
export function planCourseUpdate(input: ICourseSyncInput): ICourseSyncPlan {
  const { data, course, nowIso, createId } = input;
  const dismissed = new Set(input.dismissedKeys);
  const quarter = quarterOfWeek(input.currentWeek);
  const live = <T extends { readonly deletedAt?: string }>(list: readonly T[]): T[] => list.filter((entry) => !entry.deletedAt);
  const stamp = { updatedAt: nowIso };
  const created = { createdAt: nowIso, updatedAt: nowIso };

  const added: string[] = [];
  const updated: string[] = [];
  const overwritten: string[] = [];
  const archived: string[] = [];
  const keptStarted: string[] = [];
  const counters = {
    resources: { added: 0, updated: 0, archived: 0 },
    routeBlocks: { added: 0, updated: 0, removed: 0 },
    sections: { added: 0, updated: 0, archived: 0 },
  };

  // Итоговое состояние сущностей после плана: id → сущность
  const sections = new Map(live(data.sections).map((entry) => [entry.id, entry]));
  const topics = new Map(live(data.topics).map((entry) => [entry.id, entry]));
  const items = new Map(live(data.items).map((entry) => [entry.id, entry]));
  const resources = new Map(live(data.resources).map((entry) => [entry.id, entry]));
  const touched = { sections: new Set<string>(), topics: new Set<string>(), items: new Set<string>(), resources: new Set<string>() };
  const putSection = (entry: ISection): void => {
    sections.set(entry.id, entry);
    touched.sections.add(entry.id);
  };
  const putTopic = (entry: ITopic): void => {
    topics.set(entry.id, entry);
    touched.topics.add(entry.id);
  };
  const putItem = (entry: IItem): void => {
    items.set(entry.id, entry);
    touched.items.add(entry.id);
  };
  const putResource = (entry: IResource): void => {
    resources.set(entry.id, entry);
    touched.resources.add(entry.id);
  };

  const byKey = <T extends { readonly courseKey: string | null }>(list: Iterable<T>): Map<string, T> => {
    const map = new Map<string, T>();
    for (const entry of list) {
      if (entry.courseKey !== null && !map.has(entry.courseKey)) {
        map.set(entry.courseKey, entry);
      }
    }
    return map;
  };
  const started = startedItemIds({ items: [...items.values()], timeLogs: data.timeLogs, activeItemId: input.activeItemId });

  // ——— Ресурсы ———
  const courseResourceKeys = new Set(course.resources.map((entry) => entry.key));
  const resourceByKey = byKey(resources.values());
  for (const source of course.resources) {
    const existing = resourceByKey.get(source.key);
    const fields = {
      title: source.title,
      type: source.type,
      author: source.author,
      url: source.url,
      unit: source.unit,
      unitCount: source.unitCount,
      minPerUnit: source.minPerUnit,
      access: source.access,
      freeAlternativeUrl: source.freeAlternativeUrl,
    };
    if (existing) {
      if (existing.archived) {
        continue;
      }
      const current = {
        title: existing.title,
        type: existing.type,
        author: existing.author,
        url: existing.url,
        unit: existing.unit,
        unitCount: existing.unitCount,
        minPerUnit: existing.minPerUnit,
        access: existing.access,
        freeAlternativeUrl: existing.freeAlternativeUrl,
      };
      if (!sameJson(current, fields)) {
        putResource({ ...existing, ...fields, ...stamp });
        counters.resources.updated += 1;
      }
    } else if (!dismissed.has(source.key)) {
      const resource: IResource = { ...created, id: createId(), ...fields, archived: false, courseKey: source.key };
      putResource(resource);
      resourceByKey.set(source.key, resource);
      counters.resources.added += 1;
    }
  }

  // ——— Разделы ———
  const sectionByKey = byKey(sections.values());
  let sectionOrder = Math.max(-1, ...[...sections.values()].map((entry) => entry.order));
  for (const source of course.sections) {
    const existing = sectionByKey.get(source.key);
    if (existing) {
      if (existing.archived) {
        continue;
      }
      const next = {
        title: source.title,
        weight: source.weight,
        quarterWeights: mergeQuarterWeights({ current: existing.quarterWeights, course: source.quarterWeights, quarter }),
      };
      if (!sameJson({ title: existing.title, weight: existing.weight, quarterWeights: existing.quarterWeights }, next)) {
        putSection({ ...existing, ...next, ...stamp });
        counters.sections.updated += 1;
      }
    } else if (!dismissed.has(source.key)) {
      sectionOrder += 1;
      const section: ISection = {
        ...created,
        id: createId(),
        title: source.title,
        colorToken: (sectionOrder % 6) + 1,
        order: sectionOrder,
        weight: source.weight,
        archived: false,
        quarterWeights: [...source.quarterWeights],
        courseKey: source.key,
      };
      putSection(section);
      sectionByKey.set(source.key, section);
      added.push(section.title);
      counters.sections.added += 1;
    }
  }

  // ——— Темы ———
  const topicByKey = byKey(topics.values());
  const nextOrder = new Map<string, number>();
  const orderAfter = (parentId: string, current: readonly { readonly order: number }[]): number => {
    const value = (nextOrder.get(parentId) ?? Math.max(-1, ...current.map((entry) => entry.order))) + 1;
    nextOrder.set(parentId, value);
    return value;
  };
  for (const source of course.topics) {
    const existing = topicByKey.get(source.key);
    if (existing) {
      if (existing.archived) {
        continue;
      }
      if (existing.title !== source.title || existing.description !== source.description) {
        putTopic({ ...existing, title: source.title, description: source.description, ...stamp });
        updated.push(source.title);
      }
      continue;
    }
    const parent = sectionByKey.get(source.sectionKey);
    if (dismissed.has(source.key) || !parent || parent.archived) {
      continue;
    }
    const topic: ITopic = {
      ...created,
      id: createId(),
      sectionId: parent.id,
      title: source.title,
      description: source.description,
      order: orderAfter(`s:${parent.id}`, [...topics.values()].filter((entry) => entry.sectionId === parent.id)),
      archived: false,
      courseKey: source.key,
    };
    putTopic(topic);
    topicByKey.set(source.key, topic);
    added.push(`${parent.title} / ${topic.title}`);
  }

  // ——— Топики ———
  const topicTitle = (topicId: string): string => topics.get(topicId)?.title ?? '';
  const courseFields = (source: ICourseItem): TItemCourseFields => {
    const resource = source.resourceKey ? resourceByKey.get(source.resourceKey) : undefined;
    const refs: IResourceRef[] = resource
      ? [{ resourceId: resource.id, range: source.range, units: resource.minPerUnit > 0 ? Math.round(source.estimateMin / resource.minPerUnit) : 0 }]
      : [];
    return {
      title: source.title,
      kind: source.kind,
      estimateMin: source.estimateMin,
      resourceRefs: refs,
      recurrenceWeeks: source.recurrenceWeeks,
      selfCheck: source.selfCheck,
      guide: source.guide,
      routeRole: source.routeRole,
      checkpointDay: source.checkpointDay,
    };
  };
  const withPhotos = (guide: IGuide | null, photos: readonly string[]): IGuide | null =>
    guide ? { ...guide, imageIds: [...photos] } : null;

  const courseItemKeys = new Set(course.items.map((entry) => entry.key));
  const itemByKey = byKey(items.values());
  for (const source of course.items) {
    const fields = courseFields(source);
    const hash = itemCourseHash(fields);
    const existing = itemByKey.get(source.key);
    if (existing) {
      if (existing.archived) {
        continue;
      }
      const label = `${topicTitle(existing.topicId)} / ${existing.title}`;
      if (started.has(existing.id)) {
        keptStarted.push(label);
        continue;
      }
      const current = itemCourseHash(existing);
      if (current !== hash) {
        if (isItemEdited(existing)) {
          overwritten.push(label);
        }
        putItem({ ...existing, ...fields, guide: withPhotos(fields.guide, existing.guide?.imageIds ?? []), courseHash: hash, ...stamp });
        updated.push(`${topicTitle(existing.topicId)} / ${source.title}`);
      } else if (existing.courseHash !== hash) {
        putItem({ ...existing, courseHash: hash, ...stamp });
      }
      continue;
    }
    const parent = topicByKey.get(source.topicKey);
    if (dismissed.has(source.key) || !parent || parent.archived) {
      continue;
    }
    const item: IItem = {
      ...created,
      id: createId(),
      topicId: parent.id,
      ...fields,
      weakSpot: false,
      order: orderAfter(`t:${parent.id}`, [...items.values()].filter((entry) => entry.topicId === parent.id)),
      doneAt: null,
      archived: false,
      courseKey: source.key,
      courseHash: hash,
    };
    putItem(item);
    added.push(`${parent.title} / ${item.title}`);
  }

  // Убранные из курса топики: не начатые — в архив, начатые становятся своими
  for (const item of [...items.values()]) {
    if (item.courseKey === null || courseItemKeys.has(item.courseKey) || item.archived) {
      continue;
    }
    if (started.has(item.id)) {
      putItem({ ...item, courseKey: null, courseHash: null, ...stamp });
    } else {
      putItem({ ...item, archived: true, ...stamp });
      archived.push(`${topicTitle(item.topicId)} / ${item.title}`);
    }
  }

  // Убранные темы и разделы: в архив, если внутри не осталось активного; иначе становятся своими
  const courseTopicKeys = new Set(course.topics.map((entry) => entry.key));
  for (const topic of [...topics.values()]) {
    if (topic.courseKey === null || courseTopicKeys.has(topic.courseKey) || topic.archived) {
      continue;
    }
    const active = [...items.values()].some((item) => item.topicId === topic.id && !item.archived);
    putTopic(active ? { ...topic, courseKey: null, ...stamp } : { ...topic, archived: true, ...stamp });
    if (!active) {
      archived.push(topic.title);
    }
  }
  const courseSectionKeys = new Set(course.sections.map((entry) => entry.key));
  for (const section of [...sections.values()]) {
    if (section.courseKey === null || courseSectionKeys.has(section.courseKey) || section.archived) {
      continue;
    }
    const active = [...topics.values()].some((topic) => topic.sectionId === section.id && !topic.archived);
    putSection(active ? { ...section, courseKey: null, ...stamp } : { ...section, archived: true, ...stamp });
    if (!active) {
      archived.push(section.title);
      counters.sections.archived += 1;
    }
  }

  // Убранные ресурсы: в архив, если на них не ссылаются активные топики
  for (const resource of [...resources.values()]) {
    if (resource.courseKey === null || courseResourceKeys.has(resource.courseKey) || resource.archived) {
      continue;
    }
    const used = [...items.values()].some((item) => !item.archived && item.resourceRefs.some((ref) => ref.resourceId === resource.id));
    putResource(used ? { ...resource, courseKey: null, ...stamp } : { ...resource, archived: true, ...stamp });
    if (!used) {
      counters.resources.archived += 1;
    }
  }

  // ——— Маршрут мастеров: закончившиеся блоки — история ———
  const blocks = live(data.routeBlocks);
  const blockByKey = byKey(blocks);
  const routePuts: IRouteBlock[] = [];
  const routeRemoves: string[] = [];
  const courseBlockKeys = new Set(course.routeBlocks.map((entry) => entry.key));
  for (const source of course.routeBlocks) {
    const fields = {
      order: source.order,
      fromWeek: source.fromWeek,
      toWeek: source.toWeek,
      artists: source.artists,
      copyTask: source.copyTask,
      copyTechnique: source.copyTechnique,
      links: source.links,
    };
    const existing = blockByKey.get(source.key);
    if (existing) {
      if (existing.toWeek < input.currentWeek) {
        continue;
      }
      const current = {
        order: existing.order,
        fromWeek: existing.fromWeek,
        toWeek: existing.toWeek,
        artists: existing.artists,
        copyTask: existing.copyTask,
        copyTechnique: existing.copyTechnique,
        links: existing.links,
      };
      if (!sameJson(current, fields)) {
        routePuts.push({ ...existing, ...fields, ...stamp });
        counters.routeBlocks.updated += 1;
      }
    } else if (!dismissed.has(source.key) && source.toWeek >= input.currentWeek) {
      routePuts.push({ ...created, id: createId(), ...fields, courseKey: source.key });
      counters.routeBlocks.added += 1;
    }
  }
  for (const block of blocks) {
    if (block.courseKey === null || courseBlockKeys.has(block.courseKey)) {
      continue;
    }
    if (block.fromWeek > input.currentWeek) {
      routeRemoves.push(block.id);
      counters.routeBlocks.removed += 1;
    } else {
      routePuts.push({ ...block, courseKey: null, ...stamp });
    }
  }

  const customItems = [...items.values()].filter((item) => item.courseKey === null && !item.archived).length;
  const pick = <T extends { readonly id: string }>(map: ReadonlyMap<string, T>, ids: ReadonlySet<string>): T[] =>
    [...ids].map((id) => map.get(id)).filter((entry): entry is T => entry !== undefined);
  const puts = {
    sections: pick(sections, touched.sections),
    topics: pick(topics, touched.topics),
    items: pick(items, touched.items),
    resources: pick(resources, touched.resources),
    routeBlocks: routePuts,
  };
  const changed =
    puts.sections.length + puts.topics.length + puts.items.length + puts.resources.length + puts.routeBlocks.length + routeRemoves.length > 0;
  return {
    version: course.version,
    puts,
    removes: { routeBlocks: routeRemoves },
    summary: {
      added,
      updated,
      overwritten,
      archived,
      keptStarted,
      customItems,
      resources: counters.resources,
      routeBlocks: counters.routeBlocks,
      sections: counters.sections,
    },
    changed,
  };
}

const norm = (value: string): string => value.trim().toLowerCase();

/**
 * Миграция 2 → 3 (FR-44): стартовыми становятся сущности, чей путь названий совпадает с курсом.
 * Один ключ — одна сущность; остальное — своё. Отпечаток полей берётся с текущих значений.
 */
export function assignCourseKeys<T extends Pick<ICollections, 'sections' | 'topics' | 'items' | 'resources' | 'routeBlocks'>>(
  data: T,
  course: ICourse,
): { readonly data: T; readonly matched: number } {
  let matched = 0;
  const claim = <E extends { readonly courseKey: string | null }>(
    list: readonly E[],
    keyOf: (entry: E) => string | null,
  ): E[] => {
    const used = new Set<string>();
    return list.map((entry) => {
      const key = entry.courseKey ?? keyOf(entry);
      if (key === null || used.has(key)) {
        return entry.courseKey === null ? entry : { ...entry, courseKey: null };
      }
      used.add(key);
      matched += 1;
      return { ...entry, courseKey: key };
    });
  };

  const sectionKey = new Map(course.sections.map((entry) => [norm(entry.title), entry.key]));
  const sections = claim(data.sections, (entry) => sectionKey.get(norm(entry.title)) ?? null);
  const keyOfSection = new Map(sections.map((entry) => [entry.id, entry.courseKey]));

  const topicKey = new Map(course.topics.map((entry) => [`${entry.sectionKey}|${norm(entry.title)}`, entry.key]));
  const topics = claim(data.topics, (entry) => {
    const parent = keyOfSection.get(entry.sectionId);
    return parent ? (topicKey.get(`${parent}|${norm(entry.title)}`) ?? null) : null;
  });
  const keyOfTopic = new Map(topics.map((entry) => [entry.id, entry.courseKey]));

  const itemKey = new Map(course.items.map((entry) => [`${entry.topicKey}|${norm(entry.title)}`, entry.key]));
  const items = claim(data.items, (entry) => {
    const parent = keyOfTopic.get(entry.topicId);
    return parent ? (itemKey.get(`${parent}|${norm(entry.title)}`) ?? null) : null;
  }).map((entry) => (entry.courseKey !== null && entry.courseHash === null ? { ...entry, courseHash: itemCourseHash(entry) } : entry));

  const resourceKey = new Map(course.resources.map((entry) => [norm(entry.title), entry.key]));
  const resources = claim(data.resources, (entry) => resourceKey.get(norm(entry.title)) ?? null);

  const blockKey = new Map(course.routeBlocks.map((entry) => [`${entry.fromWeek}-${entry.toWeek}`, entry.key]));
  const routeBlocks = claim(data.routeBlocks, (entry) => blockKey.get(`${entry.fromWeek}-${entry.toWeek}`) ?? null);

  return { data: { ...data, sections, topics, items, resources, routeBlocks }, matched };
}
