import type { IGuide, IGuideLink, IGuideStep, IRouteArtist, TItemKind, TLinkAccess, TResourceType, TResourceUnit, TRouteRole, TSectionWeight } from '../types';
import { L } from './course-links';

/**
 * Курс годового челленджа (ТЗ 9, FR-42, FR-44). Описание без id — id выдаются при создании.
 * Ключ курса по умолчанию — путь названий; при переименовании задай `key` со старым путём (AGENTS.md).
 */

export interface ISeedResource {
  readonly key: string;
  readonly title: string;
  readonly type: TResourceType;
  readonly author: string;
  readonly url: string;
  readonly unit: TResourceUnit;
  readonly unitCount: number;
  readonly minPerUnit: number;
  readonly access: TLinkAccess;
  readonly freeAlternativeUrl?: string;
}

export interface ISeedItem {
  readonly key?: string;
  readonly title: string;
  readonly kind: TItemKind;
  readonly estimateMin: number;
  readonly resource?: string;
  readonly range?: string;
  readonly recurrenceWeeks?: number;
  readonly selfCheck?: string;
  readonly guide: IGuide;
  readonly routeRole?: TRouteRole;
  readonly checkpointDay?: number;
}

export interface ISeedTopic {
  readonly key?: string;
  readonly title: string;
  readonly description: string;
  readonly items: readonly ISeedItem[];
}

export interface ISeedSection {
  readonly key?: string;
  readonly title: string;
  readonly weight: TSectionWeight;
  readonly quarterWeights: readonly TSectionWeight[];
  readonly topics: readonly ISeedTopic[];
}

export interface ISeedRouteBlock {
  readonly key?: string;
  readonly fromWeek: number;
  readonly toWeek: number;
  readonly artists: readonly IRouteArtist[];
  readonly copyTask: string;
  readonly copyTechnique: string;
}

export const SEED_RESOURCES: readonly ISeedResource[] = [
  { key: 'drawabox', title: 'Drawabox', type: 'course', author: 'Uncomfortable', url: 'https://drawabox.com', unit: 'lesson', unitCount: 7, minPerUnit: 60, access: 'free' },
  { key: 'proko', title: 'Figure Drawing Fundamentals', type: 'course', author: 'Proko', url: 'https://www.proko.com/course/figure-drawing-fundamentals', unit: 'lesson', unitCount: 57, minPerUnit: 20, access: 'paid', freeAlternativeUrl: L.proko.url },
  { key: 'loa', title: 'Line of Action', type: 'tool', author: 'Line of Action', url: 'https://line-of-action.com', unit: 'minute', unitCount: 0, minPerUnit: 1, access: 'free' },
  { key: 'willkemp', title: 'Will Kemp Art School', type: 'video', author: 'Will Kemp', url: 'https://willkempartschool.com', unit: 'minute', unitCount: 180, minPerUnit: 1.5, access: 'free' },
  { key: 'bauman', title: 'Stephen Bauman — YouTube', type: 'video', author: 'Stephen Bauman', url: 'https://www.youtube.com/c/stephenbaumanartwork/videos', unit: 'minute', unitCount: 80, minPerUnit: 1.5, access: 'free' },
  { key: 'farges', title: 'Практический гид по масляной живописи', type: 'article', author: 'Florent Farges', url: 'https://www.florentfarges.com/the-practical-guide-to-oil-painting-techniques/', unit: 'minute', unitCount: 120, minPerUnit: 1, access: 'free' },
  { key: 'bucci', title: '10 Minutes to Better Painting', type: 'video', author: 'Marco Bucci', url: 'https://www.youtube.com/playlist?list=PL2MPJVby8-FVNcT35aKv6Ha30lwVYyK8G', unit: 'minute', unitCount: 80, minPerUnit: 1.5, access: 'free' },
  { key: 'munsell', title: 'Munsell Color Science for Painters', type: 'article', author: 'Munsell Color Science for Painters', url: 'https://www.munsellcolorscienceforpainters.com', unit: 'minute', unitCount: 120, minPerUnit: 1, access: 'free' },
  { key: 'zorn', title: 'Цветовая сетка палитры Цорна', type: 'exercise', author: 'Artists & Illustrators', url: 'https://www.artistsandillustrators.co.uk/how-to/art-theory/how-to-make-a-colour-chart-using-the-zorn-palette/', unit: 'piece', unitCount: 1, minPerUnit: 180, access: 'free' },
  { key: 'usk', title: 'Urban Sketchers', type: 'tool', author: 'Urban Sketchers', url: 'http://urbansketchers.org/who-we-are/', unit: 'minute', unitCount: 0, minPerUnit: 1, access: 'free' },
  { key: 'gac', title: 'Google Arts & Culture', type: 'tool', author: 'Google', url: 'https://artsandculture.google.com', unit: 'minute', unitCount: 0, minPerUnit: 1, access: 'free' },
  { key: 'li', title: 'Основы учебного академического рисунка', type: 'book', author: 'Николай Ли', url: 'https://www.labirint.ru/books/142012/', unit: 'page', unitCount: 480, minPerUnit: 4, access: 'paid', freeAlternativeUrl: L.vanderpoel.url },
  { key: 'bargue', title: 'Charles Bargue: Drawing Course', type: 'book', author: 'Gerald M. Ackerman', url: 'https://www.waterstones.com/book/charles-bargue-drawing-course/gerald-m-ackerman/graydon-parrish/9782867702037', unit: 'piece', unitCount: 197, minPerUnit: 90, access: 'paid', freeAlternativeUrl: L.bargue.url },
  { key: 'loomis', title: 'Successful Drawing', type: 'book', author: 'Andrew Loomis', url: 'https://titanbooks.com/5916-successful-drawing/', unit: 'page', unitCount: 160, minPerUnit: 4, access: 'paid', freeAlternativeUrl: L.speed.url },
  { key: 'norling', title: 'Perspective Made Easy', type: 'book', author: 'Ernest Norling', url: 'https://www.abebooks.com/9780486404738/Perspective-Made-Easy-Dover-Art-0486404730/plp', unit: 'page', unitCount: 203, minPerUnit: 4, access: 'paid', freeAlternativeUrl: L.norton.url },
  { key: 'robertson', title: 'How to Draw', type: 'book', author: 'Scott Robertson', url: 'https://designstudiopress.com/products/how-to-draw', unit: 'page', unitCount: 208, minPerUnit: 4, access: 'paid', freeAlternativeUrl: L.ctrlPerspective.url },
  { key: 'gurney', title: 'Color and Light', type: 'book', author: 'James Gurney', url: 'https://publishing.andrewsmcmeel.com/book/color-and-light/', unit: 'page', unitCount: 224, minPerUnit: 4, access: 'paid', freeAlternativeUrl: L.gurneyForm.url },
  { key: 'framedink', title: 'Framed Ink', type: 'book', author: 'Marcos Mateu-Mestre', url: 'https://designstudiopress.com/products/framed-ink', unit: 'page', unitCount: 144, minPerUnit: 4, access: 'paid', freeAlternativeUrl: L.ctrlLibrary.url },
  { key: 'ching', title: 'Architecture: Form, Space, and Order', type: 'book', author: 'Francis D. K. Ching', url: 'https://www.wiley.com/en-se/Architecture:+Form,+Space,+and+Order,+5th+Edition-p-9781119853374', unit: 'page', unitCount: 480, minPerUnit: 4, access: 'paid' },
  { key: 'schmid', title: 'Alla Prima II', type: 'book', author: 'Richard Schmid', url: 'https://www.amazon.com/Alla-Prima-II-Everything-Painting/dp/096621174X', unit: 'page', unitCount: 150, minPerUnit: 4, access: 'paid', freeAlternativeUrl: L.gurneySpeed.url },
];

type TGuideDraft = Omit<IGuide, 'stopCriterion' | 'links' | 'references' | 'imageIds' | 'pitfalls'> &
  Partial<Pick<IGuide, 'stopCriterion' | 'links' | 'references' | 'pitfalls'>>;

const guide = (draft: TGuideDraft): IGuide => ({
  stopCriterion: '',
  links: [],
  references: [],
  imageIds: [],
  pitfalls: [],
  ...draft,
});

const step = (title: string, minutes: number): IGuideStep => ({ title, minutes });

const ref = (title: string, url = ''): IGuideLink => ({ title, url, locator: '', access: 'free' });

const at = (base: IGuideLink, locator: string): IGuideLink => ({ ...base, locator });

/** Серия одинаковых по формату сессий «· N/M» с отдельным заданием на каждую (FR-37). */
const series = (params: {
  readonly title: string;
  readonly minutes: number;
  readonly resource?: string;
  readonly base: Omit<TGuideDraft, 'task'>;
  readonly tasks: readonly string[];
}): ISeedItem[] =>
  params.tasks.map((task, index) => ({
    title: `${params.title} · ${index + 1}/${params.tasks.length}`,
    kind: 'practice' as const,
    estimateMin: params.minutes,
    ...(params.resource ? { resource: params.resource } : {}),
    guide: guide({ ...params.base, task }),
  }));

/** Контрольные работы (FR-41): день 66 и конец каждого квартала по 13 недель. */
const CHECKPOINTS: readonly (readonly [string, number])[] = [
  ['день 66', 66],
  ['конец Q1', 91],
  ['конец Q2', 182],
  ['конец Q3', 273],
  ['финал', 364],
];

export const SEED_SECTIONS: readonly ISeedSection[] = [
  {
    title: 'Форма',
    weight: 3,
    quarterWeights: [3, 2, 1, 1],
    topics: [
      {
        title: 'Линия и разминка',
        description: 'Уверенная линия от плеча — основа всего остального. Разминка механическая и не относится к теме занятия.',
        items: [
          {
            title: 'Линии и эллипсы от плеча',
            kind: 'practice',
            estimateMin: 90,
            resource: 'drawabox',
            range: 'урок 1',
            selfCheck: 'Нарисуй 10 эллипсов в разных углах без подрисовки',
            guide: guide({
              goal: 'Прямая 20 см и эллипс в заданный прямоугольник — с первого раза, движением от плеча.',
              task: 'Наложенные линии, «призрачные» линии точка→точка и 2 листа таблиц эллипсов.',
              steps: [step('Наложенные линии: 8 проходов по одной', 15), step('«Призрачные» линии точка→точка', 30), step('Таблицы эллипсов, 2 листа', 45)],
              stopCriterion: 'Смещение конца линии не больше 3 мм, эллипсы без подрисовки.',
              links: [at(L.drawabox1, 'Superimposed lines, Ghosted lines, Tables of ellipses'), L.drawabox0],
              pitfalls: ['Рисовать от запястья', 'Подрисовывать неудачную линию вместо новой'],
            }),
          },
          {
            title: 'Слепой контур предметов быта',
            kind: 'practice',
            estimateMin: 60,
            guide: guide({
              goal: 'Скорость глаза равна скорости руки: линия идёт за взглядом, а не за памятью о форме.',
              task: 'Смятый пакет, кроссовок и своя левая рука: 6 слепых контуров и 3 полуслепых.',
              steps: [step('6 слепых контуров по 5 мин, не глядя на лист', 30), step('3 полуслепых по 10 мин: на лист только на углах', 30)],
              stopCriterion: 'Все 9 рисунков сделаны одной непрерывной линией.',
              references: [ref('Смятый пакет'), ref('Кроссовок'), ref('Своя левая рука')],
              pitfalls: ['Торопиться и «угадывать» форму по памяти'],
            }),
          },
        ],
      },
      {
        title: 'Конструктивные тела',
        description: 'Любой объект — комбинация куба, цилиндра, сферы и конуса. Строй невидимые грани так же тщательно, как видимые.',
        items: [
          {
            title: 'Прочитать раздел о геометрических телах',
            kind: 'study',
            estimateMin: 180,
            resource: 'li',
            range: 'раздел о геометрических телах',
            selfCheck: 'Как строится цилиндр в перспективе и почему малая ось эллипса совпадает с осью цилиндра?',
            guide: guide({
              goal: 'Понимать каркасное построение куба, цилиндра, конуса и сферы до того, как рисовать их.',
              task: 'Главы Ли о геометрических телах; без книги — Speed «Line Drawing» и «Mass Drawing» + Drawabox, урок 2.',
              steps: [step('Чтение главы', 40), step('Схемы построения в скетчбук', 15), step('Ответ на самопроверку своими словами', 5)],
              stopCriterion: 'В скетчбуке есть схема построения каждого из 4 тел.',
              links: [at(L.li, 'главы о геометрических телах'), at(L.speed, 'Line Drawing, Mass Drawing'), L.drawabox2],
            }),
          },
          ...series({
            title: 'Куб, цилиндр, сфера, конус с невидимыми гранями',
            minutes: 60,
            base: {
              goal: 'Строить простые тела в любом повороте с невидимыми гранями и осями.',
              steps: [step('Разминка: линии и эллипсы', 10), step('Построение тел', 40), step('Проверка схождения цветной ручкой', 10)],
              stopCriterion: 'Сзади видны все грани, параллельные рёбра сходятся в одну точку.',
              references: [ref('Реальные коробка и банка на столе под углом')],
              links: [L.drawabox2],
              pitfalls: ['Перепутаны узкий и широкий эллипсы одного цилиндра: дальний всегда шире'],
            },
            tasks: [
              'Кубы в 6 поворотах',
              'Цилиндры лежащие и стоящие',
              'Сферы с контурными линиями',
              'Конусы и пирамиды',
              'Пересечения тел: цилиндр сквозь куб',
              'Бытовой предмет из тел: чайник или фен',
            ],
          }),
        ],
      },
      {
        title: '250 коробок',
        description: 'Коробки в свободной перспективе лайнером, без ластика. Каждое ребро — к своей точке схода.',
        items: series({
          title: 'Коробки, по 25 штук',
          minutes: 60,
          resource: 'drawabox',
          base: {
            goal: 'Интуитивно ставить коробку в свободной перспективе и самому находить ошибки схождения.',
            steps: [step('25 коробок лайнером', 45), step('Продлить рёбра цветной ручкой и отметить расхождения', 15)],
            stopCriterion: 'В последних 25 коробках продлённые рёбра сходятся у большинства.',
            links: [L.drawabox250],
            pitfalls: ['Изометрия: рёбра параллельны', 'Рёбра расходятся вместо схождения'],
          },
          tasks: [
            'Обычные коробки, свободная перспектива',
            'Обычные коробки, свободная перспектива',
            'Обычные коробки, свободная перспектива',
            'Коробки с утолщёнными ближними рёбрами',
            'Коробки с утолщёнными ближними рёбрами',
            'Коробки с утолщёнными ближними рёбрами',
            'Сильное и слабое схождение',
            'Сильное и слабое схождение',
            'Длинные плоские коробки',
            'Длинные плоские коробки',
          ],
        }),
      },
      {
        title: 'Жест фигуры',
        description: 'Жест — движение и ритм позы до конструкции и анатомии.',
        items: [
          {
            title: 'Бесплатные уроки главы Gesture',
            kind: 'study',
            estimateMin: 90,
            resource: 'proko',
            range: 'глава Gesture',
            selfCheck: 'Чем «сила» (force) отличается от контура и где в позе прямая линия против кривой?',
            guide: guide({
              goal: 'Понимать жест как линию действия и ритм, а не как контур тела.',
              task: 'Бесплатный урок Proko + разделы Vanderpoel о фигуре в движении.',
              steps: [step('Видео урока', 30), step('Повтор упражнений за видео', 40), step('Vanderpoel: фигура в движении', 20)],
              stopCriterion: 'Можешь объяснить принцип «прямая против кривой» на своём наброске.',
              links: [L.proko, at(L.vanderpoel, 'фигура в движении')],
            }),
          },
          {
            title: 'Наброски 30 с / 2 мин',
            kind: 'practice',
            estimateMin: 240,
            resource: 'loa',
            guide: guide({
              goal: 'За 30 секунд передать движение позы линией действия и 2–3 кривыми.',
              task: 'Line of Action: 20 поз по 30 с, 10 по 1 мин, 5 по 2 мин. Мягкий карандаш или кисть-ручка, А3.',
              steps: [step('20 поз по 30 с', 10), step('10 поз по 1 мин', 10), step('5 поз по 2 мин', 10), step('Разбор: 3 лучших и 3 худших', 10)],
              stopCriterion: 'По наброску без головы и кистей угадывается действие.',
              links: [L.loa],
              pitfalls: ['Рисовать контур и мышцы вместо движения'],
            }),
          },
        ],
      },
    ],
  },
  {
    title: 'Перспектива',
    weight: 3,
    quarterWeights: [3, 1, 1, 1],
    topics: [
      {
        title: 'Основы',
        description: 'Одна, две и три точки схода: горизонт, линия взгляда, масштаб.',
        items: [
          {
            title: '1, 2, 3 точки схода',
            kind: 'study',
            estimateMin: 240,
            resource: 'norling',
            selfCheck: 'Где окажется точка схода для наклонной крыши?',
            guide: guide({
              goal: 'По любой фотографии найти горизонт и точки схода, а в своём рисунке — поставить их до первой линии.',
              task: 'Сессия 1 — горизонт и 1 точка; 2 — две точки и деление плоскости; 3 — три точки и наклонные плоскости (Storey).',
              steps: [step('Чтение главы', 35), step('Построения по главе', 15), step('3 фото улицы: маркером горизонт и сходящиеся', 10)],
              stopCriterion: 'На 3 фото горизонт и точки схода найдены без сомнений.',
              links: [at(L.norton, 'первые главы'), L.ctrlPerspective, at(L.storey, 'наклонные плоскости')],
            }),
          },
          {
            title: 'Построения к каждой главе',
            kind: 'practice',
            estimateMin: 270,
            guide: guide({
              goal: 'Строить «город из коробок» в 1, 2 и 3 точках с людьми в масштабе.',
              task: '3 листа А3: город из коробок в 1, 2 и 3 точках, 10+ объектов, человечки ростом 1,7 м.',
              steps: [step('Горизонт, точки схода, сетка', 15), step('Объекты-коробки', 50), step('Люди и проверка масштаба', 25)],
              stopCriterion: 'Головы всех людей на одной высоте с горизонтом.',
              pitfalls: ['Точки схода слишком близко — углы коробок острые, изображение искажено'],
            }),
          },
        ],
      },
      {
        title: 'Перспектива по воображению',
        description: 'Рисовать предмет из головы в разных ракурсах, опираясь на построение.',
        items: [
          {
            title: 'Главы 1–5',
            kind: 'study',
            estimateMin: 480,
            resource: 'robertson',
            range: 'гл. 1–5',
            selfCheck: 'Как разделить стену на 5 равных окон в перспективе без линейки с делениями?',
            guide: guide({
              goal: 'Владеть сеткой, эллипсами, делением и умножением плоскостей.',
              task: 'Одна глава за 1–2 сессии: чтение, видео к главе, лист построений.',
              steps: [step('Чтение главы', 35), step('Видео к главе', 15), step('Лист построений', 40)],
              stopCriterion: 'К каждой главе есть лист построений.',
              links: [at(L.robertson, 'гл. 1–5'), L.robertsonVideos, at(L.storey, 'сетка и деление плоскости')],
            }),
          },
          ...series({
            title: 'Предмет из головы в 3 ракурсах',
            minutes: 60,
            base: {
              goal: 'Нарисовать предмет из головы в 3 ракурсах так, чтобы он читался одним и тем же объектом.',
              steps: [step('Виды сбоку и сверху с размерами', 10), step('3 ракурса в коробке-габарите', 45), step('Сравнение с фото', 5)],
              stopCriterion: 'Пропорции совпадают во всех трёх ракурсах.',
              pitfalls: ['Начинать с деталей, не построив габаритную коробку'],
            },
            tasks: ['Табурет', 'Кружка', 'Ноутбук', 'Баскетбольный мяч с кольцом', 'Стул', 'Кроссовок', 'Гитара', 'Велосипед'],
          }),
        ],
      },
      {
        title: 'Эллипсы',
        description: 'Окружности в кубах и цилиндры по оси.',
        items: [
          {
            title: 'Окружности в кубах, цилиндры по оси',
            kind: 'practice',
            estimateMin: 135,
            resource: 'drawabox',
            range: 'урок 1',
            guide: guide({
              goal: 'Правильно вписывать окружность в любую грань куба и строить цилиндры по оси.',
              task: '20 кубов с эллипсами на 3 видимых гранях + 20 цилиндров с осью (cylinders in boxes).',
              steps: [step('Разминка: таблицы эллипсов', 10), step('Кубы с эллипсами', 30), step('Цилиндры с осью', 30), step('Проверка осей', 5)],
              stopCriterion: 'Малая ось каждого эллипса лежит на оси цилиндра.',
              references: [ref('Стакан'), ref('Колесо велосипеда'), ref('Стопка тарелок')],
              links: [at(L.drawabox1, 'Ellipses'), at(L.norton, 'круг в перспективе')],
              pitfalls: ['Угловатые «лимоны» вместо эллипсов', 'Эллипс не касается сторон квадрата'],
            }),
          },
        ],
      },
    ],
  },
  {
    title: 'Тон и свет',
    weight: 2,
    quarterWeights: [2, 3, 1, 1],
    topics: [
      {
        title: 'Тональная шкала',
        description: 'Светлота строит объём сильнее цвета. Держи шкалу из 9 ступеней под рукой.',
        items: [
          {
            title: 'Шкала 9 ступеней карандашом и акрилом',
            kind: 'practice',
            estimateMin: 60,
            guide: guide({
              goal: 'Смешать и найти на натуре любую из 9 ступеней светлоты с ошибкой не больше одной ступени.',
              task: 'Шкала карандашами 2H–8B в квадратах 3×3 см, та же шкала акрилом, поиск светлоты 5 предметов.',
              steps: [step('Шкала карандашами', 20), step('Шкала акрилом: белила + чёрная, проверка ч/б фото', 30), step('Окошко в карточке: светлота 5 предметов', 10)],
              stopCriterion: 'Соседние ступени различимы на ч/б фото.',
              links: [L.ctrlValue],
              pitfalls: ['Средние ступени 4–6 почти одинаковые', 'Акрил темнеет при высыхании'],
            }),
          },
        ],
      },
      {
        title: 'Свет на форме',
        description: 'Свет, полутон, терминатор, рефлекс, падающая тень.',
        items: [
          {
            title: 'Часть о свете и тени',
            kind: 'study',
            estimateMin: 180,
            resource: 'gurney',
            selfCheck: 'Почему рефлекс всегда темнее любой точки в свету?',
            guide: guide({
              goal: 'Объяснить пять зон света на форме и влияние типа освещения.',
              task: 'Gurney, главы о форм-принципе и типах света; бесплатно — Light and Form и эпизод Bucci «Light and Shadow».',
              steps: [step('Чтение', 40), step('Схемы 5 зон на сфере и кубе', 15), step('Ответ на самопроверку', 5)],
              stopCriterion: 'На схеме сферы подписаны все 5 зон.',
              links: [L.gurneyBook, L.gurneyForm, at(L.bucci, 'Light and Shadow')],
            }),
          },
          {
            title: 'Сфера и куб под одним светом',
            kind: 'practice',
            estimateMin: 180,
            guide: guide({
              goal: 'Показать на простых телах свет, полутон, терминатор, рефлекс и падающую тень.',
              task: 'Белый мяч и белая коробка на серой ткани, одна лампа сбоку-сверху под 45°, верхний свет выключен.',
              steps: [step('Линейное построение', 20), step('Граница света и тени, падающие тени', 10), step('Тональная моделировка от тёмного к светлому', 60)],
              stopCriterion: 'На ч/б фото рисунка и натуры терминатор и самая тёмная точка совпадают.',
              references: [L.bargue],
            }),
          },
          {
            title: 'Смена света: 4 этюда одного объекта',
            kind: 'practice',
            estimateMin: 160,
            selfCheck: 'Как меняется терминатор при контровом свете?',
            guide: guide({
              goal: 'Видеть, как тип освещения меняет форму теней на одном предмете.',
              task: 'Яблоко или кружка, 4 этюда по 40 мин: боковой, фронтальный, контровой, нижний свет.',
              steps: [step('Этюд 1', 40), step('Этюд 2', 40)],
              stopCriterion: 'Все 4 этюда рядом, подписан тип света.',
              pitfalls: ['«Обводить» тень контуром вместо тонального перехода'],
            }),
          },
        ],
      },
      {
        title: 'Визирование (sight-size)',
        description: 'Тренажёр глаза: перенос пропорций 1:1 с натуры или литографии.',
        items: [
          {
            title: 'Видео о методе',
            kind: 'study',
            estimateMin: 120,
            resource: 'bauman',
            guide: guide({
              goal: 'Понимать метод визирования: фиксированная точка, образец и лист рядом, сравнение с места.',
              task: 'Видео Bauman о sight-size и 2 видео с канала; конспект ключевых правил.',
              steps: [step('Видео', 45), step('Конспект правил', 15)],
              stopCriterion: 'В заметке 3 правила метода своими словами.',
              links: [L.baumanSightSize, L.baumanChannel],
            }),
          },
          ...series({
            title: 'Копия литографии Барга',
            minutes: 90,
            resource: 'bargue',
            base: {
              goal: 'Перенести пропорции образца 1:1 с ошибкой не больше 3 мм на листе А3.',
              steps: [step('Линейная стадия прямыми (блок-ин)', 40), step('Уточнение отвесами', 30), step('Теневая масса одним тоном', 20)],
              stopCriterion: 'При наложении фото рисунка на образец ключевые точки совпадают.',
              links: [L.bargue],
              pitfalls: ['Сразу кривые и детали вместо прямых блок-ина'],
            },
            tasks: ['Нос или губы — первые листы', 'Ухо или глаз', 'Стопа или кисть'],
          }),
        ],
      },
    ],
  },
  {
    title: 'Цвет',
    weight: 2,
    quarterWeights: [1, 1, 3, 2],
    topics: [
      {
        title: 'Система Манселла',
        description: 'Тон, светлота, насыщенность — три вопроса перед каждым мазком.',
        items: [
          {
            title: 'Hue / Value / Chroma',
            kind: 'study',
            estimateMin: 120,
            resource: 'munsell',
            selfCheck: 'Почему жёлтый самый насыщенный на высокой светлоте, а синий — на низкой?',
            guide: guide({
              goal: 'Описывать любой цвет тремя координатами: тон, светлота, насыщенность.',
              task: 'Страница о системе Манселла, затем эпизоды Bucci о цвете; схема «дерева» Манселла в скетчбук.',
              steps: [step('Чтение', 40), step('Эпизоды Bucci', 20)],
              stopCriterion: 'В скетчбуке схема: ось светлоты, круг тонов, лучи насыщенности.',
              links: [L.munsell, L.bucci],
            }),
          },
          {
            title: 'Подбор светлоты и насыщенности по фото',
            kind: 'practice',
            estimateMin: 135,
            guide: guide({
              goal: 'Для любого пятна на фото назвать тон, светлоту 1–9 и насыщенность и смешать его.',
              task: '12 пятен из пейзажа Сорольи: оценка «тон · светлота · насыщенность», смесь акрилом, выкраска к экрану.',
              steps: [step('Выбор 12 пятен и оценки', 15), step('Смеси и выкраски', 90), step('Проверка ч/б фильтром', 15)],
              stopCriterion: '10 из 12 выкрасок совпали по светлоте.',
              references: [L.sorolla],
              pitfalls: ['Слишком насыщенные тени', 'Перебелённый свет'],
            }),
          },
        ],
      },
      {
        title: 'Палитра Цорна',
        description: 'Белила, охра, кадмий красный, чёрная кость: чёрный работает как синий.',
        items: [
          {
            title: 'Сетка смесей 120 квадратов',
            kind: 'practice',
            estimateMin: 180,
            resource: 'zorn',
            guide: guide({
              goal: 'Знать, какие цвета даёт палитра из 4 красок, и повторять любую смесь по рецепту.',
              task: 'Сетка парных смесей × 5 ступеней белил, рецепт подписан под каждым квадратом.',
              steps: [step('Разметка сетки', 20), step('Смеси по строкам', 140), step('Подписи рецептов', 20)],
              stopCriterion: 'Все квадраты подписаны рецептом; сетка висит над мольбертом.',
              links: [L.zornChart],
              pitfalls: ['Мешать «на глаз» — сетка не повторяема'],
            }),
          },
          {
            title: 'Портретный этюд четырьмя красками',
            kind: 'practice',
            estimateMin: 180,
            guide: guide({
              goal: 'Написать портретный этюд палитрой из 4 красок с верной светлотой.',
              task: 'Автопортрет в зеркале при одной лампе или фото с боковым светом.',
              steps: [step('Рисунок кистью охрой', 20), step('Теневые массы одним цветом', 40), step('Свет и полутона большими плоскостями', 90), step('Края и акценты', 30)],
              stopCriterion: 'В ч/б этюд читается так же, как в цвете.',
              references: [L.zornPaintings],
            }),
          },
        ],
      },
      {
        title: 'Температура и свет',
        description: 'Тёплый свет — холодная тень, и наоборот.',
        items: [
          {
            title: 'Часть о цвете',
            kind: 'study',
            estimateMin: 240,
            resource: 'gurney',
            selfCheck: 'Какой цвет у тени на снегу солнечным днём и почему?',
            guide: guide({
              goal: 'Понимать температуру, цветной свет и гамму.',
              task: 'Gurney, главы о температуре, цветном свете и гамме; бесплатно — Gamut Masking, части 1–3.',
              steps: [step('Чтение', 45), step('Схема гаммы для одной картины', 15)],
              stopCriterion: 'Для одной картины мастера нарисована маска гаммы.',
              links: [L.gurneyBook, L.gurneyGamut],
            }),
          },
          {
            title: 'Плейлист 10 Minutes to Better Painting',
            kind: 'study',
            estimateMin: 120,
            resource: 'bucci',
            guide: guide({
              goal: 'Забрать принципы свет/тень, формы и слияния форм.',
              task: 'Эпизоды о свете и тени, хороших формах, слиянии форм; на каждый — мини-эскиз 5 минут.',
              steps: [step('Эпизод', 12), step('Мини-эскиз по принципу', 5)],
              stopCriterion: 'На каждый эпизод есть эскиз.',
              links: [L.bucci],
            }),
          },
          {
            title: 'Тёплый свет / холодная тень',
            kind: 'practice',
            estimateMin: 180,
            guide: guide({
              goal: 'Менять температуру света и тени, не теряя светлоты.',
              task: 'Белая чашка и лимон: этюд под лампой 2700 K и этюд при дневном свете с северного окна.',
              steps: [step('Этюд в тёплом свете', 80), step('Этюд в холодном свете', 80), step('Сравнение', 20)],
              stopCriterion: 'В ч/б этюды почти одинаковы, в цвете — противоположны.',
              references: [L.sorolla],
              pitfalls: ['Затемнять тень чёрным вместо смены температуры'],
            }),
          },
        ],
      },
    ],
  },
  {
    title: 'Композиция',
    weight: 2,
    quarterWeights: [1, 3, 1, 2],
    topics: [
      {
        title: 'Миниатюры',
        description: 'Решай композицию на маленьком формате, пока это дёшево.',
        items: [
          {
            title: '20 миниатюр 5×7 см по 3 минуты',
            kind: 'practice',
            estimateMin: 150,
            resource: 'framedink',
            guide: guide({
              goal: 'Быстро перебирать варианты кадра и отбрасывать слабые.',
              task: 'Один сюжет на 20 миниатюр: «баскетбольная площадка вечером» или «мой стол». Маркеры: 3 серых + чёрный.',
              steps: [step('10 миниатюр: формат и горизонт', 30), step('10 миниатюр: главное пятно, светлое/тёмное', 30), step('Топ-3 и «почему» в заметку', 15)],
              stopCriterion: 'Лучшая миниатюра читается с 3 метров.',
              links: [L.ctrlLibrary, at(L.bucci, 'Good Shapes')],
              pitfalls: ['Рисовать детали и сидеть над одной дольше 3 минут'],
            }),
          },
        ],
      },
      {
        title: 'Нотан и массы',
        description: 'Два-три тона: читается ли картинка без деталей.',
        items: [
          {
            title: 'Книга целиком',
            kind: 'study',
            estimateMin: 300,
            resource: 'framedink',
            selfCheck: 'Что такое «связанная тень» и зачем сливать тёмные пятна?',
            guide: guide({
              goal: 'Решать кадр массами: формат, движение, свет, планы, история.',
              task: '5 сессий: кадр и формат → линии движения → свет и тень в кадре → планы и глубина → история и настроение.',
              steps: [step('Чтение', 40), step('Срисовка 3 примеров маркером', 20)],
              stopCriterion: 'На каждую сессию 3 срисованных примера.',
              links: [L.framedInk, L.ctrlLibrary, at(L.bucci, 'Merging Shapes')],
            }),
          },
          {
            title: 'Разбор кадра мастера в 2–3 тона',
            kind: 'practice',
            estimateMin: 150,
            guide: guide({
              goal: 'Разложить любую картину на 2–3 тона и показать путь взгляда.',
              task: '6 картин по 25 мин: нотан в 2 тона, затем в 3 тона и стрелки пути взгляда.',
              steps: [step('Нотан в 2 тона', 10), step('Нотан в 3 тона', 10), step('Путь взгляда', 5)],
              stopCriterion: 'По нотану узнаётся картина.',
              references: [L.hokusai, L.sargentPaintings, L.repin],
              pitfalls: ['Видеть предметы, а не пятна — щурься или смотри через расфокус'],
            }),
          },
        ],
      },
    ],
  },
  {
    title: 'Архитектура',
    weight: 1,
    quarterWeights: [1, 2, 2, 1],
    topics: [
      {
        title: 'Элементы формы',
        description: 'Точка, линия, плоскость, объём в архитектуре.',
        items: [
          {
            title: 'Главы 1–2',
            kind: 'study',
            estimateMin: 360,
            resource: 'ching',
            range: 'гл. 1–2',
            selfCheck: 'Покажи на фото здания вычитание и сложение объёмов.',
            guide: guide({
              goal: 'Видеть фасад как систему плоскостей, ритмов и объёмов.',
              task: 'Гл. 1 «Primary Elements», гл. 2 «Form»; по 5 схем лайнером за сессию.',
              steps: [step('Чтение', 40), step('5 схем лайнером', 20)],
              stopCriterion: 'К каждой сессии 5 схем.',
              links: [at(L.ching, 'гл. 1–2')],
            }),
          },
          {
            title: 'Наброски фасадов с фото',
            kind: 'practice',
            estimateMin: 240,
            guide: guide({
              goal: 'Рисовать фасад от общего к частному.',
              task: '3 фасада по 20 мин: габарит → сетка этажей и осей → проёмы → детали.',
              steps: [step('Фасад 1', 20), step('Фасад 2', 20), step('Фасад 3', 20)],
              stopCriterion: 'Число окон и этажей совпадает с фото.',
              references: [ref('Свои фото местных храмов и шопхаусов'), L.met],
              pitfalls: ['Рисовать окна по одному без сетки — фасад «едет»'],
            }),
          },
        ],
      },
      {
        title: 'Пространство',
        description: 'Интерьер и улица в перспективе.',
        items: [
          {
            title: 'Интерьер в 1 точке',
            kind: 'practice',
            estimateMin: 120,
            resource: 'norling',
            guide: guide({
              goal: 'Интерьер в 1 точке с мебелью в верном масштабе.',
              task: 'Своя комната из дверного проёма.',
              steps: [step('Задняя стена и точка схода на высоте глаз', 15), step('Мебель коробками, перенос высоты от двери', 60), step('Тон в 3 ступени', 45)],
              stopCriterion: 'Высота стола одинакова у ближнего и дальнего края в измерении по двери.',
              links: [at(L.norton, 'интерьеры')],
            }),
          },
          {
            title: 'Улица в 2 точках',
            kind: 'practice',
            estimateMin: 120,
            resource: 'robertson',
            guide: guide({
              goal: 'Улица в 2 точках без искажения на ближнем углу.',
              task: 'Угол перекрёстка со своего фото с уровня глаз.',
              steps: [step('Точки схода за листом, горизонт', 15), step('Сетка этажей делением по диагоналям', 45), step('Люди головами на горизонте', 60)],
              stopCriterion: 'Угол у основания ближнего здания тупой.',
            }),
          },
        ],
      },
      {
        title: 'Наброски с натуры',
        description: 'Рисуй то, что видишь, на месте.',
        items: series({
          title: 'Скетч на улице',
          minutes: 60,
          resource: 'usk',
          base: {
            goal: 'Рисовать на месте, не дожидаясь идеального вида, и заканчивать скетч за час.',
            steps: [step('Выбор кадра миниатюрой', 5), step('Линия', 40), step('Тон или акварельная заливка', 15)],
            stopCriterion: 'Скетч закончен на месте за 60 минут.',
            links: [L.usk],
            references: [L.turner, L.sargentPaintings],
            pitfalls: ['Стирать и переделывать — скетч ценен как дневник'],
          },
          tasks: ['Кафе изнутри', 'Улица с мотобайками', 'Храм или большое здание', 'Рынок с людьми', 'Причал или берег', 'Баскетбольная площадка'],
        }),
      },
    ],
  },
  {
    title: 'Техники',
    weight: 2,
    quarterWeights: [1, 1, 3, 3],
    topics: [
      {
        title: 'Акрил',
        description: 'Быстро сохнет и темнеет при высыхании. Замедлитель и лессировочный медиум вместо воды.',
        items: [
          {
            title: 'Бесплатные уроки по акрилу',
            kind: 'study',
            estimateMin: 180,
            resource: 'willkemp',
            selfCheck: 'На сколько ступеней темнеет твой средний серый после высыхания?',
            guide: guide({
              goal: 'Настроить палитру и медиумы акрила.',
              task: 'Раскладка палитры, смешивание цвета, натюрморт и пейзаж; записать свою палитру и медиумы.',
              steps: [step('Видео', 45), step('Заметка: палитра и медиумы', 15)],
              stopCriterion: 'В заметке список красок и медиумов.',
              links: [L.willKemp],
            }),
          },
          {
            title: 'Градиенты с замедлителем',
            kind: 'practice',
            estimateMin: 120,
            guide: guide({
              goal: 'Ровный градиент акрилом без ступенек.',
              task: '4 полосы 5×20 см: ультрамарин→белый, кадмий→ультрамарин, без замедлителя, мокрым по мокрому с распылителем.',
              steps: [step('Полосы 1–2', 60), step('Полосы 3–4', 60)],
              stopCriterion: 'Нет видимых «ступенек» с расстояния 1 м.',
            }),
          },
          {
            title: 'Лессировка',
            kind: 'practice',
            estimateMin: 120,
            guide: guide({
              goal: 'Прозрачная лессировка поверх монохромного подмалевка.',
              task: 'Сфера или яблоко умброй, сушка, 3 слоя прозрачными пигментами с медиумом 1:5.',
              steps: [step('Монохром умброй', 40), step('Сушка и 3 лессировки', 80)],
              stopCriterion: 'Подмалевок читается сквозь все слои.',
              pitfalls: ['Разбавлять водой — слой пятнистый и слабый'],
            }),
          },
          {
            title: 'Сухая кисть и сграффито',
            kind: 'practice',
            estimateMin: 60,
            guide: guide({
              goal: 'Получать фактуры сухой кистью и сграффито.',
              task: '3 фактуры на квадратах 10×10 см: дерево, трава, камень; сграффито черенком по сырому слою.',
              steps: [step('Дерево', 20), step('Трава', 20), step('Камень', 20)],
              stopCriterion: 'Каждая фактура узнаётся без подписи.',
            }),
          },
        ],
      },
      {
        title: 'Масло без растворителей',
        description: 'Жирное поверх тощего. Сафлоровое масло вместо скипидара.',
        items: [
          {
            title: 'Гайд по техникам и материалам',
            kind: 'study',
            estimateMin: 120,
            resource: 'farges',
            selfCheck: 'Почему тощий слой поверх жирного трескается?',
            guide: guide({
              goal: 'Писать маслом дома без растворителей и соблюдать «жирное по тощему».',
              task: 'Gamblin: Solvent-Free Painting и Fat-Over-Lean. Гайд Farges — платный курс, по желанию.',
              steps: [step('Чтение', 45), step('Список материалов в заметку', 15)],
              stopCriterion: 'Есть список материалов и порядок очистки кистей.',
              links: [L.gamblinSolventFree, L.gamblinFatOverLean],
            }),
          },
          {
            title: 'Тест-пластина «жирное по тощему»',
            kind: 'practice',
            estimateMin: 60,
            guide: guide({
              goal: 'Знать сроки высыхания своих смесей в своём климате.',
              task: 'Картон на грунте, 3 полосы: краска из тюбика, +10% масла, +25% масла; проверка через 1, 3 и 7 дней.',
              steps: [step('Полосы и подписи', 45), step('Запись в заметку', 15)],
              stopCriterion: 'В заметке сроки высыхания трёх полос.',
            }),
          },
          {
            title: 'Гризайль-подмалевок',
            kind: 'practice',
            estimateMin: 180,
            guide: guide({
              goal: 'Объём без цвета тощим слоем.',
              task: 'Натюрморт из 2 предметов: белила + чёрная или умбра, 3 ступени в тенях и 5 в свету.',
              steps: [step('Рисунок', 30), step('Тени', 60), step('Свет', 90)],
              stopCriterion: 'Объём читается без цвета; слой тощий, без медиума.',
              references: [L.nga],
            }),
          },
        ],
      },
      {
        title: 'Alla prima',
        description: 'Мокрым по мокрому: большие массы, температура, края.',
        items: [
          {
            title: 'Книга',
            kind: 'study',
            estimateMin: 600,
            resource: 'schmid',
            selfCheck: 'Какие есть края и где ставить жёсткий?',
            guide: guide({
              goal: 'Понимать порядок работы alla prima, края и цвет.',
              task: 'Schmid по частям; после каждой части — этюд 30 мин по её принципу. Бесплатно — серия Gurney о Speed.',
              steps: [step('Чтение', 30), step('Этюд по принципу', 30)],
              stopCriterion: 'На каждую часть есть этюд.',
              links: [L.schmid, L.gurneySpeed, L.bucci],
            }),
          },
          ...series({
            title: 'Сессия выходного дня',
            minutes: 180,
            base: {
              goal: 'Законченный этюд маслом за одну сессию без грязи и переписывания.',
              steps: [step('3 миниатюры кадра', 15), step('Рисунок кистью и тени тощим слоем', 20), step('Большие плоскости', 90), step('Края и блики', 40), step('Фото и разбор', 15)],
              stopCriterion: 'Большие массы не переписывались больше одного раза.',
              references: [L.sargentPaintings, L.sorolla, L.fechinPaintings],
              pitfalls: ['Мелкая кисть с начала', '«Вылизывание» света'],
            },
            tasks: ['Натюрморт из 3 предметов', 'Автопортрет или портрет по фото', 'Пейзаж с натуры'],
          }),
        ],
      },
    ],
  },
  {
    title: 'Мастера',
    weight: 1,
    quarterWeights: [2, 1, 2, 3],
    topics: [
      {
        title: 'Копия мастера',
        description: 'Фрагмент картины: повтори ход работы, а не контур.',
        items: [
          {
            title: 'Копия фрагмента',
            kind: 'practice',
            estimateMin: 120,
            resource: 'gac',
            recurrenceWeeks: 4,
            routeRole: 'copy',
            guide: guide({
              goal: 'Повторить ход работы мастера на фрагменте около 15×20 см.',
              task: 'Задание копии — из текущего блока маршрута по мастерам.',
              steps: [step('Разбор: порядок слоёв, тёмное и светлое, жёсткие края', 15), step('Построение визированием', 20), step('Исполнение в технике квартала', 70), step('Фото рядом с оригиналом, 3 расхождения', 15)],
              stopCriterion: 'В заметке 3 расхождения с оригиналом.',
              links: [L.artCamera, L.wga],
              pitfalls: ['Копировать с маленькой картинки в телефоне — бери файл от 2000 px'],
            }),
          },
        ],
      },
      {
        title: 'Изучение художника',
        description: 'Два художника вперемешку. В заметке — что забираешь себе.',
        items: [
          {
            title: 'Изучение двух художников',
            kind: 'study',
            estimateMin: 60,
            resource: 'gac',
            recurrenceWeeks: 1,
            routeRole: 'study',
            guide: guide({
              goal: 'Понять, что забираешь у художника в свою работу.',
              task: 'Художник недели — из текущего блока маршрута по мастерам.',
              steps: [step('Контекст: годы, школа, техника', 10), step('10 работ в высоком разрешении', 20), step('3 штудии по 6 минут', 20), step('Заметка: ответы и «что забираю»', 10)],
              stopCriterion: 'В заметке ответы на вопросы к анализу.',
              links: [L.wga, L.artCamera],
            }),
          },
        ],
      },
      {
        title: 'Контрольные работы',
        description: 'Один и тот же сюжет раз в квартал: по фото контрольных видно, что изменилось за год.',
        items: CHECKPOINTS.map(([title, day]) => ({
          title: `Контрольная работа · ${title}`,
          kind: 'practice' as const,
          estimateMin: 120,
          checkpointDay: day,
          selfCheck: 'Что стало лучше по сравнению с прошлой контрольной — назови 3 вещи',
          guide: guide({
            goal: 'Зафиксировать уровень на сравнимой работе, чтобы видеть рост за год.',
            task: 'Натюрморт из 3 предметов разной формы под одним источником света — тот же сюжет и формат A4, что в прошлый раз.',
            steps: [step('Постановка: те же предметы и свет, фото постановки', 15), step('Композиция и построение', 25), step('Тон: 3 тональные группы, затем детали', 65), step('Фото работы при дневном свете, заметка', 15)],
            stopCriterion: 'Фото работы и заметка «что изменилось с прошлой контрольной» сохранены.',
            links: [L.speed, L.ctrlValue],
            pitfalls: ['Менять сюжет или формат — сравнение потеряет смысл', 'Доделывать работу в следующий день: время — часть условия'],
          }),
        })),
      },
    ],
  },
];

const artist = (name: string, url: IGuideLink, takeaway: string, works: string): IRouteArtist => ({ name, url: url.url, takeaway, works });

/** Маршрут по мастерам на 52 недели (курс, раздел «Мастера»). */
export const SEED_ROUTE: readonly ISeedRouteBlock[] = [
  {
    fromWeek: 1,
    toWeek: 4,
    artists: [
      artist('Дюрер', L.durer, 'Штрих по форме', '«Руки апостола» (1508), «Заяц» (1502)'),
      artist('Хокусай', L.hokusai, 'Сильный силуэт и линия', '«Большая волна в Канагаве»'),
    ],
    copyTask: 'Одна кисть из «Рук апостола» Дюрера',
    copyTechnique: 'Лайнер',
  },
  {
    fromWeek: 5,
    toWeek: 8,
    artists: [
      artist('Леонардо', L.leonardoNotes, 'Конструкция и штудия', 'Штудии рук и драпировок'),
      artist('Гольбейн', L.holbein, 'Точный контур при минимуме тона', 'Рисунок «Сэр Томас Мор»'),
    ],
    copyTask: 'Голова Гольбейна на тонированной бумаге',
    copyTechnique: 'Карандаш и мел',
  },
  {
    fromWeek: 9,
    toWeek: 13,
    artists: [
      artist('Рембрандт', L.rembrandt, 'Жест и свет быстрым средством', '«Спящая молодая женщина» (кисть, ок. 1654)'),
      artist('Дега', L.degas, 'Фигура в движении', '«Танцевальный класс»'),
    ],
    copyTask: 'Рисунок Рембрандта пером и размывкой',
    copyTechnique: 'Перо и размывка',
  },
  {
    fromWeek: 14,
    toWeek: 17,
    artists: [
      artist('Сарджент', L.sargentDrawings, 'Тон углём большими плоскостями', 'Портреты углём 1910–1920-х'),
      artist('Серов', L.serovDrawings, 'Обобщение', 'Портретные наброски'),
    ],
    copyTask: 'Голова Сарджента углём',
    copyTechnique: 'Уголь',
  },
  {
    fromWeek: 18,
    toWeek: 21,
    artists: [
      artist('Цорн', L.zornEtchings, 'Направление штриха = направление света', 'Портретные офорты'),
      artist('Шишкин', L.shishkin, 'Планы в пейзаже', '«Рожь» (1878), «Утро в сосновом лесу» (1889)'),
    ],
    copyTask: 'Фрагмент офорта Цорна штрихом лайнера',
    copyTechnique: 'Лайнер',
  },
  {
    fromWeek: 22,
    toWeek: 26,
    artists: [
      artist('Репин', L.repin, 'Композиция массами и ритмом фигур', '«Бурлаки на Волге»'),
      artist('Левитан', L.levitan, 'Настроение через тон', '«Над вечным покоем» (1894)'),
    ],
    copyTask: '«Бурлаки на Волге» в 3 тона',
    copyTechnique: 'Графит',
  },
  {
    fromWeek: 27,
    toWeek: 30,
    artists: [
      artist('Цорн', L.zornPaintings, 'Ограниченная палитра', 'Портреты 1890–1910-х'),
      artist('Соролья', L.sorolla, 'Яркий свет и цветные тени', '«Прогулка по пляжу» (1909)'),
    ],
    copyTask: 'Лицо Цорна палитрой из 4 красок',
    copyTechnique: 'Акрил',
  },
  {
    fromWeek: 31,
    toWeek: 34,
    artists: [
      artist('Моне', L.monet, 'Свет в разное время дня', 'Серии «Стога» и «Руанский собор»'),
      artist('Тёрнер', L.turner, 'Атмосфера и тёпло-холодное', '«Синий Риги» (1842)'),
    ],
    copyTask: 'Два «Стога» Моне в разном свете',
    copyTechnique: 'Акрил',
  },
  {
    fromWeek: 35,
    toWeek: 39,
    artists: [
      artist('Левитан', L.levitan, 'Цвет снега и весеннего света', '«Март», «Золотая осень» (1895)'),
      artist('Серов', L.serov, 'Свет из окна в портрете', '«Девочка с персиками» (1887)'),
    ],
    copyTask: 'Фрагмент «Марта» Левитана: снег в свете и тени',
    copyTechnique: 'Акрил',
  },
  {
    fromWeek: 40,
    toWeek: 43,
    artists: [
      artist('Сарджент', L.sargentPaintings, 'Края и экономия мазка', '«Гвоздика, лилия, лилия, роза», «Мадам Х»'),
      artist('Фешин', L.fechinDrawings, 'Фактура и конструкция головы', 'Угольные головы'),
    ],
    copyTask: 'Кисть руки или голова Сарджента alla prima',
    copyTechnique: 'Масло',
  },
  {
    fromWeek: 44,
    toWeek: 47,
    artists: [
      artist('Репин', L.repin, 'Портрет за один сеанс', '«Портрет Мусоргского» (1881)'),
      artist('Соролья', L.sorolla, 'Фигура в солнечном свете', '«Мальчики на пляже» (1910)'),
    ],
    copyTask: 'Голова «Мусоргского» Репина',
    copyTechnique: 'Масло',
  },
  {
    fromWeek: 48,
    toWeek: 52,
    artists: [
      artist('Фешин', L.fechinPaintings, 'Смелый мазок и фактура', 'Портреты 1910–1920-х'),
      artist('Художник по выбору', L.met, 'Свой выбор по итогам года', 'Подборка по своему выбору'),
    ],
    copyTask: 'Фрагмент портрета Фешина или повтор первой копии года для «Было / стало»',
    copyTechnique: 'Масло',
  },
];
