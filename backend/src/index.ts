import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import { Prisma, PrismaClient, BarrelOperationType } from '@prisma/client';
import { Telegraf, Markup } from 'telegraf';
import { telegramAuth, type TelegramUser } from './auth.js';
import { calculateShift } from './domain.js';
import { barrelId, calendarDate, cementGrade, expenseCategory, InputError, material, nonNegativeNumber, optionalText, positiveInteger, positiveNumber, requiredText, startOfMoscowPeriod, workerIds } from './validation.js';

const prisma = new PrismaClient();
const app = express();
const isProduction = process.env.NODE_ENV === 'production';
if (isProduction && (!process.env.BOT_TOKEN || !process.env.ADMIN_TELEGRAM_ID || !process.env.WEBAPP_URL)) {
  throw new Error('BOT_TOKEN, ADMIN_TELEGRAM_ID и WEBAPP_URL обязательны в production');
}
app.disable('x-powered-by');
app.use(cors({ origin: process.env.WEBAPP_URL || false }));
app.use(express.json({ limit: '64kb' }));
app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.use('/api', telegramAuth);
app.get('/api/auth/me', async (req, res) => {
  const telegram = (req as typeof req & { telegramUser?: TelegramUser }).telegramUser!;
  const name = [telegram.first_name, telegram.last_name].filter(Boolean).join(' ') || telegram.username || 'Администратор';
  const user = await prisma.user.upsert({ where: { telegramId: BigInt(telegram.id) }, update: { name }, create: { telegramId: BigInt(telegram.id), name } });
  res.json({ id: user.id, telegramId: user.telegramId.toString(), name: user.name });
});
const n = (value: unknown) => Number(value || 0);
async function usedCementTons(tx: Prisma.TransactionClient | PrismaClient, selectedBarrel: number, grade: 'M500'|'M600') {
  const [shifts, concrete] = await Promise.all([
    tx.shift.aggregate({ where: { barrelId: selectedBarrel, grade }, _sum: { tons: true } }),
    tx.concreteSale.aggregate({ where: { barrelId: selectedBarrel, cementGrade: grade }, _sum: { cementTons: true } })
  ]);
  return n(shifts._sum.tons) + n(concrete._sum.cementTons);
}

app.get('/api/workers', async (_req, res) => res.json(await prisma.worker.findMany({ orderBy: { createdAt: 'desc' } })));
app.post('/api/workers', async (req, res) => res.status(201).json(await prisma.worker.create({ data: { name: requiredText(req.body.name, 'Имя', 100), phone: optionalText(req.body.phone, 30), position: requiredText(req.body.position, 'Должность', 100) } })));
app.patch('/api/workers/:id', async (req, res) => res.json(await prisma.worker.update({
  where: { id: positiveInteger(req.params.id, 'ID работника') },
  data: { name: requiredText(req.body.name, 'Имя', 100), phone: optionalText(req.body.phone, 30), position: requiredText(req.body.position, 'Должность', 100) }
})));
app.delete('/api/workers/:id', async (req, res) => res.json(await prisma.worker.update({ where: { id: positiveInteger(req.params.id, 'ID работника') }, data: { active: false } })));
app.get('/api/workers/stats', async (req, res) => {
  const periodFrom = startOfMoscowPeriod(req.query.period);
  const lastReset = await prisma.salaryReset.findFirst({ orderBy: { createdAt: 'desc' } });
  const from = lastReset && lastReset.createdAt > periodFrom ? lastReset.createdAt : periodFrom;
  const workers = await prisma.worker.findMany({ include: { shifts: { where: { shift: { date: { gte: from } } }, include: { shift: true } } }, orderBy: { name: 'asc' } });
  res.json(workers.map(worker => ({ id: worker.id, name: worker.name, position: worker.position, active: worker.active, workDays: new Set(worker.shifts.map(x => x.shift.date.toISOString().slice(0, 10))).size, shifts: worker.shifts.length, tons: worker.shifts.reduce((sum, x) => sum + n(x.shift.tons), 0), earnings: worker.shifts.reduce((sum, x) => sum + n(x.salary), 0) })));
});

app.get('/api/shifts', async (_req, res) => res.json(await prisma.shift.findMany({ include: { workers: { include: { worker: true } }, barrel: true }, orderBy: { date: 'desc' } })));
app.post('/api/shifts', async (req, res) => {
  const bags = positiveInteger(req.body.bags, 'Количество мешков');
  const loadingTons = nonNegativeNumber(req.body.loadingTons, 'Погрузка');
  const selectedWorkers = workerIds(req.body.workerIds);
  const selectedBarrel = barrelId(req.body.barrelId);
  const grade = cementGrade(req.body.grade);
  const date = calendarDate(req.body.date);
  const loadingMaterial = loadingTons > 0 ? material(req.body.loadingMaterial) : null;
  const { tons, packagingPay, loadingPay } = calculateShift(bags, loadingTons, selectedWorkers.length);
  const result = await prisma.$transaction(async tx => {
    const activeWorkers = await tx.worker.count({ where: { id: { in: selectedWorkers }, active: true } });
    if (activeWorkers !== selectedWorkers.length) throw new InputError('Один из выбранных работников неактивен или удалён');
    const balance = await tx.barrelOperation.aggregate({ where: { barrelId: selectedBarrel, grade, type: 'RECEIPT' }, _sum: { tons: true } });
    const used = await usedCementTons(tx, selectedBarrel, grade);
    if (n(balance._sum.tons) - used < tons) throw new InputError(`Недостаточно цемента ${grade} в выбранной бочке`);
    const belarus = loadingTons > 0 ? await tx.worker.findFirst({ where: { name: { equals: 'Беларус', mode: 'insensitive' }, active: true } }) : null;
    if (loadingTons > 0 && !belarus) throw new InputError('Для начисления за сыпучку нужен активный работник «Беларус»');
    const packagingPerWorker = packagingPay / selectedWorkers.length;
    const salaryByWorker = new Map(selectedWorkers.map(workerId => [workerId, packagingPerWorker]));
    if (belarus) salaryByWorker.set(belarus.id, (salaryByWorker.get(belarus.id) ?? 0) + loadingPay);
    return tx.shift.create({ data: { date, bags, tons, loadingTons, loadingMaterial, packagingPay, loadingPay, barrelId: selectedBarrel, grade, workers: { create: [...salaryByWorker].map(([workerId, salary]) => ({ workerId, salary })) } }, include: { workers: true } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  res.status(201).json(result);
});
app.delete('/api/shifts/:id', async (req, res) => {
  const id = positiveInteger(req.params.id, 'ID смены');
  const result = await prisma.$transaction(async tx => {
    const shift = await tx.shift.findUniqueOrThrow({ where: { id } });
    const [produced, sold, historical] = await Promise.all([
      tx.shift.aggregate({ where: { grade: shift.grade }, _sum: { bags: true } }),
      tx.cementSale.aggregate({ where: { grade: shift.grade }, _sum: { bags: true } }),
      tx.historicalBagEntry.aggregate({ where: { grade: shift.grade }, _sum: { producedBags: true, soldBags: true } })
    ]);
    if (n(produced._sum.bags) + n(historical._sum.producedBags) - shift.bags < n(sold._sum.bags) + n(historical._sum.soldBags)) throw new InputError('Нельзя удалить смену: произведённые мешки уже проданы');
    return tx.shift.delete({ where: { id } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  res.json(result);
});
app.patch('/api/shifts/:id/pay', async (req, res) => {
  const id = positiveInteger(req.params.id, 'ID смены');
  const totalPay = nonNegativeNumber(req.body.totalPay, 'Зарплата за смену');
  const result = await prisma.$transaction(async tx => {
    const shift = await tx.shift.findUniqueOrThrow({ where: { id }, include: { workers: true } });
    if (!shift.workers.length) throw new InputError('В смене нет работников');
    const salary = totalPay / shift.workers.length;
    await tx.shiftWorker.updateMany({ where: { shiftId: id }, data: { salary } });
    return tx.shift.update({ where: { id }, data: { packagingPay: totalPay, loadingPay: 0 } });
  });
  res.json(result);
});

app.get('/api/salary', async (req, res) => {
  const requestedFrom = req.query.from ? calendarDate(req.query.from) : startOfMoscowPeriod('month');
  const lastReset = await prisma.salaryReset.findFirst({ orderBy: { createdAt: 'desc' } });
  const from = lastReset && lastReset.createdAt > requestedFrom ? lastReset.createdAt : requestedFrom;
  const rows = await prisma.shiftWorker.findMany({ where: { shift: { date: { gte: from } } }, include: { worker: true, shift: true } });
  const map = new Map<number, { worker: string; shifts: number; tons: number; salary: number }>();
  rows.forEach(r => { const v = map.get(r.workerId) || { worker: r.worker.name, shifts: 0, tons: 0, salary: 0 }; v.shifts++; v.tons += n(r.shift.tons); v.salary += n(r.salary); map.set(r.workerId, v); });
  res.json([...map.values()]);
});
app.post('/api/salary/reset', async (_req, res) => res.status(201).json(await prisma.salaryReset.create({ data: {} })));

app.get('/api/barrels', async (_req, res) => {
  const barrels = await prisma.barrel.findMany({ include: { operations: true, shifts: true, concreteSales: true } });
  res.json(barrels.map(b => {
    const grades = Object.fromEntries(['M500', 'M600'].map(grade => {
      const received = b.operations.filter(o => o.type === 'RECEIPT' && o.grade === grade).reduce((s, o) => s + n(o.tons), 0);
      const used = b.shifts.filter(x => x.grade === grade).reduce((s, x) => s + n(x.tons), 0) + b.concreteSales.filter(x => x.cementGrade === grade).reduce((s, x) => s + n(x.cementTons), 0);
      return [grade, { received, used, remaining: received - used }];
    }));
    const activeGrade = (['M500', 'M600'] as const).find(grade => grades[grade].remaining > 0.0005) ?? null;
    return { id: b.id, name: b.id === 1 ? 'Бочка №1 (большая)' : 'Бочка №2 (маленькая)', received: Object.values(grades).reduce((s, x) => s + x.received, 0), used: Object.values(grades).reduce((s, x) => s + x.used, 0), grades, activeGrade };
  }));
});
app.post('/api/cement', async (req, res) => {
  const tons = positiveNumber(req.body.tons, 'Количество тонн');
  const price = positiveNumber(req.body.pricePerTon, 'Цена за тонну');
  const selectedBarrel = barrelId(req.body.barrelId);
  const grade = cementGrade(req.body.grade);
  const result = await prisma.$transaction(async tx => {
    const received = await tx.barrelOperation.groupBy({ by: ['grade'], where: { barrelId: selectedBarrel, type: 'RECEIPT' }, _sum: { tons: true } });
    const otherGrade = (await Promise.all((['M500', 'M600'] as const).filter(item => item !== grade).map(async item => ({
      item,
      remaining: n(received.find(x => x.grade === item)?._sum.tons) - await usedCementTons(tx, selectedBarrel, item)
    })))).find(x => x.remaining > 0.0005)?.item;
    if (otherGrade) throw new InputError(`В бочке ещё находится цемент ${otherGrade}. Сначала израсходуйте его полностью`);
    return tx.barrelOperation.create({ data: { barrelId: selectedBarrel, grade, type: BarrelOperationType.RECEIPT, date: calendarDate(req.body.date), tons, pricePerTon: price, amount: tons * price } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  res.status(201).json(result);
});
app.get('/api/cement', async (_req, res) => res.json(await prisma.barrelOperation.findMany({ where: { type: 'RECEIPT' }, include: { barrel: true }, orderBy: { date: 'desc' } })));
app.patch('/api/cement/:id', async (req, res) => {
  const id = positiveInteger(req.params.id, 'ID прихода');
  const selectedBarrel = barrelId(req.body.barrelId), grade = cementGrade(req.body.grade);
  const tons = positiveNumber(req.body.tons, 'Количество тонн'), price = positiveNumber(req.body.pricePerTon, 'Цена за тонну');
  const result = await prisma.$transaction(async tx => {
    const current = await tx.barrelOperation.findUniqueOrThrow({ where: { id } });
    if (current.type !== BarrelOperationType.RECEIPT) throw new InputError('Можно редактировать только приход');
    if (current.grade !== grade && current.barrelId === selectedBarrel) {
      await tx.shift.updateMany({
        where: { barrelId: current.barrelId, grade: current.grade },
        data: { grade }
      });
      await tx.concreteSale.updateMany({
        where: { barrelId: current.barrelId, cementGrade: current.grade },
        data: { cementGrade: grade }
      });
    }
    const affected = new Set([`${current.barrelId}:${current.grade}`, `${selectedBarrel}:${grade}`]);
    for (const key of affected) {
      const [barrel, itemGrade] = key.split(':') as [string, 'M500' | 'M600'];
      const targetBarrel = Number(barrel);
      const receipts = await tx.barrelOperation.aggregate({ where: { barrelId: targetBarrel, grade: itemGrade, type: 'RECEIPT', id: { not: id } }, _sum: { tons: true } });
      const used = await usedCementTons(tx, targetBarrel, itemGrade);
      const editedTons = targetBarrel === selectedBarrel && itemGrade === grade ? tons : 0;
      if (n(receipts._sum.tons) + editedTons + 0.0005 < used) throw new InputError(`Нельзя уменьшить приход: цемент ${itemGrade} уже использован`);
    }
    const otherGrade = grade === 'M500' ? 'M600' : 'M500';
    const otherReceived = await tx.barrelOperation.aggregate({ where: { barrelId: selectedBarrel, grade: otherGrade, type: 'RECEIPT', id: { not: id } }, _sum: { tons: true } });
    const otherUsed = await usedCementTons(tx, selectedBarrel, otherGrade);
    if (n(otherReceived._sum.tons) - otherUsed > 0.0005) throw new InputError(`В выбранной бочке ещё находится цемент ${otherGrade}`);
    return tx.barrelOperation.update({ where: { id }, data: { barrelId: selectedBarrel, grade, date: calendarDate(req.body.date), tons, pricePerTon: price, amount: tons * price } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  res.json(result);
});

app.get('/api/sales', async (_req, res) => res.json({
  cement: await prisma.cementSale.findMany({ orderBy: { date: 'desc' } }),
  concrete: await prisma.concreteSale.findMany({ orderBy: { date: 'desc' } }),
  materials: await prisma.materialSale.findMany({ orderBy: { date: 'desc' } })
}));
app.post('/api/sales', async (req, res) => {
  const bags = positiveInteger(req.body.bags, 'Количество мешков');
  const price = positiveNumber(req.body.pricePerBag, 'Цена за мешок');
  const grade = cementGrade(req.body.grade);
  const result = await prisma.$transaction(async tx => {
    const [made, sold, historical] = await Promise.all([tx.shift.aggregate({ where: { grade }, _sum: { bags: true } }), tx.cementSale.aggregate({ where: { grade }, _sum: { bags: true } }), tx.historicalBagEntry.aggregate({ where: { grade }, _sum: { producedBags: true, soldBags: true } })]);
    const available = n(made._sum.bags) + n(historical._sum.producedBags) - n(sold._sum.bags) - n(historical._sum.soldBags);
    if (available < bags) throw new InputError(`Недостаточно мешков ${grade}. Доступно: ${Math.max(0, available)}`);
    return tx.cementSale.create({ data: { date: calendarDate(req.body.date), client: optionalText(req.body.client, 150) ?? 'Без клиента', grade, bags, pricePerBag: price, amount: bags * price } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  res.status(201).json(result);
});
app.post('/api/concrete-sales', async (req, res) => {
  const volume = positiveNumber(req.body.volume, 'Объём бетона');
  const price = positiveNumber(req.body.pricePerM3, 'Цена за м³');
  const paid = req.body.paid === true || req.body.paid === 'true' || req.body.paid === 'on';
  const concreteGrade = requiredText(req.body.concreteGrade, 'Марка бетона', 50);
  const grade = cementGrade(req.body.cementGrade);
  const selectedBarrel = barrelId(req.body.barrelId);
  const result = await prisma.$transaction(async tx => {
    const norm = await tx.concreteNorm.findFirst({ where: { name: concreteGrade, grade } });
    if (!norm) throw new InputError(`В справочнике нет нормы ${concreteGrade} для цемента ${grade}`);
    const cementTons = volume * n(norm.cementKgPerM3) / 1000;
    const received = await tx.barrelOperation.aggregate({ where: { barrelId: selectedBarrel, grade, type: 'RECEIPT' }, _sum: { tons: true } });
    const used = await usedCementTons(tx, selectedBarrel, grade);
    if (n(received._sum.tons) - used + 0.0005 < cementTons) throw new InputError(`Недостаточно цемента ${grade} в выбранной бочке`);
    return tx.concreteSale.create({ data: {
      date: calendarDate(req.body.date),
      concreteGrade,
      address: requiredText(req.body.address, 'Адрес объекта', 250),
      vehicle: requiredText(req.body.vehicle, 'Автомобиль', 150),
      volume,
      pricePerM3: price,
      amount: volume * price,
      paid,
      cementGrade: grade,
      barrelId: selectedBarrel,
      cementTons
    } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  res.status(201).json(result);
});
app.patch('/api/concrete-sales/:id', async (req, res) => {
  const id = positiveInteger(req.params.id, 'ID продажи бетона');
  const volume = positiveNumber(req.body.volume, 'Объём бетона');
  const price = positiveNumber(req.body.pricePerM3, 'Цена за м³');
  const paid = req.body.paid === true || req.body.paid === 'true' || req.body.paid === 'on';
  const concreteGrade = requiredText(req.body.concreteGrade, 'Марка бетона', 50);
  const grade = cementGrade(req.body.cementGrade);
  const selectedBarrel = barrelId(req.body.barrelId);
  const result = await prisma.$transaction(async tx => {
    const current = await tx.concreteSale.findUniqueOrThrow({ where: { id } });
    const norm = await tx.concreteNorm.findFirst({ where: { name: concreteGrade, grade } });
    if (!norm) throw new InputError(`В справочнике нет нормы ${concreteGrade} для цемента ${grade}`);
    const cementTons = volume * n(norm.cementKgPerM3) / 1000;
    const received = await tx.barrelOperation.aggregate({
      where: { barrelId: selectedBarrel, grade, type: 'RECEIPT' },
      _sum: { tons: true }
    });
    const used = await usedCementTons(tx, selectedBarrel, grade);
    const currentUsage = current.barrelId === selectedBarrel && current.cementGrade === grade
      ? n(current.cementTons)
      : 0;
    if (n(received._sum.tons) - used + currentUsage + 0.0005 < cementTons) {
      throw new InputError(`Недостаточно цемента ${grade} в выбранной бочке`);
    }
    return tx.concreteSale.update({
      where: { id },
      data: {
        date: calendarDate(req.body.date),
        concreteGrade,
        address: requiredText(req.body.address, 'Адрес объекта', 250),
        vehicle: requiredText(req.body.vehicle, 'Автомобиль', 150),
        volume,
        pricePerM3: price,
        amount: volume * price,
        paid,
        cementGrade: grade,
        barrelId: selectedBarrel,
        cementTons
      }
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  res.json(result);
});
app.patch('/api/concrete-sales/:id/paid', async (req, res) => {
  const paid = req.body.paid === true || req.body.paid === 'true' || req.body.paid === 'on';
  res.json(await prisma.concreteSale.update({
    where: { id: positiveInteger(req.params.id, 'ID продажи бетона') },
    data: { paid, ...(paid ? { createdAt: new Date() } : {}) }
  }));
});
app.post('/api/materials', async (req, res) => {
  const tons = positiveNumber(req.body.tons, 'Количество тонн');
  const price = positiveNumber(req.body.pricePerTon, 'Цена за тонну');
  res.status(201).json(await prisma.materialSale.create({ data: { date: calendarDate(req.body.date), material: material(req.body.material), tons, pricePerTon: price, amount: tons * price, includeInFinance: false } }));
});
app.get('/api/materials', async (req, res) => {
  const from = startOfMoscowPeriod(req.query.period);
  const rows = await prisma.materialSale.groupBy({ by: ['material'], where: { date: { gte: from } }, _sum: { tons: true, amount: true } });
  res.json({ sand: { tons: n(rows.find(x => x.material === 'SAND')?._sum.tons), amount: n(rows.find(x => x.material === 'SAND')?._sum.amount) }, gravel: { tons: n(rows.find(x => x.material === 'GRAVEL')?._sum.tons), amount: n(rows.find(x => x.material === 'GRAVEL')?._sum.amount) } });
});
app.delete('/api/sales/:id', async (req, res) => res.json(await prisma.cementSale.delete({ where: { id: positiveInteger(req.params.id, 'ID продажи') } })));
app.delete('/api/materials/:id', async (req, res) => res.json(await prisma.materialSale.delete({ where: { id: positiveInteger(req.params.id, 'ID продажи') } })));
app.delete('/api/concrete-sales/:id', async (req, res) => res.json(await prisma.concreteSale.delete({ where: { id: positiveInteger(req.params.id, 'ID продажи бетона') } })));
app.get('/api/expenses', async (_req, res) => res.json(await prisma.expense.findMany({ orderBy: { date: 'desc' } })));
app.post('/api/expenses', async (req, res) => res.status(201).json(await prisma.expense.create({ data: { date: calendarDate(req.body.date), category: expenseCategory(req.body.category), amount: positiveNumber(req.body.amount, 'Сумма'), comment: optionalText(req.body.comment) } })));
app.patch('/api/expenses/:id', async (req, res) => res.json(await prisma.expense.update({ where: { id: positiveInteger(req.params.id, 'ID расхода') }, data: { date: calendarDate(req.body.date), category: expenseCategory(req.body.category), amount: positiveNumber(req.body.amount, 'Сумма'), comment: optionalText(req.body.comment) } })));
app.get('/api/expenses/summary', async (req, res) => { const result = await prisma.expense.aggregate({ where: { date: { gte: startOfMoscowPeriod(req.query.period) } }, _sum: { amount: true } }); res.json({ amount: n(result._sum.amount) }); });
app.delete('/api/expenses/:id', async (req, res) => res.json(await prisma.expense.delete({ where: { id: positiveInteger(req.params.id, 'ID расхода') } })));

async function cashBalance(tx: Prisma.TransactionClient | PrismaClient) {
  const last = await tx.cashCollection.findFirst({ orderBy: { createdAt: 'desc' } });
  const cashStart = new Date('2026-07-21T00:00:00.000Z');
  const operationWhere = last ? { createdAt: { gt: last.createdAt } } : { date: { gte: cashStart } };
  const [cement, concrete, expenses, shifts, adjustments] = await Promise.all([
    tx.cementSale.aggregate({ where: operationWhere, _sum: { amount: true } }),
    tx.concreteSale.aggregate({ where: { ...operationWhere, paid: true }, _sum: { amount: true } }),
    tx.expense.aggregate({ where: { ...operationWhere, category: { not: 'SALARY' } }, _sum: { amount: true } }),
    tx.shift.aggregate({ where: operationWhere, _sum: { packagingPay: true, loadingPay: true } }),
    tx.cashAdjustment.findMany({ where: operationWhere })
  ]);
  const incomeAdjustments = adjustments.filter(x => n(x.amount) > 0).reduce((sum, x) => sum + n(x.amount), 0);
  const costAdjustments = adjustments.filter(x => n(x.amount) < 0).reduce((sum, x) => sum + Math.abs(n(x.amount)), 0);
  const income = n(cement._sum.amount) + n(concrete._sum.amount) + incomeAdjustments;
  const costs = n(expenses._sum.amount) + n(shifts._sum.packagingPay) + n(shifts._sum.loadingPay) + costAdjustments;
  return { balance: income - costs, income, costs, since: last?.createdAt ?? null };
}
app.get('/api/cash', async (_req, res) => res.json({ ...await cashBalance(prisma), collections: await prisma.cashCollection.findMany({ orderBy: { createdAt: 'desc' }, take: 20 }) }));
app.post('/api/cash/collect', async (_req, res) => {
  const result = await prisma.$transaction(async tx => {
    const cash = await cashBalance(tx);
    if (cash.balance <= 0) throw new InputError('В кассе нет денег для инкассации');
    return tx.cashCollection.create({ data: { amount: cash.balance } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  res.status(201).json(result);
});

app.get('/api/concrete', async (_req, res) => res.json(await prisma.concreteNorm.findMany({ orderBy: { name: 'asc' } })));
app.post('/api/concrete', async (req, res) => res.status(201).json(await prisma.concreteNorm.create({ data: { name: requiredText(req.body.name, 'Марка бетона', 100), grade: cementGrade(req.body.grade), cementKgPerM3: positiveNumber(req.body.cementKgPerM3, 'Норма цемента'), pricePerM3: positiveNumber(req.body.pricePerM3, 'Цена бетона') } })));
app.patch('/api/concrete/:id', async (req, res) => res.json(await prisma.concreteNorm.update({ where: { id: positiveInteger(req.params.id, 'ID нормы') }, data: { name: requiredText(req.body.name, 'Марка бетона', 100), grade: cementGrade(req.body.grade), cementKgPerM3: positiveNumber(req.body.cementKgPerM3, 'Норма цемента'), pricePerM3: positiveNumber(req.body.pricePerM3, 'Цена бетона') } })));
app.delete('/api/concrete/:id', async (req, res) => res.json(await prisma.concreteNorm.delete({ where: { id: positiveInteger(req.params.id, 'ID нормы') } })));

app.get('/api/historical-bags', async (_req, res) => res.json(await prisma.historicalBagEntry.findMany({ orderBy: [{ date: 'desc' }, { grade: 'asc' }] })));
app.post('/api/historical-bags', async (req, res) => {
  const date = calendarDate(req.body.date);
  if (date > new Date('2026-07-23T23:59:59.999Z')) throw new InputError('Стартовые данные можно внести только по 23.07.2026 включительно');
  const grade = cementGrade(req.body.grade);
  const producedBags = nonNegativeNumber(req.body.producedBags, 'Нафасовано');
  const soldBags = nonNegativeNumber(req.body.soldBags, 'Продано');
  if (!Number.isInteger(producedBags) || !Number.isInteger(soldBags)) throw new InputError('Количество мешков должно быть целым числом');
  res.status(201).json(await prisma.historicalBagEntry.upsert({ where: { date_grade: { date, grade } }, update: { producedBags, soldBags }, create: { date, grade, producedBags, soldBags } }));
});
app.delete('/api/historical-bags/:id', async (req, res) => res.json(await prisma.historicalBagEntry.delete({ where: { id: positiveInteger(req.params.id, 'ID стартовой записи') } })));

app.get('/api/dashboard/details', async (_req, res) => {
  const [shifts, cementSales, concreteSales, materialSales, expenses, historicalBags, collections, cashAdjustments] = await Promise.all([
    prisma.shift.findMany({ include: { workers: { include: { worker: true } }, barrel: true }, orderBy: { date: 'desc' } }),
    prisma.cementSale.findMany({ orderBy: { date: 'desc' } }),
    prisma.concreteSale.findMany({ orderBy: { date: 'desc' } }),
    prisma.materialSale.findMany({ orderBy: { date: 'desc' } }),
    prisma.expense.findMany({ orderBy: { date: 'desc' } }),
    prisma.historicalBagEntry.findMany({ orderBy: { date: 'desc' } }),
    prisma.cashCollection.findMany({ orderBy: { createdAt: 'desc' } }),
    prisma.cashAdjustment.findMany({ orderBy: { date: 'desc' } })
  ]);
  res.json({ shifts, cementSales, concreteSales, materialSales, expenses, historicalBags, collections, cashAdjustments });
});

app.get('/api/dashboard', async (_req, res) => {
  const today = startOfMoscowPeriod('day'), month = startOfMoscowPeriod('month');
  const [shifts, cement, concrete, materials, expenses, allMade, allSold, historical] = await Promise.all([
    prisma.shift.findMany({ where: { date: { gte: today } }, include: { workers: true } }), prisma.cementSale.aggregate({ where: { date: { gte: today } }, _sum: { amount: true, bags: true } }),
    prisma.concreteSale.aggregate({ where: { date: { gte: today } }, _sum: { amount: true, volume: true } }),
    prisma.materialSale.groupBy({ by: ['material'], where: { date: { gte: today } }, _sum: { amount: true, tons: true } }),
    prisma.expense.aggregate({ where: { date: { gte: today }, category: { not: 'SALARY' } }, _sum: { amount: true } }),
    prisma.shift.groupBy({ by: ['grade'], _sum: { bags: true } }), prisma.cementSale.groupBy({ by: ['grade'], _sum: { bags: true } }),
    prisma.historicalBagEntry.groupBy({ by: ['grade'], _sum: { producedBags: true, soldBags: true } })]);
  const paidConcrete = await prisma.concreteSale.aggregate({ where: { date: { gte: today }, paid: true }, _sum: { amount: true } });
  const salary = shifts.reduce((s, x) => s + n(x.packagingPay) + n(x.loadingPay), 0), revenue = n(cement._sum.amount) + n(paidConcrete._sum.amount), costs = n(expenses._sum.amount) + salary;
  const monthRevenue = await prisma.cementSale.aggregate({ where: { date: { gte: month } }, _sum: { amount: true } });
  const grades = Object.fromEntries(['M500', 'M600'].map(grade => {
    const produced = n(allMade.find(x => x.grade === grade)?._sum.bags) + n(historical.find(x => x.grade === grade)?._sum.producedBags);
    const sold = n(allSold.find(x => x.grade === grade)?._sum.bags) + n(historical.find(x => x.grade === grade)?._sum.soldBags);
    return [grade, { produced, sold, remaining: produced - sold }];
  }));
  const bulk = { sand: shifts.filter(x => x.loadingMaterial === 'SAND').reduce((s, x) => s + n(x.loadingTons), 0), gravel: shifts.filter(x => x.loadingMaterial === 'GRAVEL').reduce((s, x) => s + n(x.loadingTons), 0) };
  res.json({ production: { bags: shifts.reduce((s, x) => s + x.bags, 0), tons: shifts.reduce((s, x) => s + n(x.tons), 0), concreteM3: n(concrete._sum.volume), bulk }, workers: new Set(shifts.flatMap(x => x.workers.map(w => w.workerId))).size, salary, sales: { cement: n(cement._sum.amount), concrete: n(paidConcrete._sum.amount), sand: n(materials.find(x => x.material === 'SAND')?._sum.amount), gravel: n(materials.find(x => x.material === 'GRAVEL')?._sum.amount) }, expenses: n(expenses._sum.amount), finance: { revenue, costs, profit: revenue - costs }, cash: await cashBalance(prisma), stock: { bags: Object.values(grades).reduce((s, x) => s + x.remaining, 0), produced: Object.values(grades).reduce((s, x) => s + x.produced, 0), sold: Object.values(grades).reduce((s, x) => s + x.sold, 0), grades, monthRevenue: n(monthRevenue._sum.amount) } });
});

app.get('/api/analytics', async (_req, res) => {
  const from = startOfMoscowPeriod('week');
  const [shifts, cement, concrete, materials, expenses, historicalBags] = await Promise.all([
    prisma.shift.findMany({ where: { date: { gte: from } } }),
    prisma.cementSale.findMany({ where: { date: { gte: from } } }),
    prisma.concreteSale.findMany({ where: { date: { gte: from } } }),
    prisma.materialSale.findMany({ where: { date: { gte: from } } }),
    prisma.expense.findMany({ where: { date: { gte: from } } }),
    prisma.historicalBagEntry.findMany({ where: { date: { gte: from } } })
  ]);
  res.json({ shifts, cement, concrete, materials, expenses, historicalBags });
});
app.get('/api/finance', async (req, res) => {
  const periodFrom = startOfMoscowPeriod(req.query.period);
  const lastCollection = await prisma.cashCollection.findFirst({ orderBy: { createdAt: 'desc' } });
  const afterCollection = Boolean(lastCollection && lastCollection.createdAt > periodFrom);
  const operationWhere = afterCollection ? { createdAt: { gt: lastCollection!.createdAt } } : { date: { gte: periodFrom } };
  const [cement, concrete, expenses, shifts, adjustments] = await Promise.all([
    prisma.cementSale.aggregate({ where: operationWhere, _sum: { amount: true } }),
    prisma.concreteSale.aggregate({ where: { ...operationWhere, paid: true }, _sum: { amount: true } }),
    prisma.expense.groupBy({ by: ['category'], where: { ...operationWhere, category: { not: 'SALARY' } }, _sum: { amount: true } }),
    prisma.shift.aggregate({ where: operationWhere, _sum: { packagingPay: true, loadingPay: true } }),
    prisma.cashAdjustment.findMany({ where: operationWhere })
  ]);
  const incomeAdjustment = adjustments.filter(x => n(x.amount) > 0).reduce((sum, x) => sum + n(x.amount), 0);
  const expenseAdjustment = adjustments.filter(x => n(x.amount) < 0).reduce((sum, x) => sum + Math.abs(n(x.amount)), 0);
  const income = { cement: n(cement._sum.amount) + incomeAdjustment, concrete: n(concrete._sum.amount), sand: 0, gravel: 0 };
  const salary = n(shifts._sum.packagingPay) + n(shifts._sum.loadingPay), otherExpenses = expenses.reduce((sum, x) => sum + n(x._sum.amount), 0) + expenseAdjustment;
  const revenue = income.cement + income.concrete + income.sand + income.gravel, costs = salary + otherExpenses;
  res.json({ period: req.query.period || 'month', income, salary, otherExpenses, revenue, costs, profit: revenue - costs, expenseBreakdown: expenses });
});
app.patch('/api/finance/salary-total', async (req, res) => {
  const from = startOfMoscowPeriod(req.body.period);
  const total = nonNegativeNumber(req.body.total, 'Общая зарплата');
  const result = await prisma.$transaction(async tx => {
    const shifts = await tx.shift.findMany({ where: { date: { gte: from } }, include: { workers: true } });
    if (!shifts.length) throw new InputError('За выбранный период нет смен для изменения зарплаты');
    const current = shifts.reduce((sum, shift) => sum + n(shift.packagingPay) + n(shift.loadingPay), 0);
    for (const shift of shifts) {
      const oldPay = n(shift.packagingPay) + n(shift.loadingPay);
      const shiftPay = current > 0 ? total * oldPay / current : total / shifts.length;
      await tx.shift.update({ where: { id: shift.id }, data: { packagingPay: shiftPay, loadingPay: 0 } });
      if (shift.workers.length) await tx.shiftWorker.updateMany({ where: { shiftId: shift.id }, data: { salary: shiftPay / shift.workers.length } });
    }
    return { salary: total };
  });
  res.json(result);
});

app.use((err: Error & { status?: number; code?: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  const known = err instanceof InputError || err.code === 'P2002' || err.code === 'P2025';
  res.status(err.status || (err.code === 'P2025' ? 404 : 400)).json({ error: known || !isProduction ? err.message : 'Не удалось выполнить операцию' });
});
const port = Number(process.env.PORT || 3000); app.listen(port, () => console.log(`API listening on ${port}`));
if (process.env.BOT_TOKEN && process.env.WEBAPP_URL) {
  const bot = new Telegraf(process.env.BOT_TOKEN);
  const webAppUrl = new URL(process.env.WEBAPP_URL);
  webAppUrl.pathname = '/app-20260730-3';
  webAppUrl.search = '';
  const versionedWebAppUrl = webAppUrl.toString();
  bot.start(ctx => ctx.reply('Cement CRM — управление производством и финансами', Markup.inlineKeyboard([Markup.button.webApp('Открыть Cement CRM', versionedWebAppUrl)])));
  void (async () => {
    await bot.telegram.setMyCommands([{ command: 'start', description: 'Открыть Cement CRM' }]);
    await bot.telegram.setChatMenuButton({ menuButton: { type: 'web_app', text: 'Открыть CRM', web_app: { url: versionedWebAppUrl } } });
    await bot.launch();
    console.log('Telegram bot started');
  })().catch(error => {
    console.error('Telegram bot failed to start', error instanceof Error ? error.message : error);
    if (isProduction) process.exitCode = 1;
  });
}
process.once('SIGTERM', () => prisma.$disconnect());
