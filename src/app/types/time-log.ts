import type { IEntity } from './entity';
import type { TSessionType } from './plan-block';

export type TLogSource = 'timer' | 'manual';

export interface ITimeLog extends IEntity {
  /** null — сессия творчества без топика. */
  readonly itemId: string | null;
  readonly type: TSessionType;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly durationMin: number;
  readonly source: TLogSource;
  readonly editedAt: string | null;
}
