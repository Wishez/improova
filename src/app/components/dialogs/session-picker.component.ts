import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { TuiDialog } from '@taiga-ui/core';
import type { IItem, TSessionType } from '../../types';
import { DataStore, PlanService, TimerService, UiStateService } from '../../services';

interface IPickOption {
  readonly item: IItem | null;
  readonly title: string;
  readonly meta: string;
  readonly type: TSessionType;
}

/** Выбор топика для сессии вне плана (today.restDay.cta, stats.empty.cta). */
@Component({
  selector: 'app-session-picker',
  imports: [TuiDialog],
  template: `
    <ng-template
      [tuiDialog]="ui.pickerOpen() !== null"
      [tuiDialogOptions]="{ label: 'Начать сессию', size: 'm' }"
      (tuiDialogChange)="$event || ui.pickerOpen.set(null)"
    >
      <div class="dlg">
        <input class="input" type="search" placeholder="Найти топик" aria-label="Найти топик" [value]="query()" (input)="onQuery($event)" (keydown.enter)="startFirst()" />
        <ul class="dlg__list" role="listbox" aria-label="Топики">
          @for (option of options(); track option.item?.id ?? option.title) {
            <li>
              <button type="button" class="dlg__option" role="option" [attr.aria-selected]="false" (click)="start(option)">
                <span>{{ option.title }}</span>
                <span class="dlg__optionMeta">{{ option.meta }}</span>
              </button>
            </li>
          } @empty {
            <li class="dlg__group">По запросу «{{ query() }}» топиков нет</li>
          }
        </ul>
      </div>
    </ng-template>
  `,
  styleUrl: './dialogs.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SessionPickerComponent {
  private readonly store = inject(DataStore);
  private readonly plan = inject(PlanService);
  private readonly timer = inject(TimerService);
  protected readonly ui = inject(UiStateService);
  protected readonly query = signal('');

  protected readonly options = computed<IPickOption[]>(() => {
    const tree = this.store.tree();
    const needle = this.query().trim().toLowerCase();
    const planned = new Set(this.plan.plan().days.flatMap((day) => day.blocks.map((block) => block.itemId)));
    const creative: IPickOption = { item: null, title: 'Свободное творчество', meta: 'без топика', type: 'creative' };
    const items: IPickOption[] = [...tree.itemById.values()]
      .filter((item) => item.doneAt === null || item.recurrenceWeeks !== null)
      .filter((item) => needle === '' || item.title.toLowerCase().includes(needle))
      .sort((a, b) => Number(planned.has(b.id)) - Number(planned.has(a.id)))
      .slice(0, 40)
      .map((item) => {
        const topic = tree.topicById.get(item.topicId);
        const section = topic ? tree.sectionById.get(topic.sectionId) : undefined;
        return { item, title: item.title, meta: `${section?.title ?? ''} · ${topic?.title ?? ''}`, type: item.kind };
      });
    return needle === '' || 'свободное творчество'.includes(needle) ? [creative, ...items] : items;
  });

  constructor() {
    effect(() => {
      if (this.ui.pickerOpen() === null) {
        this.query.set('');
      }
    });
  }

  protected onQuery(event: Event): void {
    const target = event.target;
    if (target instanceof HTMLInputElement) {
      this.query.set(target.value);
    }
  }

  protected startFirst(): void {
    const first = this.options()[0];
    if (first) {
      this.start(first);
    }
  }

  protected start(option: IPickOption): void {
    this.ui.pickerOpen.set(null);
    this.timer.start({ itemId: option.item?.id ?? null, type: option.type, plannedMin: option.item ? Math.min(option.item.estimateMin, 90) : 30 });
  }
}
