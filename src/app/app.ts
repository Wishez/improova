import { ChangeDetectionStrategy, Component, HostListener, afterNextRender, effect, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { TuiButton, TuiIcon, TuiRoot } from '@taiga-ui/core';
import {
  CelebrationComponent,
  CommandPaletteComponent,
  FocusOverlayComponent,
  ForgottenDialogComponent,
  ItemDrawerComponent,
  MiniTimerComponent,
  SessionPickerComponent,
  SessionSummaryComponent,
  SwitchConfirmComponent,
  ToastHostComponent,
} from './components';
import { BackupService, DataStore, NotesService, PlanService, TimerService, UiStateService } from './services';

interface INavLink {
  readonly path: string;
  readonly label: string;
  readonly icon: string;
}

@Component({
  selector: 'app-root',
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    TuiRoot,
    TuiIcon,
    TuiButton,
    MiniTimerComponent,
    ItemDrawerComponent,
    SessionSummaryComponent,
    ForgottenDialogComponent,
    SwitchConfirmComponent,
    FocusOverlayComponent,
    ToastHostComponent,
    CelebrationComponent,
    SessionPickerComponent,
    CommandPaletteComponent,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  protected readonly store = inject(DataStore);
  protected readonly timer = inject(TimerService);
  protected readonly ui = inject(UiStateService);
  private readonly plan = inject(PlanService);
  private readonly backup = inject(BackupService);
  private readonly notes = inject(NotesService);
  private readonly router = inject(Router);

  constructor() {
    // Диалог забытого таймера открываем после первой отрисовки, когда портал Taiga готов (FR-11).
    afterNextRender(() => setTimeout(() => this.timer.checkForgotten(), 300));
    // Новая заметка из любого места (N, палитра, «Записать итог дня») открывается в ленте.
    effect(() => {
      const itemId = this.ui.newNoteForItem();
      if (itemId === undefined) {
        return;
      }
      this.ui.newNoteForItem.set(undefined);
      const note = this.notes.create({ itemId });
      void this.router.navigate(['/notes'], { queryParams: { open: note.id } });
    });
  }

  protected readonly links: readonly INavLink[] = [
    { path: '/today', label: 'Сегодня', icon: '@tui.sun' },
    { path: '/program', label: 'Программа', icon: '@tui.list-tree' },
    { path: '/plan', label: 'План', icon: '@tui.calendar-days' },
    { path: '/notes', label: 'Заметки', icon: '@tui.notebook-pen' },
    { path: '/stats', label: 'Статистика', icon: '@tui.chart-column' },
    { path: '/settings', label: 'Настройки', icon: '@tui.settings' },
  ];

  protected retry(): void {
    void this.store.init();
  }

  protected async restore(event: Event): Promise<void> {
    const input = event.target;
    const file = input instanceof HTMLInputElement ? input.files?.[0] : undefined;
    if (!file) {
      return;
    }
    const check = this.backup.check(await file.text());
    if (check.ok) {
      await this.backup.apply(check.snapshot, 'replace');
      this.store.status.set('ready');
    }
  }

  /** Предупреждение о несохранённых изменениях при закрытии вкладки (US-05). */
  @HostListener('window:beforeunload', ['$event'])
  protected onUnload(event: BeforeUnloadEvent): void {
    if (this.store.unsaved() > 0) {
      event.preventDefault();
    }
  }

  /** Горячие клавиши FR-34: Space — таймер, N — заметка, Ctrl+K — палитра. */
  @HostListener('document:keydown', ['$event'])
  protected onKey(event: KeyboardEvent): void {
    if (this.store.status() !== 'ready' || !this.store.meta().onboarded) {
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      this.ui.paletteOpen.set(true);
      return;
    }
    const target = event.target;
    const typing =
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      (target instanceof HTMLElement && target.isContentEditable);
    const inDialog = target instanceof Element && target.closest('[role="dialog"], tui-dialog, .drawer') !== null;
    if (typing || inDialog || event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }
    if (event.code === 'Space') {
      const focusable = target instanceof HTMLButtonElement || target instanceof HTMLAnchorElement;
      if (focusable) {
        return;
      }
      event.preventDefault();
      if (this.timer.running()) {
        this.timer.toggle();
        return;
      }
      const next = this.plan.today()?.blocks[0];
      if (next) {
        this.timer.start({ itemId: next.itemId, type: next.type, plannedMin: next.plannedMin });
      } else {
        this.ui.pickerOpen.set('practice');
      }
    } else if (event.key.toLowerCase() === 'n' || event.key.toLowerCase() === 'т') {
      event.preventDefault();
      this.ui.newNoteForItem.set(this.timer.state()?.itemId ?? null);
    }
  }
}
