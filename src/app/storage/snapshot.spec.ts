import { describe, expect, it } from 'vitest';
import { budgetFixture, itemFixture, logFixture, sectionFixture, topicFixture } from '../domain/test-fixtures';
import { defaultMeta } from '../services/data.store';
import type { IItem } from '../types';
import { MemoryAdapter } from './memory.adapter';
import { checkSnapshot } from './snapshot';

describe('импорт и экспорт (ТЗ 8.2, US-08)', () => {
  it('битый JSON и чужой файл отклоняются без изменений', () => {
    expect(checkSnapshot('{oops')).toEqual({ ok: false, reason: 'parse', path: '' });
    expect(checkSnapshot('{"app":"other","data":{}}')).toEqual({ ok: false, reason: 'parse', path: '' });
  });

  it('ошибка схемы указывает путь поля', () => {
    const broken = { app: 'improva', kind: 'full', schemaVersion: 1, exportedAt: '', data: { items: [itemFixture({ id: 'a', topicId: 't' }), { ...itemFixture({ id: 'b', topicId: 't' }), estimateMin: 'сорок' }] } };
    expect(checkSnapshot(JSON.stringify(broken))).toEqual({ ok: false, reason: 'schema', path: 'items[1].estimateMin' });
  });

  it('файл новее приложения отклоняется', () => {
    expect(checkSnapshot(JSON.stringify({ app: 'improva', schemaVersion: 99, data: {} }))).toMatchObject({ ok: false, path: 'schemaVersion' });
  });

  it('round-trip: экспорт → импорт «Заменить» даёт те же данные', async () => {
    const source = new MemoryAdapter();
    await source.init();
    await source.put('budgets', budgetFixture());
    await source.put('items', itemFixture({ id: 'i1', topicId: 't1' }));
    await source.put('timeLogs', logFixture({ id: 'l1', itemId: 'i1', type: 'practice', startedAt: '2026-01-05T10:00:00.000Z', minutes: 45 }));
    const exported = await source.exportAll();
    const check = checkSnapshot(JSON.stringify(exported));
    expect(check.ok).toBe(true);
    const target = new MemoryAdapter();
    await target.init();
    if (check.ok) {
      await target.importAll(check.snapshot, 'replace');
    }
    expect(await target.loadAll()).toEqual(await source.loadAll());
  });

  it('файл v1 мигрирует в v2: поля ориентира и весов добавляются по умолчанию (FR-42)', () => {
    const { guide: _guide, routeRole: _role, ...legacyItem } = itemFixture({ id: 'a', topicId: 't' });
    const { seasonalWeights: _seasonal, ...legacyBudget } = budgetFixture();
    const file = { app: 'improva', kind: 'full', schemaVersion: 1, exportedAt: '', data: { items: [legacyItem], budgets: [legacyBudget] } };
    const check = checkSnapshot(JSON.stringify(file));
    expect(check.ok).toBe(true);
    if (check.ok) {
      expect(check.snapshot.schemaVersion).toBe(3);
      expect(check.snapshot.data.items?.[0]).toMatchObject({ guide: null, routeRole: null });
      expect(check.snapshot.data.budgets?.[0]?.seasonalWeights).toBe(false);
      expect(check.snapshot.data.routeBlocks).toBeUndefined();
    }
  });

  it('файл v2 мигрирует в v3: стартовые получают ключи курса по пути названий, версия курса 1 (FR-44)', () => {
    const { courseVersion: _version, dismissedCourseKeys: _dismissed, courseBannerDismissed: _banner, ...legacyMeta } = defaultMeta();
    const section = { ...sectionFixture('s', 0), title: 'Форма' };
    const topic = { ...topicFixture('t', 's'), title: 'Линия и разминка' };
    const starter = { ...itemFixture({ id: 'a', topicId: 't' }), title: 'Линии и эллипсы от плеча' };
    const custom = { ...itemFixture({ id: 'b', topicId: 't' }), title: 'Мой топик' };
    const strip = ({ courseKey: _key, courseHash: _hash, checkpointDay: _day, ...rest }: IItem): object => rest;
    const file = {
      app: 'improva',
      kind: 'full',
      schemaVersion: 2,
      exportedAt: '',
      data: { meta: [legacyMeta], sections: [section], topics: [topic], items: [strip(starter), strip(custom)] },
    };
    const check = checkSnapshot(JSON.stringify(file));
    expect(check.ok).toBe(true);
    if (check.ok) {
      expect(check.snapshot.data.meta?.[0]).toMatchObject({ courseVersion: 1, dismissedCourseKeys: [], courseBannerDismissed: null });
      expect(check.snapshot.data.sections?.[0]?.courseKey).toBe('section:Форма');
      expect(check.snapshot.data.items?.find((item) => item.id === 'a')?.courseKey).toBe('item:Форма/Линия и разминка/Линии и эллипсы от плеча');
      expect(check.snapshot.data.items?.find((item) => item.id === 'b')).toMatchObject({ courseKey: null, checkpointDay: null });
    }
    const empty = checkSnapshot(JSON.stringify({ ...file, data: { meta: [legacyMeta] } }));
    expect(empty.ok && empty.snapshot.data.meta?.[0]?.courseVersion).toBeNull();
  });

  it('чужой доступ ресурса и дробный день контрольной отклоняются (негативный)', () => {
    const resource = { id: 'r', createdAt: '', updatedAt: '', title: 'R', type: 'book', author: '', url: '', unit: 'page', unitCount: 1, minPerUnit: 1, archived: false, access: 'stolen' };
    expect(checkSnapshot(JSON.stringify({ app: 'improva', schemaVersion: 3, data: { resources: [resource] } }))).toMatchObject({ path: 'resources[0].access' });
    const item = { ...itemFixture({ id: 'a', topicId: 't' }), checkpointDay: 6.5 };
    expect(checkSnapshot(JSON.stringify({ app: 'improva', schemaVersion: 3, data: { items: [item] } }))).toMatchObject({ path: 'items[0].checkpointDay' });
  });

  it('пакетная запись применяет изменения и удаления вместе (НФТ 1.3)', async () => {
    const adapter = new MemoryAdapter();
    await adapter.put('items', itemFixture({ id: 'old', topicId: 't' }));
    await adapter.writeBatch({
      puts: [{ collection: 'items', entity: itemFixture({ id: 'new', topicId: 't' }) }],
      removes: [{ collection: 'items', id: 'old' }],
    });
    expect((await adapter.loadAll()).items.map((item) => item.id)).toEqual(['new']);
  });

  it('битый ориентир и чужая роль маршрута отклоняются с путём поля (негативный)', () => {
    const badGuide = { ...itemFixture({ id: 'a', topicId: 't' }), guide: { goal: 'Цель', steps: [{ title: 'Шаг', minutes: -5 }] } };
    expect(checkSnapshot(JSON.stringify({ app: 'improva', schemaVersion: 2, data: { items: [badGuide] } }))).toEqual({
      ok: false,
      reason: 'schema',
      path: 'items[0].guide',
    });
    const badRole = { ...itemFixture({ id: 'a', topicId: 't' }), routeRole: 'teacher' };
    expect(checkSnapshot(JSON.stringify({ app: 'improva', schemaVersion: 2, data: { items: [badRole] } }))).toMatchObject({ path: 'items[0].routeRole' });
  });

  it('«Объединить» берёт запись с большим updatedAt', async () => {
    const adapter = new MemoryAdapter();
    const old: IItem = { ...itemFixture({ id: 'i1', topicId: 't' }), title: 'старое', updatedAt: '2026-01-01T00:00:00Z' };
    await adapter.put('items', old);
    const report = await adapter.importAll(
      {
        app: 'improva',
        kind: 'full',
        schemaVersion: 1,
        exportedAt: '',
        data: {
          items: [
            { ...itemFixture({ id: 'i1', topicId: 't' }), title: 'новое', updatedAt: '2026-02-01T00:00:00Z' },
            itemFixture({ id: 'i2', topicId: 't' }),
          ],
        },
      },
      'merge',
    );
    expect(report).toMatchObject({ added: 1, updated: 1 });
    const data = await adapter.loadAll();
    expect(data.items.find((item) => item.id === 'i1')?.title).toBe('новое');
  });
});
