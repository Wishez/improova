import { describe, expect, it } from 'vitest';
import type { IAsset, INote } from '../types';
import { topicBeforeAfter } from './program';
import { itemFixture } from './test-fixtures';

const asset = (id: string): IAsset => ({ id, createdAt: '', updatedAt: '', dataUrl: `data:${id}`, width: 1, height: 1, bytes: 1 });
const note = (id: string, itemId: string, createdAt: string, imageIds: readonly string[]): INote => ({
  id,
  createdAt,
  updatedAt: createdAt,
  itemId,
  logId: null,
  body: '',
  worked: '',
  failed: '',
  next: '',
  imageIds,
});

describe('«Было / стало» темы (FR-17)', () => {
  const items = [itemFixture({ id: 'a', topicId: 't' }), itemFixture({ id: 'b', topicId: 't' }), itemFixture({ id: 'c', topicId: 'other' })];
  const assets = new Map(['p1', 'p2', 'p3'].map((id) => [id, asset(id)]));

  it('первое и последнее фото темы из разных дней, чужая тема не входит', () => {
    const notes = [
      note('n2', 'b', '2026-09-20T10:00:00.000Z', ['p2']),
      note('n1', 'a', '2026-09-10T10:00:00.000Z', ['p1']),
      note('n3', 'c', '2026-09-25T10:00:00.000Z', ['p3']),
    ];
    const result = topicBeforeAfter({ topicId: 't', items, notes, assets, boundaryHour: 4 });
    expect(result?.first.asset.id).toBe('p1');
    expect(result?.last.asset.id).toBe('p2');
  });

  it('все фото в один день — сравнения нет (негативный)', () => {
    const notes = [note('n1', 'a', '2026-09-10T10:00:00.000Z', ['p1', 'p2'])];
    expect(topicBeforeAfter({ topicId: 't', items, notes, assets, boundaryHour: 4 })).toBeNull();
  });
});
