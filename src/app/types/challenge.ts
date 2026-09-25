import type { IEntity } from './entity';

export interface IChallenge extends IEntity {
  readonly title: string;
  /** Дата старта, YYYY-MM-DD. */
  readonly startDate: string;
  /** Дата окончания, YYYY-MM-DD. */
  readonly endDate: string;
}
