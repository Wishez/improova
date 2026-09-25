import type { IEntity } from './entity';

export interface INote extends IEntity {
  readonly itemId: string | null;
  readonly logId: string | null;
  readonly body: string;
  readonly worked: string;
  readonly failed: string;
  readonly next: string;
  readonly imageIds: readonly string[];
}
