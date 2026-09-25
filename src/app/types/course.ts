import type { IGuide, IGuideLink, TLinkAccess } from './guide';
import type { TItemKind, TRouteRole } from './item';
import type { TResourceType, TResourceUnit } from './resource';
import type { IRouteArtist } from './route-block';
import type { TSectionWeight } from './section';

/** Курс в релизе (FR-44, FR-45): плоская структура с ключами, без id хранилища. */

export interface ICourseSection {
  readonly key: string;
  readonly title: string;
  readonly order: number;
  readonly weight: TSectionWeight;
  readonly quarterWeights: readonly TSectionWeight[];
}

export interface ICourseTopic {
  readonly key: string;
  readonly sectionKey: string;
  readonly title: string;
  readonly description: string;
  readonly order: number;
}

export interface ICourseItem {
  readonly key: string;
  readonly topicKey: string;
  readonly order: number;
  readonly title: string;
  readonly kind: TItemKind;
  readonly estimateMin: number;
  readonly resourceKey: string | null;
  readonly range: string;
  readonly recurrenceWeeks: number | null;
  readonly selfCheck: string;
  readonly guide: IGuide;
  readonly routeRole: TRouteRole | null;
  readonly checkpointDay: number | null;
}

export interface ICourseResource {
  readonly key: string;
  readonly title: string;
  readonly type: TResourceType;
  readonly author: string;
  readonly url: string;
  readonly unit: TResourceUnit;
  readonly unitCount: number;
  readonly minPerUnit: number;
  readonly access: TLinkAccess;
  readonly freeAlternativeUrl: string;
}

export interface ICourseRouteBlock {
  readonly key: string;
  readonly order: number;
  readonly fromWeek: number;
  readonly toWeek: number;
  readonly artists: readonly IRouteArtist[];
  readonly copyTask: string;
  readonly copyTechnique: string;
  readonly links: readonly IGuideLink[];
}

/** Запись журнала «Что нового» одной версии курса. */
export interface ICourseRelease {
  readonly version: number;
  readonly date: string;
  readonly notes: readonly string[];
  /** Ключи сущностей, убранных из курса в этой версии: ключ не переиспользуется. */
  readonly removedKeys: readonly string[];
}

export interface ICourse {
  readonly version: number;
  readonly sections: readonly ICourseSection[];
  readonly topics: readonly ICourseTopic[];
  readonly items: readonly ICourseItem[];
  readonly resources: readonly ICourseResource[];
  readonly routeBlocks: readonly ICourseRouteBlock[];
  readonly releases: readonly ICourseRelease[];
}
