import type { IEntity } from './entity';

export type TItemKind = 'study' | 'practice';

export interface IResourceRef {
  readonly resourceId: string;
  /** Диапазон внутри ресурса: «гл. 1–3», «уроки 4–6». */
  readonly range: string;
  /** Сколько единиц ресурса покрывает топик. */
  readonly units: number;
}

export interface IItem extends IEntity {
  readonly topicId: string;
  readonly title: string;
  readonly kind: TItemKind;
  readonly estimateMin: number;
  readonly resourceRefs: readonly IResourceRef[];
  readonly weakSpot: boolean;
  /** Повторяющийся топик: раз в N недель; null — разовый. */
  readonly recurrenceWeeks: number | null;
  readonly selfCheck: string;
  readonly order: number;
  readonly doneAt: string | null;
  readonly archived: boolean;
}
