import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { stepsTotal } from '../domain';
import type { IGuideStep, ITimerState, TSessionType } from '../types';
import { formatClock } from '../utils';
import { DataStore } from './data.store';
import { LogsService } from './logs.service';
import { SessionDraftService } from './session-draft.service';
import { SoundService } from './sound.service';
import { ToastService } from './toast.service';
import { UiStateService } from './ui-state.service';

export interface IPhase {
  readonly title: string;
  readonly hint: string;
  readonly minutes: number;
}

export const STEP_EXTEND_MIN = 5;
/** Сотая доля секунды: меньше не различается глазом, больше — не теряет шаг из-за округления. */
const STEP_EPSILON_MIN = 1 / 6000;

/**
 * Шаги ориентира вместо шаблона фаз (FR-38). Шаг идёт столько, сколько написано в ориентире:
 * «3 штудии по 6 минут — 20 мин» длится 20 минут, а не сжимается под короткий блок плана.
 * После «Следующий шаг», «Предыдущий шаг» и «+5 мин» действует расписание из таймера.
 */
export function buildGuidePhases(params: { readonly steps: readonly IGuideStep[]; readonly stepMinutes: readonly number[] | null }): IPhase[] {
  const { steps, stepMinutes } = params;
  const minutes = stepMinutes && stepMinutes.length === steps.length ? stepMinutes : steps.map((entry) => entry.minutes);
  return steps.map((entry, index) => ({ title: entry.title, hint: '', minutes: minutes[index] ?? entry.minutes }));
}

/** Минута, на которой кончается шаг index. */
export function stepEnd(phases: readonly IPhase[], index: number): number {
  return phases.slice(0, index + 1).reduce((sum, phase) => sum + phase.minutes, 0);
}

/**
 * «Предыдущий шаг» (баг 3): прошлый шаг снова активен и получает недобранное время, минимум 5 мин;
 * текущий шаг не теряет своих минут и начнётся заново после прошлого.
 */
export function stepBack(params: {
  readonly minutes: readonly number[];
  readonly planned: readonly number[];
  readonly index: number;
  readonly elapsedMin: number;
}): number[] {
  const { planned, index, elapsedMin } = params;
  const minutes = [...params.minutes];
  if (index < 1 || index >= minutes.length) {
    return minutes;
  }
  const start = minutes.slice(0, index).reduce((sum, value) => sum + value, 0);
  const spentInCurrent = Math.max(0, elapsedMin - start);
  const previous = minutes[index - 1] ?? 0;
  const give = Math.max(STEP_EXTEND_MIN, (planned[index - 1] ?? 0) - previous);
  minutes[index - 1] = previous + spentInCurrent + give;
  // Время, которое «Следующий шаг» отдал последнему шагу, возвращается обратно
  const last = minutes.length - 1;
  if (last !== index - 1) {
    const surplus = Math.max(0, (minutes[last] ?? 0) - (planned[last] ?? 0));
    minutes[last] = (minutes[last] ?? 0) - Math.min(surplus, give);
  }
  return minutes;
}

/** Шаблон 90-минутной сессии (ТЗ M3): масштабируется под длину блока. */
const PHASE_TEMPLATE: readonly Omit<IPhase, 'minutes'>[] = [
  { title: 'Разминка', hint: 'Линии и эллипсы от плеча, не по теме занятия' },
  { title: 'Отработка', hint: 'Один изолированный навык с ограничением по времени' },
  { title: 'Глубокая работа', hint: 'Самая трудная часть: форма, тон, натура' },
  { title: 'Анализ', hint: 'Сравни с референсом и запиши задачу на завтра' },
];
const PHASE_SHARES = [10, 20, 45, 15] as const;

export const DEEP_WORK_LIMIT_MIN = 90;
export const FORGOTTEN_AFTER_MIN = 240;

export function buildPhases(plannedMin: number): IPhase[] {
  const total = PHASE_SHARES.reduce((sum, value) => sum + value, 0);
  const length = plannedMin > 0 ? plannedMin : DEEP_WORK_LIMIT_MIN;
  return PHASE_TEMPLATE.map((phase, index) => ({
    ...phase,
    minutes: Math.max(1, Math.round(((PHASE_SHARES[index] ?? 0) / total) * length)),
  }));
}

export function elapsedMs(timer: ITimerState, nowMs: number): number {
  const pausedNow = timer.pausedAt ? nowMs - Date.parse(timer.pausedAt) : 0;
  return Math.max(0, nowMs - Date.parse(timer.startedAt) - timer.pausedMs - pausedNow);
}

/** Один активный таймер, переживает перезагрузку: хранится startedAt, а не тики (FR-10, FR-11). */
@Injectable({ providedIn: 'root' })
export class TimerService {
  private readonly store = inject(DataStore);
  private readonly logs = inject(LogsService);
  private readonly sound = inject(SoundService);
  private readonly toasts = inject(ToastService);
  private readonly ui = inject(UiStateService);
  private readonly draft = inject(SessionDraftService);

  private readonly tick = signal(Date.now());
  private lastPhaseIndex = -1;
  private deepLimitNotified = false;
  /** Длина сессии, о конце которой уже сообщили; +5 мин сдвигает конец и разрешает новое уведомление. */
  private endNotifiedAt: number | null = null;

  readonly state = computed(() => this.store.meta().timer);
  readonly running = computed(() => this.state() !== null);
  readonly paused = computed(() => this.state()?.pausedAt != null);
  readonly elapsed = computed(() => {
    const timer = this.state();
    return timer ? elapsedMs(timer, this.tick()) : 0;
  });
  readonly elapsedMin = computed(() => Math.floor(this.elapsed() / 60_000));
  readonly clock = computed(() => formatClock(this.elapsed()));
  readonly item = computed(() => {
    const id = this.state()?.itemId;
    return id ? (this.store.data().items.find((item) => item.id === id) ?? null) : null;
  });
  /** Шаги ориентира топика, если они есть (FR-38). */
  readonly guideSteps = computed(() => {
    const steps = this.item()?.guide?.steps ?? [];
    return steps.length > 0 ? steps : null;
  });
  readonly phases = computed(() => {
    const timer = this.state();
    const steps = this.guideSteps();
    return steps
      ? buildGuidePhases({ steps, stepMinutes: timer?.stepMinutes ?? null })
      : buildPhases(timer?.plannedMin ?? 0);
  });
  /** Длина сессии в минутах: сумма шагов ориентира или план блока. */
  readonly totalMin = computed(() => {
    if (this.guideSteps()) {
      return this.phases().reduce((sum, phase) => sum + phase.minutes, 0);
    }
    return this.state()?.plannedMin ?? 0;
  });
  readonly phaseIndex = computed(() => {
    if (!this.guideSteps() && !this.store.settings().phases) {
      return -1;
    }
    let passed = 0;
    const minutes = this.elapsed() / 60_000;
    const phases = this.phases();
    for (let index = 0; index < phases.length; index += 1) {
      passed += phases[index]?.minutes ?? 0;
      // Допуск на дробную арифметику: граница после «Следующий шаг» ровно равна прошедшему времени
      if (minutes < passed - STEP_EPSILON_MIN) {
        return index;
      }
    }
    return phases.length - 1;
  });
  /** Задача из прошлой сессии по этому топику (M7). */
  readonly previousTask = computed(() => {
    const itemId = this.state()?.itemId;
    if (!itemId) {
      return '';
    }
    const notes = this.store
      .data()
      .notes.filter((note) => note.itemId === itemId && note.next.trim().length > 0)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return notes[0]?.next ?? '';
  });

  constructor() {
    setInterval(() => {
      if (this.state()) {
        this.tick.set(Date.now());
      }
    }, 1000);
    effect(() => {
      const timer = this.state();
      const title = timer ? `${timer.pausedAt ? '❚❚' : '▶'} ${this.clock()} · Импрува` : 'Импрува';
      document.title = title;
    });
    effect(() => {
      const index = this.phaseIndex();
      if (!this.running()) {
        this.lastPhaseIndex = -1;
        this.deepLimitNotified = false;
        return;
      }
      if (this.lastPhaseIndex !== -1 && index !== this.lastPhaseIndex && index >= 0) {
        const phase = this.phases()[index];
        this.alert({ text: `${this.guideSteps() ? 'Шаг' : 'Фаза'}: ${phase?.title ?? ''}`, final: false });
      }
      this.lastPhaseIndex = index;
    });
    // Время сессии вышло (баг 5): звук, системное уведомление в фоне и тост со «Стоп» на экране
    effect(() => {
      const total = this.totalMin();
      if (!this.running()) {
        this.endNotifiedAt = null;
        return;
      }
      if (total > 0 && this.endNotifiedAt !== total && this.elapsed() >= total * 60_000 && !this.paused()) {
        this.endNotifiedAt = total;
        this.alert({ text: `Время сессии вышло: ${Math.round(total)} мин. Закончи или добавь 5 минут.`, final: true });
      }
    });
    effect(() => {
      if (this.running() && !this.deepLimitNotified && this.elapsedMin() >= DEEP_WORK_LIMIT_MIN) {
        this.deepLimitNotified = true;
        this.sound.chime();
        const text = '90 минут — предел глубокой концентрации. Перерыв 10–15 минут?';
        this.sound.notify(text);
        this.toasts.show({ text, durationMs: 15_000 });
      }
    });
  }

  /** Проверка забытого таймера при старте приложения (FR-11). */
  checkForgotten(): void {
    const timer = this.state();
    if (timer && !timer.pausedAt && elapsedMs(timer, Date.now()) > FORGOTTEN_AFTER_MIN * 60_000) {
      this.ui.forgottenOpen.set(true);
    }
  }

  /** Возвращает false, если уже идёт другая сессия — UI спрашивает о переключении. */
  start(params: { readonly itemId: string | null; readonly type: TSessionType; readonly plannedMin: number }): boolean {
    if (this.state()) {
      this.ui.pendingStart.set(params);
      return false;
    }
    this.sound.requestPermission();
    // С ориентиром длина сессии — сумма его шагов: шаги идут по своим минутам (баг 1)
    const guide = params.itemId ? this.store.data().items.find((item) => item.id === params.itemId)?.guide : null;
    const plannedMin = guide && guide.steps.length > 0 ? stepsTotal(guide) : params.plannedMin;
    this.draft.clear();
    this.store.updateMeta({
      timer: {
        itemId: params.itemId,
        type: params.type,
        startedAt: new Date().toISOString(),
        pausedAt: null,
        pausedMs: 0,
        plannedMin,
        stepMinutes: null,
      },
    });
    this.tick.set(Date.now());
    return true;
  }

  pause(): void {
    const timer = this.state();
    if (timer && !timer.pausedAt) {
      this.store.updateMeta({ timer: { ...timer, pausedAt: new Date().toISOString() } });
    }
  }

  resume(): void {
    const timer = this.state();
    if (timer?.pausedAt) {
      const pausedMs = timer.pausedMs + (Date.now() - Date.parse(timer.pausedAt));
      this.store.updateMeta({ timer: { ...timer, pausedAt: null, pausedMs } });
      this.tick.set(Date.now());
    }
  }

  toggle(): void {
    if (this.paused()) {
      this.resume();
    } else {
      this.pause();
    }
  }

  /** «Следующий шаг»: остаток текущего шага уходит в последний, длина блока не меняется (US-10). */
  nextStep(): void {
    // Считаем от текущего момента, а не от последнего тика: иначе граница шага отстаёт до секунды
    this.tick.set(Date.now());
    const timer = this.state();
    const index = this.phaseIndex();
    const minutes = this.phases().map((phase) => phase.minutes);
    const last = minutes.length - 1;
    if (!timer || !this.guideSteps() || index < 0 || index >= last) {
      return;
    }
    const start = minutes.slice(0, index).reduce((sum, value) => sum + value, 0);
    const spent = Math.max(0, this.elapsed() / 60_000 - start);
    const current = minutes[index] ?? 0;
    const moved = Math.max(0, current - spent);
    minutes[index] = current - moved;
    minutes[last] = (minutes[last] ?? 0) + moved;
    this.store.updateMeta({ timer: { ...timer, stepMinutes: minutes } });
  }

  /** «Предыдущий шаг»: вернуться к прошлому шагу ориентира, сессия удлиняется на возвращённое время. */
  prevStep(): void {
    this.tick.set(Date.now());
    const timer = this.state();
    const steps = this.guideSteps();
    const index = this.phaseIndex();
    if (!timer || !steps || index < 1) {
      return;
    }
    const minutes = stepBack({
      minutes: this.phases().map((phase) => phase.minutes),
      planned: steps.map((entry) => entry.minutes),
      index,
      elapsedMin: this.elapsed() / 60_000,
    });
    const total = minutes.reduce((sum, value) => sum + value, 0);
    this.store.updateMeta({ timer: { ...timer, stepMinutes: minutes, plannedMin: Math.max(timer.plannedMin, Math.ceil(total)) } });
  }

  /** «+5 мин» к текущему шагу: блок удлиняется. */
  extendStep(): void {
    this.tick.set(Date.now());
    const timer = this.state();
    const index = this.phaseIndex();
    if (!timer || !this.guideSteps() || index < 0) {
      return;
    }
    const minutes = this.phases().map((phase) => phase.minutes);
    minutes[index] = (minutes[index] ?? 0) + STEP_EXTEND_MIN;
    this.store.updateMeta({ timer: { ...timer, stepMinutes: minutes, plannedMin: timer.plannedMin + STEP_EXTEND_MIN } });
  }

  /** Стоп: лог сохраняется сразу, карточка итога — необязательна (FR-13). */
  stop(overrideMinutes?: number): string | null {
    const timer = this.state();
    if (!timer) {
      return null;
    }
    const measured = elapsedMs(timer, Date.now());
    const minutes = overrideMinutes ?? Math.round(measured / 60_000);
    this.store.updateMeta({ timer: null });
    this.ui.focusMode.set(false);
    if (minutes < 1) {
      this.toasts.show({ text: 'Сессия короче минуты не записана.' });
      return null;
    }
    const endedAt = new Date();
    const startedAt = new Date(endedAt.getTime() - Math.min(minutes, 720) * 60_000);
    const log = this.logs.create({
      itemId: timer.itemId,
      type: timer.type,
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      source: 'timer',
    });
    this.draft.attach(log.id);
    this.ui.summaryLogId.set(log.id);
    return log.id;
  }

  discard(): void {
    this.store.updateMeta({ timer: null });
    this.draft.clear();
    this.ui.focusMode.set(false);
  }

  /** Сообщение таймера: на открытой вкладке — тост, в фоне — системное уведомление; звук — по настройке. */
  private alert(params: { readonly text: string; readonly final: boolean }): void {
    this.sound.chime();
    const shown = this.sound.notify(params.text, { persistent: params.final });
    if (shown) {
      return;
    }
    this.toasts.show({
      text: params.text,
      durationMs: params.final ? 30_000 : 6000,
      ...(params.final ? { action: { label: 'Стоп', run: () => void this.stop() } } : {}),
    });
  }

  /** Переключение: остановить текущую и начать ожидающую (timer.switch). */
  switchToPending(): void {
    const pending = this.ui.pendingStart();
    this.ui.pendingStart.set(null);
    if (!pending) {
      return;
    }
    this.stop();
    this.ui.summaryLogId.set(null);
    this.start(pending);
  }
}
