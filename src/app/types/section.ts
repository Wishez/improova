import type { IEntity } from './entity';

export type TSectionWeight = 1 | 2 | 3;

export interface ISection extends IEntity {
  readonly title: string;
  /** Номер цветового токена section-1…6. */
  readonly colorToken: number;
  readonly order: number;
  readonly weight: TSectionWeight;
  readonly archived: boolean;
}
