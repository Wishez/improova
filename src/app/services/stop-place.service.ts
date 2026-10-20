import { Injectable, computed, inject } from '@angular/core';
import {
  countedLogsByItem,
  stepProgress,
  stepStart,
  type IStepCalendar,
  type IStepStart,
  type TStepStartRule,
} from '../domain';
import type { IItem, IRouteBlock, ITimeLog, TSessionType } from '../types';
import { CourseService } from './course.service';
import { DataStore } from './data.store';
import { PlanService } from './plan.service';

/**
 * Вид подсказки до старта (FR-58; вкладка «Тексты 1.6»): `continue` — `startHint.continue`, `continueZero` —
 * `startHint.continueZero`, `cycleDone` — `startHint.cycleDone`, `none` — подсказки нет. Текст рисует интерфейс.
 */
export type TStartHintKind = 'continue' | 'continueZero' | 'cycleDone' | 'none';

export interface IStartHint {
  readonly kind: TStartHintKind;
  /** {n} — номер шага старта с 1. */
  readonly stepNumber: number;
  /** {done} — накоплено шагом старта за круг, целые минуты: то же число, что «X из Y мин» в режиме фокуса после старта. */
  readonly doneMin: number;
  /** {plan} — плановые минуты шага старта из текущего ориентира (FR-63). */
  readonly planMin: number;
}

export interface ITopicStart {
  readonly hint: IStartHint;
  /** Шаг старта, круг и накопленное — результат `stepStart` домена без изменений: то же правило, что у таймера (Д-27). */
  readonly start: IStepStart;
}

/**
 * Вид подсказки по результату правила FR-58 (сработавшее правило выбирает домен): числа «X из Y мин» — из `stepProgress`,
 * как у шага в идущей сессии, поэтому подсказка до старта и режим фокуса после него показывают одно и то же (US-25, критерий 2).
 */
function startHint(params: {
  readonly start: IStepStart;
  readonly item: Pick<IItem, 'guide'>;
}): IStartHint {
  const { start, item } = params;
  const progress = stepProgress({
    circleMin: start.accumulated[start.startIndex] ?? 0,
    sessionMs: 0,
    planMin: item.guide?.steps[start.startIndex]?.minutes ?? 0,
  });
  return {
    kind: hintKind(start.rule, progress.doneMin),
    stepNumber: start.startIndex + 1,
    doneMin: progress.doneMin,
    planMin: progress.planMin,
  };
}

/** Подсказка есть только у правил «круг пройден» и «есть место остановки»; при X = 0 — короткий текст без чисел. */
function hintKind(rule: TStepStartRule, doneMin: number): TStartHintKind {
  if (rule === 'circleDone') {
    return 'cycleDone';
  }
  if (rule !== 'continue') {
    return 'none';
  }
  return doneMin > 0 ? 'continue' : 'continueZero';
}

function topicStart(params: {
  readonly item: IItem;
  readonly type: TSessionType;
  readonly logs: readonly ITimeLog[];
  readonly day: string;
  readonly calendar: IStepCalendar;
}): ITopicStart | null {
  const start = stepStart(params);
  return start ? { hint: startHint({ start, item: params.item }), start } : null;
}

const sameRouteBlocks = (a: readonly IRouteBlock[], b: readonly IRouteBlock[]): boolean =>
  a.length === b.length && a.every((block, index) => block === b[index]);

const sameCalendar = (a: IStepCalendar, b: IStepCalendar): boolean =>
  a.challengeStart === b.challengeStart &&
  a.boundaryHour === b.boundaryHour &&
  a.routeBlocks === b.routeBlocks;

interface ITodayBlock {
  readonly key: string;
  readonly itemId: string | null;
  readonly type: TSessionType;
}

const sameBlocks = (a: readonly ITodayBlock[], b: readonly ITodayBlock[]): boolean =>
  a.length === b.length &&
  a.every(
    (block, index) =>
      block.key === b[index]?.key &&
      block.itemId === b[index]?.itemId &&
      block.type === b[index]?.type,
  );

/**
 * Подсказка и шаг старта по месту остановки (FR-57…FR-63; ADR-007, правило 5): для «Сегодня», карточки топика,
 * быстрого выбора, палитры команд и Space. Место не хранится — его считает домен по учитываемым логам, поэтому
 * значение само обновляется после «Стоп», правки, удаления и «Отменить» лога, импорта, отметки «Топик пройден»
 * и правки ориентира. Пересчёт идёт только при изменении логов, топиков, календаря челленджа и дня: запись `meta`
 * таймером и тик часов его не вызывают (НФТ «Время отклика»).
 */
@Injectable({ providedIn: 'root' })
export class StopPlaceService {
  private readonly store = inject(DataStore);
  private readonly course = inject(CourseService);
  private readonly plan = inject(PlanService);

  // Срезы коллекций, а не `store.logs()`: у них новая ссылка только при изменении самой коллекции
  private readonly items = this.store.items;
  private readonly timeLogs = this.store.timeLogs;
  private readonly itemById = computed(() => new Map(this.items().map((item) => [item.id, item])));
  private readonly countedLogs = computed(() =>
    countedLogsByItem({ logs: this.timeLogs(), items: this.items() }),
  );
  private readonly routeBlocks = computed(() => this.course.routeBlocks(), {
    equal: sameRouteBlocks,
  });

  /** Календарь периода повторяющегося топика (FR-61): дата старта челленджа, блоки маршрута, граница дня. */
  readonly calendar = computed<IStepCalendar>(
    () => ({
      challengeStart: this.store.challenge().startDate,
      routeBlocks: this.routeBlocks(),
      boundaryHour: this.store.settings().dayBoundaryHour,
    }),
    { equal: sameCalendar },
  );

  /** Шаг старта и подсказка каждого топика с шагами ориентира для сессии его вида — карточка топика и быстрый выбор. */
  readonly byItem = computed<ReadonlyMap<string, ITopicStart>>(() => {
    const day = this.store.today();
    const calendar = this.calendar();
    const logs = this.countedLogs();
    const result = new Map<string, ITopicStart>();
    for (const item of this.items()) {
      const entry = topicStart({
        item,
        type: item.kind,
        logs: logs.get(item.id) ?? [],
        day,
        calendar,
      });
      if (entry) {
        result.set(item.id, entry);
      }
    }
    return result;
  });

  private readonly todayBlocks = computed<readonly ITodayBlock[]>(
    () => (this.plan.today()?.blocks ?? []).map(({ key, itemId, type }) => ({ key, itemId, type })),
    { equal: sameBlocks },
  );

  /** Шаг старта и подсказка блоков «Сегодня» по типу блока; ключ — `IPlannedBlock.key`. Блока без шагов ориентира нет. */
  readonly today = computed<ReadonlyMap<string, ITopicStart>>(() => {
    const result = new Map<string, ITopicStart>();
    for (const block of this.todayBlocks()) {
      const entry = this.startOf(block);
      if (entry) {
        result.set(block.key, entry);
      }
    }
    return result;
  });

  /**
   * Шаг старта и подсказка из любой точки старта: блок — его тип; карточка, быстрый выбор, палитра и Space — вид топика
   * (тип не передаётся). null — сессия без топика или у топика нет шагов ориентира (шаблон фаз FR-12, Д-1).
   */
  startOf(params: {
    readonly itemId: string | null;
    readonly type?: TSessionType;
  }): ITopicStart | null {
    const item = params.itemId === null ? undefined : this.itemById().get(params.itemId);
    if (!item) {
      return null;
    }
    const type = params.type ?? item.kind;
    if (type === item.kind) {
      return this.byItem().get(item.id) ?? null;
    }
    return topicStart({
      item,
      type,
      logs: this.countedLogs().get(item.id) ?? [],
      day: this.store.today(),
      calendar: this.calendar(),
    });
  }
}
