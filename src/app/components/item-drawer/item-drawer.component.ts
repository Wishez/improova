import { FormsModule } from '@angular/forms';
import { ChangeDetectionStrategy, Component, ElementRef, HostListener, computed, effect, inject, signal, viewChild } from '@angular/core';
import { TuiButton, TuiCheckbox, TuiDialog } from '@taiga-ui/core';
import { TuiSwitch } from '@taiga-ui/kit';
import { estimateFromResource, isCountable, reviewState, topicBeforeAfter } from '../../domain';
import { DayShortPipe, MarkdownPipe, MinutesPipe } from '../../pipes';
import { DataStore, NotesService, PlanService, ProgramService, TimerService, UiStateService } from '../../services';
import type { IResourceRef, TItemKind } from '../../types';
import { RESOURCE_TYPE_LABEL } from '../../utils';
import { GuideCardComponent } from '../guide-card/guide-card.component';
import { LogListComponent } from '../log-list/log-list.component';
import { NoteEditorComponent } from '../note-editor/note-editor.component';

/** Карточка топика: ориентир, пояснение, ресурсы, время, логи, заметки, старт и галочка (FR-08, FR-37). */
@Component({
  selector: 'app-item-drawer',
  imports: [FormsModule, TuiButton, TuiCheckbox, TuiSwitch, TuiDialog, MinutesPipe, DayShortPipe, MarkdownPipe, LogListComponent, NoteEditorComponent, GuideCardComponent],
  templateUrl: './item-drawer.component.html',
  styleUrl: './item-drawer.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ItemDrawerComponent {
  private readonly store = inject(DataStore);
  private readonly program = inject(ProgramService);
  private readonly notesService = inject(NotesService);
  private readonly planner = inject(PlanService);
  protected readonly timer = inject(TimerService);
  protected readonly ui = inject(UiStateService);
  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');

  protected readonly resourceTypeLabel = RESOURCE_TYPE_LABEL;
  protected readonly item = computed(() => {
    const id = this.ui.drawerItemId();
    return id ? (this.store.data().items.find((entry) => entry.id === id) ?? null) : null;
  });
  protected readonly topic = computed(() => {
    const item = this.item();
    return item ? (this.store.data().topics.find((entry) => entry.id === item.topicId) ?? null) : null;
  });
  protected readonly section = computed(() => {
    const topic = this.topic();
    return topic ? (this.store.data().sections.find((entry) => entry.id === topic.sectionId) ?? null) : null;
  });
  protected readonly spent = computed(() => this.store.spent().get(this.item()?.id ?? '') ?? 0);
  protected readonly spentRatio = computed(() => {
    const estimate = this.item()?.estimateMin ?? 0;
    return estimate > 0 ? Math.min(1, this.spent() / estimate) : 0;
  });
  protected readonly remaining = computed(() => this.planner.plan().remainingByItem.get(this.item()?.id ?? '') ?? 0);
  protected readonly countable = computed(() => {
    const item = this.item();
    return item !== null && isCountable(item);
  });
  protected readonly logs = computed(() => this.store.logs().filter((log) => log.itemId === this.item()?.id));
  protected readonly notes = computed(() =>
    this.store
      .data()
      .notes.filter((note) => note.itemId === this.item()?.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  );
  protected readonly refs = computed(() => {
    const resources = this.store.resourcesById();
    return (this.item()?.resourceRefs ?? []).map((ref) => ({ ref, resource: resources.get(ref.resourceId) ?? null }));
  });
  protected readonly library = computed(() => this.store.data().resources.filter((resource) => !resource.archived));
  protected readonly review = computed(() => {
    const item = this.item();
    return item
      ? reviewState({ item, logs: this.store.logs(), intervals: this.store.budget().reviewIntervals, boundaryHour: this.store.settings().dayBoundaryHour })
      : null;
  });
  /** «Было / стало»: первое и последнее фото темы из разных дней (FR-17). */
  protected readonly gallery = computed(() => {
    const topic = this.topic();
    return topic
      ? topicBeforeAfter({
          topicId: topic.id,
          items: this.store.data().items,
          notes: this.store.data().notes,
          assets: this.store.assetsById(),
          boundaryHour: this.store.settings().dayBoundaryHour,
        })
      : null;
  });

  protected readonly editingDescription = signal(false);
  protected readonly openNoteId = signal<string | null>(null);
  protected readonly deleteOpen = signal(false);
  protected readonly logCount = computed(() => {
    const item = this.item();
    return item ? this.program.subtree('item', item.id).logCount : 0;
  });

  constructor() {
    effect(() => {
      if (this.item()) {
        this.editingDescription.set(false);
        this.openNoteId.set(null);
        queueMicrotask(() => this.panel()?.nativeElement.focus());
      }
    });
  }

  @HostListener('document:keydown.escape')
  protected close(): void {
    if (this.ui.drawerItemId() && !this.deleteOpen()) {
      this.ui.closeItem();
    }
  }

  protected value(event: Event): string {
    const target = event.target;
    return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement ? target.value : '';
  }

  protected rename(event: Event): void {
    const item = this.item();
    const title = this.value(event).trim();
    if (item && title && title !== item.title) {
      this.program.updateItem(item.id, { title });
    } else if (event.target instanceof HTMLInputElement && item) {
      event.target.value = item.title;
    }
  }

  protected setEstimate(event: Event): void {
    const minutes = Math.round(Number(this.value(event)));
    const item = this.item();
    if (item && Number.isFinite(minutes) && minutes >= 5 && minutes <= 6000) {
      this.program.updateItem(item.id, { estimateMin: minutes });
    } else if (event.target instanceof HTMLInputElement && item) {
      event.target.value = String(item.estimateMin);
    }
  }

  protected setKind(event: Event): void {
    const kind: TItemKind = this.value(event) === 'study' ? 'study' : 'practice';
    const item = this.item();
    if (item) {
      this.program.updateItem(item.id, { kind });
    }
  }

  protected setRecurrence(event: Event): void {
    const weeks = Number(this.value(event));
    const item = this.item();
    if (item) {
      this.program.updateItem(item.id, { recurrenceWeeks: weeks > 0 ? weeks : null, doneAt: null });
    }
  }

  protected setSelfCheck(event: Event): void {
    const item = this.item();
    if (item) {
      this.program.updateItem(item.id, { selfCheck: this.value(event) });
    }
  }

  protected setDescription(event: Event): void {
    const topic = this.topic();
    if (topic) {
      this.program.updateTopic(topic.id, { description: this.value(event) });
    }
  }

  protected toggleDone(): void {
    const item = this.item();
    if (item) {
      this.program.setDone(item.id, item.doneAt === null);
    }
  }

  protected toggleWeak(): void {
    const item = this.item();
    if (item) {
      this.program.updateItem(item.id, { weakSpot: !item.weakSpot });
    }
  }

  protected start(): void {
    const item = this.item();
    if (item) {
      this.timer.start({ itemId: item.id, type: item.kind, plannedMin: Math.min(Math.max(this.remaining(), 20), 90) });
    }
  }

  protected addRef(event: Event): void {
    const item = this.item();
    const resourceId = this.value(event);
    const resource = this.store.resourcesById().get(resourceId);
    if (!item || !resource || item.resourceRefs.some((ref) => ref.resourceId === resourceId)) {
      return;
    }
    const units = resource.minPerUnit > 0 ? Math.max(1, Math.round(item.estimateMin / resource.minPerUnit)) : 0;
    this.program.updateItem(item.id, { resourceRefs: [...item.resourceRefs, { resourceId, range: '', units }] });
    if (event.target instanceof HTMLSelectElement) {
      event.target.value = '';
    }
  }

  protected updateRef(ref: IResourceRef, patch: Partial<IResourceRef>): void {
    const item = this.item();
    if (!item) {
      return;
    }
    const next = { ...ref, ...patch };
    const refs = item.resourceRefs.map((entry) => (entry.resourceId === ref.resourceId ? next : entry));
    const resource = this.store.resourcesById().get(ref.resourceId);
    const estimatePatch = patch.units !== undefined && resource && next.units > 0 ? { estimateMin: estimateFromResource(resource, next.units) } : {};
    this.program.updateItem(item.id, { resourceRefs: refs, ...estimatePatch });
  }

  protected removeRef(ref: IResourceRef): void {
    const item = this.item();
    if (item) {
      this.program.updateItem(item.id, { resourceRefs: item.resourceRefs.filter((entry) => entry.resourceId !== ref.resourceId) });
    }
  }

  protected newNote(): void {
    const item = this.item();
    if (item) {
      this.openNoteId.set(this.notesService.create({ itemId: item.id }).id);
    }
  }

  protected toggleNote(id: string): void {
    const current = this.openNoteId();
    if (current && current !== id) {
      this.dropIfEmpty(current);
    }
    this.openNoteId.set(current === id ? null : id);
    if (current === id) {
      this.dropIfEmpty(id);
    }
  }

  private dropIfEmpty(id: string): void {
    const note = this.store.data().notes.find((entry) => entry.id === id);
    if (note && this.notesService.isEmpty(note)) {
      this.store.remove('notes', [id]);
    }
  }

  protected askDelete(): void {
    const item = this.item();
    if (!item) {
      return;
    }
    if (this.logCount() === 0) {
      this.ui.closeItem();
      this.program.remove('item', item.id);
    } else {
      this.deleteOpen.set(true);
    }
  }

  protected archive(): void {
    const item = this.item();
    this.deleteOpen.set(false);
    if (item) {
      this.ui.closeItem();
      this.program.archive('item', item.id);
    }
  }

  protected removeWithLogs(): void {
    const item = this.item();
    this.deleteOpen.set(false);
    if (item) {
      this.ui.closeItem();
      this.program.remove('item', item.id);
    }
  }
}
