import { FormsModule } from '@angular/forms';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { TuiButton, TuiCheckbox, TuiDialog, TuiTitle } from '@taiga-ui/core';
import { isCountable } from '../../domain';
import {
  DataStore,
  LOG_ERROR_TEXT,
  LogsService,
  NotesService,
  ProgramService,
  SessionDraftService,
  UiStateService,
  overlapText,
  type TDraftField,
} from '../../services';
import { SESSION_TYPE_LABEL, formatMinutes } from '../../utils';
import { MarkdownEditorComponent } from '../markdown-editor/markdown-editor.component';

/** Карточка итога после стопа таймера: длительность, рефлексия, галочка (FR-13, M7). Всё написанное — в черновике. */
@Component({
  selector: 'app-session-summary',
  imports: [FormsModule, TuiDialog, TuiButton, TuiCheckbox, TuiTitle, MarkdownEditorComponent],
  templateUrl: './session-summary.component.html',
  styleUrls: ['./dialogs.scss', './session-summary.component.scss'],
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
  /** Предупреждение FR-14: новая длина пересекается с другой сессией, запись ждёт «Сохранить обе» (Q-050). */
  protected readonly overlapWarning = signal('');
  /** Минуты, которые запишет «Сохранить обе»; null — ждать нечего. */
  private pendingMinutes: number | null = null;

  constructor() {
    effect(() => {
      const log = this.log();
      if (log) {
        // Предупреждение считалось по прежнему логу: после записи или для другого лога его нет
        this.clearOverlap();
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

  /** id заголовка — id окна Taiga, на него ссылается `aria-labelledby` окна; контекст окна шаблон получает без типа. */
  protected headingId(dialogId: unknown): string | null {
    return typeof dialogId === 'string' ? dialogId : null;
  }

  protected text(event: Event): string {
    const target = event.target;
    return target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement ? target.value : '';
  }

  protected edit(field: TDraftField, value: string): void {
    this.drafts.set(field, value);
  }

  /**
   * Новая длина пишется сразу, кроме пересечения с другой сессией: тогда, как «Сохранить» в списке логов (FR-14),
   * карточка предупреждает и пишет только по «Сохранить обе» (Q-050). Минуты шагов — по Д-7 в `LogsService`.
   */
  protected setDuration(event: Event): void {
    const minutes = Number(this.text(event));
    const log = this.log();
    if (!log) {
      return;
    }
    const check = this.logsService.checkDuration(log.id, minutes);
    if (check.overlap) {
      this.durationError.set('');
      this.pendingMinutes = minutes;
      this.overlapWarning.set(overlapText(check.overlap));
      return;
    }
    this.save(minutes);
  }

  /** «Сохранить обе»: записать новую длину, хотя сессии пересекаются. Фокус остаётся у поля минут. */
  protected keepBoth(field: HTMLInputElement): void {
    const minutes = this.pendingMinutes;
    this.clearOverlap();
    if (minutes !== null) {
      this.save(minutes);
    }
    field.focus();
  }

  /** «Исправить время»: ничего не пишется, в поле снова записанные минуты — правка минут с начала. */
  protected fixTime(field: HTMLInputElement): void {
    this.clearOverlap();
    field.value = String(this.duration());
    field.focus();
    field.select();
  }

  /** Убрать предупреждение и ждущие минуты. Ввод в поле убирает его, как правка поля в списке логов: новое число проверит `change`. */
  protected clearOverlap(): void {
    this.pendingMinutes = null;
    this.overlapWarning.set('');
  }

  private save(minutes: number): void {
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
    // Новая длина, которая ждала «Сохранить обе», не пишется: пересечение не подтвердили
    this.clearOverlap();
    this.durationError.set('');
    this.drafts.clear();
    this.ui.summaryLogId.set(null);
  }
}
