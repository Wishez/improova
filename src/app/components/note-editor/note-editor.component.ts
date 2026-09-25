import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal } from '@angular/core';
import { TuiButton } from '@taiga-ui/core';
import { MarkdownPipe } from '../../pipes';
import { DataStore, MAX_PHOTOS, NotesService } from '../../services';

type TNoteField = 'body' | 'worked' | 'failed' | 'next';

const AUTOSAVE_MS = 800;

/** Редактор заметки: markdown, рефлексия, фото, автосохранение 800 мс (FR-15, FR-17). */
@Component({
  selector: 'app-note-editor',
  imports: [TuiButton, MarkdownPipe],
  templateUrl: './note-editor.component.html',
  styleUrl: './note-editor.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NoteEditorComponent {
  private readonly store = inject(DataStore);
  protected readonly notes = inject(NotesService);

  readonly noteId = input.required<string>();

  protected readonly note = computed(() => this.store.data().notes.find((entry) => entry.id === this.noteId()) ?? null);
  protected readonly draft = signal<Record<TNoteField, string>>({ body: '', worked: '', failed: '', next: '' });
  protected readonly preview = signal(false);
  protected readonly dirty = signal(false);
  protected readonly maxPhotos = MAX_PHOTOS;
  protected readonly saveState = computed(() => (this.dirty() || this.store.unsaved() > 0 ? 'Сохраняем…' : 'Сохранено'));
  protected readonly photos = computed(() => {
    const assets = this.store.assetsById();
    return (this.note()?.imageIds ?? []).map((id) => assets.get(id)).filter((asset) => asset !== undefined);
  });
  protected readonly itemTitle = computed(() => {
    const itemId = this.note()?.itemId;
    return itemId ? (this.store.tree().itemById.get(itemId)?.title ?? '') : '';
  });

  private timer: ReturnType<typeof setTimeout> | null = null;
  private loadedId: string | null = null;

  constructor() {
    effect(() => {
      const note = this.note();
      if (note && note.id !== this.loadedId) {
        this.loadedId = note.id;
        this.draft.set({ body: note.body, worked: note.worked, failed: note.failed, next: note.next });
        this.preview.set(note.body.trim().length > 0);
      }
    });
    inject(DestroyRef).onDestroy(() => this.flush());
  }

  protected onInput(field: TNoteField, event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement)) {
      return;
    }
    this.draft.update((draft) => ({ ...draft, [field]: target.value }));
    this.dirty.set(true);
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => this.flush(), AUTOSAVE_MS);
  }

  protected flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.dirty() && this.note()) {
      this.notes.update(this.noteId(), this.draft());
      this.dirty.set(false);
    }
  }

  protected async onFiles(event: Event): Promise<void> {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || !target.files) {
      return;
    }
    const files = Array.from(target.files);
    target.value = '';
    this.flush();
    await this.notes.addPhotos(this.noteId(), files);
  }
}
