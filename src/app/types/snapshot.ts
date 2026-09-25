import type { IAsset } from './asset';
import type { IBudget } from './budget';
import type { IChallenge } from './challenge';
import type { IItem } from './item';
import type { IMeta } from './meta';
import type { INote } from './note';
import type { IPlanBlock } from './plan-block';
import type { IResource } from './resource';
import type { ISection } from './section';
import type { ITimeLog } from './time-log';
import type { ITopic } from './topic';

export interface ICollections {
  challenges: IChallenge[];
  budgets: IBudget[];
  sections: ISection[];
  topics: ITopic[];
  items: IItem[];
  resources: IResource[];
  planBlocks: IPlanBlock[];
  timeLogs: ITimeLog[];
  notes: INote[];
  assets: IAsset[];
  meta: IMeta[];
}

export type TCollection = keyof ICollections;

export type TSnapshotKind = 'full' | 'program';

export interface ISnapshot {
  readonly app: 'improva';
  readonly kind: TSnapshotKind;
  readonly schemaVersion: number;
  readonly exportedAt: string;
  readonly data: Partial<ICollections>;
}

export interface IImportReport {
  readonly added: number;
  readonly updated: number;
  readonly total: number;
}
