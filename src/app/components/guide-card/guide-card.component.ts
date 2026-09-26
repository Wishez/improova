import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { TuiButton } from '@taiga-ui/core';
import { ANALYSIS_QUESTIONS, EMPTY_GUIDE, GUIDE_LIMITS, stepsTotal, validateGuide, type TGuideField } from '../../domain';
import { CourseService, DataStore, ProgramService } from '../../services';
import type { IGuide, IGuideLink, IGuideStep, IItem, TLinkAccess } from '../../types';
import { ACCESS_LABEL } from '../../utils';

interface IGuideDraft {
  goal: string;
  task: string;
  steps: IGuideStep[];
  stopCriterion: string;
  links: IGuideLink[];
  references: IGuideLink[];
  pitfalls: string;
}

const toDraft = (guide: IGuide): IGuideDraft => ({
  goal: guide.goal,
  task: guide.task,
  steps: guide.steps.map((entry) => ({ ...entry })),
  stopCriterion: guide.stopCriterion,
  links: guide.links.map((entry) => ({ ...entry })),
  references: guide.references.map((entry) => ({ ...entry })),
  pitfalls: guide.pitfalls.join('\n'),
});

const emptyLink = (): IGuideLink => ({ title: '', url: '', locator: '', access: 'free' });

/** Ориентир топика в карточке: просмотр и редактирование по полям (FR-37), блок маршрута мастеров (FR-39). */
@Component({
  selector: 'app-guide-card',
  imports: [TuiButton],
  templateUrl: './guide-card.component.html',
  styleUrl: './guide-card.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GuideCardComponent {
  readonly item = input.required<IItem>();
  /** Режим фокуса: ориентир целиком, только чтение — без правки и приглашения заполнить. */
  readonly session = input(false);
  /** Текущий шаг таймера в сессии — подсвечивается в списке шагов; null — вне сессии. */
  readonly activeStep = input<number | null>(null);

  private readonly store = inject(DataStore);
  private readonly program = inject(ProgramService);
  private readonly course = inject(CourseService);

  protected readonly accessLabel = ACCESS_LABEL;
  /** Правки ориентира нестартового топика курса заменятся при обновлении курса (FR-44). */
  protected readonly courseHint = computed(() => {
    const item = this.item();
    return item.courseKey !== null && item.doneAt === null && (this.store.spent().get(item.id) ?? 0) === 0;
  });
  protected readonly questions = ANALYSIS_QUESTIONS;
  protected readonly limits = GUIDE_LIMITS;
  protected readonly editing = signal(false);
  protected readonly draft = signal<IGuideDraft>(toDraft(EMPTY_GUIDE));
  protected readonly errors = signal<Partial<Record<TGuideField, string>>>({});
  /** Сумма шагов разошлась с оценкой сессии — ждём решения пользователя (US-10). */
  protected readonly mismatch = signal<{ readonly steps: number; readonly session: number } | null>(null);

  protected readonly guide = computed(() => this.item().guide);
  protected readonly task = computed(() => this.course.taskOf(this.item()));
  protected readonly total = computed(() => stepsTotal(this.guide() ?? EMPTY_GUIDE));
  protected readonly focus = computed(() => (this.item().routeRole ? this.course.focus() : null));
  protected readonly week = this.course.week;
  protected readonly photos = computed(() => {
    const assets = this.store.assetsById();
    return (this.guide()?.imageIds ?? []).flatMap((id) => {
      const asset = assets.get(id);
      return asset ? [asset] : [];
    });
  });
  protected readonly draftTotal = computed(() => this.draft().steps.reduce((sum, entry) => sum + (Number.isFinite(entry.minutes) ? entry.minutes : 0), 0));

  protected edit(): void {
    this.draft.set(toDraft(this.guide() ?? { ...EMPTY_GUIDE, steps: [{ title: '', minutes: Math.min(this.item().estimateMin, this.sessionMinutes()) }] }));
    this.errors.set({});
    this.mismatch.set(null);
    this.editing.set(true);
  }

  protected cancel(): void {
    this.editing.set(false);
    this.mismatch.set(null);
  }

  protected patch(update: Partial<IGuideDraft>): void {
    this.draft.update((draft) => ({ ...draft, ...update }));
  }

  protected setStep(index: number, update: Partial<IGuideStep>): void {
    this.patch({ steps: this.draft().steps.map((entry, position) => (position === index ? { ...entry, ...update } : entry)) });
  }

  protected addStep(): void {
    this.patch({ steps: [...this.draft().steps, { title: '', minutes: 10 }] });
  }

  protected removeStep(index: number): void {
    this.patch({ steps: this.draft().steps.filter((_, position) => position !== index) });
  }

  protected setLink(list: 'links' | 'references', index: number, update: Partial<IGuideLink>): void {
    this.patch({ [list]: this.draft()[list].map((entry, position) => (position === index ? { ...entry, ...update } : entry)) });
  }

  protected addLink(list: 'links' | 'references'): void {
    this.patch({ [list]: [...this.draft()[list], emptyLink()] });
  }

  protected removeLink(list: 'links' | 'references', index: number): void {
    this.patch({ [list]: this.draft()[list].filter((_, position) => position !== index) });
  }

  protected save(): void {
    const guide = this.fromDraft();
    const errors = validateGuide(guide);
    this.errors.set(errors);
    if (Object.keys(errors).length > 0) {
      return;
    }
    const steps = stepsTotal(guide);
    const session = this.sessionMinutes();
    if (steps !== session) {
      this.mismatch.set({ steps, session });
      return;
    }
    this.commit(guide, false);
  }

  /** Решение по расхождению: обновить оценку топика или оставить как есть; ориентир сохраняется в обоих случаях. */
  protected resolveMismatch(updateEstimate: boolean): void {
    this.commit(this.fromDraft(), updateEstimate);
  }

  protected remove(): void {
    this.program.setGuide(this.item().id, null);
    this.editing.set(false);
  }

  protected async onPhotos(event: Event): Promise<void> {
    const target = event.target;
    if (target instanceof HTMLInputElement && target.files) {
      await this.program.addGuidePhotos(this.item().id, [...target.files]);
      target.value = '';
    }
  }

  protected removePhoto(assetId: string): void {
    this.program.removeGuidePhoto(this.item().id, assetId);
  }

  protected text(event: Event): string {
    const target = event.target;
    return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement ? target.value : '';
  }

  protected number(event: Event): number {
    return Number(this.text(event));
  }

  protected access(event: Event): TLinkAccess {
    const value = this.text(event);
    return value === 'pd' || value === 'paid' ? value : 'free';
  }

  /** Оценка одной сессии: топик длиннее блока занимает несколько сессий. */
  private sessionMinutes(): number {
    return Math.min(this.item().estimateMin, this.store.budget().blockMax);
  }

  private fromDraft(): IGuide {
    const draft = this.draft();
    return {
      goal: draft.goal.trim(),
      task: draft.task.trim(),
      steps: draft.steps.map((entry) => ({ title: entry.title.trim(), minutes: entry.minutes })),
      stopCriterion: draft.stopCriterion.trim(),
      links: draft.links.map((entry) => ({ ...entry, title: entry.title.trim(), url: entry.url.trim(), locator: entry.locator.trim() })),
      references: draft.references.map((entry) => ({ ...entry, title: entry.title.trim(), url: entry.url.trim() })),
      imageIds: this.guide()?.imageIds ?? [],
      pitfalls: draft.pitfalls
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0),
    };
  }

  private commit(guide: IGuide, updateEstimate: boolean): void {
    this.program.setGuide(this.item().id, guide);
    if (updateEstimate) {
      this.program.updateItem(this.item().id, { estimateMin: stepsTotal(guide) });
    }
    this.mismatch.set(null);
    this.editing.set(false);
  }
}
