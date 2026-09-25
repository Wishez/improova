import type { IEntity } from './entity';

/** Индекс дня недели: 0 — понедельник … 6 — воскресенье. */
export type TWeekdayIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface IBudget extends IEntity {
  /** Минуты в неделю на ресурсы (study). */
  readonly studyMinPerWeek: number;
  /** Минуты в неделю на практику (practice + creative + review). */
  readonly practiceMinPerWeek: number;
  /** Доля свободного творчества в практике, 0–0,5. */
  readonly creativeShare: number;
  /** Ёмкость дней недели в минутах, Пн…Вс. */
  readonly dayCapacity: readonly number[];
  readonly blockMin: number;
  readonly blockMax: number;
  readonly reviewIntervals: readonly number[];
  /** Брать веса разделов по кварталам (FR-40). */
  readonly seasonalWeights: boolean;
}
