# Импрува

Трекер и планировщик годового челленджа художника: программа «разделы → темы → топики» с прогрессом, план на неделю, таймер сессий с логами, заметки с фото, статистика и прогноз.

Данные хранятся только в браузере (IndexedDB). Резервная копия — экспорт JSON в «Настройках».

## Стек

Angular 22 (standalone, zoneless, signals) · Taiga UI 5 · Tailwind CSS 4 · IndexedDB (`idb`) · Vitest.

## Запуск

Нужен Node.js ≥ 22.22.3.

```bash
npm ci
npm start            # http://localhost:4200
npm test -- --watch=false
npm run build:pages  # сборка под GitHub Pages (/improova/)
```

## Деплой

Push в `main` → GitHub Actions (`.github/workflows/deploy.yml`) прогоняет тесты, собирает и публикует на GitHub Pages.
Однократно: Settings → Pages → Source: **GitHub Actions**.

Откат: `git revert` проблемного коммита и push в `main` — Pages пересоберётся с предыдущим состоянием. Данные пользователей не затрагиваются: они в браузере, схема версионирована (`SCHEMA_VERSION`).

## Структура

```
src/app/
  types/       контракты сущностей, один на файл
  utils/       даты с границей дня, форматирование, id, файлы
  domain/      чистая логика: программа, прогресс, оценки, повторения, планировщик, статистика, подсказки
  storage/     IStorageAdapter, IndexedDB и in-memory реализации, проверка и миграция снимков
  seed/        стартовая программа
  services/    состояние (signals) и сценарии: программа, таймер, логи, план, заметки, бэкап
  pipes/       форматирование в шаблонах
  components/  общие компоненты и диалоги
  pages/       экраны (lazy): onboarding, today, program, plan, notes, stats, settings
```

Решения — `docs/adr/`. Правила для агентов — `AGENTS.md`.
