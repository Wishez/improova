import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { TuiButton } from '@taiga-ui/core';
import { EmptyStateComponent } from '../../components';
import { MinutesPipe } from '../../pipes';
import { DataStore, ProgramService, ToastService } from '../../services';
import type { IResource, TItemKind, TResourceType, TResourceUnit } from '../../types';
import { RESOURCE_TYPE_LABEL, RESOURCE_UNIT_LABEL } from '../../utils';

interface IResourceDraft {
  readonly title: string;
  readonly type: TResourceType;
  readonly author: string;
  readonly url: string;
  readonly unit: TResourceUnit;
  readonly unitCount: number;
  readonly minPerUnit: number;
}

const EMPTY_DRAFT: IResourceDraft = { title: '', type: 'book', author: '', url: '', unit: 'page', unitCount: 100, minPerUnit: 4 };

/** Библиотека ресурсов: CRUD и «разбить на части» (FR-31). */
@Component({
  selector: 'app-resources-panel',
  imports: [NgTemplateOutlet, TuiButton, EmptyStateComponent, MinutesPipe],
  templateUrl: './resources-panel.component.html',
  styleUrl: './resources-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ResourcesPanelComponent {
  private readonly store = inject(DataStore);
  private readonly program = inject(ProgramService);
  private readonly toasts = inject(ToastService);

  protected readonly typeLabel = RESOURCE_TYPE_LABEL;
  protected readonly unitLabel = RESOURCE_UNIT_LABEL;
  protected readonly types = Object.keys(RESOURCE_TYPE_LABEL).filter(isResourceType);
  protected readonly units = Object.keys(RESOURCE_UNIT_LABEL).filter(isResourceUnit);
  protected readonly resources = computed(() =>
    this.store
      .data()
      .resources.filter((resource) => !resource.archived)
      .sort((a, b) => a.title.localeCompare(b.title, 'ru')),
  );
  protected readonly usage = computed(() => {
    const counts = new Map<string, number>();
    for (const item of this.store.data().items) {
      for (const ref of item.resourceRefs) {
        counts.set(ref.resourceId, (counts.get(ref.resourceId) ?? 0) + 1);
      }
    }
    return counts;
  });
  protected readonly topics = computed(() => {
    const tree = this.store.tree();
    return tree.sections.flatMap((section) =>
      (tree.topicsBySection.get(section.id) ?? []).map((topic) => ({ id: topic.id, label: `${section.title} · ${topic.title}` })),
    );
  });

  protected readonly editingId = signal<string | 'new' | null>(null);
  protected readonly draft = signal<IResourceDraft>(EMPTY_DRAFT);
  protected readonly error = signal('');
  protected readonly splitFor = signal<string | null>(null);
  protected readonly split = signal<{ readonly topicId: string; readonly partMin: number; readonly kind: TItemKind }>({ topicId: '', partMin: 60, kind: 'study' });

  protected startNew(): void {
    this.draft.set(EMPTY_DRAFT);
    this.error.set('');
    this.editingId.set('new');
  }

  protected edit(resource: IResource): void {
    this.draft.set({
      title: resource.title,
      type: resource.type,
      author: resource.author,
      url: resource.url,
      unit: resource.unit,
      unitCount: resource.unitCount,
      minPerUnit: resource.minPerUnit,
    });
    this.error.set('');
    this.editingId.set(resource.id);
  }

  protected patch(field: keyof IResourceDraft, event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) {
      return;
    }
    const value = target.value;
    this.draft.update((draft) => {
      switch (field) {
        case 'unitCount':
        case 'minPerUnit':
          return { ...draft, [field]: Number(value) };
        case 'type':
          return isResourceType(value) ? { ...draft, type: value } : draft;
        case 'unit':
          return isResourceUnit(value) ? { ...draft, unit: value } : draft;
        default:
          return { ...draft, [field]: value };
      }
    });
  }

  protected save(): void {
    const draft = this.draft();
    if (!draft.title.trim()) {
      this.error.set('Укажи название ресурса.');
      return;
    }
    if (draft.url && !/^https?:\/\//i.test(draft.url.trim())) {
      this.error.set('Ссылка должна начинаться с http:// или https://');
      return;
    }
    if (!Number.isFinite(draft.unitCount) || draft.unitCount < 0 || !Number.isFinite(draft.minPerUnit) || draft.minPerUnit < 0) {
      this.error.set('Объём и минуты на единицу — неотрицательные числа.');
      return;
    }
    const clean = { ...draft, title: draft.title.trim(), url: draft.url.trim(), author: draft.author.trim() };
    const id = this.editingId();
    if (id === 'new') {
      this.program.addResource(clean);
    } else if (id) {
      this.program.updateResource(id, clean);
    }
    this.editingId.set(null);
  }

  protected openSplit(resource: IResource): void {
    this.splitFor.set(resource.id);
    this.split.set({ topicId: this.topics()[0]?.id ?? '', partMin: 60, kind: resource.type === 'exercise' ? 'practice' : 'study' });
  }

  protected patchSplit(field: 'topicId' | 'partMin' | 'kind', event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) {
      return;
    }
    const value = target.value;
    this.split.update((split) =>
      field === 'partMin' ? { ...split, partMin: Number(value) } : field === 'kind' ? { ...split, kind: value === 'practice' ? 'practice' : 'study' } : { ...split, topicId: value },
    );
  }

  protected runSplit(resourceId: string): void {
    const split = this.split();
    if (!split.topicId || !Number.isFinite(split.partMin) || split.partMin < 15) {
      this.toasts.show({ text: 'Выбери тему и длину части от 15 минут.' });
      return;
    }
    const created = this.program.splitResource({ resourceId, topicId: split.topicId, partMin: split.partMin, kind: split.kind });
    this.splitFor.set(null);
    this.toasts.show({
      text: created > 0 ? `Добавлено топиков: ${created}. План пересчитан.` : 'У ресурса не указан объём — разбивать нечего.',
      kind: created > 0 ? 'success' : 'info',
    });
  }

  protected remove(resource: IResource): void {
    this.program.removeResource(resource.id);
  }
}

function isResourceType(value: string): value is TResourceType {
  return Object.prototype.hasOwnProperty.call(RESOURCE_TYPE_LABEL, value);
}

function isResourceUnit(value: string): value is TResourceUnit {
  return Object.prototype.hasOwnProperty.call(RESOURCE_UNIT_LABEL, value);
}
