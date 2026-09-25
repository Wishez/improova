import { Injectable, inject, signal } from '@angular/core';
import type { IAsset, INote } from '../types';
import { compressImage, createId } from '../utils';
import { DataStore } from './data.store';
import { ToastService } from './toast.service';

export const MAX_PHOTOS = 4;

/** Заметки-конспекты и фото работ (FR-15…FR-17). */
@Injectable({ providedIn: 'root' })
export class NotesService {
  private readonly store = inject(DataStore);
  private readonly toasts = inject(ToastService);
  readonly uploading = signal(false);

  create(params: { readonly itemId: string | null; readonly logId?: string | null; readonly body?: string; readonly worked?: string; readonly failed?: string; readonly next?: string }): INote {
    const now = new Date().toISOString();
    const note: INote = {
      id: createId(),
      createdAt: now,
      updatedAt: now,
      itemId: params.itemId,
      logId: params.logId ?? null,
      body: params.body ?? '',
      worked: params.worked ?? '',
      failed: params.failed ?? '',
      next: params.next ?? '',
      imageIds: [],
    };
    this.store.upsert('notes', note);
    return note;
  }

  update(id: string, patch: Partial<Pick<INote, 'body' | 'worked' | 'failed' | 'next' | 'itemId' | 'imageIds'>>): void {
    const note = this.store.data().notes.find((entry) => entry.id === id);
    if (note) {
      this.store.upsert('notes', { ...note, ...patch, updatedAt: new Date().toISOString() });
    }
  }

  isEmpty(note: INote): boolean {
    return [note.body, note.worked, note.failed, note.next].every((text) => text.trim() === '') && note.imageIds.length === 0;
  }

  remove(id: string): void {
    const note = this.store.data().notes.find((entry) => entry.id === id);
    if (!note) {
      return;
    }
    const assets = this.store.data().assets.filter((asset) => note.imageIds.includes(asset.id));
    this.store.remove('notes', [id]);
    this.store.remove('assets', assets.map((asset) => asset.id));
    this.toasts.undo({
      text: 'Заметка удалена',
      onUndo: () => {
        this.store.upsert('notes', note);
        this.store.upsertMany('assets', assets);
      },
    });
  }

  async addPhotos(noteId: string, files: readonly File[]): Promise<void> {
    const note = this.store.data().notes.find((entry) => entry.id === noteId);
    if (!note) {
      return;
    }
    const free = MAX_PHOTOS - note.imageIds.length;
    if (free <= 0) {
      this.toasts.show({ text: `К заметке можно прикрепить до ${MAX_PHOTOS} фото.` });
      return;
    }
    this.uploading.set(true);
    try {
      const assets: IAsset[] = [];
      for (const file of files.slice(0, free)) {
        if (!file.type.startsWith('image/')) {
          continue;
        }
        const image = await compressImage(file);
        const now = new Date().toISOString();
        assets.push({ id: createId(), createdAt: now, updatedAt: now, ...image });
      }
      this.store.upsertMany('assets', assets);
      this.update(noteId, { imageIds: [...note.imageIds, ...assets.map((asset) => asset.id)] });
      if (files.length > free) {
        this.toasts.show({ text: `Добавлено ${free} из ${files.length}: лимит ${MAX_PHOTOS} фото на заметку.` });
      }
    } catch {
      this.toasts.show({ text: 'Не удалось обработать фото. Попробуй JPEG или PNG.', kind: 'error' });
    } finally {
      this.uploading.set(false);
    }
  }

  removePhoto(noteId: string, assetId: string): void {
    const note = this.store.data().notes.find((entry) => entry.id === noteId);
    if (!note) {
      return;
    }
    this.update(noteId, { imageIds: note.imageIds.filter((id) => id !== assetId) });
    this.store.remove('assets', [assetId]);
  }
}
