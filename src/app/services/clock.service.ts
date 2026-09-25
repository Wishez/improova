import { DestroyRef, Injectable, inject, signal } from '@angular/core';

/** Текущее время с шагом в 15 секунд: смена дня и пересчёт плана без перезагрузки. */
@Injectable({ providedIn: 'root' })
export class ClockService {
  readonly now = signal(Date.now());

  constructor() {
    const refresh = (): void => this.now.set(Date.now());
    const interval = setInterval(refresh, 15_000);
    document.addEventListener('visibilitychange', refresh);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', refresh);
    });
  }
}
