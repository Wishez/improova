import { DestroyRef, Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import {
  MS_PER_MINUTE,
  circleMinutes,
  logStepsAtStop,
  migrateLegacyTimer,
  stepLabel,
  stepLimitMin,
  stepProgress,
  stepStart,
  timerFirstMinuteIndex,
  timerStepMs,
  type IStepCalendar,
  type IStepStart,
} from '../domain';
import type { IGuideStep, IMeta, ITimerState, ITimerSteps, TSessionType } from '../types';
import { createId, formatClock } from '../utils';
import { CourseService } from './course.service';
import { DataStore } from './data.store';
import { MAX_LOG_MIN, buildLog } from './logs.service';
import { SessionDraftService } from './session-draft.service';
import { SoundService } from './sound.service';
import { ToastService } from './toast.service';
import { UiStateService } from './ui-state.service';

export interface IPhase {
  readonly title: string;
  readonly hint: string;
  readonly minutes: number;
}

/** Шаг ориентира в идущей сессии (FR-53): «X из Y мин» и «+N сверх плана» для режима фокуса и мини-таймера. */
export interface ITimerStepView {
  readonly index: number;
  /** Название как в ориентире; шаг техники маршрута — с техникой на сегодня (FR-49). */
  readonly title: string;
  readonly planMin: number;
  /** Накоплено за круг: прошлые сессии круга и эта, целые минуты с округлением вниз. */
  readonly doneMin: number;
  /** Переработка: накоплено сверх плана, иначе 0. */
  readonly overMin: number;
  readonly active: boolean;
}

/** Минута, на которой кончается фаза index. */
export function stepEnd(phases: readonly IPhase[], index: number): number {
  return phases.slice(0, index + 1).reduce((sum, phase) => sum + phase.minutes, 0);
}

/** Шаблон 90-минутной сессии (ТЗ M3): масштабируется под длину блока. Только в сессиях без шагов ориентира (FR-12, Д-1). */
const PHASE_TEMPLATE: readonly Omit<IPhase, 'minutes'>[] = [
  { title: 'Разминка', hint: 'Линии и эллипсы от плеча, не по теме занятия' },
  { title: 'Отработка', hint: 'Один изолированный навык с ограничением по времени' },
  { title: 'Глубокая работа', hint: 'Самая трудная часть: форма, тон, натура' },
  { title: 'Анализ', hint: 'Сравни с референсом и запиши задачу на завтра' },
];
const PHASE_SHARES = [10, 20, 45, 15] as const;
/** Сотая доля секунды: меньше не различается глазом, больше — не теряет фазу из-за округления. */
const PHASE_EPSILON_MIN = 1 / 6000;

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

/** Часы сессии без пауз, мс. Битое начало или паузы не дают NaN: время сессии тогда 0. */
export function elapsedMs(timer: ITimerState, nowMs: number): number {
  const pausedNow = timer.pausedAt ? nowMs - Date.parse(timer.pausedAt) : 0;
  const value = nowMs - Date.parse(timer.startedAt) - timer.pausedMs - pausedNow;
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

/** Длина названия шага в сигнале, после которой оно сокращается (правило П-1 вкладки «Тексты 1.6»). */
const STEP_TITLE_MAX = 53;
/** Число и «мин» не разрываются переносом («Тексты 1.6», «Числа не разрываются»). */
const NBSP = ' ';

/** П-1: название длиннее 53 знаков — первые 52 знака без пробела на конце и «…». */
export function shortStepTitle(title: string): string {
  return title.length > STEP_TITLE_MAX ? `${title.slice(0, STEP_TITLE_MAX - 1).trimEnd()}…` : title;
}

/** timer.stepPlanDone (FR-54): шаг не меняется. */
export function stepPlanDoneText(params: { readonly title: string; readonly planMin: number }): string {
  return `Время шага по плану вышло: ${shortStepTitle(params.title)} · ${params.planMin}${NBSP}мин`;
}

/** timer.sessionEnd (FR-55, Q-010): без предложения добавить время. */
export function sessionEndText(limitMin: number): string {
  return `Время сессии вышло: ${Math.round(limitMin)}${NBSP}мин`;
}

const TOO_SHORT_TEXT = 'Сессия короче минуты не записана.';
/** timer.stopFailed (FR-56): таймер не остановлен — идёт или стоит на паузе, как до «Стоп». */
const STOP_FAILED_TEXT = 'Сессия не записана: хранилище не отвечает. Таймер не остановлен — нажми «Стоп» ещё раз.';

interface IStopResult {
  /** logged — лог записан; short — сессия короче минуты; failed — хранилище отказало, таймер не остановлен; none — таймера нет. */
  readonly status: 'logged' | 'short' | 'failed' | 'none';
  readonly logId: string | null;
}

/**
 * Шаги новой сессии (FR-52, FR-58; ADR-007): шаг старта и круг — из `stepStart` домена, мс шагов — нули по числу шагов
 * («Длина spentMs»). Шаг старта с уже набранным планом сразу отмечен: сигнал на нём не звучит (FR-54).
 */
function startSteps(begin: IStepStart, plan: readonly IGuideStep[]): ITimerSteps {
  const start = begin.startIndex;
  const reached = (begin.accumulated[start] ?? 0) >= (plan[start]?.minutes ?? 0);
  return {
    activeIndex: start,
    spentMs: plan.map(() => 0),
    startIndex: start,
    continuesCircle: begin.continuesCircle,
    circleId: begin.circleId ?? createId(),
    stepCount: plan.length,
    firstMinuteIndex: null,
    planSignaled: reached ? [start] : [],
    limitSignaled: false,
  };
}

/**
 * Расписание 1.5 из хранилища или импорта — недоверенные данные: годно, если это массив конечных минут ≥ 0;
 * иначе перевод идёт по плановым минутам шагов, как в 1.5 при расписании другой длины (Q-032).
 */
function validSchedule(stepMinutes: unknown): readonly number[] | null {
  if (!Array.isArray(stepMinutes)) {
    return null;
  }
  const values: readonly unknown[] = stepMinutes;
  const schedule: number[] = [];
  for (const value of values) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      return null;
    }
    schedule.push(value);
  }
  return schedule;
}

/**
 * Один активный таймер, переживает перезагрузку: хранится startedAt, а не тики (FR-10, FR-11).
 * В сессии по топику с шагами ориентира (FR-52…FR-56, ADR-007) шаг меняет только владелец, время идёт активному шагу,
 * лимит — длина точки старта; «Стоп» пишет лог со сведениями о шагах и очистку таймера одной транзакцией.
 */
@Injectable({ providedIn: 'root' })
export class TimerService {
  private readonly store = inject(DataStore);
  private readonly sound = inject(SoundService);
  private readonly toasts = inject(ToastService);
  private readonly ui = inject(UiStateService);
  private readonly draft = inject(SessionDraftService);
  private readonly course = inject(CourseService);

  private readonly tick = signal(Date.now());
  /** Фаза шаблона FR-12 на прошлом тике: «Фаза: …» звучит при её смене. */
  private lastPhaseIndex = -1;
  private deepLimitNotified = false;
  /** «Время сессии вышло» в сессии без шагов уже прозвучало — как в 1.5, до перезагрузки (Д-1). */
  private plainLimitNotified = false;
  /** Идёт запись «Стоп»: пока commit не завершён, таймер не пишется (ADR-007, «Совместная запись лога и шагов»). */
  private stopping: Promise<IStopResult> | null = null;

  readonly state = computed(() => this.store.meta().timer);
  readonly running = computed(() => this.state() !== null);
  readonly paused = computed(() => this.state()?.pausedAt != null);
  readonly elapsed = computed(() => {
    const timer = this.state();
    return timer ? elapsedMs(timer, this.tick()) : 0;
  });
  readonly elapsedMin = computed(() => Math.floor(this.elapsed() / MS_PER_MINUTE));
  readonly clock = computed(() => formatClock(this.elapsed()));
  readonly item = computed(() => {
    const id = this.state()?.itemId;
    return id ? (this.store.data().items.find((item) => item.id === id) ?? null) : null;
  });
  /** Шаги идущей сессии (ADR-007); null — сессия без шагов или таймер 1.5 до перевода. */
  readonly sessionSteps = computed(() => this.state()?.steps ?? null);
  /**
   * Шаги ориентира сессии с шагами, названия — с техникой маршрута на сегодня (FR-49). null — сессия без шагов:
   * шаблон фаз FR-12 (Д-1), даже если ориентир у топика появился во время сессии (ADR-007).
   */
  readonly guideSteps = computed<readonly IGuideStep[] | null>(() => {
    const steps = this.item()?.guide?.steps ?? [];
    if (!this.sessionSteps() || steps.length === 0) {
      return null;
    }
    const routeTechnique = this.course.focus()?.block.copyTechnique ?? null;
    return steps.map((entry) => ({ ...entry, title: stepLabel(entry.title, routeTechnique) }));
  });
  /** Активный шаг (FR-52): меняет только владелец; шага больше нет в ориентире — последний (FR-63). −1 — сессия без шагов. */
  readonly activeStepIndex = computed(() => {
    const steps = this.sessionSteps();
    const guide = this.guideSteps();
    return steps && guide ? Math.min(steps.activeIndex, guide.length - 1) : -1;
  });
  /** Время каждого шага в этой сессии, мс: активному идёт время сессии без пауз, сумма — часы сессии (ADR-007). */
  readonly stepMs = computed<readonly number[]>(() => {
    const steps = this.sessionSteps();
    return steps ? timerStepMs(steps, this.elapsed()) : [];
  });
  /** Шаги ориентира с накопленным за круг (FR-53): «X из Y мин», «+N сверх плана», активный шаг. */
  readonly stepViews = computed<readonly ITimerStepView[]>(() => {
    const guide = this.guideSteps();
    if (!guide) {
      return [];
    }
    const circle = this.circleMin();
    const stepMs = this.stepMs();
    const active = this.activeStepIndex();
    return guide.map((step, index) => ({
      index,
      title: step.title,
      ...stepProgress({ circleMin: circle[index] ?? 0, sessionMs: stepMs[index] ?? 0, planMin: step.minutes }),
      active: index === active,
    }));
  });
  /** Активный шаг для мини-таймера (FR-53); null — сессия без шагов. */
  readonly activeStep = computed(() => this.stepViews().find((view) => view.active) ?? null);
  /** Фазы режима фокуса: у сессии с шагами — шаги ориентира с плановыми минутами, не сжатые (FR-55); без шагов — шаблон FR-12. */
  readonly phases = computed<IPhase[]>(() => {
    const guide = this.guideSteps();
    return guide ? guide.map((step) => ({ title: step.title, hint: '', minutes: step.minutes })) : buildPhases(this.state()?.plannedMin ?? 0);
  });
  /** Лимит сессии, мин (FR-55): длина, с которой она запущена. Сумма шагов и смена шага его не меняют. */
  readonly totalMin = computed(() => this.state()?.plannedMin ?? 0);
  /** Текущая фаза: в сессии с шагами — активный шаг; без шагов — фаза шаблона по часам, если «Фазы» включены (Д-1). */
  readonly phaseIndex = computed(() => {
    if (this.sessionSteps()) {
      return this.activeStepIndex();
    }
    if (!this.store.settings().phases) {
      return -1;
    }
    let passed = 0;
    const minutes = this.elapsed() / MS_PER_MINUTE;
    const phases = this.phases();
    for (let index = 0; index < phases.length; index += 1) {
      passed += phases[index]?.minutes ?? 0;
      if (minutes < passed - PHASE_EPSILON_MIN) {
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

  /** Календарь периода повторяющегося топика (FR-61) — тот же, по которому считается подсказка. */
  private readonly calendar = computed<IStepCalendar>(() => ({
    challengeStart: this.store.challenge().startDate,
    routeBlocks: this.course.routeBlocks(),
    boundaryHour: this.store.settings().dayBoundaryHour,
  }));
  /** Накоплено шагами круга прошлыми сессиями, мин (FR-57): пересчитывается по логам, а не на тик. */
  private readonly circleMin = computed<readonly number[]>(() => {
    const steps = this.sessionSteps();
    const item = this.item();
    return steps && item ? circleMinutes({ item, logs: this.store.logs(), circleId: steps.circleId, calendar: this.calendar() }) : [];
  });

  constructor() {
    const interval = setInterval(() => this.onTick(), 1000);
    inject(DestroyRef).onDestroy(() => clearInterval(interval));
    effect(() => {
      const timer = this.state();
      const title = timer ? `${timer.pausedAt ? '❚❚' : '▶'} ${this.clock()} · Импрува` : 'Импрува';
      document.title = title;
    });
    // Таймер, запущенный до 1.6, переводится на шаги при первом открытии и сразу записывается (FR-65)
    effect(() => {
      const timer = this.state();
      if (timer && timer.legacySchedule !== false) {
        untracked(() => this.openLegacy(timer));
      }
    });
    // Ориентир изменили во время сессии и активного шага больше нет — активным становится последний (FR-63)
    effect(() => {
      const steps = this.sessionSteps();
      const length = this.item()?.guide?.steps.length ?? 0;
      if (steps && length > 0 && steps.activeIndex >= length) {
        untracked(() => this.switchStep(length - 1));
      }
    });
  }

  /** Проверка забытого таймера при старте приложения (FR-11). */
  checkForgotten(): void {
    const timer = this.state();
    if (timer && !timer.pausedAt && elapsedMs(timer, Date.now()) > FORGOTTEN_AFTER_MIN * MS_PER_MINUTE) {
      this.ui.forgottenOpen.set(true);
    }
  }

  /**
   * Старт сессии. Возвращает false, если уже идёт другая сессия — UI спрашивает о переключении.
   * Лимит — длина точки старта, а не сумма шагов (FR-55). Шаг старта и круг — одна функция домена с подсказкой (Д-27).
   */
  start(params: { readonly itemId: string | null; readonly type: TSessionType; readonly plannedMin: number }): boolean {
    if (this.state()) {
      this.ui.pendingStart.set(params);
      return false;
    }
    this.sound.requestPermission();
    const now = Date.now();
    const item = params.itemId ? (this.store.data().items.find((entry) => entry.id === params.itemId) ?? null) : null;
    const plan = item?.guide?.steps ?? [];
    const begin = item
      ? stepStart({ item, type: params.type, logs: this.store.logs(), day: this.store.today(), calendar: this.calendar() })
      : null;
    this.resetNotices();
    this.draft.clear();
    this.store.updateMeta({
      timer: {
        itemId: params.itemId,
        type: params.type,
        startedAt: new Date(now).toISOString(),
        pausedAt: null,
        pausedMs: 0,
        // Точки старта передают длину > 0 (Q-034); у сессии с шагами лимит всегда > 0 — правило домена (Q-035)
        plannedMin: begin ? stepLimitMin({ savedMin: params.plannedMin, guideSteps: plan }) : params.plannedMin,
        stepMinutes: null,
        steps: begin ? startSteps(begin, plan) : null,
        legacySchedule: false,
      },
    });
    this.tick.set(now);
    return true;
  }

  pause(): void {
    const timer = this.state();
    if (timer && !timer.pausedAt && !this.stopping) {
      this.store.updateMeta({ timer: { ...timer, pausedAt: new Date().toISOString() } });
    }
  }

  resume(): void {
    const timer = this.state();
    if (timer?.pausedAt && !this.stopping) {
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

  /**
   * Выбор шага (FR-52) — в списке шагов, «Следующий шаг», «Предыдущий шаг»; на ходу и на паузе. Часы, лимит и минуты
   * других шагов не меняются: время ничему не добавляется и никуда не переносится. Смена пишется сразу (≤ 1 с).
   */
  selectStep(index: number): void {
    const length = this.guideSteps()?.length ?? 0;
    if (Number.isInteger(index) && index >= 0 && index < length) {
      this.switchStep(index);
    }
  }

  nextStep(): void {
    const active = this.activeStepIndex();
    if (active >= 0) {
      this.selectStep(active + 1);
    }
  }

  prevStep(): void {
    const active = this.activeStepIndex();
    if (active >= 0) {
      this.selectStep(active - 1);
    }
  }

  /**
   * «Стоп» кнопкой или «Засчитать» с числом минут (FR-11, FR-13, FR-56): лог со сведениями о шагах и очистка таймера —
   * одной транзакцией. Сессия короче минуты не записывается. Возвращает id лога или null.
   */
  async stop(overrideMinutes?: number): Promise<string | null> {
    return (await this.finish(overrideMinutes)).logId;
  }

  /** «Удалить сессию» в диалоге забытого таймера: ничего не записывается, место остановки не меняется. */
  discard(): void {
    if (this.stopping) {
      return;
    }
    this.store.updateMeta({ timer: null });
    this.draft.clear();
    this.ui.focusMode.set(false);
  }

  /** «Переключиться»: текущая сессия записывается, ожидающая стартует после записи; при отказе хранилища — нет. */
  async switchToPending(): Promise<void> {
    const pending = this.ui.pendingStart();
    this.ui.pendingStart.set(null);
    if (!pending) {
      return;
    }
    const result = await this.finish();
    if (result.status === 'failed') {
      return;
    }
    this.ui.summaryLogId.set(null);
    this.start(pending);
  }

  /** Повторный «Стоп» во время записи возвращает ту же запись: второго лога той же сессии нет. */
  private finish(overrideMinutes?: number): Promise<IStopResult> {
    this.stopping ??= this.writeStop(overrideMinutes).finally(() => {
      this.stopping = null;
    });
    return this.stopping;
  }

  private async writeStop(overrideMinutes: number | undefined): Promise<IStopResult> {
    const timer = this.state();
    if (!timer) {
      return { status: 'none', logId: null };
    }
    const nowMs = Date.now();
    const measured = elapsedMs(timer, nowMs);
    const minutes = overrideMinutes ?? Math.round(measured / MS_PER_MINUTE);
    // Сессия короче минуты не записывается и место не меняет (FR-56; US-25, критерий 6 — 40 с)
    if (minutes < 1 || (overrideMinutes === undefined && measured < MS_PER_MINUTE)) {
      this.store.updateMeta({ timer: null });
      this.ui.focusMode.set(false);
      this.toasts.show({ text: TOO_SHORT_TEXT });
      return { status: 'short', logId: null };
    }
    const durationMin = Math.min(Math.round(minutes), MAX_LOG_MIN);
    const now = new Date(nowMs).toISOString();
    const log = buildLog(
      {
        itemId: timer.itemId,
        type: timer.type,
        startedAt: new Date(nowMs - durationMin * MS_PER_MINUTE).toISOString(),
        endedAt: now,
        source: 'timer',
        // Минуты шагов с суммой минут лога, засчитанное число — по Д-7; шаг первой минуты — на момент «Стоп» (ADR-007, правила 6, 7)
        steps: logStepsAtStop({ timer, elapsedMs: measured, durationMin }),
      },
      now,
    );
    // Черновик конспекта привязывается к логу до commit, meta пакета берётся после этого (ADR-007)
    this.draft.attach(log.id);
    const meta: IMeta = { ...this.store.meta(), timer: null, updatedAt: new Date().toISOString() };
    try {
      await this.store.commit({
        puts: [
          { collection: 'timeLogs', entity: log },
          { collection: 'meta', entity: meta },
        ],
        removes: [],
      });
    } catch {
      // Хранилище не приняло пакет: в памяти ничего не изменилось, таймер со всеми шагами идёт или стоит на паузе, как до «Стоп»
      this.toasts.show({ text: STOP_FAILED_TEXT, kind: 'error', durationMs: 10_000 });
      return { status: 'failed', logId: null };
    }
    this.ui.focusMode.set(false);
    this.ui.summaryLogId.set(log.id);
    return { status: 'logged', logId: log.id };
  }

  private onTick(): void {
    const timer = this.state();
    if (!timer) {
      return;
    }
    this.tick.set(Date.now());
    if (!this.stopping && timer.legacySchedule === false) {
      this.checkSignals(timer);
    }
  }

  private checkSignals(timer: ITimerState): void {
    const elapsed = this.elapsed();
    if (timer.steps) {
      this.checkStepSignals(timer, timer.steps, elapsed);
    } else {
      this.checkPhaseSignals(timer, elapsed);
    }
    // Сигнал на 90-й минуте (ТЗ M3) не меняется (FR-55)
    if (!this.deepLimitNotified && elapsed >= DEEP_WORK_LIMIT_MIN * MS_PER_MINUTE) {
      this.deepLimitNotified = true;
      this.sound.chime();
      const text = '90 минут — предел глубокой концентрации. Перерыв 10–15 минут?';
      this.sound.notify(text);
      this.toasts.show({ text, durationMs: 15_000 });
    }
  }

  /**
   * Сессия с шагами: «Время шага по плану вышло» — один раз на шаг за сессию, не на паузе (FR-54); «Время сессии вышло» —
   * один раз на лимите, только со «Стоп» (FR-55, Q-010). Отметки пишутся в таймер: после перезагрузки не повторяются (Д-21).
   */
  private checkStepSignals(timer: ITimerState, steps: ITimerSteps, elapsed: number): void {
    if (timer.pausedAt) {
      return;
    }
    const active = steps.activeIndex;
    const view = this.stepViews()[active];
    const stepMs = this.stepMs()[active] ?? 0;
    const planDone =
      view !== undefined &&
      !steps.planSignaled.includes(active) &&
      (this.circleMin()[active] ?? 0) * MS_PER_MINUTE + stepMs >= view.planMin * MS_PER_MINUTE;
    const limitDone = !steps.limitSignaled && elapsed >= timer.plannedMin * MS_PER_MINUTE;
    if (!planDone && !limitDone) {
      return;
    }
    this.writeSteps(timer, elapsed, {
      planSignaled: planDone ? [...steps.planSignaled, active] : steps.planSignaled,
      limitSignaled: steps.limitSignaled || limitDone,
    });
    if (view && planDone) {
      this.alert({ text: stepPlanDoneText({ title: view.title, planMin: view.planMin }), final: false });
    }
    if (limitDone) {
      this.alert({ text: sessionEndText(timer.plannedMin), final: true });
    }
  }

  /** Сессия без шагов ориентира — как в 1.5 (Д-1): «Фаза: …» при смене фазы, «Время сессии вышло» один раз. */
  private checkPhaseSignals(timer: ITimerState, elapsed: number): void {
    const index = this.phaseIndex();
    if (this.lastPhaseIndex !== -1 && index !== this.lastPhaseIndex && index >= 0) {
      this.alert({ text: `Фаза: ${this.phases()[index]?.title ?? ''}`, final: false });
    }
    this.lastPhaseIndex = index;
    const limit = timer.plannedMin;
    if (limit > 0 && !this.plainLimitNotified && !timer.pausedAt && elapsed >= limit * MS_PER_MINUTE) {
      this.plainLimitNotified = true;
      this.alert({ text: sessionEndText(limit), final: true });
    }
  }

  /**
   * Смена активного шага. Всё время до смены остаётся у своих шагов: `spentMs` не уменьшается и не укорачивается,
   * переход за конец массива дополняет его нулями (Q-032; ADR-007, «Длина spentMs»). Шаг, ставший активным
   * с уже набранным планом, сигнала не получает (FR-54).
   */
  private switchStep(index: number): void {
    const timer = this.state();
    const steps = timer?.steps;
    if (!timer || !steps || this.stopping || index === steps.activeIndex) {
      return;
    }
    const now = Date.now();
    this.tick.set(now);
    const elapsed = elapsedMs(timer, now);
    const spentMs = timerStepMs(steps, elapsed);
    while (spentMs.length <= index) {
      spentMs.push(0);
    }
    const planMin = this.item()?.guide?.steps[index]?.minutes ?? 0;
    const reached = (this.circleMin()[index] ?? 0) * MS_PER_MINUTE + (spentMs[index] ?? 0) >= planMin * MS_PER_MINUTE;
    this.writeSteps(timer, elapsed, {
      activeIndex: index,
      spentMs,
      planSignaled: reached && !steps.planSignaled.includes(index) ? [...steps.planSignaled, index] : steps.planSignaled,
    });
  }

  /** Запись шагов таймера: каждая сохраняет шаг, первым набравший 1 мин, на этот момент (ADR-007, правило 6). */
  private writeSteps(timer: ITimerState, elapsed: number, patch: Partial<ITimerSteps>): void {
    const steps = timer.steps;
    if (!steps) {
      return;
    }
    this.store.updateMeta({
      timer: { ...timer, steps: { ...steps, ...patch, firstMinuteIndex: timerFirstMinuteIndex(steps, elapsed) } },
    });
  }

  /** Перевод таймера 1.5 правилом домена (FR-65): шаг и минуты по расписанию 1.5, лимит по Q-035, таймер не сбрасывается. */
  private openLegacy(timer: ITimerState): void {
    const item = timer.itemId ? this.store.data().items.find((entry) => entry.id === timer.itemId) : undefined;
    this.store.updateMeta({
      timer: migrateLegacyTimer({
        timer: { ...timer, stepMinutes: validSchedule(timer.stepMinutes) },
        guideSteps: item?.guide?.steps ?? [],
        elapsedMs: elapsedMs(timer, Date.now()),
        circleId: createId(),
      }),
    });
  }

  private resetNotices(): void {
    this.lastPhaseIndex = -1;
    this.deepLimitNotified = false;
    this.plainLimitNotified = false;
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
}
