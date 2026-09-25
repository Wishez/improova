import { FormsModule } from '@angular/forms';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { TuiButton, TuiCheckbox, TuiDialog } from '@taiga-ui/core';
import { isCountable } from '../../domain';
import { DataStore, LOG_ERROR_TEXT, LogsService, NotesService, ProgramService, SessionDraftService, UiStateService, type TDraftField } from '../../services';
import { SESSION_TYPE_LABEL, formatMinutes } from '../../utils';
import { MarkdownEditorComponent } from '../markdown-editor/markdown-editor.component';

/** Карточка итога после стопа таймера: длительность, рефлексия, галочка (FR-13, M7). Всё написанное — в черновике. */
@Component({
  selector: 'app-session-summary',
  imports: [FormsModule, TuiDialog, TuiButton, TuiCheckbox, MarkdownEditorComponent],
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
  protected readonly drafts = inject(SessionDraftService);

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

  protected readonly draft = this.drafts.draft;
  protected readonly done = signal(false);
  protected readonly duration = signal(0);
  protected readonly durationError = signal('');

  constructor() {
    effect(() => {
      const log = this.log();
      if (log) {
        this.duration.set(log.durationMin);
        this.done.set(this.item()?.doneAt != null);
        // Черновик из режима фокуса привязывается к логу; чужой устаревший — сбрасывается
        untracked(() => {
          const logId = this.drafts.draft().logId;
          if (logId !== log.id) {
            if (logId !== null) {
              this.drafts.clear();
            }
            this.drafts.attach(log.id);
          }
        });
      }
    });
  }

  protected text(event: Event): string {
    const target = event.target;
    return target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement ? target.value : '';
  }

  protected edit(field: TDraftField, value: string): void {
    this.drafts.set(field, value);
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
    const draft = this.draft();
    if (log) {
      const hasText = [draft.worked, draft.failed, draft.next, draft.body].some((value) => value.trim() !== '');
      if (hasText) {
        this.notes.create({
          itemId: log.itemId,
          logId: log.id,
          body: draft.body,
          worked: draft.worked,
          failed: draft.failed,
          next: draft.next,
        });
      }
      const item = this.item();
      if (item && this.canClose() && this.done() !== (item.doneAt !== null)) {
        this.program.setDone(item.id, this.done());
      }
    }
    this.durationError.set('');
    this.drafts.clear();
    this.ui.summaryLogId.set(null);
  }
}
