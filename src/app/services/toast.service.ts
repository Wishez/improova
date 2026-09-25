import { Injectable, signal } from '@angular/core';

export type TToastKind = 'info' | 'success' | 'error';

export interface IToastAction {
  readonly label: string;
  readonly run: () => void;
}

export interface IToast {
  readonly id: number;
  readonly text: string;
  readonly kind: TToastKind;
  readonly durationMs: number;
  readonly action: IToastAction | null;
}

const MAX_TOASTS = 3;

/** Тосты с действием «Отменить» и таймером (ТЗ 7.4, FR-14). */
@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly toasts = signal<readonly IToast[]>([]);
  private nextId = 1;
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();

  show(params: { readonly text: string; readonly kind?: TToastKind; readonly durationMs?: number; readonly action?: IToastAction }): number {
    const toast: IToast = {
      id: this.nextId++,
      text: params.text,
      kind: params.kind ?? 'info',
      durationMs: params.durationMs ?? 4000,
      action: params.action ?? null,
    };
    this.toasts.update((list) => [...list, toast].slice(-MAX_TOASTS));
    this.timers.set(
      toast.id,
      setTimeout(() => this.dismiss(toast.id), toast.durationMs),
    );
    return toast.id;
  }

  undo(params: { readonly text: string; readonly onUndo: () => void }): void {
    this.show({ text: params.text, durationMs: 10_000, action: { label: 'Отменить', run: params.onUndo } });
  }

  dismiss(id: number): void {
    const timer = this.timers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
    this.toasts.update((list) => list.filter((toast) => toast.id !== id));
  }

  runAction(toast: IToast): void {
    toast.action?.run();
    this.dismiss(toast.id);
  }
}
