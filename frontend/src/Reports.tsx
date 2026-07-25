import { useEffect, useMemo, useState } from 'react';
import { Bar, Line } from 'react-chartjs-2';
import { BarElement, CategoryScale, Chart as ChartJS, Legend, LinearScale, LineElement, PointElement, Tooltip } from 'chart.js';
import { BarChart3, Factory, Pencil, Receipt, Trash2 } from 'lucide-react';
import { api } from './api';

ChartJS.register(CategoryScale, LinearScale, BarElement, PointElement, LineElement, Tooltip, Legend);
const rub = (v = 0) => new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(v);
const date = (value: string) => new Date(value).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' });

export type ShiftRow = { id:number;date:string;grade:'M500'|'M600';bags:number;tons:number;loadingTons:number;packagingPay:number;loadingPay:number;barrel:{name:string};workers:{worker:{name:string};salary:number}[] };
type Sale = { id:number;date:string;grade?:'M500'|'M600';client?:string;bags?:number;material?:'SAND'|'GRAVEL';tons?:number;amount:number };
type ExpenseRow = { id:number;date:string;category:string;amount:number;comment?:string };
type HistoricalBagRow = { id:number;date:string;grade:'M500'|'M600';producedBags:number;soldBags:number };
type AnalyticsData = { shifts:ShiftRow[];cement:Sale[];materials:Sale[];expenses:ExpenseRow[];historicalBags:HistoricalBagRow[] };
type FinanceData = { income:{cement:number;sand:number;gravel:number};salary:number;otherExpenses:number;revenue:number;costs:number;profit:number };
type WorkerStat = {id:number;name:string;position:string;active:boolean;workDays:number;shifts:number;tons:number;earnings:number};

export function PeriodTabs({value,onChange}:{value:string;onChange:(value:string)=>void}) { return <div className="period-tabs">{[['day','День'],['week','Неделя'],['month','Месяц']].map(([key,label])=><button className={value===key?'selected':''} onClick={()=>onChange(key)} key={key}>{label}</button>)}</div> }

export function StockSummary(){const [stock,setStock]=useState<{bags:number;produced:number;sold:number;grades:Record<'M500'|'M600',{produced:number;sold:number;remaining:number}>}|null>(null);useEffect(()=>{api<{stock:NonNullable<typeof stock>}>('/dashboard').then(x=>setStock(x.stock))},[]);return stock?<><div className="summary"><Factory/><span>Остаток готовой продукции</span><strong>{stock.bags} меш. · {(stock.bags*.025).toFixed(3)} т</strong></div><div className="grid barrel-grid"><div className="card"><div className="muted">М500</div><strong>{stock.grades.M500.remaining} меш.</strong><small>Нафасовано {stock.grades.M500.produced} · продано {stock.grades.M500.sold}</small></div><div className="card"><div className="muted">М600</div><strong>{stock.grades.M600.remaining} меш.</strong><small>Нафасовано {stock.grades.M600.produced} · продано {stock.grades.M600.sold}</small></div></div></>:null}
export function MaterialStats(){const [period,setPeriod]=useState('day'),[data,setData]=useState<{sand:{tons:number;amount:number};gravel:{tons:number;amount:number}}|null>(null);useEffect(()=>{api<typeof data>(`/materials?period=${period}`).then(setData)},[period]);return <><PeriodTabs value={period} onChange={setPeriod}/>{data&&<div className="grid barrel-grid"><div className="card"><div className="muted">Песок</div><strong>{data.sand.tons.toFixed(2)} т</strong><small>{rub(data.sand.amount)}</small></div><div className="card"><div className="muted">Щебень</div><strong>{data.gravel.tons.toFixed(2)} т</strong><small>{rub(data.gravel.amount)}</small></div></div>}</>}
export function ExpenseStats(){const [period,setPeriod]=useState('day'),[amount,setAmount]=useState(0);useEffect(()=>{api<{amount:number}>(`/expenses/summary?period=${period}`).then(x=>setAmount(x.amount))},[period]);return <><PeriodTabs value={period} onChange={setPeriod}/><div className="summary"><Receipt/><span>Расходы за период</span><strong>{rub(amount)}</strong></div></>}

export function Production({reload}:{reload:()=>void}) {
  const [rows,setRows]=useState<ShiftRow[]>([]),[stock,setStock]=useState<Record<'M500'|'M600',{produced:number;sold:number;remaining:number}>|null>(null);
  const load=()=>Promise.all([api<ShiftRow[]>('/shifts').then(setRows),api<{stock:{grades:NonNullable<typeof stock>}}>('/dashboard').then(x=>setStock(x.stock.grades))]); useEffect(()=>{void load()},[]);
  const remove=async(id:number)=>{if(!confirm('Удалить смену? Остаток цемента и зарплата будут пересчитаны.'))return;await api(`/shifts/${id}`,{method:'DELETE'});load();reload()};
  const editPay=async(x:ShiftRow)=>{const current=Number(x.packagingPay)+Number(x.loadingPay),value=prompt('Общая зарплата за эту смену, ₽',String(current));if(value===null)return;await api(`/shifts/${x.id}/pay`,{method:'PATCH',body:JSON.stringify({totalPay:value})});load();reload()};
  const editBaseline=async(grade:'M500'|'M600')=>{const defaults=grade==='M500'?{produced:1036,sold:106}:{produced:2947,sold:2690};const producedBags=prompt(`Стартовая фасовка ${grade} до 23.07`,String(defaults.produced));if(producedBags===null)return;const soldBags=prompt(`Стартовая продажа ${grade} до 23.07`,String(defaults.sold));if(soldBags===null)return;await api('/historical-bags',{method:'POST',body:JSON.stringify({date:'2026-07-20',grade,producedBags,soldBags})});load();reload()};
  const bags=rows.reduce((s,x)=>s+x.bags,0),tons=rows.reduce((s,x)=>s+Number(x.tons),0);
  return <>{stock&&<div className="grid barrel-grid">{(['M500','M600'] as const).map(grade=><div className="card" key={grade}><div className="history-top"><div><div className="muted">{grade} · баланс мешков</div><strong>{stock[grade].remaining} меш.</strong><small>Фасовка {stock[grade].produced} · продажа {stock[grade].sold}</small></div><button className="icon-button" onClick={()=>editBaseline(grade)} title="Изменить стартовые данные"><Pencil/></button></div></div>)}</div>}<div className="summary"><Factory/><span>Произведено по сменам</span><strong>{bags} меш. · {tons.toFixed(2)} т</strong></div><h2>История смен</h2><div className="list">{rows.map(x=><div className="history" key={x.id}><div className="history-top"><div><strong>{date(x.date)} · {x.grade} · {x.bags} мешков</strong><small>{Number(x.tons).toFixed(3)} т · {x.barrel.name}</small></div><button className="icon-button" onClick={()=>editPay(x)} title="Изменить зарплату"><Pencil/></button><button className="icon-button danger" onClick={()=>remove(x.id)}><Trash2/></button></div><div className="chips">{x.workers.map(w=><span key={w.worker.name}>{w.worker.name} · {rub(Number(w.salary))}</span>)}</div></div>)}{!rows.length&&<Empty/>}</div></>;
}

export function Operations({kind,reload}:{kind:'sales'|'materials'|'expenses';reload:()=>void}) {
 const [rows,setRows]=useState<(Sale|ExpenseRow)[]>([]);
 const load=()=> kind==='expenses'?api<ExpenseRow[]>('/expenses').then(setRows):api<{cement:Sale[];materials:Sale[]}>('/sales').then(x=>setRows(kind==='sales'?x.cement:x.materials)); useEffect(()=>{void load()},[kind]);
 const remove=async(id:number)=>{if(!confirm('Удалить запись?'))return;await api(`/${kind}/${id}`,{method:'DELETE'});load();reload()};
 const editExpense=async(x:ExpenseRow)=>{const amount=prompt('Новая сумма расхода, ₽',String(x.amount));if(amount===null)return;const comment=prompt('Комментарий',x.comment||'')??x.comment??'';await api(`/expenses/${x.id}`,{method:'PATCH',body:JSON.stringify({date:x.date.slice(0,10),category:x.category,amount,comment})});load();reload()};
 return <><h2>История операций</h2><div className="list">{rows.map(x=><div className="history compact" key={x.id}><div><strong>{'client'in x&&x.client?`${x.client}${x.grade?` · ${x.grade}`:''}`:'material'in x?(x.material==='SAND'?'Песок':'Щебень'):(x as ExpenseRow).comment||category((x as ExpenseRow).category)}</strong><small>{date(x.date)} · {'bags'in x&&x.bags?`${x.bags} меш.`:'tons'in x&&x.tons?`${Number(x.tons).toFixed(2)} т`:category((x as ExpenseRow).category)}</small></div><b>{rub(Number(x.amount))}</b>{kind==='expenses'&&<button className="icon-button" onClick={()=>editExpense(x as ExpenseRow)} title="Изменить расход"><Pencil/></button>}<button className="icon-button danger" onClick={()=>remove(x.id)}><Trash2/></button></div>)}{!rows.length&&<Empty/>}</div></>;
}

export function WorkerStats() { const [period,setPeriod]=useState('month'),[rows,setRows]=useState<WorkerStat[]>([]);useEffect(()=>{api<WorkerStat[]>(`/workers/stats?period=${period}`).then(setRows)},[period]);return <><PeriodTabs value={period} onChange={setPeriod}/><div className="list">{rows.map(x=><div className="worker-stat" key={x.id}><div><strong>{x.name}</strong><small>{x.position}</small></div><b>{rub(x.earnings)}</b><div className="stat-line"><span>{x.workDays} рабочих дней</span><span>{x.shifts} смен</span><span>{x.tons.toFixed(2)} т</span></div></div>)}</div></> }

export function Finance() { const [period,setPeriod]=useState('month'),[data,setData]=useState<FinanceData|null>(null);const load=()=>api<FinanceData>(`/finance?period=${period}`).then(setData);useEffect(()=>{load()},[period]);const editSalary=async()=>{if(!data)return;const total=prompt('Общая зарплата за выбранный период, ₽',String(data.salary));if(total===null)return;await api('/finance/salary-total',{method:'PATCH',body:JSON.stringify({period,total})});load()};return <><PeriodTabs value={period} onChange={setPeriod}/>{data&&<><section className="hero finance-hero"><span>Чистая прибыль</span><strong className={data.profit<0?'negative':''}>{rub(data.profit)}</strong><div><span>Доход {rub(data.revenue)}</span><span>Расход {rub(data.costs)}</span></div></section><h2>Доходы</h2><div className="finance-list"><Row label="Цемент" value={data.income.cement}/><Row label="Песок" value={data.income.sand}/><Row label="Щебень" value={data.income.gravel}/></div><h2>Расходы</h2><div className="finance-list"><Row label="Зарплата" value={data.salary} action={editSalary}/><Row label="Расходы предприятия" value={data.otherExpenses}/></div></>}</> }

export function Analytics(){
  const [data,setData]=useState<AnalyticsData|null>(null);
  useEffect(()=>{api<AnalyticsData>('/analytics').then(setData)},[]);
  const days=useMemo(()=>Array.from({length:7},(_,i)=>{const d=new Date();d.setDate(d.getDate()-6+i);return d.toISOString().slice(0,10)}),[]);
  if(!data)return <div className="loader">Строим графики…</div>;
  const byDay=<T extends {date:string}>(items:T[],day:string,value:(item:T)=>number)=>items.filter(x=>x.date.slice(0,10)===day).reduce((sum,item)=>sum+value(item),0);
  const labels=days.map(x=>date(x));
  const income=days.map(day=>byDay(data.cement,day,x=>Number(x.amount))+byDay(data.materials,day,x=>Number(x.amount)));
  const costs=days.map(day=>byDay(data.expenses.filter(x=>x.category!=='SALARY'),day,x=>Number(x.amount))+byDay(data.shifts,day,x=>Number(x.packagingPay)+Number(x.loadingPay)));
  const options={responsive:true,plugins:{legend:{position:'bottom' as const}},scales:{x:{grid:{display:false}},y:{beginAtZero:true}}};
  return <div className="charts">
    <article><h2>Производство</h2><Bar options={options} data={{labels,datasets:[
      {label:'Мешки',data:days.map(day=>byDay(data.shifts,day,x=>x.bags)+byDay(data.historicalBags,day,x=>x.producedBags)),backgroundColor:'#a9cc31',borderRadius:7},
      {label:'Тонны',data:days.map(day=>byDay(data.shifts,day,x=>Number(x.tons))),backgroundColor:'#596b19',borderRadius:7}
    ]}}/></article>
    <article><h2>Фасовка и продажа мешков</h2><Bar options={options} data={{labels,datasets:[
      {label:'Нафасовано',data:days.map(day=>byDay(data.shifts,day,x=>x.bags)+byDay(data.historicalBags,day,x=>x.producedBags)),backgroundColor:'#a9cc31',borderRadius:7},
      {label:'Продано',data:days.map(day=>byDay(data.cement,day,x=>Number(x.bags||0))+byDay(data.historicalBags,day,x=>x.soldBags)),backgroundColor:'#e79478',borderRadius:7}
    ]}}/></article>
    <article><h2>Продажи</h2><Line options={options} data={{labels,datasets:[
      {label:'Цемент',data:days.map(day=>byDay(data.cement,day,x=>Number(x.amount))),borderColor:'#20241d',backgroundColor:'#20241d'},
      {label:'Песок',data:days.map(day=>byDay(data.materials.filter(x=>x.material==='SAND'),day,x=>Number(x.amount))),borderColor:'#c6a15b',backgroundColor:'#c6a15b'},
      {label:'Щебень',data:days.map(day=>byDay(data.materials.filter(x=>x.material==='GRAVEL'),day,x=>Number(x.amount))),borderColor:'#7b8587',backgroundColor:'#7b8587'}
    ]}}/></article>
    <article><h2>Финансы</h2><Bar options={options} data={{labels,datasets:[
      {label:'Доход',data:income,backgroundColor:'#a9cc31'},
      {label:'Расход',data:costs,backgroundColor:'#e79478'},
      {label:'Прибыль',data:income.map((value,index)=>value-costs[index]),backgroundColor:'#596b19'}
    ]}}/></article>
  </div>
}
function Row({label,value,action}:{label:string;value:number;action?:()=>void}){return <div><span>{label}</span><strong>{rub(value)}</strong>{action&&<button className="icon-button" onClick={action} title="Изменить"><Pencil/></button>}</div>};function Empty(){return <div className="empty"><BarChart3/>Записей пока нет</div>}function category(key:string){return ({SALARY:'Зарплата',RENT:'Аренда',ELECTRICITY:'Электричество',FUEL:'Топливо',REPAIR:'Ремонт',PACKAGING:'Упаковка',OTHER:'Прочее'} as Record<string,string>)[key]||key}
