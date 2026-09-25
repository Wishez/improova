import type { IGuide, IGuideStep, IItem, IRouteArtist, IRouteBlock, ISection } from '../types';
import { diffDays } from '../utils';

export const WEEKS_PER_QUARTER = 13;

/** Темы кварталов из годового маршрута курса. */
export const QUARTER_THEMES: readonly string[] = ['Линия и пространство', 'Тон и композиция', 'Цвет', 'Живопись'];

/** Вопросы к анализу — одинаковы для всех художников маршрута. */
export const ANALYSIS_QUESTIONS: readonly string[] = [
  'Где самое светлое и самое тёмное пятно и почему они рядом или далеко?',
  'Сколько уровней тона на самом деле — 3, 5 или 9?',
  'Где края жёсткие, где потерянные?',
  'Как движется взгляд от первого пятна до последнего?',
  'Что художник намеренно не дорисовал?',
];

/** Неделя челленджа с 1: первая неделя начинается в день старта. */
export function challengeWeek(startDate: string, day: string): number {
  return Math.floor(diffDays(startDate, day) / 7) + 1;
}

/** Квартал 1–4 по неделе; недели после 52-й (продление) относятся к Q4. */
export function quarterOfWeek(week: number): number {
  return Math.min(4, Math.max(1, Math.ceil(week / WEEKS_PER_QUARTER)));
}

/** Вес раздела в квартале (FR-40); без квартальных весов — общий вес раздела. */
export function sectionWeightIn(params: { readonly section: ISection; readonly quarter: number; readonly seasonal: boolean }): number {
  const { section, quarter, seasonal } = params;
  if (!seasonal || !section.quarterWeights) {
    return section.weight;
  }
  return section.quarterWeights[quarter - 1] ?? section.weight;
}

export function sectionWeightsFor(params: {
  readonly sections: readonly ISection[];
  readonly quarter: number;
  readonly seasonal: boolean;
}): Map<string, number> {
  return new Map(
    params.sections.map((section) => [section.id, sectionWeightIn({ section, quarter: params.quarter, seasonal: params.seasonal })]),
  );
}

export interface IRouteFocus {
  readonly block: IRouteBlock;
  readonly artist: IRouteArtist | null;
  /** Первая неделя блока — время для копии. */
  readonly copyWeek: boolean;
}

/** Блок маршрута и художник недели: нечётная неделя блока — первый художник, чётная — второй (FR-39). */
export function routeFocus(blocks: readonly IRouteBlock[], week: number): IRouteFocus | null {
  const block = blocks.find((entry) => !entry.deletedAt && week >= entry.fromWeek && week <= entry.toWeek);
  if (!block) {
    return null;
  }
  const offset = week - block.fromWeek;
  return { block, artist: block.artists[offset % 2] ?? block.artists[0] ?? null, copyWeek: offset === 0 };
}

/** Название повторяющегося топика маршрута с учётом недели (FR-39, US-11). */
export function routeTitle(item: Pick<IItem, 'title' | 'routeRole'>, focus: IRouteFocus | null): string {
  if (item.routeRole === 'study') {
    return focus?.artist ? `Изучение: ${focus.artist.name}` : 'Изучение художника по выбору';
  }
  if (item.routeRole === 'copy') {
    return focus ? `Копия: ${focus.block.copyTask}` : 'Копия по выбору';
  }
  return item.title;
}

/** Пропорционально масштабирует шаги под длину блока, сумма равна plannedMin (FR-38). */
export function scaleSteps(steps: readonly IGuideStep[], plannedMin: number): number[] {
  const total = steps.reduce((sum, entry) => sum + entry.minutes, 0);
  if (total <= 0 || plannedMin <= 0) {
    return steps.map((entry) => entry.minutes);
  }
  const raw = steps.map((entry) => (entry.minutes / total) * plannedMin);
  const rounded = raw.map((value) => Math.max(1, Math.floor(value)));
  let rest = plannedMin - rounded.reduce((sum, value) => sum + value, 0);
  const order = raw.map((value, index) => ({ index, frac: value - Math.floor(value) })).sort((a, b) => b.frac - a.frac);
  for (let cursor = 0; rest > 0 && order.length > 0; cursor = (cursor + 1) % order.length) {
    const target = order[cursor];
    if (target) {
      rounded[target.index] = (rounded[target.index] ?? 0) + 1;
      rest -= 1;
    }
  }
  return rounded;
}

export const GUIDE_LIMITS = { goal: 200, stepsMin: 1, stepsMax: 8, stepMinutesMax: 240, links: 10, references: 10, pitfalls: 5, photos: 4 } as const;

export type TGuideField = 'goal' | 'steps' | 'links' | 'references' | 'pitfalls';

export const EMPTY_GUIDE: IGuide = {
  goal: '',
  task: '',
  steps: [],
  stopCriterion: '',
  links: [],
  references: [],
  imageIds: [],
  pitfalls: [],
};

const isHttpUrl = (url: string): boolean => /^https?:\/\/\S+$/i.test(url.trim());

/** Проверка ориентира перед сохранением (правила полей, ТЗ 1.2). Пустой url у референса допустим. */
export function validateGuide(guide: IGuide): Partial<Record<TGuideField, string>> {
  const errors: Partial<Record<TGuideField, string>> = {};
  if (guide.goal.trim().length === 0) {
    errors.goal = 'Опиши цель одной фразой.';
  } else if (guide.goal.length > GUIDE_LIMITS.goal) {
    errors.goal = `Цель — до ${GUIDE_LIMITS.goal} символов.`;
  }
  if (guide.steps.length < GUIDE_LIMITS.stepsMin || guide.steps.length > GUIDE_LIMITS.stepsMax) {
    errors.steps = `Нужно от ${GUIDE_LIMITS.stepsMin} до ${GUIDE_LIMITS.stepsMax} шагов.`;
  } else if (
    guide.steps.some(
      (entry) => entry.title.trim() === '' || !Number.isInteger(entry.minutes) || entry.minutes < 1 || entry.minutes > GUIDE_LIMITS.stepMinutesMax,
    )
  ) {
    errors.steps = `У каждого шага название и целые минуты от 1 до ${GUIDE_LIMITS.stepMinutesMax}.`;
  }
  if (guide.links.length > GUIDE_LIMITS.links) {
    errors.links = `Ссылок — не больше ${GUIDE_LIMITS.links}.`;
  } else if (guide.links.some((entry) => entry.title.trim() === '' || !isHttpUrl(entry.url))) {
    errors.links = 'Ссылка должна начинаться с https:// и иметь название.';
  }
  if (guide.references.length > GUIDE_LIMITS.references) {
    errors.references = `Референсов — не больше ${GUIDE_LIMITS.references}.`;
  } else if (guide.references.some((entry) => entry.title.trim() === '' || (entry.url.trim() !== '' && !isHttpUrl(entry.url)))) {
    errors.references = 'Ссылка должна начинаться с https:// и иметь название.';
  }
  if (guide.pitfalls.length > GUIDE_LIMITS.pitfalls) {
    errors.pitfalls = `Ловушек — не больше ${GUIDE_LIMITS.pitfalls}.`;
  }
  return errors;
}

export function stepsTotal(guide: Pick<IGuide, 'steps'>): number {
  return guide.steps.reduce((sum, entry) => sum + entry.minutes, 0);
}
