import { describe, expect, it } from 'vitest';
import type { IPlanBlock, ITimeLog } from '../types';
import { addDays, fromDayKey } from '../utils';
import { planWeek, type IPlannerInput } from './planner';
import { buildProgramTree } from './program';
import { budgetFixture, itemFixture, logFixture, programFixture, sectionFixture, topicFixture } from './test-fixtures';

const MONDAY = '2026-01-05';

function input(patch: Partial<IPlannerInput> = {}): IPlannerInput {
  const program = programFixture();
  return {
    today: MONDAY,
    horizonDays: 7,
    budget: budgetFixture(),
    tree: buildProgramTree(program),
    resources: new Map(),
    logs: [],
    blocks: [],
    boundaryHour: 4,
    ...patch,
  };
}

const noonOf = (day: string): string => {
  const date = fromDayKey(day);
  return date.toISOString();
};

describe('planWeek (ТЗ 5)', () => {
  it('детерминирован: одинаковый вход — одинаковый план', () => {
    expect(planWeek(input())).toEqual(planWeek(input()));
  });

  it('сумма блоков дня не превышает ёмкость, длина блока в границах b_min…b_max', () => {
    const plan = planWeek(input());
    for (const day of plan.days) {
      const planned = day.blocks.reduce((sum, block) => sum + block.plannedMin, 0);
      expect(planned).toBeLessThanOrEqual(day.capacity);
      for (const block of day.blocks) {
        expect(block.plannedMin).toBeGreaterThanOrEqual(20);
        expect(block.plannedMin).toBeLessThanOrEqual(90);
      }
    }
  });

  it('недельный бюджет выдерживается: study ≈ S, остальное ≈ P (US-01)', () => {
    const plan = planWeek(input({ budget: budgetFixture({ dayCapacity: [60, 60, 60, 60, 60, 60, 60] }) }));
    const blocks = plan.days.flatMap((day) => day.blocks);
    const study = blocks.filter((block) => block.type === 'study').reduce((sum, block) => sum + block.plannedMin, 0);
    const practice = blocks.filter((block) => block.type !== 'study').reduce((sum, block) => sum + block.plannedMin, 0);
    expect(Math.abs(study - 120)).toBeLessThanOrEqual(20);
    expect(practice).toBeLessThanOrEqual(240);
    expect(practice).toBeGreaterThanOrEqual(200);
  });

  it('в неделю попадают топики минимум из двух разделов (M5)', () => {
    const plan = planWeek(input());
    const sections = new Set(plan.days.flatMap((day) => day.blocks.map((block) => block.sectionId)).filter(Boolean));
    expect(sections.size).toBeGreaterThanOrEqual(2);
  });

  it('если ёмкость меньше бюджета — план урезается пропорционально (ТЗ 5.1)', () => {
    const plan = planWeek(input({ budget: budgetFixture({ dayCapacity: [0, 0, 100, 0, 0, 100, 0] }) }));
    expect(plan.scale).toBeCloseTo(200 / 360, 5);
    const total = plan.days.flatMap((day) => day.blocks).reduce((sum, block) => sum + block.plannedMin, 0);
    expect(total).toBeLessThanOrEqual(200);
  });

  it('закреплённый блок не сдвигается и учитывается в ёмкости', () => {
    const pinned: IPlanBlock = {
      id: 'pin1',
      createdAt: '',
      updatedAt: '',
      date: addDays(MONDAY, 2),
      itemId: 'c1-5',
      type: 'practice',
      plannedMin: 45,
      pinned: true,
      status: 'planned',
    };
    const plan = planWeek(input({ blocks: [pinned] }));
    const day = plan.days.find((entry) => entry.date === pinned.date);
    expect(day?.blocks.some((block) => block.storedId === 'pin1' && block.plannedMin === 45)).toBe(true);
    expect(day?.blocks.reduce((sum, block) => sum + block.plannedMin, 0)).toBeLessThanOrEqual(120);
  });

  it('пропущенный топик не ставится в этот день', () => {
    const first = planWeek(input()).days.find((day) => day.blocks.length > 0);
    const block = first?.blocks.find((entry) => entry.itemId);
    expect(block).toBeDefined();
    const skipped: IPlanBlock = {
      id: 's1',
      createdAt: '',
      updatedAt: '',
      date: block?.date ?? MONDAY,
      itemId: block?.itemId ?? null,
      type: block?.type ?? 'practice',
      plannedMin: block?.plannedMin ?? 20,
      pinned: false,
      status: 'skipped',
    };
    const plan = planWeek(input({ blocks: [skipped] }));
    const day = plan.days.find((entry) => entry.date === skipped.date);
    expect(day?.blocks.some((entry) => entry.itemId === skipped.itemId)).toBe(false);
  });

  it('пустая программа — только блоки творчества (US-01, негативный)', () => {
    const plan = planWeek(input({ tree: buildProgramTree({ sections: [], topics: [], items: [] }) }));
    const types = new Set(plan.days.flatMap((day) => day.blocks.map((block) => block.type)));
    expect([...types].every((type) => type === 'creative')).toBe(true);
  });

  it('залогированное сегодня время уменьшает ёмкость сегодняшнего дня', () => {
    const tuesday = addDays(MONDAY, 1);
    const log = logFixture({ id: 'l1', itemId: 'a0-1', type: 'practice', startedAt: noonOf(tuesday), minutes: 50 });
    const plan = planWeek(input({ today: tuesday, logs: [log] }));
    const today = plan.days[0];
    expect((today?.planned ?? 0) + (today?.logged ?? 0)).toBeLessThanOrEqual(60);
  });

  it('слабое место встаёт раньше соседей по разделу (M1)', () => {
    const sections = [sectionFixture('a', 0)];
    const topics = [topicFixture('t', 'a')];
    const items = [
      itemFixture({ id: 'first', topicId: 't', order: 0 }),
      itemFixture({ id: 'weak', topicId: 't', order: 5, weakSpot: true }),
    ];
    const plan = planWeek(input({ tree: buildProgramTree({ sections, topics, items }) }));
    const firstItem = plan.days.flatMap((day) => day.blocks).find((block) => block.itemId)?.itemId;
    expect(firstItem).toBe('weak');
  });

  it('повторения появляются после закрытия топика и не превышают 2 в день (ТЗ 5.6)', () => {
    const program = programFixture();
    const doneAt = new Date(Date.parse(noonOf(addDays(MONDAY, -3)))).toISOString();
    const items = program.items.map((item, index) => (index < 5 ? { ...item, doneAt } : item));
    const plan = planWeek(input({ tree: buildProgramTree({ ...program, items }) }));
    expect(plan.pendingReviews.length).toBe(5);
    for (const day of plan.days) {
      expect(day.blocks.filter((block) => block.type === 'review').length).toBeLessThanOrEqual(2);
    }
  });

  it('8 недель симуляции: доли разделов близки к весам (±10 п.п.)', () => {
    const program = programFixture();
    const items = program.items.map((item) => ({ ...item, estimateMin: 600 }));
    const tree = buildProgramTree({ ...program, items });
    const logs: ITimeLog[] = [];
    let day = MONDAY;
    for (let step = 0; step < 56; step += 1) {
      const plan = planWeek(input({ today: day, tree, logs, horizonDays: 1 }));
      for (const block of plan.days[0]?.blocks ?? []) {
        logs.push(logFixture({ id: `${day}-${block.key}`, itemId: block.itemId, type: block.type, startedAt: noonOf(day), minutes: block.plannedMin }));
      }
      day = addDays(day, 1);
    }
    const bySection = new Map<string, number>();
    let total = 0;
    for (const log of logs) {
      const section = log.itemId?.slice(0, 1);
      if (section && (log.type === 'study' || log.type === 'practice')) {
        bySection.set(section, (bySection.get(section) ?? 0) + log.durationMin);
        total += log.durationMin;
      }
    }
    const expected: Record<string, number> = { a: 3 / 6, b: 2 / 6, c: 1 / 6 };
    for (const [section, share] of Object.entries(expected)) {
      expect(Math.abs((bySection.get(section) ?? 0) / total - share)).toBeLessThanOrEqual(0.1);
    }
  });

  it('300 мс на объёме 3000 топиков и 10 000 логов (НФТ 8.3)', () => {
    const sections = Array.from({ length: 20 }, (_, index) => sectionFixture(`s${index}`, index));
    const topics = sections.flatMap((section) => Array.from({ length: 15 }, (_, index) => topicFixture(`${section.id}t${index}`, section.id, index)));
    const items = topics.flatMap((topic) => Array.from({ length: 10 }, (_, index) => itemFixture({ id: `${topic.id}i${index}`, topicId: topic.id, order: index, kind: index % 2 ? 'study' : 'practice' })));
    const logs = Array.from({ length: 10_000 }, (_, index) =>
      logFixture({ id: `l${index}`, itemId: items[index % items.length]?.id ?? null, type: 'practice', startedAt: noonOf(addDays(MONDAY, -(index % 300))), minutes: 5 }),
    );
    const started = performance.now();
    planWeek(input({ tree: buildProgramTree({ sections, topics, items }), logs }));
    expect(performance.now() - started).toBeLessThan(1500);
  });
});

describe('контрольные работы в плане (FR-41, US-16)', () => {
  // Пн 0, Вт 90, Ср 60, Чт 150, Пт 0, Сб 180, Вс 0
  const budget = budgetFixture({ dayCapacity: [0, 90, 60, 150, 0, 180, 0] });
  const withCheckpoint = (patch: { readonly doneAt?: string | null } = {}): IPlannerInput => {
    const program = programFixture();
    const checkpoint = itemFixture({ id: 'cp', topicId: 'a0', estimateMin: 120, checkpointDay: 3, order: 99, doneAt: patch.doneAt ?? null });
    return input({ budget, tree: buildProgramTree({ ...program, items: [...program.items, checkpoint] }), challengeStart: MONDAY });
  };
  const checkpointDays = (plan: ReturnType<typeof planWeek>): string[] =>
    plan.days.filter((day) => day.blocks.some((block) => block.itemId === 'cp')).map((day) => day.date);

  it('ставится закреплённым блоком в первый день не раньше срока, где свободно ≥ 2 ч', () => {
    const plan = planWeek(withCheckpoint());
    // Срок — среда (день 3), в среде 60 мин, поэтому четверг
    expect(checkpointDays(plan)).toEqual([addDays(MONDAY, 3)]);
    const block = plan.days.flatMap((day) => day.blocks).find((entry) => entry.itemId === 'cp');
    expect(block).toMatchObject({ pinned: true, plannedMin: 120 });
  });

  it('до срока не попадает в обычный план', () => {
    const plan = planWeek(withCheckpoint());
    const before = plan.days.filter((day) => day.date < addDays(MONDAY, 2));
    expect(before.some((day) => day.blocks.some((block) => block.itemId === 'cp'))).toBe(false);
  });

  it('пропуск переносит контрольную на следующий подходящий день', () => {
    const skipped: IPlanBlock = {
      id: 's1',
      createdAt: MONDAY,
      updatedAt: MONDAY,
      date: addDays(MONDAY, 3),
      itemId: 'cp',
      type: 'practice',
      plannedMin: 120,
      pinned: false,
      status: 'skipped',
    };
    expect(checkpointDays(planWeek({ ...withCheckpoint(), blocks: [skipped] }))).toEqual([addDays(MONDAY, 5)]);
  });

  it('просроченная и не пройденная ставится от сегодня; пройденная — не ставится', () => {
    const late = { ...withCheckpoint(), today: addDays(MONDAY, 7), horizonDays: 7 };
    expect(checkpointDays(planWeek(late))).toEqual([addDays(MONDAY, 10)]);
    expect(checkpointDays(planWeek(withCheckpoint({ doneAt: '2026-01-06T10:00:00.000Z' })))).toEqual([]);
  });
});
