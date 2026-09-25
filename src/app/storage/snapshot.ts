import type { ICollections, ISnapshot, TCollection, TSnapshotKind } from '../types';
import { COLLECTIONS, SCHEMA_VERSION } from './storage-adapter';

type TFieldRule = 'string' | 'number' | 'boolean' | 'string?' | 'number?' | 'array' | 'object' | 'object?';

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
  },
  sections: { ...BASE, title: 'string', colorToken: 'number', order: 'number', weight: 'number', archived: 'boolean' },
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
  meta: { ...BASE, onboarded: 'boolean', settings: 'object', tips: 'object', milestonesShown: 'array', expanded: 'array' },
};

const ENUMS: Partial<Record<string, readonly string[]>> = {
  'items.kind': ['study', 'practice'],
  'planBlocks.type': ['study', 'practice', 'creative', 'review'],
  'planBlocks.status': ['planned', 'skipped'],
  'timeLogs.type': ['study', 'practice', 'creative', 'review'],
  'timeLogs.source': ['timer', 'manual'],
  'resources.type': ['book', 'course', 'video', 'article', 'exercise', 'tool'],
  'resources.unit': ['page', 'lesson', 'minute', 'piece'],
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
    case 'string?':
      return value === null || value === undefined || typeof value === 'string';
    case 'number?':
      return value === null || value === undefined || (typeof value === 'number' && Number.isFinite(value));
    case 'array':
      return Array.isArray(value);
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
        if (!checkField(value, rule) || (allowed && typeof value === 'string' && !allowed.includes(value))) {
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

/** Цепочка миграций схемы; версия 1 — текущая. */
export function migrate(snapshot: ISnapshot): ISnapshot {
  return { ...snapshot, schemaVersion: SCHEMA_VERSION };
}
