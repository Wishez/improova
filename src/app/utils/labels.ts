import type { TResourceType, TResourceUnit, TSessionType } from '../types';

export const SESSION_TYPE_LABEL: Readonly<Record<TSessionType, string>> = {
  study: 'Учёба',
  practice: 'Практика',
  creative: 'Творчество',
  review: 'Повторение',
};

export const RESOURCE_TYPE_LABEL: Readonly<Record<TResourceType, string>> = {
  book: 'Книга',
  course: 'Курс',
  video: 'Видео',
  article: 'Статья',
  exercise: 'Упражнение',
  tool: 'Инструмент',
};

export const RESOURCE_UNIT_LABEL: Readonly<Record<TResourceUnit, string>> = {
  page: 'страница',
  lesson: 'урок',
  minute: 'минута',
  piece: 'штука',
};
