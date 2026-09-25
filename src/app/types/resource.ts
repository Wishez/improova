import type { IEntity } from './entity';

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
}
