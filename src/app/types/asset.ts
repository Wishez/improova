import type { IEntity } from './entity';

/** Фото работы, сжатое до 1600 px WebP, хранится как data URL. */
export interface IAsset extends IEntity {
  readonly dataUrl: string;
  readonly width: number;
  readonly height: number;
  readonly bytes: number;
}
