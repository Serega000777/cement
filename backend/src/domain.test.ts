import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateShift, profit, remainingBags } from './domain.js';

test('расчёт фасовки 400 мешков', () => {
  const result = calculateShift(400, 0, 4);
  assert.deepEqual([result.tons, result.packagingPay, result.salaryPerWorker], [10, 25_000, 6_250]);
});
test('бонус погрузки делится на бригаду', () => {
  const result = calculateShift(400, 5, 4);
  assert.deepEqual([result.loadingPay, result.totalPay, result.salaryPerWorker], [500, 25_500, 6_375]);
});
test('некорректная смена отклоняется', () => {
  assert.throws(() => calculateShift(0, 0, 1)); assert.throws(() => calculateShift(10, -1, 1)); assert.throws(() => calculateShift(10, 0, 0));
});
test('остаток и прибыль', () => {
  assert.equal(remainingBags(1000, 300), 700); assert.equal(profit(500_000, 300_000), 200_000);
});
