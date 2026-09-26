import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { topicBeforeAfter } from '../../domain';
import { DayShortPipe, MarkdownPipe } from '../../pipes';
import { DataStore } from '../../services';
import type { IItem } from '../../types';
import { ACCESS_LABEL, RESOURCE_TYPE_LABEL, toDayKey } from '../../utils';

/** Сколько прошлых заметок по топику показывать в сессии: свежие важнее, лента — в «Заметках». */
const SESSION_NOTES = 3;

/**
 * Карточка урока в сессии: тема, ресурсы с главами, самопроверка, прошлые заметки и «Было / стало».
 * Только чтение: правка — в карточке топика (FR-08, FR-35).
 */
@Component({
  selector: 'app-lesson-info',
  imports: [MarkdownPipe, DayShortPipe],
  templateUrl: './lesson-info.component.html',
  styleUrl: './lesson-info.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LessonInfoComponent {
  readonly item = input.required<IItem>();

  private readonly store = inject(DataStore);

  protected readonly typeLabel = RESOURCE_TYPE_LABEL;
  protected readonly accessLabel = ACCESS_LABEL;
  protected readonly topic = computed(() => this.store.data().topics.find((entry) => entry.id === this.item().topicId) ?? null);
  protected readonly section = computed(() => {
    const topic = this.topic();
    return topic ? (this.store.data().sections.find((entry) => entry.id === topic.sectionId) ?? null) : null;
  });
  protected readonly refs = computed(() => {
    const resources = this.store.resourcesById();
    return this.item().resourceRefs.map((ref) => ({ ref, resource: resources.get(ref.resourceId) ?? null }));
  });
  protected readonly notes = computed(() => {
    const boundary = this.store.settings().dayBoundaryHour;
    return this.store
      .data()
      .notes.filter((note) => note.itemId === this.item().id && [note.body, note.worked, note.failed, note.next].some((text) => text.trim() !== ''))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, SESSION_NOTES)
      .map((note) => ({ note, day: toDayKey(new Date(note.createdAt), boundary) }));
  });
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
}
