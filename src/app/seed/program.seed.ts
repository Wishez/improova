import type { TItemKind, TResourceType, TResourceUnit, TSectionWeight } from '../types';

/** Стартовая программа (ТЗ 9). Описание без id — id выдаются при создании. */

export interface ISeedResource {
  readonly key: string;
  readonly title: string;
  readonly type: TResourceType;
  readonly author: string;
  readonly url: string;
  readonly unit: TResourceUnit;
  readonly unitCount: number;
  readonly minPerUnit: number;
}

export interface ISeedItem {
  readonly title: string;
  readonly kind: TItemKind;
  readonly estimateMin: number;
  readonly resource?: string;
  readonly range?: string;
  readonly recurrenceWeeks?: number;
  readonly selfCheck?: string;
}

export interface ISeedTopic {
  readonly title: string;
  readonly description: string;
  readonly items: readonly ISeedItem[];
}

export interface ISeedSection {
  readonly title: string;
  readonly weight: TSectionWeight;
  readonly topics: readonly ISeedTopic[];
}

export const SEED_RESOURCES: readonly ISeedResource[] = [
  { key: 'drawabox', title: 'Drawabox', type: 'course', author: 'Uncomfortable', url: 'https://drawabox.com', unit: 'lesson', unitCount: 7, minPerUnit: 60 },
  { key: 'proko', title: 'Figure Drawing Fundamentals', type: 'course', author: 'Proko', url: 'https://www.proko.com/course/figure-drawing-fundamentals', unit: 'lesson', unitCount: 57, minPerUnit: 20 },
  { key: 'loa', title: 'Line of Action', type: 'tool', author: 'Line of Action', url: 'https://line-of-action.com', unit: 'minute', unitCount: 0, minPerUnit: 1 },
  { key: 'willkemp', title: 'Will Kemp Art School', type: 'video', author: 'Will Kemp', url: 'https://willkempartschool.com', unit: 'minute', unitCount: 180, minPerUnit: 1.5 },
  { key: 'bauman', title: 'Stephen Bauman — YouTube', type: 'video', author: 'Stephen Bauman', url: 'https://www.youtube.com/c/stephenbaumanartwork/videos', unit: 'minute', unitCount: 80, minPerUnit: 1.5 },
  { key: 'farges', title: 'Практический гид по масляной живописи', type: 'article', author: 'Florent Farges', url: 'https://www.florentfarges.com/the-practical-guide-to-oil-painting-techniques/', unit: 'minute', unitCount: 120, minPerUnit: 1 },
  { key: 'bucci', title: '10 Minutes to Better Painting', type: 'video', author: 'Marco Bucci', url: 'https://www.youtube.com/playlist?list=PL2MPJVby8-FVNcT35aKv6Ha30lwVYyK8G', unit: 'minute', unitCount: 80, minPerUnit: 1.5 },
  { key: 'munsell', title: 'Munsell Color Science for Painters', type: 'article', author: 'Munsell Color Science for Painters', url: 'https://www.munsellcolorscienceforpainters.com', unit: 'minute', unitCount: 120, minPerUnit: 1 },
  { key: 'zorn', title: 'Цветовая сетка палитры Цорна', type: 'exercise', author: 'Artists & Illustrators', url: 'https://www.artistsandillustrators.co.uk/how-to/art-theory/how-to-make-a-colour-chart-using-the-zorn-palette/', unit: 'piece', unitCount: 1, minPerUnit: 180 },
  { key: 'usk', title: 'Urban Sketchers', type: 'tool', author: 'Urban Sketchers', url: 'http://urbansketchers.org/who-we-are/', unit: 'minute', unitCount: 0, minPerUnit: 1 },
  { key: 'gac', title: 'Google Arts & Culture', type: 'tool', author: 'Google', url: 'https://artsandculture.google.com', unit: 'minute', unitCount: 0, minPerUnit: 1 },
  { key: 'li', title: 'Основы учебного академического рисунка', type: 'book', author: 'Николай Ли', url: 'https://www.labirint.ru/books/142012/', unit: 'page', unitCount: 480, minPerUnit: 4 },
  { key: 'bargue', title: 'Charles Bargue: Drawing Course', type: 'book', author: 'Gerald M. Ackerman', url: 'https://www.waterstones.com/book/charles-bargue-drawing-course/gerald-m-ackerman/graydon-parrish/9782867702037', unit: 'piece', unitCount: 197, minPerUnit: 90 },
  { key: 'loomis', title: 'Successful Drawing', type: 'book', author: 'Andrew Loomis', url: 'https://titanbooks.com/5916-successful-drawing/', unit: 'page', unitCount: 160, minPerUnit: 4 },
  { key: 'norling', title: 'Perspective Made Easy', type: 'book', author: 'Ernest Norling', url: 'https://www.abebooks.com/9780486404738/Perspective-Made-Easy-Dover-Art-0486404730/plp', unit: 'page', unitCount: 203, minPerUnit: 4 },
  { key: 'robertson', title: 'How to Draw', type: 'book', author: 'Scott Robertson', url: 'https://designstudiopress.com/products/how-to-draw', unit: 'page', unitCount: 208, minPerUnit: 4 },
  { key: 'gurney', title: 'Color and Light', type: 'book', author: 'James Gurney', url: 'https://publishing.andrewsmcmeel.com/book/color-and-light/', unit: 'page', unitCount: 224, minPerUnit: 4 },
  { key: 'framedink', title: 'Framed Ink', type: 'book', author: 'Marcos Mateu-Mestre', url: 'https://designstudiopress.com/products/framed-ink', unit: 'page', unitCount: 144, minPerUnit: 4 },
  { key: 'ching', title: 'Architecture: Form, Space, and Order', type: 'book', author: 'Francis D. K. Ching', url: 'https://www.wiley.com/en-se/Architecture:+Form,+Space,+and+Order,+5th+Edition-p-9781119853374', unit: 'page', unitCount: 480, minPerUnit: 4 },
  { key: 'schmid', title: 'Alla Prima II', type: 'book', author: 'Richard Schmid', url: 'https://www.amazon.com/Alla-Prima-II-Everything-Painting/dp/096621174X', unit: 'page', unitCount: 150, minPerUnit: 4 },
];

const parts = (params: { readonly title: string; readonly count: number; readonly minutes: number; readonly resource?: string }): ISeedItem[] =>
  Array.from({ length: params.count }, (_, index) => ({
    title: `${params.title} · ${index + 1}/${params.count}`,
    kind: 'practice' as const,
    estimateMin: params.minutes,
    ...(params.resource ? { resource: params.resource } : {}),
  }));

export const SEED_SECTIONS: readonly ISeedSection[] = [
  {
    title: 'Форма',
    weight: 3,
    topics: [
      {
        title: 'Линия и разминка',
        description: 'Уверенная линия от плеча — основа всего остального. Разминка механическая и не относится к теме занятия.',
        items: [
          { title: 'Линии и эллипсы от плеча', kind: 'practice', estimateMin: 90, resource: 'drawabox', range: 'урок 1', selfCheck: 'Нарисуй 10 эллипсов в разных углах без подрисовки' },
          { title: 'Слепой контур предметов быта', kind: 'practice', estimateMin: 60 },
        ],
      },
      {
        title: 'Конструктивные тела',
        description: 'Любой объект — комбинация куба, цилиндра, сферы и конуса. Строй невидимые грани так же тщательно, как видимые.',
        items: [
          { title: 'Прочитать раздел о геометрических телах', kind: 'study', estimateMin: 180, resource: 'li', range: 'раздел о геометрических телах', selfCheck: 'Как строится цилиндр в перспективе?' },
          ...parts({ title: 'Куб, цилиндр, сфера, конус с невидимыми гранями', count: 6, minutes: 60 }),
        ],
      },
      {
        title: '250 коробок',
        description: 'Коробки в свободной перспективе лайнером, без ластика. Каждое ребро — к своей точке схода.',
        items: parts({ title: 'Коробки, по 25 штук', count: 10, minutes: 60, resource: 'drawabox' }),
      },
      {
        title: 'Жест фигуры',
        description: 'Жест — движение и ритм позы до конструкции и анатомии.',
        items: [
          { title: 'Бесплатные уроки главы Gesture', kind: 'study', estimateMin: 90, resource: 'proko', range: 'глава Gesture' },
          { title: 'Наброски 30 с / 2 мин', kind: 'practice', estimateMin: 240, resource: 'loa' },
        ],
      },
    ],
  },
  {
    title: 'Перспектива',
    weight: 3,
    topics: [
      {
        title: 'Основы',
        description: 'Одна, две и три точки схода: горизонт, линия взгляда, масштаб.',
        items: [
          { title: '1, 2, 3 точки схода', kind: 'study', estimateMin: 240, resource: 'norling', selfCheck: 'Где окажется точка схода для наклонной крыши?' },
          { title: 'Построения к каждой главе', kind: 'practice', estimateMin: 270 },
        ],
      },
      {
        title: 'Перспектива по воображению',
        description: 'Рисовать предмет из головы в разных ракурсах, опираясь на построение.',
        items: [
          { title: 'Главы 1–5', kind: 'study', estimateMin: 480, resource: 'robertson', range: 'гл. 1–5' },
          ...parts({ title: 'Предмет из головы в 3 ракурсах', count: 8, minutes: 60 }),
        ],
      },
      {
        title: 'Эллипсы',
        description: 'Окружности в кубах и цилиндры по оси.',
        items: [{ title: 'Окружности в кубах, цилиндры по оси', kind: 'practice', estimateMin: 135, resource: 'drawabox', range: 'урок 1' }],
      },
    ],
  },
  {
    title: 'Тон и свет',
    weight: 2,
    topics: [
      {
        title: 'Тональная шкала',
        description: 'Светлота строит объём сильнее цвета. Держи шкалу из 9 ступеней под рукой.',
        items: [{ title: 'Шкала 9 ступеней карандашом и акрилом', kind: 'practice', estimateMin: 60 }],
      },
      {
        title: 'Свет на форме',
        description: 'Свет, полутон, терминатор, рефлекс, падающая тень.',
        items: [
          { title: 'Часть о свете и тени', kind: 'study', estimateMin: 180, resource: 'gurney' },
          { title: 'Сфера и куб под одним светом', kind: 'practice', estimateMin: 180 },
          { title: 'Смена света: 4 этюда одного объекта', kind: 'practice', estimateMin: 160, selfCheck: 'Как меняется терминатор при контровом свете?' },
        ],
      },
      {
        title: 'Визирование (sight-size)',
        description: 'Тренажёр глаза: перенос пропорций 1:1 с натуры или литографии.',
        items: [
          { title: 'Видео о методе', kind: 'study', estimateMin: 120, resource: 'bauman' },
          ...parts({ title: 'Копия литографии Барга', count: 3, minutes: 90, resource: 'bargue' }),
        ],
      },
    ],
  },
  {
    title: 'Цвет',
    weight: 2,
    topics: [
      {
        title: 'Система Манселла',
        description: 'Тон, светлота, насыщенность — три вопроса перед каждым мазком.',
        items: [
          { title: 'Hue / Value / Chroma', kind: 'study', estimateMin: 120, resource: 'munsell' },
          { title: 'Подбор светлоты и насыщенности по фото', kind: 'practice', estimateMin: 135 },
        ],
      },
      {
        title: 'Палитра Цорна',
        description: 'Белила, охра, кадмий красный, чёрная кость: чёрный работает как синий.',
        items: [
          { title: 'Сетка смесей 120 квадратов', kind: 'practice', estimateMin: 180, resource: 'zorn' },
          { title: 'Портретный этюд четырьмя красками', kind: 'practice', estimateMin: 180 },
        ],
      },
      {
        title: 'Температура и свет',
        description: 'Тёплый свет — холодная тень, и наоборот.',
        items: [
          { title: 'Часть о цвете', kind: 'study', estimateMin: 240, resource: 'gurney' },
          { title: 'Плейлист 10 Minutes to Better Painting', kind: 'study', estimateMin: 120, resource: 'bucci' },
          { title: 'Тёплый свет / холодная тень', kind: 'practice', estimateMin: 180 },
        ],
      },
    ],
  },
  {
    title: 'Композиция',
    weight: 2,
    topics: [
      {
        title: 'Миниатюры',
        description: 'Решай композицию на маленьком формате, пока это дёшево.',
        items: [{ title: '20 миниатюр 5×7 см по 3 минуты', kind: 'practice', estimateMin: 150, resource: 'framedink' }],
      },
      {
        title: 'Нотан и массы',
        description: 'Два-три тона: читается ли картинка без деталей.',
        items: [
          { title: 'Книга целиком', kind: 'study', estimateMin: 300, resource: 'framedink' },
          { title: 'Разбор кадра мастера в 2–3 тона', kind: 'practice', estimateMin: 150 },
        ],
      },
    ],
  },
  {
    title: 'Архитектура',
    weight: 1,
    topics: [
      {
        title: 'Элементы формы',
        description: 'Точка, линия, плоскость, объём в архитектуре.',
        items: [
          { title: 'Главы 1–2', kind: 'study', estimateMin: 360, resource: 'ching', range: 'гл. 1–2' },
          { title: 'Наброски фасадов с фото', kind: 'practice', estimateMin: 240 },
        ],
      },
      {
        title: 'Пространство',
        description: 'Интерьер и улица в перспективе.',
        items: [
          { title: 'Интерьер в 1 точке', kind: 'practice', estimateMin: 120, resource: 'norling' },
          { title: 'Улица в 2 точках', kind: 'practice', estimateMin: 120, resource: 'robertson' },
        ],
      },
      {
        title: 'Наброски с натуры',
        description: 'Рисуй то, что видишь, на месте.',
        items: parts({ title: 'Скетч на улице', count: 6, minutes: 60, resource: 'usk' }),
      },
    ],
  },
  {
    title: 'Техники',
    weight: 2,
    topics: [
      {
        title: 'Акрил',
        description: 'Быстро сохнет и темнеет при высыхании. Замедлитель и лессировочный медиум вместо воды.',
        items: [
          { title: 'Бесплатные уроки по акрилу', kind: 'study', estimateMin: 180, resource: 'willkemp' },
          { title: 'Градиенты с замедлителем', kind: 'practice', estimateMin: 120 },
          { title: 'Лессировка', kind: 'practice', estimateMin: 120 },
          { title: 'Сухая кисть и сграффито', kind: 'practice', estimateMin: 60 },
        ],
      },
      {
        title: 'Масло без растворителей',
        description: 'Жирное поверх тощего. Сафлоровое масло и масло лаванды вместо скипидара.',
        items: [
          { title: 'Гайд по техникам и материалам', kind: 'study', estimateMin: 120, resource: 'farges' },
          { title: 'Тест-пластина «жирное по тощему»', kind: 'practice', estimateMin: 60 },
          { title: 'Гризайль-подмалевок', kind: 'practice', estimateMin: 180 },
        ],
      },
      {
        title: 'Alla prima',
        description: 'Мокрым по мокрому: большие массы, температура, края.',
        items: [
          { title: 'Книга', kind: 'study', estimateMin: 600, resource: 'schmid' },
          ...parts({ title: 'Сессия выходного дня', count: 3, minutes: 180 }),
        ],
      },
    ],
  },
  {
    title: 'Мастера',
    weight: 1,
    topics: [
      {
        title: 'Копия мастера',
        description: 'Фрагмент картины: повтори ход работы, а не контур.',
        items: [{ title: 'Копия фрагмента', kind: 'practice', estimateMin: 120, resource: 'gac', recurrenceWeeks: 4 }],
      },
      {
        title: 'Изучение художника',
        description: 'Два художника вперемешку. В заметке — что забираешь себе.',
        items: [{ title: 'Изучение двух художников', kind: 'study', estimateMin: 60, resource: 'gac', recurrenceWeeks: 1 }],
      },
    ],
  },
];
