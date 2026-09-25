import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { TuiButton, TuiHint } from '@taiga-ui/core';
import { ClockTimePipe, DayShortPipe, MinutesPipe } from '../../pipes';
import { DataStore, LOG_ERROR_TEXT, LogsService, findOverlap, overlapText, validateLog } from '../../services';
import type { ITimeLog, TSessionType } from '../../types';
import { SESSION_TYPE_LABEL, fromLocalInputValue, toDayKey, toLocalInputValue } from '../../utils';

interface IDraft {
  readonly start: string;
  readonly minutes: number;
  readonly type: TSessionType;
}

/** Список логов с инлайн-правкой и ручным добавлением (FR-14, US-03). */
@Component({
  selector: 'app-log-list',
  imports: [NgTemplateOutlet, TuiButton, TuiHint, MinutesPipe, DayShortPipe, ClockTimePipe],
  templateUrl: './log-list.component.html',
  styleUrl: './log-list.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LogListComponent {
  private readonly store = inject(DataStore);
  private readonly logsService = inject(LogsService);

  readonly logs = input.required<readonly ITimeLog[]>();
  /** Топик для ручного добавления; undefined — добавление скрыто. */
  readonly itemId = input<string | null | undefined>(undefined);
  readonly showItem = input(false);
  readonly limit = input(50);

  protected readonly types: readonly TSessionType[] = ['study', 'practice', 'creative', 'review'];
  protected readonly typeLabel = SESSION_TYPE_LABEL;
  protected readonly editingId = signal<string | null>(null);
  protected readonly adding = signal(false);
  protected readonly draft = signal<IDraft>({ start: '', minutes: 30, type: 'practice' });
  protected readonly error = signal('');
  protected readonly overlapWarning = signal('');

  protected readonly visible = computed(() =>
    [...this.logs()].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, this.limit()),
  );

  protected itemTitle(log: ITimeLog): string {
    if (!log.itemId) {
      return this.typeLabel[log.type];
    }
    return this.store.tree().itemById.get(log.itemId)?.title ?? 'Топик в архиве';
  }

  protected dayOf(log: ITimeLog): string {
    return toDayKey(new Date(log.startedAt), this.store.settings().dayBoundaryHour);
  }

  protected edit(log: ITimeLog): void {
    this.adding.set(false);
    this.editingId.set(log.id);
    this.draft.set({ start: toLocalInputValue(log.startedAt), minutes: log.durationMin, type: log.type });
    this.error.set('');
    this.overlapWarning.set('');
  }

  protected startAdding(): void {
    this.editingId.set(null);
    this.adding.set(true);
    const start = new Date(Date.now() - 30 * 60_000).toISOString();
    const item = this.itemId() ? this.store.tree().itemById.get(this.itemId() ?? '') : undefined;
    this.draft.set({ start: toLocalInputValue(start), minutes: 30, type: item?.kind ?? 'creative' });
    this.error.set('');
    this.overlapWarning.set('');
  }

  protected cancel(): void {
    this.editingId.set(null);
    this.adding.set(false);
    this.error.set('');
    this.overlapWarning.set('');
  }

  protected patch(field: keyof IDraft, event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) {
      return;
    }
    const value = target.value;
    this.draft.update((draft) => {
      if (field === 'minutes') {
        return { ...draft, minutes: Number(value) };
      }
      if (field === 'type') {
        const type = this.types.find((entry) => entry === value);
        return type ? { ...draft, type } : draft;
      }
      return { ...draft, start: value };
    });
    this.overlapWarning.set('');
  }

  protected save(): void {
    const draft = this.draft();
    const startedAt = fromLocalInputValue(draft.start);
    if (!startedAt) {
      this.error.set(LOG_ERROR_TEXT.invalid);
      return;
    }
    if (!Number.isFinite(draft.minutes) || draft.minutes < 1 || draft.minutes > 720) {
      this.error.set(LOG_ERROR_TEXT.duration);
      return;
    }
    const endedAt = new Date(Date.parse(startedAt) + Math.round(draft.minutes) * 60_000).toISOString();
    const validation = validateLog({ startedAt, endedAt }, Date.now());
    if (validation) {
      this.error.set(LOG_ERROR_TEXT[validation]);
      return;
    }
    const editing = this.editingId();
    const overlap = findOverlap({ startedAt, endedAt }, this.store.logs(), editing);
    if (overlap && !this.overlapWarning()) {
      this.overlapWarning.set(overlapText(overlap));
      return;
    }
    if (editing) {
      const error = this.logsService.update(editing, { startedAt, endedAt, type: draft.type });
      if (error) {
        this.error.set(LOG_ERROR_TEXT[error]);
        return;
      }
    } else {
      this.logsService.create({ itemId: this.itemId() ?? null, type: draft.type, startedAt, endedAt, source: 'manual' });
    }
    this.cancel();
  }

  protected remove(log: ITimeLog): void {
    this.cancel();
    this.logsService.remove(log.id);
  }
}
