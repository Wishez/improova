import { ApplicationConfig, inject, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withHashLocation, withInMemoryScrolling, withViewTransitions } from '@angular/router';
import { provideTaiga } from '@taiga-ui/core';
import { routes } from './app.routes';
import { DataStore, TimerService } from './services';
import { IndexedDbAdapter, MemoryAdapter, STORAGE_ADAPTER } from './storage';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(
      routes,
      withHashLocation(),
      withViewTransitions({ skipInitialTransition: true }),
      withInMemoryScrolling({ scrollPositionRestoration: 'top' }),
    ),
    provideTaiga({ mode: 'dark' }),
    {
      provide: STORAGE_ADAPTER,
      useFactory: () => (typeof indexedDB === 'undefined' ? new MemoryAdapter() : new IndexedDbAdapter()),
    },
    provideAppInitializer(async () => {
      const store = inject(DataStore);
      inject(TimerService);
      await store.init();
    }),
  ],
};
