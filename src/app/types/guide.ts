/** Ориентир занятия по топику (FR-37): что делать в сессии без поиска информации. */

export type TLinkAccess = 'pd' | 'free' | 'paid';

export interface IGuideLink {
  readonly title: string;
  readonly url: string;
  /** Глава, урок или фрагмент внутри источника: «гл. 1–5», «Lesson 1». */
  readonly locator: string;
  readonly access: TLinkAccess;
}

export interface IGuideStep {
  readonly title: string;
  readonly minutes: number;
}

export interface IGuide {
  readonly goal: string;
  /** Конкретное задание этой сессии. */
  readonly task: string;
  readonly steps: readonly IGuideStep[];
  readonly stopCriterion: string;
  readonly links: readonly IGuideLink[];
  readonly references: readonly IGuideLink[];
  readonly imageIds: readonly string[];
  readonly pitfalls: readonly string[];
}
