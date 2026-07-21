# Cement CRM

Telegram Mini App и бот для оперативного учета фасовки и продаж цемента.

## Стек

- React, TypeScript, Vite, Tailwind CSS, Chart.js
- Node.js, Express, TypeScript, Telegraf
- PostgreSQL, Prisma
- Docker Compose

## Быстрый запуск

1. Скопируйте `.env.example` в `.env` и укажите `BOT_TOKEN`, `ADMIN_TELEGRAM_ID` и публичный HTTPS `WEBAPP_URL`.
2. Запустите `docker compose up --build`.
3. Откройте `http://localhost:5173` для локальной проверки.

База доступна на порту `5432`, API — `3000`, Mini App — `5173`.

## Разработка без Docker

```bash
npm install
npm run db:generate
npm run dev
```

Для локального браузера установите `DEV_AUTH=true`. В production Telegram `initData` проверяется HMAC-подписью и дополнительно сверяется `ADMIN_TELEGRAM_ID`.

## Основные сценарии

- Dashboard с показателями за сегодня и месяц
- CRUD работников
- Производственная смена с автоматическим весом, списанием из бочки и зарплатой
- Приход цемента в две бочки
- Продажи фасованного цемента, песка и щебня
- Расходы, финансы и аналитика
- Telegram-бот с кнопкой запуска Mini App

