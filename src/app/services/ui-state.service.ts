import { Injectable, signal } from '@angular/core';
import type { TSessionType } from '../types';

export interface IPendingStart {
  readonly itemId: string | null;
  readonly type: TSessionType;
  readonly plannedMin: number;
}

/** Состояние оболочки: drawer топика, фокус, диалоги (FR-08, FR-13, FR-35). */
@Injectable({ providedIn: 'root' })
export class UiStateService {
  readonly drawerItemId = signal<string | null>(null);
  readonly focusMode = signal(false);
  readonly summaryLogId = signal<string | null>(null);
  readonly forgottenOpen = signal(false);
  readonly pendingStart = signal<IPendingStart | null>(null);
  readonly pickerOpen = signal<TSessionType | null>(null);
  readonly paletteOpen = signal(false);
  readonly newNoteForItem = signal<string | null | undefined>(undefined);

  openItem(itemId: string): void {
    this.drawerItemId.set(itemId);
  }

  closeItem(): void {
    this.drawerItemId.set(null);
  }
}
