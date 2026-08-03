import { CementGrade, ExpenseCategory, Material } from '@prisma/client';

export class InputError extends Error {
  status = 400;
}

export function positiveNumber(value: unknown, label: string) {
  const result = Number(value);
  if (!Number.isFinite(result) || result <= 0) throw new InputError(`${label}: укажите положительное число`);
  return result;
}

export function nonNegativeNumber(value: unknown, label: string) {
  const result = Number(value ?? 0);
  if (!Number.isFinite(result) || result < 0) throw new InputError(`${label}: значение не может быть отрицательным`);
  return result;
}

export function positiveInteger(value: unknown, label: string) {
  const result = Number(value);
  if (!Number.isInteger(result) || result <= 0) throw new InputError(`${label}: укажите положительное целое число`);
  return result;
}

export function requiredText(value: unknown, label: string, max = 200) {
  const result = String(value ?? '').trim();
  if (!result) throw new InputError(`${label}: поле обязательно`);
  if (result.length > max) throw new InputError(`${label}: максимум ${max} символов`);
  return result;
}

export function optionalText(value: unknown, max = 500) {
  const result = String(value ?? '').trim();
  if (result.length > max) throw new InputError(`Максимум ${max} символов`);
  return result || null;
}

export function calendarDate(value: unknown) {
  const source = String(value ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(source)) throw new InputError('Укажите корректную дату');
  const result = new Date(`${source}T12:00:00.000Z`);
  if (Number.isNaN(result.valueOf()) || result.toISOString().slice(0, 10) !== source) throw new InputError('Укажите корректную дату');
  return result;
}

export function barrelId(value: unknown) {
  const result = positiveInteger(value, 'Бочка');
  if (result !== 1 && result !== 2) throw new InputError('Выберите бочку №1 или №2');
  return result;
}

export function workerIds(value: unknown) {
  if (!Array.isArray(value) || value.length === 0) throw new InputError('Выберите хотя бы одного работника');
  const result = [...new Set(value.map(item => positiveInteger(item, 'Работник')))];
  if (result.length !== value.length) throw new InputError('Работник не может быть выбран дважды');
  return result;
}

export function material(value: unknown) {
  if (!Object.values(Material).includes(value as Material)) throw new InputError('Выберите песок или щебень');
  return value as Material;
}

export function cementGrade(value: unknown) {
  if (!Object.values(CementGrade).includes(value as CementGrade)) throw new InputError('Выберите марку цемента М500 или М600');
  return value as CementGrade;
}

export function expenseCategory(value: unknown) {
  if (!Object.values(ExpenseCategory).includes(value as ExpenseCategory)) throw new InputError('Выберите категорию расхода');
  return value as ExpenseCategory;
}

const MOSCOW_OFFSET_MS = 3 * 60 * 60 * 1000;

export function startOfMoscowPeriod(period: unknown, now = new Date()) {
  const local = new Date(now.getTime() + MOSCOW_OFFSET_MS);
  const year = local.getUTCFullYear();
  const month = local.getUTCMonth();
  const day = local.getUTCDate();
  const daysBack = period === 'week' ? 6 : 0;
  const start = period === 'month'
    ? Date.UTC(year, month, 1)
    : Date.UTC(year, month, day - daysBack);
  return new Date(start - MOSCOW_OFFSET_MS);
}
