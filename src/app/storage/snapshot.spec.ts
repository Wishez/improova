import { describe, expect, it } from 'vitest';
import { budgetFixture, itemFixture, logFixture } from '../domain/test-fixtures';
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
