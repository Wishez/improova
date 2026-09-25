import type { IEntity } from './entity';
import type { IGuide } from './guide';

export type TItemKind = 'study' | 'practice';

/** Роль повторяющегося топика в маршруте по мастерам (FR-39). */
export type TRouteRole = 'study' | 'copy';

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
  readonly guide: IGuide | null;
  readonly routeRole: TRouteRole | null;
  /** Ключ курса (FR-44): стабильный идентификатор стартовой сущности; null — своя. */
  readonly courseKey: string | null;
  /** Отпечаток полей курса при последней синхронизации: отличие от текущих полей — правки пользователя. */
  readonly courseHash: string | null;
  /** День челленджа контрольной работы (FR-41); null — обычный топик. */
  readonly checkpointDay: number | null;
}
