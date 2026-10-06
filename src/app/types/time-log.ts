import type { IEntity } from './entity';
import type { ILogSteps } from './log-steps';
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
  /**
   * Шаги ориентира за сессию (FR-56, ADR-007). null или нет поля — «без шагов»: ручной лог, лог до 1.6,
   * сессия без ориентира; такой лог место остановки не задаёт (FR-65).
   */
  readonly steps?: ILogSteps | null;
}
