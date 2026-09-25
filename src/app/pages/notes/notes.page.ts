import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { TuiButton } from '@taiga-ui/core';
import { map } from 'rxjs';
import { EmptyStateComponent, NoteEditorComponent } from '../../components';
import { DayShortPipe, MarkdownPipe } from '../../pipes';
import { DataStore, NotesService, UiStateService } from '../../services';
import type { IAsset, INote } from '../../types';
import { toDayKey } from '../../utils';

interface IGalleryEntry {
  readonly topicId: string;
  readonly title: string;
  readonly first: { readonly asset: IAsset; readonly day: string };
  readonly last: { readonly asset: IAsset; readonly day: string } | null;
}

/** Фото контрольной работы в ленте роста (FR-41). */
interface ICheckpointPhoto {
  readonly id: string;
  readonly asset: IAsset;
  readonly day: string;
  readonly title: string;
}

/** Лента заметок, поиск, фильтр по разделу, галерея «Было / стало» и лента контрольных (FR-16, FR-17, FR-41). */
@Component({
  selector: 'app-notes-page',
  imports: [TuiButton, EmptyStateComponent, NoteEditorComponent, DayShortPipe, MarkdownPipe],
  templateUrl: './notes.page.html',
  styleUrl: './notes.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotesPage {
  private readonly store = inject(DataStore);
  private readonly notesService = inject(NotesService);
  protected readonly ui = inject(UiStateService);
  private readonly openParam = toSignal(inject(ActivatedRoute).queryParamMap.pipe(map((params) => params.get('open'))));

  protected readonly tab = signal<'feed' | 'gallery'>('feed');
  protected readonly query = signal('');
  protected readonly sectionId = signal('');
  protected readonly openId = signal<string | null>(null);
  protected readonly sections = computed(() => this.store.tree().sections);

  protected readonly notes = computed(() => {
    const tree = this.store.tree();
    const needle = this.query().trim().toLowerCase();
    const sectionId = this.sectionId();
    return [...this.store.data().notes]
      .filter((note) => {
        if (sectionId) {
          const item = note.itemId ? tree.itemById.get(note.itemId) : undefined;
          const topic = item ? tree.topicById.get(item.topicId) : undefined;
          if (topic?.sectionId !== sectionId) {
            return false;
          }
        }
        if (!needle) {
          return true;
        }
        const title = note.itemId ? (tree.itemById.get(note.itemId)?.title ?? '') : '';
        return [note.body, note.worked, note.failed, note.next, title].some((text) => text.toLowerCase().includes(needle));
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  });

  protected readonly gallery = computed<IGalleryEntry[]>(() => {
    const tree = this.store.tree();
    const assets = this.store.assetsById();
    const boundary = this.store.settings().dayBoundaryHour;
    const byTopic = new Map<string, { asset: IAsset; day: string }[]>();
    for (const note of this.store.data().notes) {
      const item = note.itemId ? tree.itemById.get(note.itemId) : undefined;
      if (!item) {
        continue;
      }
      for (const id of note.imageIds) {
        const asset = assets.get(id);
        if (asset) {
          byTopic.set(item.topicId, [...(byTopic.get(item.topicId) ?? []), { asset, day: toDayKey(new Date(note.createdAt), boundary) }]);
        }
      }
    }
    return [...byTopic.entries()].map(([topicId, photos]) => {
      const sorted = [...photos].sort((a, b) => a.day.localeCompare(b.day));
      const first = sorted[0];
      const last = sorted.at(-1);
      return first
        ? [{ topicId, title: tree.topicById.get(topicId)?.title ?? '', first, last: last && last.day !== first.day ? last : null }]
        : [];
    }).flat();
  });

  /** Фото из заметок к контрольным работам — от ранних к поздним. */
  protected readonly checkpoints = computed<ICheckpointPhoto[]>(() => {
    const tree = this.store.tree();
    const assets = this.store.assetsById();
    const boundary = this.store.settings().dayBoundaryHour;
    const photos: ICheckpointPhoto[] = [];
    for (const note of this.store.data().notes) {
      const item = note.itemId ? tree.itemById.get(note.itemId) : undefined;
      if (!item || item.checkpointDay === null) {
        continue;
      }
      for (const id of note.imageIds) {
        const asset = assets.get(id);
        if (asset) {
          photos.push({ id, asset, day: toDayKey(new Date(note.createdAt), boundary), title: item.title });
        }
      }
    }
    return photos.sort((a, b) => a.day.localeCompare(b.day) || a.id.localeCompare(b.id));
  });

  constructor() {
    effect(() => {
      const open = this.openParam();
      if (open) {
        this.openId.set(open);
        setTimeout(() => document.getElementById(`note-${open}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
      }
    });
  }

  protected text(event: Event): string {
    const target = event.target;
    return target instanceof HTMLInputElement || target instanceof HTMLSelectElement ? target.value : '';
  }

  protected titleOf(note: INote): string {
    return note.itemId ? (this.store.tree().itemById.get(note.itemId)?.title ?? 'Топик в архиве') : 'Без топика';
  }

  protected preview(note: INote): string {
    return note.body || [note.worked, note.failed, note.next].filter((text) => text.trim()).join(' · ') || 'Пустая заметка';
  }

  protected toggle(note: INote): void {
    const current = this.openId();
    if (current && current !== note.id) {
      this.dropIfEmpty(current);
    }
    this.openId.set(current === note.id ? null : note.id);
  }

  protected create(): void {
    this.ui.newNoteForItem.set(null);
  }

  protected remove(note: INote): void {
    this.openId.set(null);
    this.notesService.remove(note.id);
  }

  protected link(note: INote, event: Event): void {
    const itemId = this.text(event);
    this.notesService.update(note.id, { itemId: itemId || null });
  }

  protected items = computed(() => [...this.store.tree().itemById.values()]);

  private dropIfEmpty(id: string): void {
    const note = this.store.data().notes.find((entry) => entry.id === id);
    if (note && this.notesService.isEmpty(note)) {
      this.store.remove('notes', [id]);
    }
  }
}
