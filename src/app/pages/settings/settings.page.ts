import { FormsModule } from '@angular/forms';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { TuiButton, TuiDialog } from '@taiga-ui/core';
import { TuiSwitch } from '@taiga-ui/kit';
import type { TTipId } from '../../domain';
import { MinutesPipe } from '../../pipes';
import { BackupService, CourseService, DataStore, ToastService, type ICoursePreview, type TImportCheck } from '../../services';
import type { IBudget, ISection, ISnapshot, TSectionWeight } from '../../types';
import { addDays, deviceTimeZone, diffDays, isValidDayKey, isValidTimeZone, weekdayShort } from '../../utils';

const TIP_TOGGLES: readonly { readonly id: TTipId; readonly label: string }[] = [
  { id: 'missedDay', label: 'После пропущенного дня' },
  { id: 'reviewOverdue', label: 'Просроченное повторение' },
  { id: 'overEstimate', label: 'Топик дольше оценки' },
  { id: 'sameSection', label: 'Три сессии в одном разделе' },
  { id: 'creativeLow', label: 'Мало творчества' },
  { id: 'masterCopy', label: 'Копия мастера в начале месяца' },
];

/** Настройки: бюджет, дни, челлендж, звук, подсказки, данные (FR-32, FR-33). */
@Component({
  selector: 'app-settings-page',
  imports: [FormsModule, TuiButton, TuiSwitch, TuiDialog, MinutesPipe],
  templateUrl: './settings.page.html',
  styleUrl: './settings.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsPage {
  protected readonly store = inject(DataStore);
  protected readonly backup = inject(BackupService);
  protected readonly course = inject(CourseService);
  private readonly toasts = inject(ToastService);
  protected readonly sections = computed(() =>
    this.store
      .data()
      .sections.filter((section) => !section.archived)
      .sort((a, b) => a.order - b.order),
  );
  protected readonly coursePreview = signal<ICoursePreview | null>(null);

  protected readonly budget = this.store.budget;
  protected readonly settings = this.store.settings;
  protected readonly challenge = this.store.challenge;
  protected readonly weekdays = [0, 1, 2, 3, 4, 5, 6].map((index) => weekdayShort(index));
  protected readonly tipToggles = TIP_TOGGLES;
  protected readonly capacityTotal = computed(() => this.budget().dayCapacity.reduce((sum, value) => sum + value, 0));
  protected readonly wanted = computed(() => this.budget().studyMinPerWeek + this.budget().practiceMinPerWeek);
  protected readonly creativeMin = computed(() => Math.round(this.budget().practiceMinPerWeek * this.budget().creativeShare));
  protected readonly errors = signal<Readonly<Record<string, string>>>({});
  protected readonly importCheck = signal<Extract<TImportCheck, { ok: true }> | null>(null);
  protected readonly importError = signal('');
  protected readonly replaceConfirm = signal(false);
  protected readonly notifications = signal(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);

  constructor() {
    void this.backup.refreshUsage();
  }

  private number(event: Event): number {
    const target = event.target;
    return target instanceof HTMLInputElement ? Number(target.value) : Number.NaN;
  }

  private setError(key: string, message: string): void {
    this.errors.update((errors) => ({ ...errors, [key]: message }));
  }

  protected saveBudget(patch: Partial<IBudget>): void {
    this.store.upsert('budgets', { ...this.budget(), ...patch, updatedAt: new Date().toISOString() });
  }

  protected setMinutes(field: 'studyMinPerWeek' | 'practiceMinPerWeek', event: Event): void {
    const value = Math.round(this.number(event));
    if (!Number.isFinite(value) || value < 0 || value > 6000) {
      this.setError(field, 'От 0 до 6000 минут.');
      return;
    }
    this.setError(field, '');
    this.saveBudget({ [field]: value });
  }

  protected setDay(index: number, event: Event): void {
    const value = Math.round(this.number(event));
    if (!Number.isFinite(value) || value < 0 || value > 720) {
      this.setError('days', 'Ёмкость дня — от 0 до 720 минут.');
      return;
    }
    this.setError('days', '');
    this.saveBudget({ dayCapacity: this.budget().dayCapacity.map((minutes, day) => (day === index ? value : minutes)) });
  }

  protected setCreative(event: Event): void {
    const value = this.number(event);
    if (Number.isFinite(value)) {
      this.saveBudget({ creativeShare: Math.min(0.5, Math.max(0, value / 100)) });
    }
  }

  protected setBlock(field: 'blockMin' | 'blockMax', event: Event): void {
    const value = Math.round(this.number(event));
    const other = field === 'blockMin' ? this.budget().blockMax : this.budget().blockMin;
    const valid = Number.isFinite(value) && value >= 10 && value <= 180 && (field === 'blockMin' ? value <= other : value >= other);
    if (!valid) {
      this.setError('blocks', 'Блок — от 10 до 180 минут, минимум не больше максимума.');
      return;
    }
    this.setError('blocks', '');
    this.saveBudget({ [field]: value });
  }

  protected setIntervals(event: Event): void {
    const target = event.target;
    const raw = target instanceof HTMLInputElement ? target.value : '';
    const values = raw
      .split(/[\s,;]+/)
      .filter(Boolean)
      .map(Number);
    const valid = values.length > 0 && values.length <= 6 && values.every((value) => Number.isInteger(value) && value >= 1 && value <= 180);
    if (!valid) {
      this.setError('intervals', 'Через запятую, от 1 до 180 дней, не больше 6 значений.');
      return;
    }
    this.setError('intervals', '');
    this.saveBudget({ reviewIntervals: values });
  }

  protected setChallengeDate(field: 'startDate' | 'endDate', event: Event): void {
    const target = event.target;
    const value = target instanceof HTMLInputElement ? target.value : '';
    const challenge = this.challenge();
    const next = { ...challenge, [field]: value };
    if (!isValidDayKey(value) || diffDays(next.startDate, next.endDate) < 7) {
      this.setError('challenge', 'Проверь даты: челлендж — от недели, конец позже начала.');
      return;
    }
    this.setError('challenge', '');
    this.store.upsert('challenges', { ...next, updatedAt: new Date().toISOString() });
  }

  protected extendChallenge(weeks: number): void {
    const challenge = this.challenge();
    this.store.upsert('challenges', { ...challenge, endDate: addDays(challenge.endDate, weeks * 7), updatedAt: new Date().toISOString() });
  }

  protected setTitle(event: Event): void {
    const target = event.target;
    const title = target instanceof HTMLInputElement ? target.value.trim() : '';
    if (title) {
      this.store.upsert('challenges', { ...this.challenge(), title, updatedAt: new Date().toISOString() });
    }
  }

  protected setBoundary(event: Event): void {
    const value = Math.round(this.number(event));
    if (Number.isFinite(value) && value >= 0 && value <= 12) {
      this.store.updateSettings({ dayBoundaryHour: value });
    }
  }

  protected readonly deviceZone = deviceTimeZone();
  protected readonly timeZones = Intl.supportedValuesOf('timeZone');

  protected setTimeZone(event: Event): void {
    const target = event.target;
    const value = target instanceof HTMLSelectElement ? target.value : '';
    if (isValidTimeZone(value)) {
      this.store.updateSettings({ timeZone: value });
    }
  }

  protected setReviewDay(event: Event): void {
    const target = event.target;
    const value = target instanceof HTMLSelectElement ? Number(target.value) : Number.NaN;
    if (Number.isInteger(value) && value >= 0 && value <= 6) {
      this.store.updateSettings({ reviewWeekday: value });
    }
  }

  protected toggleTip(id: TTipId): void {
    const disabled = new Set(this.settings().disabledTips);
    if (disabled.has(id)) {
      disabled.delete(id);
    } else {
      disabled.add(id);
    }
    this.store.updateSettings({ disabledTips: [...disabled] });
  }

  protected async requestNotifications(): Promise<void> {
    if (typeof Notification !== 'undefined') {
      this.notifications.set(await Notification.requestPermission());
    }
  }

  protected async onImportFile(event: Event): Promise<void> {
    const target = event.target;
    const file = target instanceof HTMLInputElement ? target.files?.[0] : undefined;
    if (target instanceof HTMLInputElement) {
      target.value = '';
    }
    if (!file) {
      return;
    }
    const check = this.backup.check(await file.text());
    if (check.ok) {
      this.importError.set('');
      this.importCheck.set(check);
    } else {
      this.importCheck.set(null);
      this.importError.set(check.message);
    }
  }

  protected async applyImport(snapshot: ISnapshot, mode: 'replace' | 'merge'): Promise<void> {
    this.replaceConfirm.set(false);
    this.importCheck.set(null);
    await this.backup.apply(snapshot, mode);
  }

  protected formatBytes(bytes: number): string {
    return bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1).replace('.', ',')} МБ` : `${Math.round(bytes / 1024)} КБ`;
  }

  /** Вес раздела в квартале (FR-40): при первой правке недостающие кварталы берут общий вес. */
  protected setQuarterWeight(section: ISection, quarter: number, event: Event): void {
    const value = Number(event.target instanceof HTMLSelectElement ? event.target.value : Number.NaN);
    if (value !== 1 && value !== 2 && value !== 3) {
      return;
    }
    const weights: TSectionWeight[] = [0, 1, 2, 3].map((index) => section.quarterWeights?.[index] ?? section.weight);
    weights[quarter] = value;
    this.store.upsert('sections', { ...section, quarterWeights: weights, updatedAt: new Date().toISOString() });
  }

  protected previewCourse(): void {
    this.coursePreview.set(this.course.preview());
  }

  protected applyCourse(): void {
    const result = this.course.apply();
    this.coursePreview.set(null);
    this.toasts.show({ text: `Ориентиры добавлены в ${result.matched} топиков`, kind: 'success' });
  }
}
