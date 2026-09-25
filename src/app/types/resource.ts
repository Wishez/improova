import type { IEntity } from './entity';
import type { TLinkAccess } from './guide';

export type TResourceType = 'book' | 'course' | 'video' | 'article' | 'exercise' | 'tool';

export type TResourceUnit = 'page' | 'lesson' | 'minute' | 'piece';

export interface IResource extends IEntity {
  readonly title: string;
  readonly type: TResourceType;
  readonly author: string;
  readonly url: string;
  readonly unit: TResourceUnit;
  readonly unitCount: number;
  readonly minPerUnit: number;
  readonly archived: boolean;
  /** Доступ (FR-43): общественное достояние, бесплатно или платно. */
  readonly access: TLinkAccess;
  /** Легальная бесплатная замена платного ресурса; пустая строка — нет. */
  readonly freeAlternativeUrl: string;
  /** Ключ курса (FR-44): стабильный идентификатор стартовой сущности; null — своя. */
  readonly courseKey: string | null;
}
