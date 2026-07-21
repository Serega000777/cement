import crypto from 'node:crypto';
import type { RequestHandler } from 'express';

export const telegramAuth: RequestHandler = (req, res, next) => {
  if (process.env.DEV_AUTH === 'true' && process.env.NODE_ENV !== 'production') { (req as typeof req & { telegramUser?: TelegramUser }).telegramUser = { id: Number(process.env.ADMIN_TELEGRAM_ID || 1), first_name: 'Локальный', last_name: 'администратор' }; return next(); }
  const initData = req.header('x-telegram-init-data');
  const token = process.env.BOT_TOKEN;
  if (!initData || !token) return res.status(401).json({ error: 'Требуется авторизация Telegram' });
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  params.delete('hash');
  const dataCheckString = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  const expected = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');
  if (!hash || hash.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(expected))) {
    return res.status(401).json({ error: 'Некорректная подпись Telegram' });
  }
  const authDate = Number(params.get('auth_date'));
  if (!authDate || Date.now() / 1000 - authDate > 86400) return res.status(401).json({ error: 'Сессия Telegram устарела' });
  const user = JSON.parse(params.get('user') || '{}') as TelegramUser;
  if (process.env.ADMIN_TELEGRAM_ID && String(user.id) !== process.env.ADMIN_TELEGRAM_ID) return res.status(403).json({ error: 'Доступ запрещён' });
  (req as typeof req & { telegramUser?: TelegramUser }).telegramUser = user;
  next();
};

export type TelegramUser = { id: number; first_name?: string; last_name?: string; username?: string };

