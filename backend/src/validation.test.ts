import assert from 'node:assert/strict';
import test from 'node:test';
import { calendarDate, positiveInteger, positiveNumber, startOfMoscowPeriod, workerIds } from './validation.js';

test('отрицательные и нулевые значения отклоняются', () => {
  assert.throws(() => positiveNumber(-1, 'Сумма'));
  assert.throws(() => positiveNumber(0, 'Сумма'));
  assert.throws(() => positiveInteger(1.5, 'Мешки'));
  assert.equal(positiveInteger('10', 'Мешки'), 10);
});

test('дубликаты работников отклоняются', () => {
  assert.throws(() => workerIds([1, 1]));
  assert.deepEqual(workerIds([1, 2]), [1, 2]);
});

test('календарная дата сохраняет выбранный день', () => {
  assert.equal(calendarDate('2026-07-24').toISOString(), '2026-07-24T12:00:00.000Z');
  assert.throws(() => calendarDate('2026-02-30'));
});

test('границы периода рассчитываются по Москве', () => {
  const earlyMoscow = new Date('2026-07-23T22:00:00.000Z');
  assert.equal(startOfMoscowPeriod('day', earlyMoscow).toISOString(), '2026-07-23T21:00:00.000Z');
  assert.equal(startOfMoscowPeriod('month', earlyMoscow).toISOString(), '2026-06-30T21:00:00.000Z');
});
