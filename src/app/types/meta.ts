import type { IEntity } from './entity';
import type { TSessionType } from './plan-block';

export interface ITimerState {
  readonly itemId: string | null;
  readonly type: TSessionType;
  readonly startedAt: string;
  readonly pausedAt: string | null;
  readonly pausedMs: number;
  readonly plannedMin: number;
}

export interface ISettings {
  readonly dayBoundaryHour: number;
  /** IANA-пояс отображения; пустая строка — пояс устройства. */
  readonly timeZone: string;
  readonly reviewWeekday: number;
  readonly sound: boolean;
  readonly phases: boolean;
  readonly tipsEnabled: boolean;
  readonly disabledTips: readonly string[];
}

export interface ITipStats {
  /** Сколько раз подсказку закрыли без действия. */
  readonly ignored: Readonly<Record<string, number>>;
  /** Дата → id показанных подсказок. */
  readonly shownOn: Readonly<Record<string, readonly string[]>>;
}

/** Служебная запись приложения (одна на ключ). */
export interface IMeta extends IEntity {
  readonly onboarded: boolean;
  readonly timer: ITimerState | null;
  readonly settings: ISettings;
  readonly tips: ITipStats;
  readonly milestonesShown: readonly string[];
  readonly lastExportAt: string | null;
  readonly expanded: readonly string[];
}
