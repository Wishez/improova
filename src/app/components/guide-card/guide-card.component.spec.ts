import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { itemFixture } from '../../domain/test-fixtures';
import { DataStore } from '../../services';
import { MemoryAdapter, STORAGE_ADAPTER } from '../../storage';
import type { IItem } from '../../types';
import { GuideCardComponent } from './guide-card.component';

const NBSP = ' ';

const sphere: IItem = {
  ...itemFixture({ id: 'sphere', topicId: 'topic' }),
  guide: {
    goal: 'Свет на простой форме',
    task: '',
    steps: [
      { title: 'Линейное построение', minutes: 20 },
      { title: 'Граница света и тени, падающие тени', minutes: 10 },
      { title: 'Тон и рефлексы', minutes: 60 },
    ],
    stopCriterion: '',
    links: [],
    references: [],
    imageIds: [],
    pitfalls: [],
  },
};

async function render(params: { readonly session: boolean; readonly activeStep: number | null }): Promise<HTMLElement[]> {
  TestBed.configureTestingModule({ providers: [{ provide: STORAGE_ADAPTER, useValue: new MemoryAdapter() }] });
  await TestBed.inject(DataStore).init();
  // Карточка топика и карточка в режиме фокуса открыты вместе
  return [0, 1].map(() => {
    const fixture = TestBed.createComponent(GuideCardComponent);
    fixture.componentRef.setInput('item', sphere);
    fixture.componentRef.setInput('session', params.session);
    fixture.componentRef.setInput('activeStep', params.activeStep);
    fixture.detectChanges();
    const element: HTMLElement = fixture.nativeElement;
    return element;
  });
}

afterEach(() => {
  TestBed.resetTestingModule();
});

describe('карточка ориентира: шаги 1.6 (FR-52)', () => {
  it('под шагами — «Шаги сессии — 90 мин по плану, шаг переключаешь сам»: обещания 1.5 «таймер ведёт шаги» нет', async () => {
    const [card] = await render({ session: false, activeStep: null });
    expect(card?.querySelector('.guide__meta')?.textContent?.trim()).toBe(`Шаги сессии — 90${NBSP}мин по плану, шаг переключаешь сам`);
    expect(card?.textContent ?? '').not.toContain('таймер ведёт шаги');
    expect(card?.querySelector('.guide__current')).toBeNull();
  });

  it('в сессии активный шаг отмечен словом «текущий», подсветка только дополняет', async () => {
    const [card] = await render({ session: true, activeStep: 2 });
    const marks = [...(card?.querySelectorAll('.guide__step') ?? [])].map((row) => row.querySelector('.guide__current')?.textContent?.trim() ?? null);
    expect(marks).toEqual([null, null, 'текущий']);
  });

  it('у двух карточек на странице заголовки с разными id — имя каждой секции ведёт на свой заголовок', async () => {
    const cards = await render({ session: true, activeStep: 0 });
    const ids = cards.map((card) => card.querySelector('h3')?.id ?? '');
    expect(new Set(ids).size).toBe(2);
    for (const card of cards) {
      const section = card.querySelector('section.guide');
      expect(section?.getAttribute('aria-labelledby')).toBe(card.querySelector('h3')?.id);
    }
  });
});
