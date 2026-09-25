import { Injectable, computed, inject, signal } from '@angular/core';
import type { ISessionDraft } from '../types';
import { DataStore } from './data.store';

/** Задержка автосохранения конспекта: пишем через секунду после последнего ввода. */
export const DRAFT_SAVE_MS = 1000;

export type TDraftField = 'body' | 'worked' | 'failed' | 'next';

const EMPTY_DRAFT: ISessionDraft = { logId: null, body: '', worked: '', failed: '', next: '' };

/**
 * Черновик конспекта сессии (FR-13, FR-35). Ввод виден сразу, в хранилище уходит через 1 с тишины
 * и немедленно при уходе со страницы — перезагрузка ничего не теряет.
 */
@Injectable({ providedIn: 'root' })
export class SessionDraftService {
  private readonly store = inject(DataStore);

  /** Несохранённые правки поверх записанного черновика. */
  private readonly pending = signal<ISessionDraft | null>(null);
  private timer: ReturnType<typeof setTimeout> | null = null;

  readonly draft = computed<ISessionDraft>(() => this.pending() ?? this.store.meta().sessionDraft ?? EMPTY_DRAFT);
  readonly saving = computed(() => this.pending() !== null);

  constructor() {
    const flushNow = (): void => this.flush();
    window.addEventListener('pagehide', flushNow);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        this.flush();
      }
    });
  }

  set(field: TDraftField, value: string): void {
    this.pending.set({ ...this.draft(), [field]: value });
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => this.flush(), DRAFT_SAVE_MS);
  }

  /** Сессия завершена: черновик привязывается к логу, чтобы после перезагрузки открыть карточку итога. */
  attach(logId: string): void {
    this.write({ ...this.draft(), logId });
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const pending = this.pending();
    if (pending) {
      this.write(pending);
    }
  }

  clear(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.pending.set(null);
    if (this.store.meta().sessionDraft !== null) {
      this.store.updateMeta({ sessionDraft: null });
    }
  }

  private write(draft: ISessionDraft): void {
    this.pending.set(null);
    this.store.updateMeta({ sessionDraft: draft });
  }
}
