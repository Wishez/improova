import type { IBudget, IChallenge, IRouteBlock, ISection } from '../types';
import { addDays, diffDays, weekdayIndex } from '../utils';
import { QUARTER_THEMES, WEEKS_PER_QUARTER, challengeWeek, quarterOfWeek } from './course';
import type { IDayPlan } from './planner';

/** Выполнен — факт ≥ 80% плана (ТЗ: неделя в ритме считается так же). */
export const DONE_SHARE = 0.8;
export const MILESTONE_DAY = 66;

export type TCalendarState = 'done' | 'partial' | 'missed' | 'off' | 'today' | 'planned' | 'projected';

export type TCalendarMarkerKind = 'quarter' | 'route' | 'milestone' | 'checkpoint' | 'eta' | 'end';

/** Контрольная работа на календаре (FR-41): день челленджа с 1. */
export interface ICalendarCheckpoint {
  readonly day: number;
  readonly label: string;
  readonly done: boolean;
}

export interface ICalendarMarker {
  readonly kind: TCalendarMarkerKind;
  readonly label: string;
}

export interface ISectionMinutes {
  readonly sectionId: string | null;
  readonly minutes: number;
}

export interface ICalendarDay {
  readonly date: string;
  readonly state: TCalendarState;
  readonly planMin: number;
  readonly factMin: number;
  /** Только для прогнозных дней: минуты по разделам; null — творчество. */
  readonly bySection: readonly ISectionMinutes[];
  readonly markers: readonly ICalendarMarker[];
}

export interface ICalendarInput {
  readonly challenge: IChallenge;
  readonly budget: IBudget;
  readonly today: string;
  /** Коэффициент урезания бюджета из планировщика. */
  readonly scale: number;
  readonly factByDay: ReadonlyMap<string, number>;
  /** План, зафиксированный в сам день; нет записи — ёмкость дня × масштаб. */
  readonly dayPlans: Readonly<Record<string, number>>;
  /** Дни горизонта планировщика, начиная с сегодня. */
  readonly planDays: readonly IDayPlan[];
  readonly sections: readonly ISection[];
  readonly remainingBySection: ReadonlyMap<string, number>;
  readonly weightsForQuarter: (quarter: number) => ReadonlyMap<string, number>;
  readonly routeBlocks: readonly IRouteBlock[];
  /** Контрольные работы; нет — без отметок. */
  readonly checkpoints?: readonly ICalendarCheckpoint[];
}

function pastState(planMin: number, factMin: number): TCalendarState {
  if (planMin <= 0) {
    return factMin > 0 ? 'done' : 'off';
  }
  if (factMin >= planMin * DONE_SHARE) {
    return 'done';
  }
  return factMin > 0 ? 'partial' : 'missed';
}

/**
 * Календарь всего челленджа (FR-36). Прошлое — факт против ёмкости дня, горизонт — блоки планировщика,
 * дальше — прогноз минут по разделам с учётом квартальных весов и остатка программы.
 */
export function buildCalendar(input: ICalendarInput): ICalendarDay[] {
  const { challenge, budget, today, scale } = input;
  const total = Math.max(0, diffDays(challenge.startDate, challenge.endDate));
  const planByDate = new Map(input.planDays.map((day) => [day.date, day]));
  const horizonEnd = input.planDays.length > 0 ? (input.planDays[input.planDays.length - 1]?.date ?? today) : today;

  const wanted = budget.studyMinPerWeek + budget.practiceMinPerWeek;
  const itemsShare = wanted > 0 ? (budget.studyMinPerWeek + budget.practiceMinPerWeek * (1 - budget.creativeShare)) / wanted : 0;
  const remaining = new Map(input.remainingBySection);
  const sectionTitle = new Map(input.sections.map((section) => [section.id, section.title]));
  const etaMarked = new Set<string>();

  const markersOf = (date: string, index: number): ICalendarMarker[] => {
    const markers: ICalendarMarker[] = [];
    if (index % (WEEKS_PER_QUARTER * 7) === 0) {
      const quarter = quarterOfWeek(challengeWeek(challenge.startDate, date));
      if (index / (WEEKS_PER_QUARTER * 7) < 4) {
        markers.push({ kind: 'quarter', label: `Q${quarter}: ${QUARTER_THEMES[quarter - 1] ?? ''}` });
      }
    }
    if (index % 7 === 0) {
      const week = challengeWeek(challenge.startDate, date);
      const block = input.routeBlocks.find((entry) => !entry.deletedAt && entry.fromWeek === week);
      if (block) {
        markers.push({ kind: 'route', label: `Мастера: ${block.artists.map((artist) => artist.name).join(' + ')}` });
      }
    }
    if (index === MILESTONE_DAY - 1) {
      markers.push({ kind: 'milestone', label: `День ${MILESTONE_DAY}` });
    }
    for (const checkpoint of input.checkpoints ?? []) {
      if (checkpoint.day - 1 === index) {
        markers.push({ kind: 'checkpoint', label: `${checkpoint.label}${checkpoint.done ? ' — пройдена' : ''}` });
      }
    }
    if (index === total) {
      markers.push({ kind: 'end', label: 'Финал челленджа' });
    }
    return markers;
  };

  const days: ICalendarDay[] = [];
  for (let index = 0; index <= total; index += 1) {
    const date = addDays(challenge.startDate, index);
    const capacity = Math.round((budget.dayCapacity[weekdayIndex(date)] ?? 0) * scale);
    const factMin = input.factByDay.get(date) ?? 0;
    const markers = markersOf(date, index);
    if (date < today) {
      const planMin = input.dayPlans[date] ?? capacity;
      days.push({ date, state: pastState(planMin, factMin), planMin, factMin, bySection: [], markers });
      continue;
    }
    const planned = planByDate.get(date);
    if (planned) {
      const state: TCalendarState = date === today ? 'today' : planned.capacity > 0 ? 'planned' : 'off';
      days.push({ date, state, planMin: planned.planned, factMin, bySection: [], markers });
      continue;
    }
    if (date <= horizonEnd) {
      days.push({ date, state: 'off', planMin: 0, factMin, bySection: [], markers });
      continue;
    }
    // Прогноз: минуты дня делятся по разделам с остатком пропорционально весу квартала
    const quarter = quarterOfWeek(challengeWeek(challenge.startDate, date));
    const weights = input.weightsForQuarter(quarter);
    const open = [...remaining.entries()].filter(([, minutes]) => minutes > 0);
    const weightSum = open.reduce((sum, [id]) => sum + (weights.get(id) ?? 1), 0);
    const itemMinutes = capacity * itemsShare;
    const bySection: ISectionMinutes[] = [];
    for (const [id, left] of open) {
      const share = weightSum > 0 ? ((weights.get(id) ?? 1) / weightSum) * itemMinutes : 0;
      const minutes = Math.min(left, share);
      if (minutes <= 0) {
        continue;
      }
      bySection.push({ sectionId: id, minutes: Math.round(minutes) });
      const rest = left - minutes;
      remaining.set(id, rest);
      if (rest <= 0 && !etaMarked.has(id)) {
        etaMarked.add(id);
        markers.push({ kind: 'eta', label: `${sectionTitle.get(id) ?? 'Раздел'}: прогноз завершения` });
      }
    }
    const creative = capacity > 0 ? Math.round(capacity - capacity * itemsShare) : 0;
    if (creative > 0) {
      bySection.push({ sectionId: null, minutes: creative });
    }
    const planMin = bySection.reduce((sum, entry) => sum + entry.minutes, 0);
    days.push({ date, state: planMin > 0 ? 'projected' : 'off', planMin, factMin: 0, bySection, markers });
  }
  return days;
}

export interface ICalendarCell {
  readonly date: string;
  /** null — день вне периода челленджа. */
  readonly day: ICalendarDay | null;
}

export interface ICalendarMonth {
  /** Ключ месяца YYYY-MM. */
  readonly key: string;
  /** Пустые ячейки перед первым числом (Пн = 0). */
  readonly lead: number;
  readonly cells: readonly ICalendarCell[];
}

/** Полные календарные месяцы периода для сетки Пн–Вс; дни вне периода — пустые. */
export function calendarMonths(days: readonly ICalendarDay[]): ICalendarMonth[] {
  const first = days[0];
  const last = days[days.length - 1];
  if (!first || !last) {
    return [];
  }
  const byDate = new Map(days.map((day) => [day.date, day]));
  const months: ICalendarMonth[] = [];
  let cursor = `${first.date.slice(0, 7)}-01`;
  while (cursor <= last.date) {
    const key = cursor.slice(0, 7);
    const cells: ICalendarCell[] = [];
    for (let date = cursor; date.startsWith(key); date = addDays(date, 1)) {
      cells.push({ date, day: byDate.get(date) ?? null });
    }
    months.push({ key, lead: weekdayIndex(cursor), cells });
    cursor = addDays(cursor, cells.length);
  }
  return months;
}
