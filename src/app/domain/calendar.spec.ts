import { describe, expect, it } from 'vitest';
import type { IChallenge, IRouteBlock } from '../types';
import { buildCalendar, calendarMonths, type ICalendarInput } from './calendar';
import type { IDayPlan } from './planner';
import { budgetFixture, sectionFixture } from './test-fixtures';

const NOW = '2026-01-01T00:00:00.000Z';

const challenge: IChallenge = {
  id: 'challenge',
  createdAt: NOW,
  updatedAt: NOW,
  title: 'Годовой челлендж',
  startDate: '2026-10-01',
  endDate: '2027-09-30',
};

// Пн 0, Вт 90, Ср 120, Чт 90, Пт 90, Сб 180, Вс 0
const budget = budgetFixture({ studyMinPerWeek: 150, practiceMinPerWeek: 330, creativeShare: 0.3, dayCapacity: [0, 90, 120, 90, 90, 180, 0] });

const planDay = (date: string, planned: number, capacity = planned): IDayPlan => ({ date, capacity, planned, logged: 0, blocks: [] });

const route: IRouteBlock = {
  id: 'r1',
  createdAt: NOW,
  updatedAt: NOW,
  order: 0,
  fromWeek: 1,
  toWeek: 4,
  artists: [
    { name: 'Дюрер', url: '', takeaway: '', works: '' },
    { name: 'Хокусай', url: '', takeaway: '', works: '' },
  ],
  copyTask: 'Кисть',
  copyTechnique: 'Лайнер',
  courseKey: null,
  links: [],
};

function input(patch: Partial<ICalendarInput> = {}): ICalendarInput {
  const sections = [sectionFixture('a', 0, 3), sectionFixture('b', 1, 1)];
  return {
    challenge,
    budget,
    today: '2026-10-20',
    scale: 1,
    factByDay: new Map([
      ['2026-10-16', 75],
      ['2026-10-13', 30],
    ]),
    dayPlans: {},
    planDays: [planDay('2026-10-20', 90), planDay('2026-10-21', 120), planDay('2026-10-22', 90), planDay('2026-10-23', 90), planDay('2026-10-24', 180), planDay('2026-10-25', 0, 0), planDay('2026-10-26', 0, 0)],
    sections,
    remainingBySection: new Map([
      ['a', 3000],
      ['b', 600],
    ]),
    weightsForQuarter: () => new Map([
      ['a', 3],
      ['b', 1],
    ]),
    routeBlocks: [route],
    ...patch,
  };
}

describe('календарь всего челленджа (FR-36, US-09)', () => {
  const days = buildCalendar(input());
  const day = (date: string) => days.find((entry) => entry.date === date);

  it('охватывает весь период от старта до окончания', () => {
    expect(days[0]?.date).toBe('2026-10-01');
    expect(days[days.length - 1]?.date).toBe('2027-09-30');
    expect(days.length).toBe(365);
  });

  it('прошлый день: 75 из 90 — выполнен, 30 из 90 — частично, без логов — пропущен', () => {
    expect(day('2026-10-16')).toMatchObject({ state: 'done', planMin: 90, factMin: 75 });
    expect(day('2026-10-13')).toMatchObject({ state: 'partial', factMin: 30 });
    expect(day('2026-10-14')?.state).toBe('missed');
  });

  it('выходной с ёмкостью 0 и без логов — «выходной», а не «пропущен»', () => {
    expect(day('2026-10-12')?.state).toBe('off');
    expect(day('2026-10-18')?.state).toBe('off');
  });

  it('сегодня и горизонт 7 дней — из планировщика, дальше — прогноз по разделам', () => {
    expect(day('2026-10-20')?.state).toBe('today');
    expect(day('2026-10-21')).toMatchObject({ state: 'planned', planMin: 120 });
    const projected = day('2026-10-28');
    expect(projected?.state).toBe('projected');
    const sectionA = projected?.bySection.find((entry) => entry.sectionId === 'a')?.minutes ?? 0;
    const sectionB = projected?.bySection.find((entry) => entry.sectionId === 'b')?.minutes ?? 0;
    expect(sectionA).toBeGreaterThan(sectionB);
    expect(projected?.bySection.some((entry) => entry.sectionId === null)).toBe(true);
  });

  it('прошлое не меняется от новых настроек: зафиксированный план дня важнее ёмкости (негативный)', () => {
    const changed = buildCalendar(
      input({ budget: { ...budget, dayCapacity: [0, 90, 120, 90, 0, 180, 0] }, dayPlans: { '2026-10-16': 90 } }),
    );
    expect(changed.find((entry) => entry.date === '2026-10-16')).toMatchObject({ state: 'done', planMin: 90 });
    expect(changed.find((entry) => entry.date === '2026-11-06')?.state).toBe('off');
  });

  it('раздел закончился — отметка прогноза завершения и больше нет минут', () => {
    const small = buildCalendar(input({ remainingBySection: new Map([['b', 100]]) }));
    const eta = small.find((entry) => entry.markers.some((marker) => marker.kind === 'eta'));
    expect(eta).toBeDefined();
    const after = small.filter((entry) => eta && entry.date > eta.date && entry.state === 'projected');
    expect(after.every((entry) => entry.bySection.every((part) => part.sectionId === null))).toBe(true);
  });

  it('маркеры: кварталы, блок мастеров, день 66, финал', () => {
    expect(day('2026-10-01')?.markers.map((marker) => marker.kind)).toEqual(expect.arrayContaining(['quarter', 'route']));
    expect(day('2026-12-31')?.markers.some((marker) => marker.kind === 'quarter')).toBe(true);
    expect(day('2026-12-05')?.markers.some((marker) => marker.kind === 'milestone')).toBe(true);
    expect(day('2027-09-30')?.markers.some((marker) => marker.kind === 'end')).toBe(true);
  });

  it('365 дней считаются быстрее 300 мс (НФТ скорости)', () => {
    const started = performance.now();
    buildCalendar(input());
    expect(performance.now() - started).toBeLessThan(300);
  });
});

describe('сетка месяцев', () => {
  it('полные месяцы Пн–Вс; дни вне периода — пустые ячейки', () => {
    const months = calendarMonths(buildCalendar(input({ challenge: { ...challenge, startDate: '2026-10-15', endDate: '2026-11-10' } })));
    expect(months.map((month) => month.key)).toEqual(['2026-10', '2026-11']);
    const october = months[0];
    expect(october?.lead).toBe(3); // 1 октября 2026 — четверг
    expect(october?.cells.length).toBe(31);
    expect(october?.cells[0]?.day).toBeNull();
    expect(october?.cells[14]?.day?.date).toBe('2026-10-15');
    expect(months[1]?.cells[20]?.day).toBeNull();
  });
});
