import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import { Prisma, PrismaClient, BarrelOperationType } from '@prisma/client';
import { Telegraf, Markup } from 'telegraf';
import { telegramAuth, type TelegramUser } from './auth.js';
import { calculateShift } from './domain.js';
import { barrelId, calendarDate, expenseCategory, InputError, material, nonNegativeNumber, optionalText, positiveInteger, positiveNumber, requiredText, startOfMoscowPeriod, workerIds } from './validation.js';

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

app.get('/api/workers', async (_req, res) => res.json(await prisma.worker.findMany({ orderBy: { createdAt: 'desc' } })));
app.post('/api/workers', async (req, res) => res.status(201).json(await prisma.worker.create({ data: { name: requiredText(req.body.name, 'Имя', 100), phone: optionalText(req.body.phone, 30), position: requiredText(req.body.position, 'Должность', 100) } })));
app.patch('/api/workers/:id', async (req, res) => res.json(await prisma.worker.update({
  where: { id: positiveInteger(req.params.id, 'ID работника') },
  data: { name: requiredText(req.body.name, 'Имя', 100), phone: optionalText(req.body.phone, 30), position: requiredText(req.body.position, 'Должность', 100) }
})));
app.delete('/api/workers/:id', async (req, res) => res.json(await prisma.worker.update({ where: { id: positiveInteger(req.params.id, 'ID работника') }, data: { active: false } })));
app.get('/api/workers/stats', async (req, res) => {
  const from = startOfMoscowPeriod(req.query.period);
  const workers = await prisma.worker.findMany({ include: { shifts: { where: { shift: { date: { gte: from } } }, include: { shift: true } } }, orderBy: { name: 'asc' } });
  res.json(workers.map(worker => ({ id: worker.id, name: worker.name, position: worker.position, active: worker.active, workDays: new Set(worker.shifts.map(x => x.shift.date.toISOString().slice(0, 10))).size, shifts: worker.shifts.length, tons: worker.shifts.reduce((sum, x) => sum + n(x.shift.tons), 0), earnings: worker.shifts.reduce((sum, x) => sum + n(x.salary), 0) })));
});

app.get('/api/shifts', async (_req, res) => res.json(await prisma.shift.findMany({ include: { workers: { include: { worker: true } }, barrel: true }, orderBy: { date: 'desc' } })));
app.post('/api/shifts', async (req, res) => {
  const bags = positiveInteger(req.body.bags, 'Количество мешков');
  const loadingTons = nonNegativeNumber(req.body.loadingTons, 'Погрузка');
  const selectedWorkers = workerIds(req.body.workerIds);
  const selectedBarrel = barrelId(req.body.barrelId);
  const date = calendarDate(req.body.date);
  const { tons, packagingPay, loadingPay, salaryPerWorker: salary } = calculateShift(bags, loadingTons, selectedWorkers.length);
  const result = await prisma.$transaction(async tx => {
    const activeWorkers = await tx.worker.count({ where: { id: { in: selectedWorkers }, active: true } });
    if (activeWorkers !== selectedWorkers.length) throw new InputError('Один из выбранных работников неактивен или удалён');
    const balance = await tx.barrelOperation.aggregate({ where: { barrelId: selectedBarrel, type: 'RECEIPT' }, _sum: { tons: true } });
    const used = await tx.shift.aggregate({ where: { barrelId: selectedBarrel }, _sum: { tons: true } });
    if (n(balance._sum.tons) - n(used._sum.tons) < tons) throw new Error('Недостаточно цемента в бочке');
    return tx.shift.create({ data: { date, bags, tons, loadingTons, packagingPay, loadingPay, barrelId: selectedBarrel, workers: { create: selectedWorkers.map(workerId => ({ workerId, salary })) } }, include: { workers: true } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  res.status(201).json(result);
});
app.delete('/api/shifts/:id', async (req, res) => {
  const id = positiveInteger(req.params.id, 'ID смены');
  const result = await prisma.$transaction(async tx => {
    const [shift, produced, sold] = await Promise.all([
      tx.shift.findUniqueOrThrow({ where: { id } }),
      tx.shift.aggregate({ _sum: { bags: true } }),
      tx.cementSale.aggregate({ _sum: { bags: true } })
    ]);
    if (n(produced._sum.bags) - shift.bags < n(sold._sum.bags)) throw new InputError('Нельзя удалить смену: произведённые мешки уже проданы');
    return tx.shift.delete({ where: { id } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  res.json(result);
});

app.get('/api/salary', async (req, res) => {
  const from = req.query.from ? calendarDate(req.query.from) : startOfMoscowPeriod('month');
  const rows = await prisma.shiftWorker.findMany({ where: { shift: { date: { gte: from } } }, include: { worker: true, shift: true } });
  const map = new Map<number, { worker: string; shifts: number; tons: number; salary: number }>();
  rows.forEach(r => { const v = map.get(r.workerId) || { worker: r.worker.name, shifts: 0, tons: 0, salary: 0 }; v.shifts++; v.tons += n(r.shift.tons); v.salary += n(r.salary); map.set(r.workerId, v); });
  res.json([...map.values()]);
});

app.get('/api/barrels', async (_req, res) => {
  const barrels = await prisma.barrel.findMany({ include: { operations: true, shifts: true } });
  res.json(barrels.map(b => ({ id: b.id, name: b.name, received: b.operations.filter(o => o.type === 'RECEIPT').reduce((s, o) => s + n(o.tons), 0), used: b.shifts.reduce((s, x) => s + n(x.tons), 0) })));
});
app.post('/api/cement', async (req, res) => {
  const tons = positiveNumber(req.body.tons, 'Количество тонн');
  const price = positiveNumber(req.body.pricePerTon, 'Цена за тонну');
  res.status(201).json(await prisma.barrelOperation.create({ data: { barrelId: barrelId(req.body.barrelId), type: BarrelOperationType.RECEIPT, date: calendarDate(req.body.date), tons, pricePerTon: price, amount: tons * price } }));
});
app.get('/api/cement', async (_req, res) => res.json(await prisma.barrelOperation.findMany({ where: { type: 'RECEIPT' }, include: { barrel: true }, orderBy: { date: 'desc' } })));

app.get('/api/sales', async (_req, res) => res.json({ cement: await prisma.cementSale.findMany({ orderBy: { date: 'desc' } }), materials: await prisma.materialSale.findMany({ orderBy: { date: 'desc' } }) }));
app.post('/api/sales', async (req, res) => {
  const bags = positiveInteger(req.body.bags, 'Количество мешков');
  const price = positiveNumber(req.body.pricePerBag, 'Цена за мешок');
  const result = await prisma.$transaction(async tx => {
    const [made, sold] = await Promise.all([tx.shift.aggregate({ _sum: { bags: true } }), tx.cementSale.aggregate({ _sum: { bags: true } })]);
    if (n(made._sum.bags) - n(sold._sum.bags) < bags) throw new InputError('Недостаточно мешков');
    return tx.cementSale.create({ data: { date: calendarDate(req.body.date), client: requiredText(req.body.client, 'Клиент', 150), bags, pricePerBag: price, amount: bags * price } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  res.status(201).json(result);
});
app.post('/api/materials', async (req, res) => {
  const tons = positiveNumber(req.body.tons, 'Количество тонн');
  const price = positiveNumber(req.body.pricePerTon, 'Цена за тонну');
  res.status(201).json(await prisma.materialSale.create({ data: { date: calendarDate(req.body.date), material: material(req.body.material), tons, pricePerTon: price, amount: tons * price } }));
});
app.get('/api/materials', async (req, res) => {
  const from = startOfMoscowPeriod(req.query.period);
  const rows = await prisma.materialSale.groupBy({ by: ['material'], where: { date: { gte: from } }, _sum: { tons: true, amount: true } });
  res.json({ sand: { tons: n(rows.find(x => x.material === 'SAND')?._sum.tons), amount: n(rows.find(x => x.material === 'SAND')?._sum.amount) }, gravel: { tons: n(rows.find(x => x.material === 'GRAVEL')?._sum.tons), amount: n(rows.find(x => x.material === 'GRAVEL')?._sum.amount) } });
});
app.delete('/api/sales/:id', async (req, res) => res.json(await prisma.cementSale.delete({ where: { id: positiveInteger(req.params.id, 'ID продажи') } })));
app.delete('/api/materials/:id', async (req, res) => res.json(await prisma.materialSale.delete({ where: { id: positiveInteger(req.params.id, 'ID продажи') } })));
app.get('/api/expenses', async (_req, res) => res.json(await prisma.expense.findMany({ orderBy: { date: 'desc' } })));
app.post('/api/expenses', async (req, res) => res.status(201).json(await prisma.expense.create({ data: { date: calendarDate(req.body.date), category: expenseCategory(req.body.category), amount: positiveNumber(req.body.amount, 'Сумма'), comment: optionalText(req.body.comment) } })));
app.get('/api/expenses/summary', async (req, res) => { const result = await prisma.expense.aggregate({ where: { date: { gte: startOfMoscowPeriod(req.query.period) } }, _sum: { amount: true } }); res.json({ amount: n(result._sum.amount) }); });
app.delete('/api/expenses/:id', async (req, res) => res.json(await prisma.expense.delete({ where: { id: positiveInteger(req.params.id, 'ID расхода') } })));

app.get('/api/dashboard', async (_req, res) => {
  const today = startOfMoscowPeriod('day'), month = startOfMoscowPeriod('month');
  const [shifts, cement, materials, expenses, allMade, allSold] = await Promise.all([
    prisma.shift.findMany({ where: { date: { gte: today } }, include: { workers: true } }), prisma.cementSale.aggregate({ where: { date: { gte: today } }, _sum: { amount: true, bags: true } }),
    prisma.materialSale.groupBy({ by: ['material'], where: { date: { gte: today } }, _sum: { amount: true, tons: true } }), prisma.expense.aggregate({ where: { date: { gte: today }, category: { not: 'SALARY' } }, _sum: { amount: true } }),
    prisma.shift.aggregate({ _sum: { bags: true } }), prisma.cementSale.aggregate({ _sum: { bags: true } })]);
  const salary = shifts.reduce((s, x) => s + n(x.packagingPay) + n(x.loadingPay), 0), revenue = n(cement._sum.amount) + materials.reduce((s, x) => s + n(x._sum.amount), 0), costs = n(expenses._sum.amount) + salary;
  const monthRevenue = await prisma.cementSale.aggregate({ where: { date: { gte: month } }, _sum: { amount: true } });
  res.json({ production: { bags: shifts.reduce((s, x) => s + x.bags, 0), tons: shifts.reduce((s, x) => s + n(x.tons), 0) }, workers: new Set(shifts.flatMap(x => x.workers.map(w => w.workerId))).size, salary, sales: { cement: n(cement._sum.amount), sand: n(materials.find(x => x.material === 'SAND')?._sum.amount), gravel: n(materials.find(x => x.material === 'GRAVEL')?._sum.amount) }, expenses: n(expenses._sum.amount), finance: { revenue, costs, profit: revenue - costs }, stock: { bags: n(allMade._sum.bags) - n(allSold._sum.bags), monthRevenue: n(monthRevenue._sum.amount) } });
});

app.get('/api/analytics', async (_req, res) => {
  const from = startOfMoscowPeriod('week');
  const [shifts, cement, materials, expenses] = await Promise.all([
    prisma.shift.findMany({ where: { date: { gte: from } } }),
    prisma.cementSale.findMany({ where: { date: { gte: from } } }),
    prisma.materialSale.findMany({ where: { date: { gte: from } } }),
    prisma.expense.findMany({ where: { date: { gte: from } } })
  ]);
  res.json({ shifts, cement, materials, expenses });
});
app.get('/api/finance', async (req, res) => {
  const from = startOfMoscowPeriod(req.query.period);
  const [cement, materials, expenses, shifts] = await Promise.all([
    prisma.cementSale.aggregate({ where: { date: { gte: from } }, _sum: { amount: true } }),
    prisma.materialSale.groupBy({ by: ['material'], where: { date: { gte: from } }, _sum: { amount: true, tons: true } }),
    prisma.expense.groupBy({ by: ['category'], where: { date: { gte: from }, category: { not: 'SALARY' } }, _sum: { amount: true } }),
    prisma.shift.aggregate({ where: { date: { gte: from } }, _sum: { packagingPay: true, loadingPay: true } })
  ]);
  const income = { cement: n(cement._sum.amount), sand: n(materials.find(x => x.material === 'SAND')?._sum.amount), gravel: n(materials.find(x => x.material === 'GRAVEL')?._sum.amount) };
  const salary = n(shifts._sum.packagingPay) + n(shifts._sum.loadingPay), otherExpenses = expenses.reduce((sum, x) => sum + n(x._sum.amount), 0);
  const revenue = income.cement + income.sand + income.gravel, costs = salary + otherExpenses;
  res.json({ period: req.query.period || 'month', income, salary, otherExpenses, revenue, costs, profit: revenue - costs, expenseBreakdown: expenses });
});

app.use((err: Error & { status?: number; code?: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  const known = err instanceof InputError || err.code === 'P2002' || err.code === 'P2025';
  res.status(err.status || (err.code === 'P2025' ? 404 : 400)).json({ error: known || !isProduction ? err.message : 'Не удалось выполнить операцию' });
});
const port = Number(process.env.PORT || 3000); app.listen(port, () => console.log(`API listening on ${port}`));
if (process.env.BOT_TOKEN && process.env.WEBAPP_URL) {
  const bot = new Telegraf(process.env.BOT_TOKEN);
  const webAppUrl = process.env.WEBAPP_URL;
  bot.start(ctx => ctx.reply('Cement CRM — управление производством и финансами', Markup.inlineKeyboard([Markup.button.webApp('Открыть Cement CRM', webAppUrl)])));
  void (async () => {
    await bot.telegram.setMyCommands([{ command: 'start', description: 'Открыть Cement CRM' }]);
    await bot.telegram.setChatMenuButton({ menuButton: { type: 'web_app', text: 'Открыть CRM', web_app: { url: webAppUrl } } });
    await bot.launch();
    console.log('Telegram bot started');
  })().catch(error => {
    console.error('Telegram bot failed to start', error instanceof Error ? error.message : error);
    if (isProduction) process.exitCode = 1;
  });
}
process.once('SIGTERM', () => prisma.$disconnect());
