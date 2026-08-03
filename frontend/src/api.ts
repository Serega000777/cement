const base = import.meta.env.VITE_API_URL || '/api';
export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${base}${path}`, { ...options, headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': window.Telegram?.WebApp.initData || '', ...options?.headers } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Ошибка сервера');
  return body;
}

