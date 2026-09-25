import { inject } from '@angular/core';
import { Router, type CanActivateFn, type Routes } from '@angular/router';
import { DataStore } from './services';

const onboarded: CanActivateFn = () => {
  const store = inject(DataStore);
  return store.status() !== 'ready' || store.meta().onboarded ? true : inject(Router).createUrlTree(['/welcome']);
};

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'today' },
  { path: 'welcome', loadComponent: () => import('./pages/onboarding/onboarding.page').then((m) => m.OnboardingPage), title: 'Импрува · Старт' },
  { path: 'today', canActivate: [onboarded], loadComponent: () => import('./pages/today/today.page').then((m) => m.TodayPage), title: 'Импрува · Сегодня' },
  { path: 'program', canActivate: [onboarded], loadComponent: () => import('./pages/program/program.page').then((m) => m.ProgramPage), title: 'Импрува · Программа' },
  { path: 'plan', canActivate: [onboarded], loadComponent: () => import('./pages/plan/plan.page').then((m) => m.PlanPage), title: 'Импрува · План' },
  { path: 'notes', canActivate: [onboarded], loadComponent: () => import('./pages/notes/notes.page').then((m) => m.NotesPage), title: 'Импрува · Заметки' },
  { path: 'stats', canActivate: [onboarded], loadComponent: () => import('./pages/stats/stats.page').then((m) => m.StatsPage), title: 'Импрува · Статистика' },
  { path: 'settings', canActivate: [onboarded], loadComponent: () => import('./pages/settings/settings.page').then((m) => m.SettingsPage), title: 'Импрува · Настройки' },
  { path: '**', redirectTo: 'today' },
];
