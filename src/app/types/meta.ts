import type { IEntity } from './entity';
import type { TSessionType } from './plan-block';
import type { ITimerSteps } from './timer-steps';

export interface ITimerState {
  readonly itemId: string | null;
  readonly type: TSessionType;
  readonly startedAt: string;
  readonly pausedAt: string | null;
  readonly pausedMs: number;
  /** Длина сессии при старте; у сессии с шагами ориентира с 1.6 — её лимит (FR-55, ADR-007). */
  readonly plannedMin: number;
  /**
   * Текущее расписание шагов ориентира в минутах после «Следующий шаг» / «+5 мин» (1.5).
   * С 1.6 читается только при переводе таймера, запущенного до обновления (FR-65, ADR-007).
   */
  readonly stepMinutes: readonly number[] | null;
  /** Шаги ориентира идущей сессии (ADR-007); null или нет поля — сессия без шагов или таймер до 1.6 (`legacySchedule`). */
  readonly steps?: ITimerSteps | null;
  /**
   * Таймер запущен до 1.6: шаги ещё идут по расписанию `stepMinutes` и переводятся на `steps`
   * при первом открытии (FR-65, ADR-007). Нет поля — тоже таймер до 1.6.
   */
  readonly legacySchedule?: boolean;
}

/** Черновик конспекта сессии (FR-13, FR-35): переживает перезагрузку, пока итог не сохранён. */
export interface ISessionDraft {
  /** Лог завершённой сессии; null — сессия ещё идёт. */
  readonly logId: string | null;
  readonly body: string;
  readonly worked: string;
  readonly failed: string;
  readonly next: string;
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
  /** План дня в минутах, зафиксированный в сам день: календарь не пересчитывает прошлое (FR-36). */
  readonly dayPlans: Readonly<Record<string, number>>;
  readonly expanded: readonly string[];
  /** Версия курса в данных (FR-45); null — челлендж без курса. */
  readonly courseVersion: number | null;
  /** Ключи стартовых сущностей, удалённых пользователем: обновление курса их не возвращает. */
  readonly dismissedCourseKeys: readonly string[];
  /** Версия курса, баннер которой закрыт на «Сегодня». */
  readonly courseBannerDismissed: number | null;
  /** Черновик конспекта текущей или только что завершённой сессии. */
  readonly sessionDraft: ISessionDraft | null;
}
