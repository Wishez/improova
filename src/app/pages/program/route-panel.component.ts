import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TuiButton } from '@taiga-ui/core';
import { ANALYSIS_QUESTIONS } from '../../domain';
import { CourseService } from '../../services';
import type { IRouteArtist, IRouteBlock } from '../../types';

/** Маршрут по мастерам: 12 блоков на год, замена художника и сдвиг недель (FR-39). */
@Component({
  selector: 'app-route-panel',
  imports: [TuiButton],
  templateUrl: './route-panel.component.html',
  styleUrl: './route-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RoutePanelComponent {
  protected readonly course = inject(CourseService);
  protected readonly questions = ANALYSIS_QUESTIONS;
  protected readonly blocks = this.course.routeBlocks;
  protected readonly currentId = computed(() => this.course.focus()?.block.id ?? null);
  /** Пересечения недель между блоками — подсветка ошибки в форме. */
  protected readonly overlaps = computed(() => {
    const ids = new Set<string>();
    const blocks = this.blocks();
    for (const block of blocks) {
      for (const other of blocks) {
        if (block.id !== other.id && block.fromWeek <= other.toWeek && other.fromWeek <= block.toWeek) {
          ids.add(block.id);
        }
      }
    }
    return ids;
  });

  protected setWeeks(block: IRouteBlock, field: 'fromWeek' | 'toWeek', event: Event): void {
    const value = Math.round(Number(this.text(event)));
    if (!Number.isFinite(value) || value < 1) {
      return;
    }
    const next = { fromWeek: block.fromWeek, toWeek: block.toWeek, [field]: value };
    if (next.fromWeek <= next.toWeek) {
      this.course.updateBlock(block.id, next);
    }
  }

  protected setArtist(block: IRouteBlock, index: number, patch: Partial<IRouteArtist>): void {
    const artists = [0, 1].map((position) => {
      const current = block.artists[position] ?? { name: '', url: '', takeaway: '', works: '' };
      return position === index ? { ...current, ...patch } : current;
    });
    this.course.updateBlock(block.id, { artists });
  }

  protected setText(block: IRouteBlock, field: 'copyTask' | 'copyTechnique', event: Event): void {
    this.course.updateBlock(block.id, { [field]: this.text(event).trim() });
  }

  protected artist(block: IRouteBlock, index: number): IRouteArtist {
    return block.artists[index] ?? { name: '', url: '', takeaway: '', works: '' };
  }

  protected text(event: Event): string {
    const target = event.target;
    return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement ? target.value : '';
  }
}
