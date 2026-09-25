import type { IEntity } from './entity';

export type TSessionType = 'study' | 'practice' | 'creative' | 'review';

export type TPlanBlockStatus = 'planned' | 'skipped';

/** Сохраняются только блоки, которые трогал пользователь: закреплённые и пропущенные (ADR-3). */
export interface IPlanBlock extends IEntity {
  readonly date: string;
  /** null — блок творчества без топика. */
  readonly itemId: string | null;
  readonly type: TSessionType;
  readonly plannedMin: number;
  readonly pinned: boolean;
  readonly status: TPlanBlockStatus;
}
