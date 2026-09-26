import { describe, expect, it } from 'vitest';
import { COURSE, SEED_ROUTE, TECHNIQUES } from '../seed';
import type { IGuide, IItem } from '../types';
import {
  filterTechniques,
  isRouteTechniqueStep,
  matchTechniques,
  resolveGuide,
  routeTechnique,
  stepLabel,
  techniqueUsage,
} from './techniques';
import { itemFixture, sectionFixture, topicFixture } from './test-fixtures';

const keys = (list: readonly { readonly key: string }[]): readonly string[] =>
  list.map((entry) => entry.key);
const steps = (titles: readonly string[]): IGuide['steps'] =>
  titles.map((title) => ({ title, minutes: 10 }));
const courseTexts = (): readonly string[] =>
  COURSE.items.flatMap((item) => [item.guide.task, ...item.guide.steps.map((step) => step.title)]);

describe('справочник приёмов: полнота карточек (FR-47, FR-50)', () => {
  it('44 карточки с уникальными ключами курса и номерами 1–44', () => {
    expect(TECHNIQUES).toHaveLength(44);
    expect(new Set(keys(TECHNIQUES)).size).toBe(44);
    expect(TECHNIQUES.every((entry) => entry.key.startsWith('technique:'))).toBe(true);
    expect(TECHNIQUES.map((entry) => entry.number)).toEqual(
      Array.from({ length: 44 }, (_, index) => index + 1),
    );
  });

  it('у каждой карточки «что это», «зачем», материалы, 3–6 шагов, проверка и ошибки', () => {
    for (const entry of TECHNIQUES) {
      expect(entry.what.trim(), entry.title).not.toBe('');
      expect(entry.why.trim(), entry.title).not.toBe('');
      expect(entry.materials.trim(), entry.title).not.toBe('');
      expect(entry.steps.length, entry.title).toBeGreaterThanOrEqual(3);
      expect(entry.steps.length, entry.title).toBeLessThanOrEqual(6);
      expect(entry.check.trim(), entry.title).not.toBe('');
      expect(entry.mistakes.length, entry.title).toBeGreaterThanOrEqual(1);
    }
  });

  it('у каждой карточки минимум 2 бесплатных источника с https-ссылкой и местом внутри', () => {
    for (const entry of TECHNIQUES) {
      expect(entry.sources.length, entry.title).toBeGreaterThanOrEqual(2);
      for (const source of entry.sources) {
        expect(source.url, entry.title).toMatch(/^https?:\/\/\S+$/);
        expect(source.locator.trim(), `${entry.title}: ${source.title}`).not.toBe('');
        expect(source.access, `${entry.title}: ${source.title}`).not.toBe('paid');
      }
    }
  });

  it('каждая карточка используется в курсе: шагом, заданием или техникой маршрута', () => {
    const texts = courseTexts();
    const routeKeys = new Set(
      SEED_ROUTE.flatMap((block) =>
        keys(
          [routeTechnique(block.copyTechnique, TECHNIQUES)].flatMap((card) => (card ? [card] : [])),
        ),
      ),
    );
    const unused = TECHNIQUES.filter(
      (entry) =>
        !routeKeys.has(entry.key) && !texts.some((text) => entry.match?.test(text) ?? false),
    );
    expect(unused.map((entry) => entry.title)).toEqual([]);
  });

  it('у каждой техники блоков маршрута курса есть карточка', () => {
    for (const block of SEED_ROUTE) {
      expect(routeTechnique(block.copyTechnique, TECHNIQUES), block.copyTechnique).not.toBeNull();
    }
  });
});

describe('словарь приёмов (FR-48)', () => {
  const titles = (text: string): readonly string[] =>
    matchTechniques(text, TECHNIQUES).map((entry) => entry.title);

  it('шаги копии мастера со скриншота получают свои карточки', () => {
    expect(titles('Построение визированием')).toEqual([
      'Sight-size («размер как видишь»)',
      'Блок-ин прямыми, отвесы и визирные углы',
    ]);
    expect(titles('Разбор: порядок слоёв, тёмное и светлое, жёсткие края')).toEqual([
      'Края',
      'Разбор слоёв и сравнение с оригиналом',
    ]);
    expect(titles('Фото рядом с оригиналом, 3 расхождения')).toEqual([
      'Разбор слоёв и сравнение с оригиналом',
    ]);
  });

  it('«расхождения» не путаются со «схождением», «угол» — с «углём» (негативный)', () => {
    expect(titles('Продлить рёбра цветной ручкой и отметить расхождения')).toEqual([
      'Коробка с невидимыми гранями и проверка схождения',
    ]);
    expect(titles('Проверка схождения цветной ручкой')).toEqual([
      'Коробка с невидимыми гранями и проверка схождения',
    ]);
    expect(titles('Ближний угол дома')).toEqual([]);
  });

  it('пустой текст и шаг без приёма — без карточек', () => {
    expect(titles('')).toEqual([]);
    expect(titles('Ответ на самопроверку своими словами')).toEqual([]);
  });

  it('свои ориентиры тоже получают карточки по словарю', () => {
    expect(titles('Лессировка ультрамарином по сухому')).toEqual(['Лессировка']);
  });
});

describe('техника квартала (FR-49, US-20)', () => {
  const copySteps = steps([
    'Разбор: порядок слоёв, тёмное и светлое, жёсткие края',
    'Построение визированием',
    'Исполнение в технике квартала',
  ]);

  it('шаг показывает технику блока и её карточку первой', () => {
    const guide = resolveGuide({
      steps: copySteps,
      task: '',
      routeTechniqueName: 'Перо и размывка',
      catalog: TECHNIQUES,
    });
    const last = guide.steps[2];
    expect(isRouteTechniqueStep('Исполнение в технике квартала')).toBe(true);
    expect(last?.label).toBe('Исполнение: перо и размывка');
    expect(last?.route).toBe('resolved');
    expect(last?.techniques[0]?.title).toBe('Перо и размывка');
  });

  it('своя техника без карточки — название есть, карточки нет', () => {
    const guide = resolveGuide({
      steps: copySteps,
      task: '',
      routeTechniqueName: 'Пастель',
      catalog: TECHNIQUES,
    });
    expect(guide.steps[2]?.label).toBe('Исполнение: пастель');
    expect(guide.steps[2]?.techniques).toEqual([]);
  });

  it('блока маршрута на дату нет — состояние «не задана», без ошибки (негативный)', () => {
    const guide = resolveGuide({
      steps: copySteps,
      task: '',
      routeTechniqueName: null,
      catalog: TECHNIQUES,
    });
    expect(guide.steps[2]?.route).toBe('missing');
    expect(guide.steps[2]?.label).toBe('Исполнение в технике квартала');
    expect(guide.steps[2]?.techniques).toEqual([]);
  });

  it('название техники сравнивается без учёта регистра и «ё»', () => {
    expect(routeTechnique('  уголь ', TECHNIQUES)?.title).toBe('Уголь');
    expect(routeTechnique('МАСЛО', TECHNIQUES)?.title).toBe('Копия маслом');
    expect(routeTechnique('', TECHNIQUES)).toBeNull();
  });

  it('приёмы задания, которых нет в шагах, выносятся отдельно без повторов', () => {
    const guide = resolveGuide({
      steps: steps(['Нотан в 2 тона']),
      task: '6 картин: нотан в 2 тона, затем стрелки пути взгляда',
      routeTechniqueName: null,
      catalog: TECHNIQUES,
    });
    expect(guide.taskTechniques.map((entry) => entry.title)).toEqual(['Миниатюры и путь взгляда']);
  });
});

describe('список приёмов (FR-51, US-22)', () => {
  it('поиск по началу названия без учёта регистра', () => {
    expect(filterTechniques('лес', TECHNIQUES).map((entry) => entry.title)).toEqual(['Лессировка']);
    expect(filterTechniques('', TECHNIQUES)).toHaveLength(44);
  });

  it('поиск без совпадений — пустой список (негативный)', () => {
    expect(filterTechniques('квантовая живопись', TECHNIQUES)).toEqual([]);
  });

  it('«Где используется» — активные топики по разделам, архивный топик не показывается', () => {
    const guide = (title: string): IGuide => ({
      goal: '',
      task: '',
      steps: steps([title]),
      stopCriterion: '',
      links: [],
      references: [],
      imageIds: [],
      pitfalls: [],
    });
    const withGuide = (item: IItem, title: string): IItem => ({ ...item, guide: guide(title) });
    const items: IItem[] = [
      withGuide(itemFixture({ id: 'a', topicId: 't1' }), 'Сушка и 3 лессировки'),
      {
        ...withGuide(itemFixture({ id: 'b', topicId: 't2' }), 'Лессировка по гризайли'),
        archived: true,
      },
      withGuide(itemFixture({ id: 'c', topicId: 't3' }), 'Лессировка'),
    ];
    const topics = [
      topicFixture('t1', 's2'),
      topicFixture('t2', 's1'),
      { ...topicFixture('t3', 's1'), archived: true },
    ];
    const sections = [sectionFixture('s1', 0), sectionFixture('s2', 1)];
    const glazing = TECHNIQUES.find((entry) => entry.title === 'Лессировка');
    expect(glazing).toBeDefined();
    if (!glazing) {
      return;
    }
    const usage = techniqueUsage({
      technique: glazing,
      items,
      topics,
      sections,
      routeTechniqueNames: [],
      catalog: TECHNIQUES,
    });
    expect(usage.map((entry) => entry.topic.id)).toEqual(['t1']);
  });

  it('копия мастера используется через технику маршрута', () => {
    const copy: IItem = {
      ...itemFixture({ id: 'copy', topicId: 't1' }),
      routeRole: 'copy',
      guide: {
        goal: '',
        task: '',
        steps: steps(['Исполнение в технике квартала']),
        stopCriterion: '',
        links: [],
        references: [],
        imageIds: [],
        pitfalls: [],
      },
    };
    const acrylic = TECHNIQUES.find((entry) => entry.title === 'Копия акрилом');
    const oil = TECHNIQUES.find((entry) => entry.title === 'Копия маслом');
    if (!acrylic || !oil) {
      throw new Error('нет карточек техник маршрута');
    }
    const params = {
      items: [copy],
      topics: [topicFixture('t1', 's1')],
      sections: [sectionFixture('s1', 0)],
      routeTechniqueNames: ['Акрил'],
      catalog: TECHNIQUES,
    };
    expect(techniqueUsage({ ...params, technique: acrylic })).toHaveLength(1);
    expect(techniqueUsage({ ...params, technique: oil })).toEqual([]);
  });
});

describe('название шага техники маршрута в таймере (FR-49)', () => {
  it('подставляет технику блока, остальные шаги не трогает', () => {
    expect(stepLabel('Исполнение в технике квартала', 'Акрил')).toBe('Исполнение: акрил');
    expect(stepLabel('Построение визированием', 'Акрил')).toBe('Построение визированием');
    expect(stepLabel('Исполнение в технике квартала', null)).toBe('Исполнение в технике квартала');
  });
});
