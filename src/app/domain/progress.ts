import type { IItem } from '../types';
import { isCountable, type IProgramTree } from './program';

export type TProgressStatus = 'todo' | 'inProgress' | 'done';

export interface IProgress {
  readonly doneMin: number;
  readonly totalMin: number;
  readonly doneCount: number;
  readonly totalCount: number;
  /** Доля, взвешенная по оценке (ТЗ 3, правило 3; Q1). */
  readonly ratio: number;
  readonly status: TProgressStatus;
}

const EMPTY: IProgress = { doneMin: 0, totalMin: 0, doneCount: 0, totalCount: 0, ratio: 0, status: 'todo' };

export function progressOfItems(items: readonly IItem[], spent: ReadonlyMap<string, number>): IProgress {
  const countable = items.filter(isCountable);
  if (countable.length === 0) {
    return EMPTY;
  }
  let doneMin = 0;
  let totalMin = 0;
  let doneCount = 0;
  let touched = false;
  for (const item of countable) {
    const weight = Math.max(1, item.estimateMin);
    totalMin += weight;
    if (item.doneAt) {
      doneMin += weight;
      doneCount += 1;
    } else if ((spent.get(item.id) ?? 0) > 0) {
      touched = true;
    }
  }
  const status: TProgressStatus =
    doneCount === countable.length ? 'done' : doneCount > 0 || touched ? 'inProgress' : 'todo';
  return { doneMin, totalMin, doneCount, totalCount: countable.length, ratio: doneMin / totalMin, status };
}

export function topicItems(tree: IProgramTree, topicId: string): readonly IItem[] {
  return tree.itemsByTopic.get(topicId) ?? [];
}

export function sectionItems(tree: IProgramTree, sectionId: string): readonly IItem[] {
  return (tree.topicsBySection.get(sectionId) ?? []).flatMap((topic) => topicItems(tree, topic.id));
}

export function allItems(tree: IProgramTree): readonly IItem[] {
  return [...tree.itemById.values()];
}
