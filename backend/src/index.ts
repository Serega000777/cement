import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import { PrismaClient, BarrelOperationType, ExpenseCategory, Material } from '@prisma/client';
import { Telegraf, Markup } from 'telegraf';
import { telegramAuth } from './auth.js';

const prisma = new PrismaClient();
const app = express();
app.use(cors()); app.use(express.json());
app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.use('/api', telegramAuth);
const startOfDay = (d = new Date()) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const startOfMonth = () => new Date(new Date().getFullYear(), new Date().getMonth(), 1);
const n = (value: unknown) => Number(value || 0);

app.get('/api/workers', async (_req, res) => res.json(await prisma.worker.findMany({ orderBy: { createdAt: 'desc' } })));
app.post('/api/workers', async (req, res) => res.status(201).json(await prisma.worker.create({ data: { name: req.body.name, phone: req.body.phone || null, position: req.body.position } })));
app.patch('/api/workers/:id', async (req, res) => res.json(await prisma.worker.update({ where: { id: +req.params.id }, data: req.body })));
app.delete('/api/workers/:id', async (req, res) => res.json(await prisma.worker.update({ where: { id: +req.params.id }, data: { active: false } })));

app.get('/api/shifts', async (_req, res) => res.json(await prisma.shift.findMany({ include: { workers: { include: { worker: true } }, barrel: true }, orderBy: { date: 'desc' } })));
app.post('/api/shifts', async (req, res) => {
  const bags = n(req.body.bags), tons = bags * 0.025, loadingTons = n(req.body.loadingTons);
  const workerIds: number[] = req.body.workerIds || [];
  if (!workerIds.length || bags <= 0) return res.status(400).json({ error: 'Укажите мешки и работников' });
  const packagingPay = tons * 2500, loadingPay = loadingTons * 200, salary = (packagingPay + loadingPay) / workerIds.length;
  const result = await prisma.$transaction(async tx => {
    const balance = await tx.barrelOperation.aggregate({ where: { barrelId: n(req.body.barrelId) }, _sum: { tons: true } });
    const used = await tx.shift.aggregate({ where: { barrelId: n(req.body.barrelId) }, _sum: { tons: true } });
    if (n(balance._sum.tons) - n(used._sum.tons) < tons) throw new Error('Недостаточно цемента в бочке');
    return tx.shift.create({ data: { date: new Date(req.body.date), bags, tons, loadingTons, packagingPay, loadingPay, barrelId: n(req.body.barrelId), workers: { create: workerIds.map(workerId => ({ workerId, salary })) } }, include: { workers: true } });
  });
  res.status(201).json(result);
});

app.get('/api/salary', async (req, res) => {
  const from = req.query.from ? new Date(String(req.query.from)) : startOfMonth();
  const rows = await prisma.shiftWorker.findMany({ where: { shift: { date: { gte: from } } }, include: { worker: true, shift: true } });
  const map = new Map<number, { worker: string; shifts: number; tons: number; salary: number }>();
  rows.forEach(r => { const v = map.get(r.workerId) || { worker: r.worker.name, shifts: 0, tons: 0, salary: 0 }; v.shifts++; v.tons += n(r.shift.tons); v.salary += n(r.salary); map.set(r.workerId, v); });
  res.json([...map.values()]);
});

app.get('/api/barrels', async (_req, res) => {
  const barrels = await prisma.barrel.findMany({ include: { operations: true, shifts: true } });
  res.json(barrels.map(b => ({ id: b.id, name: b.name, received: b.operations.filter(o => o.type === 'RECEIPT').reduce((s, o) => s + n(o.tons), 0), used: b.shifts.reduce((s, x) => s + n(x.tons), 0) })));
});
app.post('/api/cement', async (req, res) => { const tons = n(req.body.tons), price = n(req.body.pricePerTon); res.status(201).json(await prisma.barrelOperation.create({ data: { barrelId: n(req.body.barrelId), type: BarrelOperationType.RECEIPT, date: new Date(req.body.date), tons, pricePerTon: price, amount: tons * price } })); });

app.get('/api/sales', async (_req, res) => res.json({ cement: await prisma.cementSale.findMany({ orderBy: { date: 'desc' } }), materials: await prisma.materialSale.findMany({ orderBy: { date: 'desc' } }) }));
app.post('/api/sales', async (req, res) => { const bags = n(req.body.bags), price = n(req.body.pricePerBag); const made = await prisma.shift.aggregate({ _sum: { bags: true } }); const sold = await prisma.cementSale.aggregate({ _sum: { bags: true } }); if (n(made._sum.bags) - n(sold._sum.bags) < bags) return res.status(400).json({ error: 'Недостаточно мешков' }); res.status(201).json(await prisma.cementSale.create({ data: { date: new Date(req.body.date), client: req.body.client, bags, pricePerBag: price, amount: bags * price } })); });
app.post('/api/materials', async (req, res) => { const tons = n(req.body.tons), price = n(req.body.pricePerTon); res.status(201).json(await prisma.materialSale.create({ data: { date: new Date(req.body.date), material: req.body.material as Material, tons, pricePerTon: price, amount: tons * price } })); });
app.get('/api/expenses', async (_req, res) => res.json(await prisma.expense.findMany({ orderBy: { date: 'desc' } })));
app.post('/api/expenses', async (req, res) => res.status(201).json(await prisma.expense.create({ data: { date: new Date(req.body.date), category: req.body.category as ExpenseCategory, amount: n(req.body.amount), comment: req.body.comment || null } })));

app.get('/api/dashboard', async (_req, res) => {
  const today = startOfDay(), month = startOfMonth();
  const [shifts, cement, materials, expenses, allMade, allSold] = await Promise.all([
    prisma.shift.findMany({ where: { date: { gte: today } }, include: { workers: true } }), prisma.cementSale.aggregate({ where: { date: { gte: today } }, _sum: { amount: true, bags: true } }),
    prisma.materialSale.groupBy({ by: ['material'], where: { date: { gte: today } }, _sum: { amount: true, tons: true } }), prisma.expense.aggregate({ where: { date: { gte: today } }, _sum: { amount: true } }),
    prisma.shift.aggregate({ _sum: { bags: true } }), prisma.cementSale.aggregate({ _sum: { bags: true } })]);
  const salary = shifts.reduce((s, x) => s + n(x.packagingPay) + n(x.loadingPay), 0), revenue = n(cement._sum.amount) + materials.reduce((s, x) => s + n(x._sum.amount), 0), costs = n(expenses._sum.amount) + salary;
  const monthRevenue = await prisma.cementSale.aggregate({ where: { date: { gte: month } }, _sum: { amount: true } });
  res.json({ production: { bags: shifts.reduce((s, x) => s + x.bags, 0), tons: shifts.reduce((s, x) => s + n(x.tons), 0) }, workers: new Set(shifts.flatMap(x => x.workers.map(w => w.workerId))).size, salary, sales: { cement: n(cement._sum.amount), sand: n(materials.find(x => x.material === 'SAND')?._sum.amount), gravel: n(materials.find(x => x.material === 'GRAVEL')?._sum.amount) }, expenses: n(expenses._sum.amount), finance: { revenue, costs, profit: revenue - costs }, stock: { bags: n(allMade._sum.bags) - n(allSold._sum.bags), monthRevenue: n(monthRevenue._sum.amount) } });
});

app.get('/api/analytics', async (_req, res) => { const from = new Date(Date.now() - 6 * 86400000); const [shifts, cement, materials, expenses] = await Promise.all([prisma.shift.findMany({ where: { date: { gte: from } } }), prisma.cementSale.findMany({ where: { date: { gte: from } } }), prisma.materialSale.findMany({ where: { date: { gte: from } } }), prisma.expense.findMany({ where: { date: { gte: from } } })]); res.json({ shifts, cement, materials, expenses }); });

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => { console.error(err); res.status(400).json({ error: err.message || 'Ошибка запроса' }); });
const port = Number(process.env.PORT || 3000); app.listen(port, () => console.log(`API listening on ${port}`));
if (process.env.BOT_TOKEN) { const bot = new Telegraf(process.env.BOT_TOKEN); bot.start(ctx => ctx.reply('Cement CRM — управление производством и финансами', Markup.inlineKeyboard([Markup.button.webApp('Открыть Cement CRM', process.env.WEBAPP_URL || '')]))); bot.launch(); }
process.once('SIGTERM', () => prisma.$disconnect());
