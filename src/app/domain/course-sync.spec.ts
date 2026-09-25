import { describe, expect, it } from 'vitest';
import { COURSE, buildSeed } from '../seed';
import { COURSE_V1_KEYS } from '../seed/course-v1-keys.fixture';
import type { ICourse, IItem, ITimeLog } from '../types';
import { assignCourseKeys, isItemEdited, itemCourseHash, planCourseUpdate, type ICourseSyncInput, type TCourseData } from './course-sync';
import { logFixture } from './test-fixtures';

const NOW = '2026-09-25T10:00:00.000Z';
let counter = 0;
const createId = (): string => `id-${(counter += 1)}`;

function seeded(): TCourseData {
  const seed = buildSeed(NOW);
  return { ...seed, timeLogs: [] };
}

function plan(data: TCourseData, patch: Partial<ICourseSyncInput> = {}): ReturnType<typeof planCourseUpdate> {
  return planCourseUpdate({ data, course: COURSE, dismissedKeys: [], activeItemId: null, currentWeek: 1, nowIso: NOW, createId, ...patch });
}

/** Применяет план к данным так же, как CourseService.apply. */
function applyPlan(data: TCourseData, result: ReturnType<typeof planCourseUpdate>): TCourseData {
  const merge = <T extends { readonly id: string }>(list: readonly T[], puts: readonly T[], removes: readonly string[] = []): T[] => {
    const byId = new Map(list.filter((entry) => !removes.includes(entry.id)).map((entry) => [entry.id, entry]));
    for (const entry of puts) {
      byId.set(entry.id, entry);
    }
    return [...byId.values()];
  };
  return {
    sections: merge(data.sections, result.puts.sections),
    topics: merge(data.topics, result.puts.topics),
    items: merge(data.items, result.puts.items),
    resources: merge(data.resources, result.puts.resources),
    routeBlocks: merge(data.routeBlocks, result.puts.routeBlocks, result.removes.routeBlocks),
    timeLogs: data.timeLogs,
  };
}

const at = <T>(list: readonly T[], index: number): T => {
  const value = list[index];
  if (value === undefined) {
    throw new Error(`Нет элемента ${index}`);
  }
  return value;
};

const log = (itemId: string, id = `log-${itemId}`): ITimeLog =>
  logFixture({ id, itemId, type: 'practice', startedAt: '2026-09-20T10:00:00.000Z', minutes: 45 });

describe('курс и ключи (FR-44)', () => {
  it('ключи уникальны в каждом типе и все ключи v1 остались в курсе или записаны как убранные', () => {
    for (const list of [COURSE.sections, COURSE.topics, COURSE.items, COURSE.resources, COURSE.routeBlocks]) {
      const keys = list.map((entry) => entry.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
    const all = new Set([
      ...COURSE.sections.map((entry) => entry.key),
      ...COURSE.topics.map((entry) => entry.key),
      ...COURSE.items.map((entry) => entry.key),
      ...COURSE.resources.map((entry) => entry.key),
      ...COURSE.routeBlocks.map((entry) => entry.key),
    ]);
    const removed = new Set(COURSE.releases.flatMap((release) => release.removedKeys));
    const lost = COURSE_V1_KEYS.filter((key) => !all.has(key) && !removed.has(key));
    expect(lost).toEqual([]);
    for (const key of removed) {
      expect(all.has(key)).toBe(false);
    }
  });

  it('журнал версий заканчивается текущей версией курса', () => {
    expect(COURSE.releases.at(-1)?.version).toBe(COURSE.version);
    expect(COURSE.releases.map((release) => release.version)).toEqual([...COURSE.releases.keys()].map((index) => index + 1));
  });

  it('стартовая программа — курс, применённый к пустым данным: всё стартовое, повторный план пуст', () => {
    const data = seeded();
    expect(data.items.every((item) => item.courseKey !== null && item.courseHash === itemCourseHash(item))).toBe(true);
    expect(data.sections.every((section) => section.courseKey !== null)).toBe(true);
    expect(data.resources.every((resource) => resource.courseKey !== null)).toBe(true);
    expect(data.items.filter((item) => item.checkpointDay !== null).map((item) => item.checkpointDay)).toEqual([66, 91, 182, 273, 364]);
    const again = plan(data);
    expect(again.changed).toBe(false);
  });
});

describe('обновление курса (FR-46, US-14)', () => {
  /** Данные «курса v1»: у стартовых топиков другие поля, контрольных работ ещё нет. */
  function legacy(): { data: TCourseData; untouched: IItem; started: IItem; custom: IItem } {
    const data = seeded();
    const checkpointTopic = data.topics.find((topic) => topic.title === 'Контрольные работы');
    const items = data.items
      .filter((item) => item.checkpointDay === null)
      .map((item) => {
        const old = { ...item, estimateMin: item.estimateMin + 15, guide: item.guide ? { ...item.guide, goal: 'Старая цель' } : null };
        return { ...old, courseHash: itemCourseHash(old) };
      });
    const custom: IItem = { ...at(items, 0), id: 'custom-1', title: 'Свой топик', courseKey: null, courseHash: null };
    const withCustom = [...items, custom];
    const untouched = withCustom[1];
    const started = withCustom[2];
    if (!untouched || !started || !checkpointTopic) {
      throw new Error('fixture');
    }
    return {
      data: { ...data, topics: data.topics.filter((topic) => topic.id !== checkpointTopic.id), items: withCustom, timeLogs: [log(started.id)] },
      untouched,
      started,
      custom,
    };
  }

  it('не начатые стартовые — как в курсе; начатые и свои — без изменений; новое добавляется', () => {
    const { data, untouched, started, custom } = legacy();
    const result = plan(data);
    const after = applyPlan(data, result);
    const course = COURSE.items.find((entry) => entry.key === untouched.courseKey);
    const updated = after.items.find((item) => item.id === untouched.id);
    expect(updated?.estimateMin).toBe(course?.estimateMin);
    expect(updated?.guide?.goal).toBe(course?.guide.goal);
    expect(after.items.find((item) => item.id === started.id)).toEqual(started);
    expect(after.items.find((item) => item.id === custom.id)).toEqual(custom);
    expect(result.summary.keptStarted.length).toBe(1);
    expect(result.summary.customItems).toBe(1);
    const checkpoints = after.items.filter((item) => item.checkpointDay !== null);
    expect(checkpoints.length).toBe(5);
    expect(result.summary.added).toContain('Мастера / Контрольные работы');
    expect(result.summary.overwritten).toEqual([]);
  });

  it('повторное применение ничего не меняет (идемпотентность)', () => {
    const { data } = legacy();
    const after = applyPlan(data, plan(data));
    expect(plan(after).changed).toBe(false);
  });

  it('логи, отметки «пройден» и заметки не входят в план — прогресс сохраняется', () => {
    const { data, started } = legacy();
    const done = { ...started, id: 'done-1', courseKey: 'item:несуществующий', doneAt: NOW };
    const input = { ...data, items: [...data.items, done] };
    const result = plan(input);
    const after = applyPlan(input, result);
    expect(after.timeLogs).toEqual(input.timeLogs);
    expect(after.items.filter((item) => item.doneAt !== null).map((item) => item.id)).toEqual(['done-1']);
    // Убранный из курса, но пройденный топик остаётся и становится своим
    expect(after.items.find((item) => item.id === 'done-1')).toMatchObject({ archived: false, courseKey: null });
  });

  it('правки пользователя в не начатом стартовом топике видны в предпросмотре и заменяются курсом', () => {
    const data = seeded();
    const target = data.items[3];
    if (!target) {
      throw new Error('fixture');
    }
    const edited = { ...target, estimateMin: 999 };
    expect(isItemEdited(edited)).toBe(true);
    const input = { ...data, items: data.items.map((item) => (item.id === target.id ? edited : item)) };
    const result = plan(input);
    expect(result.summary.overwritten).toHaveLength(1);
    expect(applyPlan(input, result).items.find((item) => item.id === target.id)?.estimateMin).toBe(target.estimateMin);
  });

  it('фото ориентира и «слабое место» — данные пользователя, курс их не трогает', () => {
    const data = seeded();
    const target = data.items[4];
    if (!target?.guide) {
      throw new Error('fixture');
    }
    const mine = { ...target, weakSpot: true, estimateMin: 5, guide: { ...target.guide, imageIds: ['photo-1'] } };
    const input = { ...data, items: data.items.map((item) => (item.id === target.id ? mine : item)) };
    const after = applyPlan(input, plan(input)).items.find((item) => item.id === target.id);
    expect(after?.weakSpot).toBe(true);
    expect(after?.guide?.imageIds).toEqual(['photo-1']);
    expect(after?.estimateMin).toBe(target.estimateMin);
  });

  it('убранный из курса не начатый топик уходит в архив, начатый становится своим', () => {
    const data = seeded();
    const topic = data.topics[0];
    if (!topic) {
      throw new Error('fixture');
    }
    const extra = (id: string): IItem => ({ ...at(data.items, 0), id, topicId: topic.id, title: id, courseKey: `item:старое/${id}` });
    const input = { ...data, items: [...data.items, extra('a'), extra('b')], timeLogs: [log('b')] };
    const result = plan(input);
    const after = applyPlan(input, result);
    expect(after.items.find((item) => item.id === 'a')).toMatchObject({ archived: true });
    expect(after.items.find((item) => item.id === 'b')).toMatchObject({ archived: false, courseKey: null });
    expect(result.summary.archived).toHaveLength(1);
  });

  it('топик по таймеру считается начатым', () => {
    const { data, untouched } = legacy();
    const result = plan(data, { activeItemId: untouched.id });
    expect(result.puts.items.some((item) => item.id === untouched.id)).toBe(false);
  });

  it('удалённая пользователем стартовая сущность не возвращается', () => {
    const data = seeded();
    const removed = data.items[0];
    if (!removed?.courseKey) {
      throw new Error('fixture');
    }
    const input = { ...data, items: data.items.filter((item) => item.id !== removed.id) };
    expect(plan(input, { dismissedKeys: [removed.courseKey] }).changed).toBe(false);
    expect(plan(input).summary.added).toHaveLength(1);
  });

  it('архивная стартовая сущность не достаётся из архива и не меняется', () => {
    const data = seeded();
    const target = data.items[5];
    if (!target) {
      throw new Error('fixture');
    }
    const archived = { ...target, archived: true, estimateMin: 1 };
    const input = { ...data, items: data.items.map((item) => (item.id === target.id ? archived : item)) };
    expect(plan(input).changed).toBe(false);
  });

  it('маршрут: закончившиеся блоки не меняются, текущий и будущие — как в курсе, лишние будущие удаляются', () => {
    const data = seeded();
    const blocks = data.routeBlocks.map((block) => ({ ...block, copyTask: 'старое' }));
    const extra = { ...at(blocks, 0), id: 'future', fromWeek: 60, toWeek: 61, courseKey: 'route:99' };
    const input = { ...data, routeBlocks: [...blocks, extra] };
    const result = plan(input, { currentWeek: 10 });
    const after = applyPlan(input, result);
    const block = (from: number): string | undefined => after.routeBlocks.find((entry) => entry.fromWeek === from)?.copyTask;
    expect(block(1)).toBe('старое');
    expect(block(5)).toBe('старое');
    expect(block(9)).not.toBe('старое');
    expect(block(48)).not.toBe('старое');
    expect(after.routeBlocks.some((entry) => entry.id === 'future')).toBe(false);
    expect(result.summary.routeBlocks.removed).toBe(1);
  });

  it('квартальные веса: прошедшие кварталы остаются, с текущего — из курса', () => {
    const data = seeded();
    const sections = data.sections.map((section) => ({ ...section, quarterWeights: [1, 1, 1, 1] as const }));
    const input = { ...data, sections };
    const after = applyPlan(input, plan(input, { currentWeek: 14 }));
    const form = after.sections.find((section) => section.title === 'Форма');
    expect(form?.quarterWeights).toEqual([1, 2, 1, 1]);
  });

  it('ресурсы получают доступ и бесплатную замену из курса', () => {
    const data = seeded();
    const resources = data.resources.map((resource) => ({ ...resource, access: 'paid' as const, freeAlternativeUrl: '' }));
    const input = { ...data, resources };
    const after = applyPlan(input, plan(input));
    const drawabox = after.resources.find((resource) => resource.courseKey === 'resource:drawabox');
    expect(drawabox?.access).toBe('free');
    const li = after.resources.find((resource) => resource.courseKey === 'resource:li');
    expect(li?.freeAlternativeUrl).toMatch(/^https:\/\//);
  });

  it('расчёт на 500 топиках и 5000 логах укладывается в 300 мс', () => {
    const data = seeded();
    const topic = data.topics[0];
    if (!topic) {
      throw new Error('fixture');
    }
    const extra: IItem[] = Array.from({ length: 420 }, (_, index) => ({ ...at(data.items, 0), id: `x${index}`, topicId: topic.id, courseKey: null, courseHash: null }));
    const logs = Array.from({ length: 5000 }, (_, index) => log(`x${index % 420}`, `l${index}`));
    const input = { ...data, items: [...data.items, ...extra], timeLogs: logs };
    const course: ICourse = COURSE;
    const started = performance.now();
    planCourseUpdate({ data: input, course, dismissedKeys: [], activeItemId: null, currentWeek: 20, nowIso: NOW, createId });
    expect(performance.now() - started).toBeLessThan(300);
  });
});

describe('миграция 2 → 3 (FR-44, US-15)', () => {
  const stripped = (): TCourseData => {
    const data = seeded();
    return {
      ...data,
      sections: data.sections.map((entry) => ({ ...entry, courseKey: null })),
      topics: data.topics.map((entry) => ({ ...entry, courseKey: null })),
      items: data.items.map((entry) => ({ ...entry, courseKey: null, courseHash: null })),
      resources: data.resources.map((entry) => ({ ...entry, courseKey: null })),
      routeBlocks: data.routeBlocks.map((entry) => ({ ...entry, courseKey: null })),
    };
  };

  it('совпадение пути названий — стартовое, переименованное — своё', () => {
    const data = stripped();
    const renamed = data.items[0];
    if (!renamed) {
      throw new Error('fixture');
    }
    const input = { ...data, items: data.items.map((item) => (item.id === renamed.id ? { ...item, title: 'Мой вариант' } : item)) };
    const { data: result, matched } = assignCourseKeys(input, COURSE);
    expect(matched).toBeGreaterThan(100);
    expect(result.items.find((item) => item.id === renamed.id)?.courseKey).toBeNull();
    expect(result.items.filter((item) => item.courseKey !== null)).toHaveLength(data.items.length - 1);
    expect(result.items.every((item) => item.courseKey === null || item.courseHash === itemCourseHash(item))).toBe(true);
    expect(result.resources.every((resource) => resource.courseKey !== null)).toBe(true);
    expect(result.routeBlocks.every((block) => block.courseKey !== null)).toBe(true);
  });

  it('дубль по названию получает ключ только один раз', () => {
    const data = stripped();
    const first = data.items[0];
    if (!first) {
      throw new Error('fixture');
    }
    const input = { ...data, items: [...data.items, { ...first, id: 'dup' }] };
    const { data: result } = assignCourseKeys(input, COURSE);
    expect(result.items.find((item) => item.id === 'dup')?.courseKey).toBeNull();
  });
});
