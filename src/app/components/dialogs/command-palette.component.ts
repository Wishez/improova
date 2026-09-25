import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { TuiDialog } from '@taiga-ui/core';
import { BackupService, DataStore, TimerService, UiStateService } from '../../services';

interface ICommand {
  readonly id: string;
  readonly title: string;
  readonly meta: string;
  readonly run: () => void;
}

/** Палитра команд Ctrl+K: переход, старт топика, поиск (FR-34). */
@Component({
  selector: 'app-command-palette',
  imports: [TuiDialog],
  template: `
    <ng-template
      [tuiDialog]="ui.paletteOpen()"
      [tuiDialogOptions]="{ label: 'Команды', size: 'm' }"
      (tuiDialogChange)="ui.paletteOpen.set($event)"
    >
      <div class="dlg">
        <input
          class="input"
          type="search"
          placeholder="Перейти, начать топик, найти…"
          aria-label="Команда"
          [value]="query()"
          (input)="onQuery($event)"
          (keydown)="onKey($event)"
        />
        <ul class="dlg__list" role="listbox" aria-label="Команды">
          @for (command of commands(); track command.id; let index = $index) {
            <li>
              <button
                type="button"
                role="option"
                class="dlg__option"
                [class.dlg__option_active]="index === active()"
                [attr.aria-selected]="index === active()"
                (click)="run(command)"
              >
                <span>{{ command.title }}</span>
                <span class="dlg__optionMeta">{{ command.meta }}</span>
              </button>
            </li>
          } @empty {
            <li class="dlg__group">Ничего не найдено</li>
          }
        </ul>
      </div>
    </ng-template>
  `,
  styleUrl: './dialogs.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommandPaletteComponent {
  protected readonly ui = inject(UiStateService);
  private readonly router = inject(Router);
  private readonly store = inject(DataStore);
  private readonly timer = inject(TimerService);
  private readonly backup = inject(BackupService);
  protected readonly query = signal('');
  protected readonly active = signal(0);

  private readonly base = computed<ICommand[]>(() => [
    { id: 'go-today', title: 'Сегодня', meta: 'переход', run: () => void this.router.navigateByUrl('/today') },
    { id: 'go-program', title: 'Программа', meta: 'переход', run: () => void this.router.navigateByUrl('/program') },
    { id: 'go-plan', title: 'План', meta: 'переход', run: () => void this.router.navigateByUrl('/plan') },
    { id: 'go-notes', title: 'Заметки', meta: 'переход', run: () => void this.router.navigateByUrl('/notes') },
    { id: 'go-stats', title: 'Статистика', meta: 'переход', run: () => void this.router.navigateByUrl('/stats') },
    { id: 'go-settings', title: 'Настройки', meta: 'переход', run: () => void this.router.navigateByUrl('/settings') },
    { id: 'note', title: 'Новая заметка', meta: 'N', run: () => this.ui.newNoteForItem.set(this.timer.state()?.itemId ?? null) },
    { id: 'creative', title: 'Начать свободное творчество', meta: 'сессия', run: () => this.timer.start({ itemId: null, type: 'creative', plannedMin: 30 }) },
    { id: 'export', title: 'Скачать копию данных', meta: 'JSON', run: () => this.backup.exportFull() },
  ]);

  protected readonly commands = computed<ICommand[]>(() => {
    const needle = this.query().trim().toLowerCase();
    const base = this.base().filter((command) => needle === '' || command.title.toLowerCase().includes(needle));
    if (needle.length < 2) {
      return base;
    }
    const tree = this.store.tree();
    const items = [...tree.itemById.values()]
      .filter((item) => item.title.toLowerCase().includes(needle))
      .slice(0, 12)
      .flatMap<ICommand>((item) => [
        {
          id: `start-${item.id}`,
          title: `Старт: ${item.title}`,
          meta: tree.topicById.get(item.topicId)?.title ?? '',
          run: () => this.timer.start({ itemId: item.id, type: item.kind, plannedMin: Math.min(item.estimateMin, 90) }),
        },
        { id: `open-${item.id}`, title: `Открыть: ${item.title}`, meta: 'карточка топика', run: () => this.ui.openItem(item.id) },
      ]);
    return [...base, ...items];
  });

  constructor() {
    effect(() => {
      if (!this.ui.paletteOpen()) {
        this.query.set('');
        this.active.set(0);
      }
    });
  }

  protected onQuery(event: Event): void {
    const target = event.target;
    if (target instanceof HTMLInputElement) {
      this.query.set(target.value);
      this.active.set(0);
    }
  }

  protected onKey(event: KeyboardEvent): void {
    const count = this.commands().length;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.active.set(count > 0 ? (this.active() + 1) % count : 0);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.active.set(count > 0 ? (this.active() - 1 + count) % count : 0);
    } else if (event.key === 'Enter') {
      const command = this.commands()[this.active()];
      if (command) {
        this.run(command);
      }
    }
  }

  protected run(command: ICommand): void {
    this.ui.paletteOpen.set(false);
    command.run();
  }
}
