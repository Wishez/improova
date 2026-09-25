import { Injectable, inject } from '@angular/core';
import { DataStore } from './data.store';

/** Тихий сигнал смены фазы и системное уведомление (FR-12, Q5). */
@Injectable({ providedIn: 'root' })
export class SoundService {
  private readonly store = inject(DataStore);
  private context: AudioContext | null = null;

  chime(): void {
    if (!this.store.settings().sound) {
      return;
    }
    try {
      this.context ??= new AudioContext();
      const context = this.context;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = 660;
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.08, context.currentTime + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.9);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 1);
    } catch {
      // Звук необязателен: браузер мог запретить аудио до взаимодействия.
    }
  }

  /**
   * Системное уведомление, когда вкладка в фоне. Возвращает true, если уведомление показано;
   * иначе вызывающий показывает сообщение внутри приложения.
   * persistent — конец сессии: со звуком системы и висит, пока его не закроют.
   */
  notify(text: string, options: { readonly persistent?: boolean } = {}): boolean {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted' || document.visibilityState === 'visible') {
      return false;
    }
    try {
      const notification = new Notification('Импрува', {
        body: text,
        silent: !options.persistent,
        requireInteraction: options.persistent === true,
        tag: options.persistent ? 'improva-session-end' : 'improva-step',
      });
      notification.onclick = () => {
        window.focus();
        notification.close();
      };
      return true;
    } catch {
      // Уведомления недоступны в этом окружении.
      return false;
    }
  }

  requestPermission(): void {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      void Notification.requestPermission();
    }
  }
}
