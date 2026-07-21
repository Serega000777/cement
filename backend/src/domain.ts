export const BAG_KG = 25;
export const PACKAGING_RATE = 2500;
export const LOADING_RATE = 200;

export function calculateShift(bags: number, loadingTons: number, workerCount: number) {
  if (!Number.isInteger(bags) || bags <= 0) throw new Error('Количество мешков должно быть положительным целым числом');
  if (loadingTons < 0) throw new Error('Погрузка не может быть отрицательной');
  if (!Number.isInteger(workerCount) || workerCount <= 0) throw new Error('Выберите хотя бы одного работника');
  const tons = bags * BAG_KG / 1000;
  const packagingPay = tons * PACKAGING_RATE;
  const loadingPay = loadingTons * LOADING_RATE;
  return { tons, packagingPay, loadingPay, totalPay: packagingPay + loadingPay, salaryPerWorker: (packagingPay + loadingPay) / workerCount };
}

export const remainingBags = (produced: number, sold: number) => Math.max(0, produced - sold);
export const profit = (revenue: number, expenses: number) => revenue - expenses;

