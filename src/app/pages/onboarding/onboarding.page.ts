import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { TuiButton } from '@taiga-ui/core';
import { MinutesPipe } from '../../pipes';
import { BackupService, DataStore, PlanService, ProgramService } from '../../services';
import { formatDayShort, weekdayIndex, weekdayShort } from '../../utils';

type TTemplate = 'seed' | 'empty' | 'import';

/** Онбординг в 3 шага: программа → бюджет → план (FR-01). */
@Component({
  selector: 'app-onboarding-page',
  imports: [TuiButton, MinutesPipe],
  templateUrl: './onboarding.page.html',
  styleUrl: './onboarding.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OnboardingPage {
  private readonly store = inject(DataStore);
  private readonly program = inject(ProgramService);
  private readonly backup = inject(BackupService);
  private readonly router = inject(Router);
  private readonly planner = inject(PlanService);

  protected readonly step = signal(1);
  protected readonly template = signal<TTemplate>('seed');
  protected readonly importError = signal('');
  protected readonly budget = this.store.budget;
  protected readonly weekdays = [0, 1, 2, 3, 4, 5, 6].map((index) => weekdayShort(index));
  protected readonly capacityTotal = computed(() => this.budget().dayCapacity.reduce((sum, value) => sum + value, 0));
  protected readonly wanted = computed(() => this.budget().studyMinPerWeek + this.budget().practiceMinPerWeek);
  protected readonly firstDays = computed(() => {
    const tree = this.store.tree();
    return this.planner
      .plan()
      .days.filter((day) => day.blocks.length > 0)
      .slice(0, 3)
      .map((day) => ({
        date: day.date,
        label: `${weekdayShort(weekdayIndex(day.date))}, ${formatDayShort(day.date)}`,
        blocks: day.blocks.map((block) => ({
          key: block.key,
          title: block.itemId ? (tree.itemById.get(block.itemId)?.title ?? '') : 'Свободное творчество',
          minutes: block.plannedMin,
        })),
      }));
  });

  protected readonly templates: readonly { readonly id: TTemplate; readonly title: string; readonly body: string }[] = [
    { id: 'seed', title: 'Стартовая программа', body: '8 разделов: форма, перспектива, тон, цвет, композиция, архитектура, техники, мастера. ≈ 150 ч топиков.' },
    { id: 'empty', title: 'Пустая программа', body: 'Соберёшь разделы и темы сам.' },
    { id: 'import', title: 'Из файла копии', body: 'JSON, выгруженный из Импрувы.' },
  ];

  protected select(template: TTemplate): void {
    this.template.set(template);
    this.importError.set('');
  }

  protected async onFile(event: Event): Promise<void> {
    const target = event.target;
    const file = target instanceof HTMLInputElement ? target.files?.[0] : undefined;
    if (!file) {
      return;
    }
    const check = this.backup.check(await file.text());
    if (!check.ok) {
      this.importError.set(check.message);
      return;
    }
    await this.backup.apply(check.snapshot, check.snapshot.kind === 'program' ? 'merge' : 'replace');
    if (this.store.meta().onboarded) {
      void this.router.navigateByUrl('/today');
      return;
    }
    this.step.set(2);
  }

  protected next(): void {
    if (this.step() === 1) {
      if (this.template() === 'seed' && this.store.data().sections.length === 0) {
        this.program.installSeed();
      }
      this.step.set(2);
    } else if (this.step() === 2) {
      this.step.set(3);
    }
  }

  protected setMinutes(field: 'studyMinPerWeek' | 'practiceMinPerWeek', event: Event): void {
    const target = event.target;
    const value = target instanceof HTMLInputElement ? Math.round(Number(target.value)) : NaN;
    if (Number.isFinite(value) && value >= 0 && value <= 6000) {
      this.store.upsert('budgets', { ...this.budget(), [field]: value, updatedAt: new Date().toISOString() });
    }
  }

  protected setDay(index: number, event: Event): void {
    const target = event.target;
    const value = target instanceof HTMLInputElement ? Math.round(Number(target.value)) : NaN;
    if (Number.isFinite(value) && value >= 0 && value <= 720) {
      const dayCapacity = this.budget().dayCapacity.map((minutes, day) => (day === index ? value : minutes));
      this.store.upsert('budgets', { ...this.budget(), dayCapacity, updatedAt: new Date().toISOString() });
    }
  }

  protected finish(): void {
    const now = new Date().toISOString();
    const today = this.store.today();
    this.store.upsert('challenges', { ...this.store.challenge(), startDate: today, updatedAt: now });
    this.store.updateMeta({ onboarded: true });
    void this.router.navigateByUrl('/today');
  }
}
