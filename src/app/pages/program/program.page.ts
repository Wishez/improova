import { FormsModule } from '@angular/forms';
import { CdkDrag, CdkDragHandle, CdkDropList, type CdkDragDrop } from '@angular/cdk/drag-drop';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { TuiButton, TuiCheckbox, TuiDialog, TuiHint } from '@taiga-ui/core';
import { TuiSegmented } from '@taiga-ui/kit';
import { map } from 'rxjs';
import { EmptyStateComponent } from '../../components';
import { progressOfItems, sectionItems, type IProgress } from '../../domain';
import { MarkdownPipe, MinutesPipe } from '../../pipes';
import { DataStore, ProgramService, UiStateService, parseBulkLines, type TProgramEntity } from '../../services';
import type { IItem, ISection, ITopic, TSectionWeight } from '../../types';
import { ResourcesPanelComponent } from './resources-panel.component';
import { RoutePanelComponent } from './route-panel.component';

type TFilter = 'all' | 'inProgress' | 'todo' | 'done' | 'weak';

interface ITopicView {
  readonly topic: ITopic;
  readonly items: readonly IItem[];
  readonly progress: IProgress;
}

interface ISectionView {
  readonly section: ISection;
  readonly topics: readonly ITopicView[];
  readonly progress: IProgress;
}

const FILTERS: readonly { readonly id: TFilter; readonly label: string }[] = [
  { id: 'all', label: 'Все' },
  { id: 'inProgress', label: 'В работе' },
  { id: 'todo', label: 'Не начаты' },
  { id: 'done', label: 'Закрыты' },
  { id: 'weak', label: 'Слабые места' },
];

/** Программа: дерево Раздел → Тема → Топик и редактор (FR-05…FR-07, FR-27…FR-30). */
@Component({
  selector: 'app-program-page',
  imports: [
    FormsModule,
    CdkDropList,
    CdkDrag,
    CdkDragHandle,
    TuiButton,
    TuiCheckbox,
    TuiDialog,
    TuiHint,
    TuiSegmented,
    EmptyStateComponent,
    MinutesPipe,
    MarkdownPipe,
    ResourcesPanelComponent, RoutePanelComponent,
  ],
  templateUrl: './program.page.html',
  styleUrl: './program.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProgramPage {
  private readonly store = inject(DataStore);
  private readonly program = inject(ProgramService);
  protected readonly ui = inject(UiStateService);
  private readonly focusSection = toSignal(inject(ActivatedRoute).queryParamMap.pipe(map((params) => params.get('section'))));

  protected readonly filters = FILTERS;
  protected readonly tab = signal<'program' | 'resources' | 'route'>('program');
  protected readonly filter = signal<TFilter>('all');
  protected readonly query = signal('');
  protected readonly editing = signal<{ readonly kind: TProgramEntity; readonly id: string } | null>(null);
  protected readonly addingTopicFor = signal<string | null>(null);
  protected readonly addingItemsFor = signal<string | null>(null);
  protected readonly editingDescriptionFor = signal<string | null>(null);
  protected readonly addingSection = signal(false);
  protected readonly pendingDelete = signal<{ readonly kind: TProgramEntity; readonly id: string; readonly title: string; readonly logs: number } | null>(null);
  protected readonly weights: readonly TSectionWeight[] = [1, 2, 3];

  protected readonly expanded = computed(() => new Set(this.store.meta().expanded));
  protected readonly filterIndex = computed(() => FILTERS.findIndex((entry) => entry.id === this.filter()));

  protected readonly view = computed<ISectionView[]>(() => {
    const tree = this.store.tree();
    const spent = this.store.spent();
    const needle = this.query().trim().toLowerCase();
    const filter = this.filter();
    const matchesItem = (item: IItem): boolean => {
      const byFilter =
        filter === 'all' ||
        (filter === 'done' && item.doneAt !== null) ||
        (filter === 'weak' && item.weakSpot) ||
        (filter === 'todo' && item.doneAt === null && (spent.get(item.id) ?? 0) === 0) ||
        (filter === 'inProgress' && item.doneAt === null && (spent.get(item.id) ?? 0) > 0);
      return byFilter && (needle === '' || item.title.toLowerCase().includes(needle));
    };
    const narrowed = filter !== 'all' || needle !== '';
    return tree.sections
      .map((section) => {
        const topics = (tree.topicsBySection.get(section.id) ?? [])
          .map((topic) => {
            const all = tree.itemsByTopic.get(topic.id) ?? [];
            const topicMatches = needle !== '' && topic.title.toLowerCase().includes(needle) && filter === 'all';
            return { topic, items: topicMatches ? all : all.filter(matchesItem), progress: progressOfItems(all, spent) };
          })
          .filter((entry) => !narrowed || entry.items.length > 0);
        return { section, topics, progress: progressOfItems(sectionItems(tree, section.id), spent) };
      })
      .filter((entry) => !narrowed || entry.topics.length > 0 || entry.section.title.toLowerCase().includes(needle));
  });
  protected readonly isEmpty = computed(() => this.store.tree().sections.length === 0);
  protected readonly narrowed = computed(() => this.filter() !== 'all' || this.query().trim() !== '');
  protected readonly allTopicIds = computed(() => this.view().flatMap((section) => section.topics.map((entry) => `topic-${entry.topic.id}`)));

  constructor() {
    effect(() => {
      const sectionId = this.focusSection();
      if (sectionId && this.store.tree().sectionById.has(sectionId) && !this.expanded().has(sectionId)) {
        this.store.updateMeta({ expanded: [...this.store.meta().expanded, sectionId] });
      }
      if (sectionId) {
        setTimeout(() => document.getElementById(`section-${sectionId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
      }
    });
  }

  protected isOpen(id: string): boolean {
    return this.narrowed() || this.expanded().has(id);
  }

  protected toggle(id: string): void {
    const expanded = new Set(this.store.meta().expanded);
    if (expanded.has(id)) {
      expanded.delete(id);
    } else {
      expanded.add(id);
    }
    this.store.updateMeta({ expanded: [...expanded] });
  }

  protected expandAll(open: boolean): void {
    const tree = this.store.tree();
    this.store.updateMeta({ expanded: open ? [...tree.sections.map((s) => s.id), ...[...tree.topicById.keys()]] : [] });
  }

  protected setFilter(index: number): void {
    this.filter.set(FILTERS[index]?.id ?? 'all');
  }

  protected text(event: Event): string {
    const target = event.target;
    return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement ? target.value : '';
  }

  protected commitRename(kind: TProgramEntity, id: string, event: Event): void {
    const title = this.text(event).trim();
    this.editing.set(null);
    if (!title) {
      return;
    }
    if (kind === 'section') {
      this.program.updateSection(id, { title });
    } else if (kind === 'topic') {
      this.program.updateTopic(id, { title });
    } else {
      this.program.updateItem(id, { title });
    }
  }

  protected addSection(event: Event): void {
    const title = this.text(event).trim();
    if (title) {
      const section = this.program.addSection(title);
      this.store.updateMeta({ expanded: [...this.store.meta().expanded, section.id] });
    }
    this.addingSection.set(false);
  }

  protected addTopic(sectionId: string, event: Event): void {
    const title = this.text(event).trim();
    if (title) {
      const topic = this.program.addTopic(sectionId, title);
      this.store.updateMeta({ expanded: [...this.store.meta().expanded, sectionId, topic.id] });
    }
    this.addingTopicFor.set(null);
  }

  protected addItems(topicId: string, textarea: HTMLTextAreaElement): void {
    const lines = parseBulkLines(textarea.value);
    if (lines.length > 0) {
      this.program.addItems(topicId, lines);
    }
    this.addingItemsFor.set(null);
  }

  protected setWeight(section: ISection, event: Event): void {
    const weight = Number(this.text(event));
    if (weight === 1 || weight === 2 || weight === 3) {
      this.program.setSectionWeight(section.id, weight);
    }
  }

  protected setDescription(topic: ITopic, event: Event): void {
    this.program.updateTopic(topic.id, { description: this.text(event) });
  }

  protected toggleDone(item: IItem): void {
    this.program.setDone(item.id, item.doneAt === null);
  }

  protected spentOf(item: IItem): number {
    return this.store.spent().get(item.id) ?? 0;
  }

  protected askDelete(kind: TProgramEntity, id: string, title: string): void {
    const logs = this.program.subtree(kind, id).logCount;
    if (logs === 0) {
      this.program.remove(kind, id);
    } else {
      this.pendingDelete.set({ kind, id, title, logs });
    }
  }

  protected confirmDelete(mode: 'archive' | 'remove'): void {
    const pending = this.pendingDelete();
    this.pendingDelete.set(null);
    if (!pending) {
      return;
    }
    if (mode === 'archive') {
      this.program.archive(pending.kind, pending.id);
    } else {
      this.program.remove(pending.kind, pending.id);
    }
  }

  protected dropSection(event: CdkDragDrop<readonly ISectionView[]>): void {
    const ids = this.view().map((entry) => entry.section.id);
    move(ids, event.previousIndex, event.currentIndex);
    this.program.reorder('section', ids);
  }

  protected dropTopic(sectionView: ISectionView, event: CdkDragDrop<readonly ITopicView[]>): void {
    const ids = sectionView.topics.map((entry) => entry.topic.id);
    move(ids, event.previousIndex, event.currentIndex);
    this.program.reorder('topic', ids);
  }

  /** Перенос внутри темы и между темами (FR-28). */
  protected dropItem(topicView: ITopicView, event: CdkDragDrop<readonly IItem[], readonly IItem[], IItem>): void {
    const item = event.item.data;
    if (event.previousContainer === event.container) {
      const ids = topicView.items.map((entry) => entry.id);
      move(ids, event.previousIndex, event.currentIndex);
      this.program.reorder('item', ids);
    } else {
      this.program.moveItem(item.id, topicView.topic.id, event.currentIndex);
    }
  }

  /** Клавиатурная альтернатива перетаскиванию: Alt+↑/↓ (FR-28). */
  protected keyMove(topicView: ITopicView, index: number, event: KeyboardEvent): void {
    if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) {
      return;
    }
    event.preventDefault();
    const target = event.key === 'ArrowUp' ? index - 1 : index + 1;
    if (target < 0 || target >= topicView.items.length) {
      return;
    }
    const ids = topicView.items.map((entry) => entry.id);
    move(ids, index, target);
    this.program.reorder('item', ids);
    setTimeout(() => document.getElementById(`item-${ids[target]}`)?.focus());
  }
}

function move(list: string[], from: number, to: number): void {
  const [entry] = list.splice(from, 1);
  if (entry !== undefined) {
    list.splice(to, 0, entry);
  }
}
