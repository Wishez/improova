import type { IEntity } from './entity';

export interface ITopic extends IEntity {
  readonly sectionId: string;
  readonly title: string;
  /** Пояснение в markdown. */
  readonly description: string;
  readonly order: number;
  readonly archived: boolean;
}
