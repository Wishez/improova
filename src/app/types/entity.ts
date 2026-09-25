/** Базовая сущность хранилища (ТЗ 8.1). */
export interface IEntity {
  readonly id: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly deletedAt?: string;
}
