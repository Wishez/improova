import type { IEntity } from './entity';
import type { IGuideLink } from './guide';

export interface IRouteArtist {
  readonly name: string;
  /** Подборка работ в высоком разрешении. */
  readonly url: string;
  /** Что забираешь себе у художника. */
  readonly takeaway: string;
  /** Конкретные работы для просмотра. */
  readonly works: string;
}

/** Блок маршрута по мастерам (FR-39): пара художников и копия на отрезок недель. */
export interface IRouteBlock extends IEntity {
  readonly order: number;
  /** Недели челленджа, с 1, включительно. */
  readonly fromWeek: number;
  readonly toWeek: number;
  readonly artists: readonly IRouteArtist[];
  readonly copyTask: string;
  readonly copyTechnique: string;
  readonly links: readonly IGuideLink[];
}
