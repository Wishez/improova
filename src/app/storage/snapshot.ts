import type { ICollections, IGuide, IGuideLink, IRouteArtist, ISnapshot, TCollection, TSnapshotKind } from '../types';
import { COLLECTIONS, SCHEMA_VERSION } from './storage-adapter';

type TFieldRule = 'string' | 'number' | 'boolean' | 'boolean?' | 'string?' | 'number?' | 'array' | 'array?' | 'object' | 'object?';

const BASE: Record<string, TFieldRule> = { id: 'string', createdAt: 'string', updatedAt: 'string' };

/** Минимальные схемы коллекций: поля, без которых приложение не работает. */
const RULES: Record<TCollection, Record<string, TFieldRule>> = {
  challenges: { ...BASE, title: 'string', startDate: 'string', endDate: 'string' },
  budgets: {
    ...BASE,
    studyMinPerWeek: 'number',
    practiceMinPerWeek: 'number',
    creativeShare: 'number',
    dayCapacity: 'array',
    blockMin: 'number',
    blockMax: 'number',
    reviewIntervals: 'array',
    seasonalWeights: 'boolean?',
  },
  sections: {
    ...BASE,
    title: 'string',
    colorToken: 'number',
    order: 'number',
    weight: 'number',
    archived: 'boolean',
    quarterWeights: 'array?',
  },
  topics: { ...BASE, sectionId: 'string', title: 'string', description: 'string', order: 'number', archived: 'boolean' },
  items: {
    ...BASE,
    topicId: 'string',
    title: 'string',
    kind: 'string',
    estimateMin: 'number',
    resourceRefs: 'array',
    weakSpot: 'boolean',
    recurrenceWeeks: 'number?',
    selfCheck: 'string',
    order: 'number',
    doneAt: 'string?',
    archived: 'boolean',
    guide: 'object?',
    routeRole: 'string?',
  },
  resources: {
    ...BASE,
    title: 'string',
    type: 'string',
    author: 'string',
    url: 'string',
    unit: 'string',
    unitCount: 'number',
    minPerUnit: 'number',
    archived: 'boolean',
  },
  planBlocks: {
    ...BASE,
    date: 'string',
    itemId: 'string?',
    type: 'string',
    plannedMin: 'number',
    pinned: 'boolean',
    status: 'string',
  },
  timeLogs: {
    ...BASE,
    itemId: 'string?',
    type: 'string',
    startedAt: 'string',
    endedAt: 'string',
    durationMin: 'number',
    source: 'string',
    editedAt: 'string?',
  },
  notes: {
    ...BASE,
    itemId: 'string?',
    logId: 'string?',
    body: 'string',
    worked: 'string',
    failed: 'string',
    next: 'string',
    imageIds: 'array',
  },
  assets: { ...BASE, dataUrl: 'string', width: 'number', height: 'number', bytes: 'number' },
  meta: { ...BASE, onboarded: 'boolean', settings: 'object', tips: 'object', milestonesShown: 'array', expanded: 'array', dayPlans: 'object?' },
  routeBlocks: {
    ...BASE,
    order: 'number',
    fromWeek: 'number',
    toWeek: 'number',
    artists: 'array',
    copyTask: 'string',
    copyTechnique: 'string',
    links: 'array',
  },
};

const ENUMS: Partial<Record<string, readonly string[]>> = {
  'items.kind': ['study', 'practice'],
  'planBlocks.type': ['study', 'practice', 'creative', 'review'],
  'planBlocks.status': ['planned', 'skipped'],
  'timeLogs.type': ['study', 'practice', 'creative', 'review'],
  'timeLogs.source': ['timer', 'manual'],
  'resources.type': ['book', 'course', 'video', 'article', 'exercise', 'tool'],
  'resources.unit': ['page', 'lesson', 'minute', 'piece'],
  'items.routeRole': ['study', 'copy'],
};

const isStringArray = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === 'string');

export function isGuideLink(value: unknown): value is IGuideLink {
  return (
    isRecord(value) &&
    typeof value['title'] === 'string' &&
    typeof value['url'] === 'string' &&
    typeof value['locator'] === 'string' &&
    (value['access'] === 'pd' || value['access'] === 'free' || value['access'] === 'paid')
  );
}

const isStep = (value: unknown): boolean =>
  isRecord(value) &&
  typeof value['title'] === 'string' &&
  typeof value['minutes'] === 'number' &&
  Number.isFinite(value['minutes']) &&
  value['minutes'] > 0;

export function isGuide(value: unknown): value is IGuide {
  return (
    isRecord(value) &&
    typeof value['goal'] === 'string' &&
    typeof value['task'] === 'string' &&
    typeof value['stopCriterion'] === 'string' &&
    Array.isArray(value['steps']) &&
    value['steps'].every(isStep) &&
    Array.isArray(value['links']) &&
    value['links'].every(isGuideLink) &&
    Array.isArray(value['references']) &&
    value['references'].every(isGuideLink) &&
    isStringArray(value['imageIds']) &&
    isStringArray(value['pitfalls'])
  );
}

export function isRouteArtist(value: unknown): value is IRouteArtist {
  return (
    isRecord(value) &&
    typeof value['name'] === 'string' &&
    typeof value['url'] === 'string' &&
    typeof value['takeaway'] === 'string' &&
    typeof value['works'] === 'string'
  );
}

const isQuarterWeights = (value: unknown): boolean =>
  Array.isArray(value) && value.length === 4 && value.every((weight) => weight === 1 || weight === 2 || weight === 3);

/** Проверки вложенных структур, которые не описываются плоским правилом. */
const DEEP: Partial<Record<string, (value: unknown) => boolean>> = {
  'items.guide': (value) => value === null || value === undefined || isGuide(value),
  'sections.quarterWeights': (value) => value === null || value === undefined || isQuarterWeights(value),
  'routeBlocks.artists': (value) => Array.isArray(value) && value.every(isRouteArtist),
  'routeBlocks.links': (value) => Array.isArray(value) && value.every(isGuideLink),
};

export type TSnapshotCheck =
  | { readonly ok: true; readonly snapshot: ISnapshot }
  | { readonly ok: false; readonly reason: 'parse' | 'schema'; readonly path: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function checkField(value: unknown, rule: TFieldRule): boolean {
  switch (rule) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'boolean?':
      return value === null || value === undefined || typeof value === 'boolean';
    case 'string?':
      return value === null || value === undefined || typeof value === 'string';
    case 'number?':
      return value === null || value === undefined || (typeof value === 'number' && Number.isFinite(value));
    case 'array':
      return Array.isArray(value);
    case 'array?':
      return value === null || value === undefined || Array.isArray(value);
    case 'object':
      return isRecord(value);
    case 'object?':
      return value === null || value === undefined || isRecord(value);
  }
}

/** Проверка файла копии: при первой ошибке возвращает её путь, данные не трогаются (ТЗ US-08). */
export function checkSnapshot(text: string): TSnapshotCheck {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'parse', path: '' };
  }
  if (!isRecord(raw) || raw['app'] !== 'improva' || !isRecord(raw['data'])) {
    return { ok: false, reason: 'parse', path: '' };
  }
  const version = raw['schemaVersion'];
  if (typeof version !== 'number' || version > SCHEMA_VERSION || version < 1) {
    return { ok: false, reason: 'schema', path: 'schemaVersion' };
  }
  const kind: TSnapshotKind = raw['kind'] === 'program' ? 'program' : 'full';
  const data: Partial<ICollections> = {};
  for (const collection of COLLECTIONS) {
    const rows = raw['data'][collection];
    if (rows === undefined) {
      continue;
    }
    if (!Array.isArray(rows)) {
      return { ok: false, reason: 'schema', path: collection };
    }
    const rules = RULES[collection];
    for (let index = 0; index < rows.length; index += 1) {
      const row: unknown = rows[index];
      if (!isRecord(row)) {
        return { ok: false, reason: 'schema', path: `${collection}[${index}]` };
      }
      for (const [field, rule] of Object.entries(rules)) {
        const value = row[field];
        const allowed = ENUMS[`${collection}.${field}`];
        const deep = DEEP[`${collection}.${field}`];
        if (
          !checkField(value, rule) ||
          (allowed && typeof value === 'string' && !allowed.includes(value)) ||
          (deep && !deep(value))
        ) {
          return { ok: false, reason: 'schema', path: `${collection}[${index}].${field}` };
        }
      }
    }
    Object.assign(data, { [collection]: rows });
  }
  return {
    ok: true,
    snapshot: migrate({
      app: 'improva',
      kind,
      schemaVersion: version,
      exportedAt: typeof raw['exportedAt'] === 'string' ? raw['exportedAt'] : new Date().toISOString(),
      data,
    }),
  };
}

/**
 * Приводит данные к текущей схеме. Миграция 1 → 2 только добавляет поля со значениями
 * по умолчанию, ничего не удаляет, поэтому обратима экспортом (ТЗ 1.2, FR-42).
 */
function normalizePartial(data: Partial<ICollections>): Partial<ICollections> {
  const next: Partial<ICollections> = { ...data };
  if (data.items) {
    next.items = data.items.map((item) => ({ ...item, guide: item.guide ?? null, routeRole: item.routeRole ?? null }));
  }
  if (data.sections) {
    next.sections = data.sections.map((section) => ({ ...section, quarterWeights: section.quarterWeights ?? null }));
  }
  if (data.budgets) {
    // Для данных v1 квартальные веса выключены: поведение планировщика не меняется
    next.budgets = data.budgets.map((budget) => ({ ...budget, seasonalWeights: budget.seasonalWeights ?? false }));
  }
  if (data.meta) {
    next.meta = data.meta.map((meta) => ({
      ...meta,
      timer: meta.timer ? { ...meta.timer, stepMinutes: meta.timer.stepMinutes ?? null } : null,
      dayPlans: meta.dayPlans ?? {},
    }));
  }
  return next;
}

export function normalizeCollections(data: ICollections): ICollections {
  return { ...data, ...normalizePartial(data) };
}

/** Цепочка миграций схемы; версия 2 — текущая. */
export function migrate(snapshot: ISnapshot): ISnapshot {
  return { ...snapshot, schemaVersion: SCHEMA_VERSION, data: normalizePartial(snapshot.data) };
}
