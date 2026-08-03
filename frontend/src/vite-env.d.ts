/// <reference types="vite/client" />
interface Window { Telegram?: { WebApp: { initData: string; ready(): void; expand(): void; HapticFeedback?: { notificationOccurred(type: string): void } } } }

