import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { TuiButton } from '@taiga-ui/core';
import { TechniqueCardComponent } from '../../components/technique-card/technique-card.component';
import {
  TECHNIQUE_GROUPS,
  filterTechniques,
  techniqueUsage,
  type ITechniqueUsage,
} from '../../domain';
import { TECHNIQUES } from '../../seed';
import { CourseService, DataStore, UiStateService } from '../../services';
import type { ITechnique, TTechniqueGroup } from '../../types';

interface IGroupView {
  readonly id: TTechniqueGroup;
  readonly label: string;
  readonly cards: readonly {
    readonly technique: ITechnique;
    readonly usage: readonly ITechniqueUsage[];
  }[];
}

/** Справочник приёмов в программе (FR-51): все карточки по группам, поиск, «Где используется». */
@Component({
  selector: 'app-techniques-panel',
  imports: [TuiButton, TechniqueCardComponent],
  templateUrl: './techniques-panel.component.html',
  styleUrl: './techniques-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TechniquesPanelComponent {
  private readonly store = inject(DataStore);
  private readonly course = inject(CourseService);
  private readonly ui = inject(UiStateService);

  protected readonly total = TECHNIQUES.length;
  protected readonly query = signal('');
  /** Где используется каждый приём — по активным топикам и технике блоков маршрута. */
  private readonly usage = computed(() => {
    const data = this.store.data();
    const routeTechniqueNames = this.course.routeBlocks().map((block) => block.copyTechnique);
    return new Map(
      TECHNIQUES.map((technique) => [
        technique.key,
        techniqueUsage({
          technique,
          items: data.items,
          topics: data.topics,
          sections: data.sections,
          routeTechniqueNames,
          catalog: TECHNIQUES,
        }),
      ]),
    );
  });
  protected readonly groups = computed<readonly IGroupView[]>(() => {
    const found = new Set(filterTechniques(this.query(), TECHNIQUES).map((entry) => entry.key));
    const usage = this.usage();
    return TECHNIQUE_GROUPS.map((group) => ({
      ...group,
      cards: TECHNIQUES.filter((entry) => entry.group === group.id && found.has(entry.key)).map(
        (technique) => ({
          technique,
          usage: usage.get(technique.key) ?? [],
        }),
      ),
    })).filter((group) => group.cards.length > 0);
  });

  /** Открывает первый топик темы, где встречается приём. */
  protected open(usage: ITechniqueUsage): void {
    const first = usage.items[0];
    if (first) {
      this.ui.openItem(first.id);
    }
  }

  protected text(event: Event): string {
    const target = event.target;
    return target instanceof HTMLInputElement ? target.value : '';
  }
}
