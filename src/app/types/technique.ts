import type { TLinkAccess } from './guide';

/** Справочник приёмов (FR-47): группы карточек в порядке курса. */
export type TTechniqueGroup =
  | 'line'
  | 'construction'
  | 'gesture'
  | 'perspective'
  | 'tone'
  | 'sighting'
  | 'color'
  | 'composition'
  | 'graphics'
  | 'painting'
  | 'masters'
  | 'route';

export type TTechniqueLang = 'ru' | 'en';

/** Источник карточки: одна ссылка и место внутри неё (глава, раздел, минута). */
export interface ITechniqueSource {
  readonly title: string;
  readonly url: string;
  readonly locator: string;
  readonly access: TLinkAccess;
  /** Уточнение доступа, если «бесплатно» не всё: «видеоурок платный». */
  readonly accessNote: string;
  readonly lang: TTechniqueLang;
}

/**
 * Карточка приёма (FR-47): часть курса, поставляется с приложением и не хранится в данных (ADR-006).
 * Тексты — markdown без блоков: допускаются **жирный** и ссылки.
 */
export interface ITechnique {
  /** Ключ курса `technique:<slug>`; не меняется и не переиспользуется. */
  readonly key: string;
  /** Номер карточки в каталоге требований v1.5. */
  readonly number: number;
  readonly group: TTechniqueGroup;
  readonly title: string;
  readonly what: string;
  readonly why: string;
  readonly materials: string;
  /** 3–6 шагов «как делать». */
  readonly steps: readonly string[];
  readonly check: string;
  /** Предупреждение о безопасности; пусто — не нужно. */
  readonly safety: string;
  readonly mistakes: readonly string[];
  readonly sources: readonly ITechniqueSource[];
  /** Словарь приёма: где в тексте шага или задания он назван. null — только через технику маршрута. */
  readonly match: RegExp | null;
  /** Названия техники в блоках маршрута мастеров (FR-49), без учёта регистра. */
  readonly routeNames: readonly string[];
}
