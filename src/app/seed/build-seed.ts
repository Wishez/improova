import { planCourseUpdate } from '../domain';
import type { IItem, IResource, IRouteBlock, ISection, ITopic } from '../types';
import { createId } from '../utils';
import { COURSE } from './course';

export interface ISeedResult {
  readonly sections: ISection[];
  readonly topics: ITopic[];
  readonly items: IItem[];
  readonly resources: IResource[];
  readonly routeBlocks: IRouteBlock[];
}

/** Стартовая программа (ТЗ 9, FR-01): курс текущей версии, применённый к пустым данным. */
export function buildSeed(nowIso: string): ISeedResult {
  const plan = planCourseUpdate({
    data: { sections: [], topics: [], items: [], resources: [], routeBlocks: [], timeLogs: [] },
    course: COURSE,
    dismissedKeys: [],
    activeItemId: null,
    currentWeek: 1,
    nowIso,
    createId: () => createId(),
  });
  return {
    sections: [...plan.puts.sections],
    topics: [...plan.puts.topics],
    items: [...plan.puts.items],
    resources: [...plan.puts.resources],
    routeBlocks: [...plan.puts.routeBlocks],
  };
}
