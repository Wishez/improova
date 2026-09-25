import { FormsModule } from '@angular/forms';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { TuiButton, TuiCheckbox, TuiDialog } from '@taiga-ui/core';
import { isCountable } from '../../domain';
import { DataStore, LOG_ERROR_TEXT, LogsService, NotesService, ProgramService, UiStateService } from '../../services';
import { SESSION_TYPE_LABEL, formatMinutes } from '../../utils';

/** Карточка итога после стопа таймера: длительность, рефлексия, галочка (FR-13, M7). */
@Component({
  selector: 'app-session-summary',
  imports: [FormsModule, TuiDialog, TuiButton, TuiCheckbox],
  templateUrl: './session-summary.component.html',
  styleUrl: './dialogs.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SessionSummaryComponent {
  private readonly store = inject(DataStore);
  private readonly logsService = inject(LogsService);
  private readonly notes = inject(NotesService);
  private readonly program = inject(ProgramService);
  protected readonly ui = inject(UiStateService);

  protected readonly log = computed(() => {
    const id = this.ui.summaryLogId();
    return id ? (this.store.data().timeLogs.find((entry) => entry.id === id) ?? null) : null;
  });
  protected readonly item = computed(() => {
    const itemId = this.log()?.itemId;
    return itemId ? (this.store.data().items.find((entry) => entry.id === itemId) ?? null) : null;
  });
  protected readonly canClose = computed(() => {
    const item = this.item();
    return item !== null && isCountable(item);
  });
  protected readonly heading = computed(() => {
    const log = this.log();
    return log ? `Сессия записана · ${formatMinutes(log.durationMin)}` : '';
  });
  protected readonly subtitle = computed(() => {
    const log = this.log();
    return this.item()?.title ?? (log ? SESSION_TYPE_LABEL[log.type] : '');
  });

  protected readonly worked = signal('');
  protected readonly failed = signal('');
  protected readonly next = signal('');
  protected readonly body = signal('');
  protected readonly done = signal(false);
  protected readonly duration = signal(0);
  protected readonly durationError = signal('');

  constructor() {
    effect(() => {
      const log = this.log();
      if (log) {
        this.duration.set(log.durationMin);
        this.done.set(this.item()?.doneAt != null);
      }
    });
    effect(() => {
      if (this.ui.summaryLogId()) {
        this.body.set(this.ui.sessionDraft());
      }
    });
  }

  protected text(event: Event): string {
    const target = event.target;
    return target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement ? target.value : '';
  }

  protected setDuration(event: Event): void {
    const minutes = Number(this.text(event));
    const log = this.log();
    if (!log) {
      return;
    }
    const error = this.logsService.setDuration(log.id, minutes);
    this.durationError.set(error ? LOG_ERROR_TEXT[error] : '');
    if (!error) {
      this.duration.set(minutes);
    }
  }

  protected onOpenChange(open: boolean): void {
    if (!open) {
      this.finish();
    }
  }

  /** Лог уже сохранён; заметка создаётся, только если что-то написано. */
  protected finish(): void {
    const log = this.log();
    if (log) {
      const hasText = [this.worked(), this.failed(), this.next(), this.body()].some((value) => value.trim() !== '');
      if (hasText) {
        this.notes.create({
          itemId: log.itemId,
          logId: log.id,
          body: this.body(),
          worked: this.worked(),
          failed: this.failed(),
          next: this.next(),
        });
      }
      const item = this.item();
      if (item && this.canClose() && this.done() !== (item.doneAt !== null)) {
        this.program.setDone(item.id, this.done());
      }
    }
    this.worked.set('');
    this.failed.set('');
    this.next.set('');
    this.body.set('');
    this.durationError.set('');
    this.ui.sessionDraft.set('');
    this.ui.summaryLogId.set(null);
  }
}
