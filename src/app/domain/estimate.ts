import type { IItem, IResource, TResourceType } from '../types';
import { clamp } from '../utils';

/** Калибровка оценок k_type (ТЗ 5.2): медиана «факт / оценка» по 10 последним закрытым топикам типа. */
export function calibration(params: {
  readonly items: readonly IItem[];
  readonly resources: ReadonlyMap<string, IResource>;
  readonly spent: ReadonlyMap<string, number>;
}): ReadonlyMap<TResourceType, number> {
  const ratios = new Map<TResourceType, { at: string; ratio: number }[]>();
  for (const item of params.items) {
    const type = resourceTypeOf(item, params.resources);
    const spentMin = params.spent.get(item.id) ?? 0;
    if (!type || !item.doneAt || item.estimateMin <= 0 || spentMin <= 0) {
      continue;
    }
    ratios.set(type, [...(ratios.get(type) ?? []), { at: item.doneAt, ratio: spentMin / item.estimateMin }]);
  }
  const result = new Map<TResourceType, number>();
  for (const [type, list] of ratios) {
    if (list.length < 3) {
      continue;
    }
    const last = [...list].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 10).map((entry) => entry.ratio);
    result.set(type, clamp(median(last), 0.5, 3));
  }
  return result;
}

export function resourceTypeOf(item: IItem, resources: ReadonlyMap<string, IResource>): TResourceType | null {
  const ref = item.resourceRefs[0];
  return ref ? (resources.get(ref.resourceId)?.type ?? null) : null;
}

export function median(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2 : (sorted[middle] ?? 0);
}

/** Остаток R_i: никогда не ноль, пока нет галочки (ТЗ 5.2). */
export function remainingMinutes(params: {
  readonly estimateMin: number;
  readonly spentMin: number;
  readonly factor: number;
  readonly blockMin: number;
}): number {
  const scaled = params.estimateMin * params.factor;
  return Math.max(scaled - params.spentMin, Math.max(params.blockMin, 0.25 * scaled));
}

/** Расчётная оценка по ресурсу: единицы × минут на единицу (ТЗ 5.2). */
export function estimateFromResource(resource: IResource, units: number): number {
  return Math.max(5, Math.round((units * resource.minPerUnit) / 5) * 5);
}
