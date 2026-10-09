'use strict';

// ---------- Config ----------

const STORAGE_KEY = 'budget-app-v1';
const KEEP_MONTHS = 12; // current month + 11 previous

const DEFAULT_CATEGORIES = [
  { name: 'Rent', type: 'fixed', emoji: '🏠', amount: 0 },
  { name: 'Internet', type: 'fixed', emoji: '🌐', amount: 0 },
  { name: 'Phone', type: 'fixed', emoji: '📱', amount: 0 },
  { name: 'Insurance', type: 'fixed', emoji: '🛡️', amount: 0 },
  { name: 'Utility', type: 'fixed', emoji: '💡', amount: 0 },
  { name: 'Grocery', type: 'flex', emoji: '🛒' },
  { name: 'Dining', type: 'flex', emoji: '🍽️' },
  { name: 'Drinks', type: 'flex', emoji: '🧋' },
  { name: 'Entertainment', type: 'flex', emoji: '🎬' },
];

// ---------- Helpers ----------
// All money is stored as integer cents.

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const fmt = (cents) => money.format(cents / 100);
const moneyWhole = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
// Drops ".00" on round amounts so the stats row fits on narrow phones.
const fmtShort = (cents) => (cents % 100 ? fmt(cents) : moneyWhole.format(cents / 100));
const fmtSigned = (cents) => (cents > 0 ? '+' : cents < 0 ? '−' : '') + fmtShort(Math.abs(cents));
const fmtLeft = (cents) => (cents < 0 ? '−' : '') + fmt(Math.abs(cents));

const pad = (n) => String(n).padStart(2, '0');
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayISO = () => isoOf(new Date());
const monthKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;

function addMonths(key, n) {
  const [y, m] = key.split('-').map(Number);
  return monthKey(new Date(y, m - 1 + n, 1));
}

function monthLabel(key) {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function dayLabel(iso) {
  if (iso === todayISO()) return 'Today';
  const yd = new Date();
  yd.setDate(yd.getDate() - 1);
  if (iso === isoOf(yd)) return 'Yesterday';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function parseAmount(str) {
  const n = parseFloat(String(str).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
}

const toInput = (cents) => (cents ? (cents / 100).toFixed(2).replace(/\.00$/, '') : '');

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// ---------- Data ----------

function freshDb() {
  return {
    version: 1,
    budget: 0,
    categories: DEFAULT_CATEGORIES.map((c) => ({ id: uid(), deleted: false, ...c })),
    months: {}, // 'YYYY-MM' -> { budget, fixed: { catId: cents } }
    expenses: [], // { id, date, catId, amount, split, note, createdAt }
    startMonth: monthKey(),
    startCarry: 0, // rollover into startMonth (preserved when old months are pruned)
    rules: {}, // merchant key -> catId, learned from imports
    ignoredImports: [], // importIds of bank charges you chose not to import
    // Savings: a fund's balance is `base` plus its transactions. Old transactions fold into `base` when pruned.
    // `auto` = fixed amount added on the 1st; `target` = flexible amount set aside from leftovers. A fund can have both.
    funds: [], // { id, name, emoji, auto, target, goal, base, created, autoThrough, starred, deleted }
    fundTx: [], // { id, fundId, month, date, amount, kind: 'initial'|'auto'|'deposit'|'adjust' }
  };
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.error('Could not read saved data', e);
  }
  return freshDb();
}

const save = () => localStorage.setItem(STORAGE_KEY, JSON.stringify(db));

let db = load();

const UNKNOWN_CAT = { name: 'Unknown', emoji: '❔', type: 'flex' };
const cat = (id) => db.categories.find((c) => c.id === id) || UNKNOWN_CAT;
const activeCats = (type) => db.categories.filter((c) => c.type === type && !c.deleted);
const counted = (e) => (e.split ? Math.round(e.amount / 2) : e.amount);
const expensesIn = (key) => db.expenses.filter((e) => e.date.startsWith(key));

function newMonth() {
  return {
    budget: db.budget,
    fixed: Object.fromEntries(activeCats('fixed').map((c) => [c.id, c.amount || 0])),
  };
}

// Every month from startMonth to now gets a snapshot of budget + fixed bills.
function ensureMonths() {
  const now = monthKey();
  if (db.startMonth > now) db.startMonth = now;
  for (let k = db.startMonth; k <= now; k = addMonths(k, 1)) {
    if (!db.months[k]) db.months[k] = newMonth();
  }
}

// activeFunds('flex') = funds with a leftover target; activeFunds('fixed') = funds with an automatic amount.
const activeFunds = (kind) =>
  db.funds.filter((f) => !f.deleted && (!kind || (kind === 'flex' ? f.target > 0 : f.auto > 0)));
const fundBalance = (f) => db.fundTx.reduce((sum, t) => (t.fundId === f.id ? sum + t.amount : sum), f.base);
const savingsTargets = () => activeFunds('flex').reduce((sum, f) => sum + f.target, 0);
// Money moved from a month's leftovers into flexible savings when that month was closed out.
const depositsFrom = (key) => db.fundTx.reduce((sum, t) => (t.kind === 'deposit' && t.month === key ? sum + t.amount : sum), 0);

function stats(key) {
  const m = db.months[key] || newMonth();
  const fixed = Object.values(m.fixed).reduce((a, b) => a + b, 0);
  const exps = expensesIn(key);
  const spent = exps.reduce((a, e) => a + counted(e), 0);
  let carry = 0;
  if (key === db.startMonth) carry = db.startCarry;
  else if (key > db.startMonth) {
    const prev = stats(addMonths(key, -1));
    carry = prev.remaining - prev.saved; // what was left after moving money into savings
  }
  const available = m.budget + carry - fixed;
  return { budget: m.budget, fixed, spent, carry, available, remaining: available - spent, saved: depositsFrom(key), exps };
}

// Past months whose leftovers haven't been moved into savings yet, oldest first.
const unclosedMonth = () => Object.keys(db.months).filter((k) => k < monthKey() && !db.months[k].closed).sort()[0];

// Automatic amounts are added on the 1st of each month, starting the month after they're set.
function applyAutoSavings() {
  const now = monthKey();
  for (const f of activeFunds('fixed')) {
    f.autoThrough ||= now;
    for (let k = addMonths(f.autoThrough, 1); k <= now; k = addMonths(k, 1)) {
      db.fundTx.push({ id: uid(), fundId: f.id, month: k, date: `${k}-01`, amount: f.auto, kind: 'auto' });
    }
    if (f.autoThrough < now) f.autoThrough = now;
  }
}

// Older versions had separate fixed and flexible funds and one "show on Home" switch.
// Convert them, and merge funds with the same name into one shared balance.
function migrateFunds() {
  for (const f of db.funds) {
    if (!('type' in f)) continue;
    f.auto = f.type === 'fixed' ? f.monthly : 0;
    f.target = f.type === 'flex' ? f.monthly : 0;
    if (f.target) f.targetSince = f.created;
    f.starred = !!db.showSavingsOnHome;
    delete f.type;
    delete f.monthly;
  }
  delete db.showSavingsOnHome;

  const byName = new Map();
  for (const f of db.funds) {
    if (f.deleted) continue;
    const key = f.name.trim().toLowerCase();
    const keep = byName.get(key);
    if (!keep) {
      byName.set(key, f);
      continue;
    }
    keep.auto += f.auto;
    keep.target += f.target;
    keep.base += f.base;
    keep.goal = Math.max(keep.goal, f.goal);
    keep.starred ||= f.starred;
    if (f.created < keep.created) keep.created = f.created;
    if (f.autoThrough > (keep.autoThrough || '')) keep.autoThrough = f.autoThrough;
    if (f.targetSince && !(keep.targetSince < f.targetSince)) keep.targetSince = f.targetSince;
    db.fundTx.forEach((t) => { if (t.fundId === f.id) t.fundId = keep.id; });
    f.deleted = true;
  }
}

// Drop data older than KEEP_MONTHS, but keep the rollover it produced.
function prune() {
  const cutoff = addMonths(monthKey(), -(KEEP_MONTHS - 1));
  if (db.startMonth >= cutoff) return;
  const carry = stats(cutoff).carry;
  db.expenses = db.expenses.filter((e) => e.date.slice(0, 7) >= cutoff);
  for (const k of Object.keys(db.months)) if (k < cutoff) delete db.months[k];
  db.startMonth = cutoff;
  db.startCarry = carry;
  db.ignoredImports = db.ignoredImports.filter((id) => id.slice(0, 7) >= cutoff); // ids start with the date

  const used = new Set(db.expenses.map((e) => e.catId));
  Object.values(db.months).forEach((m) => Object.keys(m.fixed).forEach((id) => used.add(id)));
  db.categories = db.categories.filter((c) => !c.deleted || used.has(c.id));

  // Balances must outlive the 12-month window, so fold old savings activity into each fund's base.
  for (const t of db.fundTx) {
    const f = t.month < cutoff && db.funds.find((x) => x.id === t.fundId);
    if (f) f.base += t.amount;
  }
  db.fundTx = db.fundTx.filter((t) => t.month >= cutoff);
  db.funds = db.funds.filter((f) => !f.deleted || db.fundTx.some((t) => t.fundId === f.id));
}

function startup() {
  // Fields added after the first release; older saved data won't have them.
  db.rules ||= {};
  db.ignoredImports ||= [];
  delete db.sheet; // left over from the removed Google Sheet sync
  if (!db.funds) {
    db.funds = [];
    db.fundTx = [];
  }
  migrateFunds();
  ensureMonths();
  applyAutoSavings();
  // With no flexible funds there's nothing to close out, so past months close on their own.
  if (!activeFunds('flex').length) Object.keys(db.months).forEach((k) => { if (k < monthKey()) db.months[k].closed = true; });
  prune();
  save();
  if (ui.month < db.startMonth || ui.month > monthKey()) ui.month = monthKey();
}

// ---------- Views ----------

const ui = { view: 'home', month: monthKey() };
const $app = document.getElementById('app');

function render() {
  const views = { home: homeView, savings: savingsView, history: historyView, settings: settingsView };
  $app.innerHTML = (views[ui.view] || homeView)();
  document.querySelectorAll('.tabbar [data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === ui.view));
  document.body.classList.toggle('no-add', ui.view === 'settings' || ui.view === 'savings');
  document.body.classList.toggle('on-home', ui.view === 'home');
}

const stat = (label, value) => `<div class="stat"><b>${value}</b><span>${label}</span></div>`;

function homeView() {
  const key = ui.month;
  const s = stats(key);
  const isCurrent = key === monthKey();
  // This month sets aside your flexible savings targets; past months show what was actually moved.
  const setAside = isCurrent ? savingsTargets() : s.saved;
  const free = s.remaining - setAside;
  const neg = free < 0;
  const base = s.available - setAside;
  const pctLeft = base > 0 ? Math.max(0, Math.min(100, (free / base) * 100)) : 0;

  let sub = '';
  if (s.remaining < 0) {
    sub = `Over budget by ${fmt(-s.remaining)}`;
  } else if (neg) {
    sub = `${fmt(-free)} short of your savings targets`;
  } else if (isCurrent && free > 0) {
    const d = new Date();
    const daysLeft = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate() - d.getDate() + 1;
    sub = `≈ ${fmt(Math.floor(free / daysLeft))} / day · ${daysLeft} day${daysLeft > 1 ? 's' : ''} left`;
  }
  const actual = setAside
    ? `<div class="hero-actual"><b>${fmtLeft(s.remaining)}</b> ${isCurrent ? 'actually left' : 'was left'} · ${fmt(setAside)} ${isCurrent ? 'set aside for savings' : 'moved to savings'}</div>`
    : '';

  const pending = unclosedMonth();
  const setup = !db.budget
    ? `<button class="card setup" data-action="go" data-view="settings">👋 Start by setting your monthly budget and fixed bills <span>›</span></button>`
    : pending ? closeBanner(pending) : '';

  return `
    <header class="month-nav">
      <button class="icon-btn" data-action="month" data-delta="-1" ${key <= db.startMonth ? 'disabled' : ''} aria-label="Previous month">‹</button>
      <h1>${monthLabel(key)}</h1>
      <button class="icon-btn" data-action="month" data-delta="1" ${isCurrent ? 'disabled' : ''} aria-label="Next month">›</button>
    </header>
    ${setup}
    <div class="cols"><div class="col">
    <section class="card hero ${neg ? 'neg' : ''}">
      <div class="hero-label">${isCurrent ? 'Left to spend' : 'Left over'}</div>
      <div class="hero-amount">${fmtLeft(free)}</div>
      ${actual}
      <div class="meter"><span style="width:${pctLeft}%"></span></div>
      ${sub ? `<div class="hero-sub">${sub}</div>` : ''}
    </section>
    <section class="card stats">
      ${stat('Budget', fmtShort(s.budget))}
      ${s.carry ? stat('Rollover', fmtSigned(s.carry)) : ''}
      ${stat('Fixed', fmtShort(s.fixed))}
      ${stat('Spent', fmtShort(s.spent))}
    </section>
    ${homeSavingsCard()}
    ${breakdownCard(s)}
    </div><div class="col">
    ${expensesCard(s)}
    ${fixedCard(key)}
    </div></div>
  `;
}

function breakdownCard(s) {
  const totals = new Map(activeCats('flex').map((c) => [c.id, 0]));
  s.exps.forEach((e) => totals.set(e.catId, (totals.get(e.catId) || 0) + counted(e)));
  const rows = [...totals].sort((a, b) => b[1] - a[1]);
  if (!rows.length) return '';
  const max = Math.max(1, ...rows.map((r) => r[1]));
  return `
    <section class="card">
      <h2>By category</h2>
      ${rows.map(([id, total]) => {
        const c = cat(id);
        const pct = s.spent ? Math.round((total / s.spent) * 100) : 0;
        return `
          <div class="bar-row ${total ? '' : 'zero'}">
            <div class="bar-head"><span><span class="bar-emoji">${c.emoji}</span>${esc(c.name)}</span><span>${fmt(total)} <small>${pct}%</small></span></div>
            <div class="bar"><span style="width:${(total / max) * 100}%"></span></div>
          </div>`;
      }).join('')}
    </section>`;
}

function expensesCard(s) {
  if (!s.exps.length) {
    return `<section class="card"><h2>Expenses</h2><p class="empty">No expenses yet. Tap <b>Add expense</b> to log one.</p></section>`;
  }
  const sorted = [...s.exps].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  let html = '';
  let lastDate = '';
  for (const e of sorted) {
    if (e.date !== lastDate) {
      html += `<div class="day">${dayLabel(e.date)}</div>`;
      lastDate = e.date;
    }
    const c = cat(e.catId);
    html += `
      <button class="row" data-action="edit-expense" data-id="${e.id}">
        <span class="emoji">${c.emoji}</span>
        <span class="row-main">
          <span class="row-title">${esc(c.name)}</span>
          ${e.note ? `<span class="row-sub">${esc(e.note)}</span>` : ''}
        </span>
        <span class="row-amt">${fmt(counted(e))}${e.split ? `<span class="row-sub">½ of ${fmt(e.amount)}</span>` : ''}</span>
      </button>`;
  }
  return `<section class="card"><h2>Expenses <small>${s.exps.length}</small></h2>${html}</section>`;
}

function fixedCard(key) {
  const m = db.months[key];
  const ids = Object.keys(m.fixed);
  if (!ids.length) return '';
  return `
    <section class="card">
      <h2>Fixed bills <small>tap to adjust this month</small></h2>
      ${ids.map((id) => {
        const c = cat(id);
        return `
          <button class="row" data-action="edit-month-fixed" data-id="${id}">
            <span class="emoji">${c.emoji}</span>
            <span class="row-main"><span class="row-title">${esc(c.name)}</span></span>
            <span class="row-amt">${fmt(m.fixed[id])}</span>
          </button>`;
      }).join('')}
    </section>`;
}

function historyView() {
  const rows = [];
  for (let k = monthKey(); k >= db.startMonth; k = addMonths(k, -1)) {
    const s = stats(k);
    const left = s.remaining - (k === monthKey() ? savingsTargets() : s.saved); // matches the Home number
    rows.push(`
      <button class="row" data-action="open-month" data-month="${k}">
        <span class="row-main">
          <span class="row-title">${monthLabel(k)}</span>
          <span class="row-sub">Spent ${fmt(s.spent)} · Fixed ${fmt(s.fixed)}${s.saved ? ` · Saved ${fmt(s.saved)}` : ''}</span>
        </span>
        <span class="row-amt ${left < 0 ? 'neg' : 'pos'}">${fmtLeft(left)}<span class="row-sub">${left < 0 ? 'over' : 'left'}</span></span>
        <span class="chev">›</span>
      </button>`);
  }
  return `
    <header class="page-head"><h1>History</h1><p>The last ${KEEP_MONTHS} months are kept on this device.</p></header>
    <section class="card">${rows.join('')}</section>`;
}

const closeBanner = (key) =>
  `<button class="card setup" data-action="close-month" data-month="${key}">🐷 Close out ${monthLabel(key)}: move leftovers to savings <span>›</span></button>`;

const monthsText = (n) => (n == null ? '—' : `${n} month${n === 1 ? '' : 's'}`);
const monthsToGoal = (toGo, perMonth) => (perMonth > 0 ? Math.ceil(toGo / perMonth) : null);

// Your real monthly pace: the automatic amount plus your average leftover deposits over closed-out
// months since the leftover target was set (up to the last 12). Months where you saved nothing count too.
// Returns null when there's no closed-out month yet to measure.
function actualPace(f) {
  if (!f.target) return f.auto;
  const months = [];
  for (let k = f.targetSince || f.created; k < monthKey(); k = addMonths(k, 1)) {
    if (k >= db.startMonth && db.months[k]?.closed) months.push(k);
  }
  const recent = new Set(months.slice(-12));
  if (!recent.size) return null;
  const deposited = db.fundTx.reduce((sum, t) =>
    t.fundId === f.id && t.kind === 'deposit' && recent.has(t.month) ? sum + t.amount : sum, 0);
  return f.auto + Math.round(deposited / recent.size);
}

function fundCard(f) {
  const bal = fundBalance(f);
  const toGo = f.goal - bal;
  const plan = f.auto + f.target;
  const actual = actualPace(f);
  const tags = [
    f.auto ? `<span class="tag">🔁&nbsp; Automatic ${fmtShort(f.auto)}/mo</span>` : '',
    f.target ? `<span class="tag">🎯&nbsp; From leftovers ${fmtShort(f.target)}/mo</span>` : '',
  ].join('');
  let goal = '';
  if (f.goal) {
    goal = `
      <div class="bar fund-bar"><span style="width:${Math.min(100, (bal / f.goal) * 100)}%"></span></div>
      <div class="fund-goal"><span>Goal ${fmt(f.goal)}</span><span>${toGo > 0 ? `${fmt(toGo)} to go` : 'Goal reached 🎉'}</span></div>`;
    if (toGo > 0) {
      goal += `
        <div class="fund-eta">
          <div><b>${monthsText(monthsToGoal(toGo, plan))}</b><span>plan ${fmtShort(plan)}/mo</span></div>
          <div><b>${actual == null ? '—' : monthsText(monthsToGoal(toGo, actual))}</b><span>${actual == null
            ? 'actual · no history yet'
            : `actual ${fmtShort(actual)}/mo`}</span></div>
        </div>`;
    }
  }
  // A div, not a button, so the star can be its own button inside it.
  return `
    <div class="fund" role="button" tabindex="0" data-action="edit-fund" data-id="${f.id}">
      <div class="fund-top">
        <span class="emoji">${f.emoji}</span>
        <span class="row-main"><span class="row-title">${esc(f.name)}</span></span>
        <span class="fund-bal">${fmt(bal)}</span>
        <button class="star ${f.starred ? 'on' : ''}" data-action="star-fund" data-id="${f.id}"
          aria-pressed="${!!f.starred}" aria-label="${f.starred ? 'Hide from' : 'Show on'} Home">${f.starred ? '★' : '☆'}</button>
      </div>
      ${tags ? `<div class="tags">${tags}</div>` : ''}
      ${goal}
    </div>`;
}

function savingsView() {
  const funds = activeFunds();
  const total = funds.reduce((sum, f) => sum + fundBalance(f), 0);
  const autoTotal = funds.reduce((sum, f) => sum + f.auto, 0);
  const pending = unclosedMonth();
  return `
    <header class="page-head">
      <h1>Savings</h1>
      <p><b>${fmt(total)}</b> saved · ${fmtShort(autoTotal)}/mo automatic · ${fmtShort(savingsTargets())}/mo from leftovers</p>
    </header>
    ${pending ? closeBanner(pending) : ''}
    <section class="card">
      <h2>Your funds <small>tap ☆ to show on Home</small></h2>
      ${funds.map(fundCard).join('') || `<p class="empty">Add funds like an emergency fund, travel or stocks. Each can get an automatic amount, a target from your leftovers, or both.</p>`}
      <button class="add-row" data-action="new-fund">+ Add savings fund</button>
    </section>`;
}

function homeSavingsCard() {
  const funds = activeFunds().filter((f) => f.starred);
  if (!funds.length) return '';
  const total = funds.reduce((sum, f) => sum + fundBalance(f), 0);
  return `
    <section class="card">
      <h2>Savings <small>${fmt(total)}</small></h2>
      ${funds.map((f) => {
        const bal = fundBalance(f);
        return `
          <button class="row" data-action="go" data-view="savings">
            <span class="emoji">${f.emoji}</span>
            <span class="row-main">
              <span class="row-title">${esc(f.name)}</span>
              ${f.goal ? `<span class="bar mini-bar"><span style="width:${Math.min(100, (bal / f.goal) * 100)}%"></span></span>` : ''}
            </span>
            <span class="row-amt">${fmt(bal)}${f.goal ? `<span class="row-sub">of ${fmtShort(f.goal)}</span>` : ''}</span>
          </button>`;
      }).join('')}
    </section>`;
}

function settingsView() {
  const row = (c) => `
    <button class="row" data-action="edit-cat" data-id="${c.id}">
      <span class="emoji">${c.emoji}</span>
      <span class="row-main"><span class="row-title">${esc(c.name)}</span></span>
      ${c.type === 'fixed' ? `<span class="row-amt">${fmt(c.amount || 0)}</span>` : ''}
      <span class="chev">›</span>
    </button>`;
  return `
    <header class="page-head"><h1>Settings</h1></header>
    <section class="card">
      <h2>Monthly budget</h2>
      <div class="money-field"><span>$</span><input id="budget" inputmode="decimal" placeholder="0.00" value="${toInput(db.budget)}" autocomplete="off"></div>
      <p class="hint">Your total for the month, including fixed bills. Changes apply to this month and every month after.</p>
    </section>
    <section class="card">
      <h2>Import from Chase</h2>
      <p class="hint" style="margin:0 0 4px">On chase.com, open your card, choose <b>Download account activity</b> and pick the <b>CSV</b> file type. Then tap below and select the file. Charges you've already imported are skipped automatically.</p>
      <button class="primary" data-action="import-chase">Import from Chase</button>
    </section>
    <section class="card">
      <h2>Fixed expenses <small>auto-applied monthly</small></h2>
      ${activeCats('fixed').map(row).join('')}
      <button class="add-row" data-action="new-cat" data-type="fixed">+ Add fixed expense</button>
    </section>
    <section class="card">
      <h2>Flexible categories</h2>
      ${activeCats('flex').map(row).join('')}
      <button class="add-row" data-action="new-cat" data-type="flex">+ Add category</button>
    </section>
    <section class="card">
      <h2>Data</h2>
      <p class="hint">Everything is stored only on this device. Expenses older than ${KEEP_MONTHS} months are deleted automatically.</p>
      <button class="danger-btn" data-action="reset">Erase all data</button>
    </section>`;
}

// ---------- Bottom sheet ----------

const $sheet = document.getElementById('sheet');
const $sheetBody = document.getElementById('sheet-body');

function openSheet(html, focusId) {
  $sheetBody.innerHTML = html;
  $sheet.classList.add('open');
  $sheet.setAttribute('aria-hidden', 'false');
  // Must run synchronously inside the tap handler so iOS opens the keyboard.
  if (focusId) document.getElementById(focusId)?.focus();
}

function closeSheet() {
  document.activeElement?.blur();
  $sheet.classList.remove('open');
  $sheet.setAttribute('aria-hidden', 'true');
}

function defaultExpenseDate() {
  if (ui.month === monthKey()) return todayISO();
  const [y, m] = ui.month.split('-').map(Number);
  return isoOf(new Date(y, m, 0)); // last day of the month being viewed
}

function expenseSheet(e) {
  let cats = activeCats('flex');
  if (e && !cats.some((c) => c.id === e.catId)) cats = [...cats, cat(e.catId)];
  if (!cats.length) {
    openSheet(`<h2>Add expense</h2><p class="empty">You have no flexible categories. Add one in Settings first.</p>`);
    return;
  }
  openSheet(`
    <h2>${e ? 'Edit expense' : 'Add expense'}</h2>
    <div class="money-field big"><span>$</span><input id="exp-amt" inputmode="decimal" placeholder="0.00" value="${e ? toInput(e.amount) : ''}" autocomplete="off"></div>
    <div class="chips">
      ${cats.map((c) => `<button type="button" class="chip ${e && c.id === e.catId ? 'on' : ''}" data-action="pick-cat" data-id="${c.id}">${c.emoji} ${esc(c.name)}</button>`).join('')}
    </div>
    <label class="switch-row">
      <span><b>Split 50/50</b><span class="hint" id="split-hint">Only your half counts</span></span>
      <input type="checkbox" id="exp-split" ${e && e.split ? 'checked' : ''}>
      <span class="switch"></span>
    </label>
    <input id="exp-note" class="text" placeholder="Note (optional)" maxlength="80" value="${e ? esc(e.note || '') : ''}">
    <input id="exp-date" class="text" type="date" value="${e ? e.date : defaultExpenseDate()}" min="${db.startMonth}-01" max="${todayISO()}">
    <button class="primary" id="exp-save" data-action="save-expense" data-id="${e ? e.id : ''}" disabled>${e ? 'Save' : 'Add'}</button>
    ${e ? `<button class="danger-btn" data-action="delete-expense" data-id="${e.id}">Delete expense</button>` : ''}
  `, e ? null : 'exp-amt');
  updateExpenseForm();
}

function updateExpenseForm() {
  const btn = document.getElementById('exp-save');
  if (!btn) return;
  const amount = parseAmount(document.getElementById('exp-amt').value);
  const split = document.getElementById('exp-split').checked;
  const picked = $sheetBody.querySelector('.chip.on');
  const verb = btn.dataset.id ? 'Save' : 'Add';
  const track = split ? Math.round(amount / 2) : amount;
  btn.disabled = !amount || !picked;
  btn.textContent = amount ? `${verb} ${fmt(track)}` : verb;
  document.getElementById('split-hint').textContent =
    split && amount ? `You'll track ${fmt(track)} of ${fmt(amount)}` : 'Only your half counts';
}

function catSheet(c, type) {
  type = c ? c.type : type;
  const label = type === 'fixed' ? 'fixed expense' : 'category';
  openSheet(`
    <h2>${c ? 'Edit' : 'New'} ${label}</h2>
    <div class="field-row">
      <input id="cat-emoji" class="text emoji-input" maxlength="8" aria-label="Emoji" value="${c ? c.emoji : type === 'fixed' ? '📄' : '🏷️'}">
      <input id="cat-name" class="text" placeholder="Name (e.g. ${type === 'fixed' ? 'Gym membership' : 'Fitness'})" maxlength="30" value="${c ? esc(c.name) : ''}">
    </div>
    ${type === 'fixed' ? `
      <div class="money-field"><span>$</span><input id="cat-amt" inputmode="decimal" placeholder="Monthly amount" value="${c ? toInput(c.amount) : ''}" autocomplete="off"></div>
      <p class="hint">Applies to this month and every month after.</p>` : ''}
    <button class="primary" data-action="save-cat" data-id="${c ? c.id : ''}" data-type="${type}">Save</button>
    ${c ? `<button class="danger-btn" data-action="delete-cat" data-id="${c.id}">Delete ${label}</button>` : ''}
  `, c ? null : 'cat-name');
}

function monthFixedSheet(id) {
  const c = cat(id);
  const amt = db.months[ui.month].fixed[id];
  openSheet(`
    <h2>${c.emoji} ${esc(c.name)} · ${monthLabel(ui.month)}</h2>
    <div class="money-field big"><span>$</span><input id="mf-amt" inputmode="decimal" placeholder="0.00" value="${toInput(amt)}" autocomplete="off"></div>
    <p class="hint">Only changes ${monthLabel(ui.month)}. To change it for every month, edit it in Settings.</p>
    <button class="primary" data-action="save-month-fixed" data-id="${id}">Save</button>
  `, 'mf-amt');
}

function fundSheet(f) {
  const moneyInput = (id, value, placeholder = '0.00') =>
    `<div class="money-field"><span>$</span><input id="${id}" inputmode="decimal" placeholder="${placeholder}" value="${toInput(value)}" autocomplete="off"></div>`;
  openSheet(`
    <h2>${f ? 'Edit' : 'New'} savings fund</h2>
    <div class="field-row">
      <input id="fund-emoji" class="text emoji-input" maxlength="8" aria-label="Emoji" value="${f ? f.emoji : '💰'}">
      <input id="fund-name" class="text" placeholder="Name (e.g. Stocks)" maxlength="30" value="${f ? esc(f.name) : ''}">
    </div>
    <label class="lbl">🔁 Automatic each month <small>fixed · optional</small></label>
    ${moneyInput('fund-auto', f?.auto)}
    <p class="hint">Added to the balance on the 1st of each month, starting next month. Doesn't change your Left to spend.</p>
    <label class="lbl">🎯 From leftovers each month <small>flexible target · optional</small></label>
    ${moneyInput('fund-target', f?.target)}
    <p class="hint">Set aside from your Left to spend. At the end of the month you confirm how much you actually moved.</p>
    <label class="lbl">Savings goal <small>optional</small></label>
    ${moneyInput('fund-goal', f?.goal, 'e.g. 1500')}
    <label class="lbl">${f ? 'Current balance' : 'Starting balance'}</label>
    ${moneyInput('fund-balance', f ? fundBalance(f) : 0)}
    <button class="primary" data-action="save-fund" data-id="${f ? f.id : ''}">Save</button>
    ${f ? `<button class="danger-btn" data-action="delete-fund" data-id="${f.id}">Delete fund</button>` : ''}
  `, f ? null : 'fund-name');
}

let closingMonth = null;

function closeMonthSheet(key) {
  closingMonth = key;
  const s = stats(key);
  const next = monthLabel(addMonths(key, 1));
  // Pre-fill each fund with its target, in list order, until the leftovers run out.
  let left = Math.max(0, s.remaining);
  const rows = activeFunds('flex').map((f) => {
    const value = Math.min(f.target, left);
    left -= value;
    return `
      <label class="close-row">
        <span class="emoji">${f.emoji}</span>
        <span class="row-main"><span class="row-title">${esc(f.name)}</span><span class="row-sub">Target ${fmt(f.target)}</span></span>
        <span class="money-field small"><span>$</span><input data-close-fund="${f.id}" inputmode="decimal" placeholder="0" value="${toInput(value)}" autocomplete="off"></span>
      </label>`;
  });
  openSheet(`
    <h2>Close out ${monthLabel(key)}</h2>
    <p class="hint">${s.remaining >= 0
      ? `You had <b>${fmt(s.remaining)}</b> left. How much did you move into each fund?`
      : `You went over by <b>${fmt(-s.remaining)}</b>, so there's nothing to save. The overspend carries into ${next}.`}</p>
    <div class="close-list">${rows.join('')}</div>
    <div class="sheet-footer">
      <p class="close-remain" id="close-remain"></p>
      <button class="primary" id="close-save" data-action="confirm-close">Confirm</button>
      <button class="text-btn" data-action="close">Later</button>
    </div>
  `);
  updateCloseForm();
}

function updateCloseForm() {
  const remain = document.getElementById('close-remain');
  if (!remain) return;
  const total = [...$sheetBody.querySelectorAll('[data-close-fund]')].reduce((sum, el) => sum + parseAmount(el.value), 0);
  const left = stats(closingMonth).remaining - total;
  remain.textContent = `${fmtLeft(left)} ${left < 0 ? 'overspend carries' : 'rolls'} into ${monthLabel(addMonths(closingMonth, 1))}`;
  remain.classList.toggle('neg', left < 0);
  document.getElementById('close-save').textContent = total ? `Move ${fmt(total)} to savings` : 'Confirm · nothing saved';
}

// ---------- Chase import ----------
// Reads the CSV from chase.com: credit card (Transaction Date, Description, Category, Type, Amount)
// or checking (Posting Date, Description, Amount, Type). Purchases are negative amounts.

const CHASE_CATEGORY_MAP = {
  'food & drink': 'dining',
  groceries: 'grocery',
  entertainment: 'entertainment',
  'health & wellness': 'fitness',
};
const DRINK_WORDS = /\b(starbucks|coffee|boba|tea|peet'?s|dunkin|philz|blue bottle|dutch bros|gong cha|kung fu tea|tiger sugar|sharetea|chatime)\b/i;
const BILL_CATEGORIES = new Set(['bills & utilities']);
const PROCESSOR_PREFIX = /^(tst|sq|sp|dd|py|pp|ic|bt)\s*\*\s*/i; // "TST* SUSHI PLACE" -> "SUSHI PLACE"

function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  text = text.replace(/^\uFEFF/, ''); // byte-order mark some exports start with
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch !== '"') field += ch;
      else if (text[i + 1] === '"') { field += '"'; i++; }
      else quoted = false;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((f) => f.trim()));
}

function csvDateToISO(s) {
  const us = s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (us) return `${us[3].length === 2 ? '20' + us[3] : us[3]}-${pad(us[1])}-${pad(us[2])}`;
  const iso = s.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;
}

function readChaseCSV(text) {
  const [header, ...lines] = parseCSV(text);
  if (!header) return null;
  const h = header.map((x) => x.trim().toLowerCase());
  const col = (...names) => names.map((n) => h.indexOf(n)).find((i) => i >= 0) ?? -1;
  const iDate = col('transaction date', 'posting date', 'post date');
  const iDesc = col('description');
  const iAmt = col('amount');
  if (iDate < 0 || iDesc < 0 || iAmt < 0) return null;
  const iCat = col('category');
  const iType = col('type');
  const get = (r, i) => (i >= 0 ? (r[i] || '').trim() : '');
  return lines
    .map((r) => ({
      date: csvDateToISO(get(r, iDate)),
      desc: get(r, iDesc),
      amount: Math.round(parseFloat(get(r, iAmt).replace(/[$,\s]/g, '')) * 100),
      chaseCat: get(r, iCat),
      type: get(r, iType).toLowerCase(),
      isCard: iCat >= 0,
    }))
    .filter((t) => t.date && t.desc && Number.isFinite(t.amount) && t.amount !== 0);
}

// Short, stable key for a merchant so "STARBUCKS STORE 123" and "STARBUCKS STORE 456" match.
const merchantKey = (desc) =>
  desc.toLowerCase().replace(PROCESSOR_PREFIX, '').replace(/[^a-z&]+/g, ' ').trim().split(' ').slice(0, 2).join(' ');

const prettyMerchant = (desc) =>
  desc.replace(PROCESSOR_PREFIX, '').replace(/#?\d{3,}/g, '').replace(/\s+/g, ' ').trim()
    .toLowerCase().replace(/(^|\s)[a-z]/g, (c) => c.toUpperCase()).slice(0, 40);

function suggestCategory(t) {
  const flex = activeCats('flex');
  const byName = (name) => flex.find((c) => c.name.toLowerCase() === name)?.id || null;
  const learned = db.rules[merchantKey(t.desc)];
  if (learned && flex.some((c) => c.id === learned)) return learned;
  if (DRINK_WORDS.test(t.desc) && byName('drinks')) return byName('drinks');
  return byName(CHASE_CATEGORY_MAP[t.chaseCat.toLowerCase()]);
}

const daysApart = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) / 864e5;

// Every charge in the file becomes an item. Ones with a `skip` reason go in the collapsed
// "Skipped" section; `locked` ones can't be re-added (it would double-count or fall outside history).
function buildImport(txns) {
  const minDate = `${db.startMonth}-01`;
  const imported = new Set(db.expenses.map((e) => e.importId).filter(Boolean));
  const ignored = new Set(db.ignoredImports);
  const manual = db.expenses.filter((e) => !e.importId);
  const matched = new Set();
  const occurrences = {};
  const items = [];

  for (const t of txns) {
    // Two identical charges on the same day get different ids.
    const base = `${t.date}|${t.desc}|${t.amount}`;
    occurrences[base] = (occurrences[base] || 0) + 1;
    const importId = `${base}|${occurrences[base]}`;
    const amount = -t.amount; // positive = spending, negative = refund
    const item = { importId, date: t.date, desc: t.desc, note: prettyMerchant(t.desc), amount,
      chaseCat: t.chaseCat, catId: suggestCategory(t), split: false, warn: '', skip: '', locked: false, include: false };

    if (imported.has(importId)) Object.assign(item, { skip: 'Already imported', locked: true });
    else if (t.date < minDate) Object.assign(item, { skip: 'Before your history starts', locked: true });
    // Card returns are normal refunds; payments and checking deposits need a deliberate opt-in.
    else if (t.amount > 0 && !(t.isCard && t.type === 'return')) item.skip = 'Payment or deposit · would count as a refund';
    else if (ignored.has(importId)) item.skip = 'You unchecked this in an earlier import';
    if (item.skip) {
      items.push(item);
      continue;
    }

    const twin = manual.find((e) => !matched.has(e.id) && Math.abs(e.amount) === Math.abs(amount) && daysApart(e.date, t.date) <= 2);
    if (twin) {
      matched.add(twin.id);
      item.warn = 'Looks like one you already entered';
    } else if (BILL_CATEGORIES.has(t.chaseCat.toLowerCase())) {
      item.warn = 'Looks like a fixed bill';
    }
    item.include = !item.warn && !!item.catId;
    items.push(item);
  }
  items.sort((a, b) => b.date.localeCompare(a.date));
  return items;
}

let pendingImport = null;

function importRow(it, i, flex) {
  return `
    <div class="imp ${it.include ? '' : 'off'}" data-i="${i}">
      <input type="checkbox" class="imp-check" data-imp="include" ${it.include ? 'checked' : ''} ${it.locked ? 'disabled' : ''} aria-label="Import this charge">
      <div class="imp-main">
        <div class="imp-top"><span class="row-title">${esc(it.note)}</span><span class="row-amt">${fmtLeft(it.amount)}</span></div>
        <div class="row-sub">${dayLabel(it.date)}${it.chaseCat ? ` · ${esc(it.chaseCat)}` : ''}${it.amount < 0 && !it.skip ? ' · Refund' : ''}</div>
        ${it.warn ? `<div class="imp-warn">⚠️ ${it.warn}</div>` : ''}
        ${it.skip ? `<div class="imp-reason">${it.skip}</div>` : ''}
        ${it.locked ? '' : `
          <div class="imp-ctrls">
            <select data-imp="cat" class="${it.catId ? '' : 'empty'}" aria-label="Category">
              <option value="">Choose category…</option>
              ${flex.map((c) => `<option value="${c.id}" ${c.id === it.catId ? 'selected' : ''}>${c.emoji} ${esc(c.name)}</option>`).join('')}
            </select>
            <label class="imp-split"><input type="checkbox" data-imp="split"> Split ½</label>
          </div>`}
      </div>
    </div>`;
}

function importSheet(items) {
  pendingImport = items;
  if (!items.length) {
    openSheet(`
      <h2>No charges found</h2>
      <p class="hint">This file doesn't have any transactions in it.</p>
      <button class="primary" data-action="close">OK</button>`);
    return;
  }
  const flex = activeCats('flex');
  const rows = (skipped) => items.map((it, i) => (!!it.skip === skipped ? importRow(it, i, flex) : '')).join('');
  const newCount = items.filter((it) => !it.skip).length;
  const skipCount = items.length - newCount;
  openSheet(`
    <h2>${newCount ? `Review ${newCount} charge${newCount > 1 ? 's' : ''}` : 'Nothing new to import'}</h2>
    <p class="hint">${newCount
      ? 'Checked charges will be added. Unchecked ones will appear under Skipped next time.'
      : 'Everything in this file was skipped. Open the list below to add any of them anyway.'}</p>
    <div class="imp-list">${rows(false)}</div>
    ${skipCount ? `
      <details class="imp-skipped" ${newCount ? '' : 'open'}>
        <summary>Skipped (${skipCount})</summary>
        <p class="hint">Tick a charge to add it anyway. Greyed-out ones can't be added again.</p>
        <div class="imp-list">${rows(true)}</div>
      </details>` : ''}
    <div class="sheet-footer">
      <button class="primary" id="imp-save" data-action="do-import"></button>
      <button class="text-btn" data-action="close">Cancel</button>
    </div>
  `);
  updateImportButton();
}

function updateImportButton() {
  const btn = document.getElementById('imp-save');
  if (!btn) return;
  const ready = pendingImport.filter((it) => it.include && it.catId);
  const missing = pendingImport.filter((it) => it.include && !it.catId).length;
  const total = ready.reduce((sum, it) => sum + counted(it), 0);
  pendingImport.forEach((it, i) => {
    $sheetBody.querySelector(`.imp[data-i="${i}"] select`)?.classList.toggle('need', it.include && !it.catId);
  });
  btn.disabled = !ready.length || missing > 0;
  if (missing) btn.textContent = `Choose a category for ${missing} checked charge${missing > 1 ? 's' : ''}`;
  else btn.textContent = ready.length ? `Import ${ready.length} · ${fmtLeft(total)}` : 'Nothing selected';
}

function onImportField(el) {
  const row = el.closest('.imp');
  const it = pendingImport[row.dataset.i];
  if (el.dataset.imp === 'include') it.include = el.checked;
  if (el.dataset.imp === 'split') it.split = el.checked;
  if (el.dataset.imp === 'cat') {
    it.catId = el.value || null;
    el.classList.toggle('empty', !it.catId);
    if (it.catId) row.querySelector('[data-imp=include]').checked = it.include = true;
  }
  row.classList.toggle('off', !it.include);
  updateImportButton();
}

document.getElementById('chase-file').addEventListener('change', async (ev) => {
  const file = ev.target.files[0];
  ev.target.value = ''; // so picking the same file again still fires
  if (!file) return;
  const txns = readChaseCSV(await file.text());
  if (!txns) {
    openSheet(`
      <h2>Couldn't read that file</h2>
      <p class="hint">Make sure it's the CSV download from chase.com, not a PDF statement.</p>
      <button class="primary" data-action="close">OK</button>`);
    return;
  }
  importSheet(buildImport(txns));
});

// ---------- Actions ----------

let toastTimer;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
}

function commit(msg) {
  save();
  closeSheet();
  render();
  if (msg) toast(msg);
}

const val = (id) => document.getElementById(id).value;

const actions = {
  go(el) {
    ui.view = el.dataset.view;
    if (ui.view === 'home') ui.month = monthKey();
    render();
    window.scrollTo(0, 0);
  },
  month(el) {
    ui.month = addMonths(ui.month, Number(el.dataset.delta));
    render();
  },
  'open-month'(el) {
    ui.month = el.dataset.month;
    ui.view = 'home';
    render();
    window.scrollTo(0, 0);
  },
  close: closeSheet,
  add: () => expenseSheet(null),
  'edit-expense': (el) => expenseSheet(db.expenses.find((e) => e.id === el.dataset.id)),
  'pick-cat'(el) {
    $sheetBody.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c === el));
    updateExpenseForm();
  },
  'save-expense'(el) {
    const date = val('exp-date') || todayISO();
    const data = {
      date,
      catId: $sheetBody.querySelector('.chip.on').dataset.id,
      amount: parseAmount(val('exp-amt')),
      split: document.getElementById('exp-split').checked,
      note: val('exp-note').trim(),
    };
    if (!data.amount) return;
    const existing = db.expenses.find((e) => e.id === el.dataset.id);
    if (existing && existing.amount < 0) data.amount = -data.amount; // keep imported refunds negative
    if (existing) Object.assign(existing, data);
    else db.expenses.push({ id: uid(), createdAt: Date.now(), ...data });
    const where = date.slice(0, 7) === ui.month ? '' : ` in ${monthLabel(date.slice(0, 7))}`;
    commit(`${existing ? 'Saved' : 'Added'} ${fmt(counted(data))} · ${cat(data.catId).name}${where}`);
  },
  'delete-expense'(el) {
    if (!confirm('Delete this expense?')) return;
    db.expenses = db.expenses.filter((e) => e.id !== el.dataset.id);
    commit('Expense deleted');
  },
  'edit-month-fixed': (el) => monthFixedSheet(el.dataset.id),
  'save-month-fixed'(el) {
    db.months[ui.month].fixed[el.dataset.id] = parseAmount(val('mf-amt'));
    commit('Updated for this month');
  },
  'new-cat': (el) => catSheet(null, el.dataset.type),
  'edit-cat': (el) => catSheet(cat(el.dataset.id)),
  'save-cat'(el) {
    const name = val('cat-name').trim();
    if (!name) return document.getElementById('cat-name').focus();
    const emoji = val('cat-emoji').trim() || (el.dataset.type === 'fixed' ? '📄' : '🏷️');
    let c = db.categories.find((x) => x.id === el.dataset.id);
    if (!c) {
      c = { id: uid(), type: el.dataset.type, deleted: false };
      db.categories.push(c);
    }
    Object.assign(c, { name, emoji });
    if (c.type === 'fixed') {
      c.amount = parseAmount(val('cat-amt'));
      db.months[monthKey()].fixed[c.id] = c.amount;
    }
    commit(`${name} saved`);
  },
  'delete-cat'(el) {
    const c = cat(el.dataset.id);
    const msg = c.type === 'fixed'
      ? `Delete "${c.name}"? It will stop counting from this month on. Past months are unchanged.`
      : `Delete "${c.name}"? Past expenses in this category stay in your history.`;
    if (!confirm(msg)) return;
    c.deleted = true;
    delete db.months[monthKey()].fixed[c.id];
    commit(`${c.name} deleted`);
  },
  'new-fund': () => fundSheet(null),
  'edit-fund': (el) => fundSheet(db.funds.find((f) => f.id === el.dataset.id)),
  'star-fund'(el) {
    const f = db.funds.find((x) => x.id === el.dataset.id);
    f.starred = !f.starred;
    save();
    render();
    toast(f.starred ? `${f.name} will show on Home` : `${f.name} hidden from Home`);
  },
  'save-fund'(el) {
    const name = val('fund-name').trim();
    if (!name) return document.getElementById('fund-name').focus();
    // Same name means same money: point to the existing fund instead of making a second one.
    const twin = activeFunds().find((x) => x.id !== el.dataset.id && x.name.trim().toLowerCase() === name.toLowerCase());
    if (twin) return toast(`"${twin.name}" already exists. Edit it instead.`);
    let f = db.funds.find((x) => x.id === el.dataset.id);
    const isNew = !f;
    if (isNew) {
      f = { id: uid(), base: 0, auto: 0, target: 0, created: monthKey(), starred: false, deleted: false };
      db.funds.push(f);
    }
    const auto = parseAmount(val('fund-auto'));
    const target = parseAmount(val('fund-target'));
    if (auto && !f.auto) f.autoThrough = monthKey(); // first automatic deposit is next month
    if (target && !f.target) f.targetSince = monthKey(); // actual pace is measured from here
    Object.assign(f, {
      name, auto, target,
      emoji: val('fund-emoji').trim() || '💰',
      goal: parseAmount(val('fund-goal')),
    });
    // Record a new starting balance, or a correction you typed in, as its own transaction.
    const diff = parseAmount(val('fund-balance')) - fundBalance(f);
    if (diff) db.fundTx.push({ id: uid(), fundId: f.id, month: monthKey(), date: todayISO(), amount: diff, kind: isNew ? 'initial' : 'adjust' });
    commit(`${name} saved`);
  },
  'delete-fund'(el) {
    const f = db.funds.find((x) => x.id === el.dataset.id);
    if (!confirm(`Delete "${f.name}"? Its ${fmt(fundBalance(f))} balance is removed from your savings. Past months aren't changed.`)) return;
    f.deleted = true;
    commit(`${f.name} deleted`);
  },
  'close-month': (el) => closeMonthSheet(el.dataset.month),
  'confirm-close'() {
    const key = closingMonth;
    let total = 0;
    $sheetBody.querySelectorAll('[data-close-fund]').forEach((input) => {
      const amount = parseAmount(input.value);
      if (!amount) return;
      total += amount;
      db.fundTx.push({ id: uid(), fundId: input.dataset.closeFund, month: key, date: `${addMonths(key, 1)}-01`, amount, kind: 'deposit' });
    });
    db.months[key].closed = true;
    commit(total ? `Moved ${fmt(total)} to savings` : `${monthLabel(key)} closed out`);
    const next = unclosedMonth();
    if (next) closeMonthSheet(next);
  },
  'import-chase': () => document.getElementById('chase-file').click(),
  'do-import'() {
    const ready = pendingImport.filter((it) => it.include && it.catId);
    for (const it of pendingImport) {
      if (it.include && it.catId) db.rules[merchantKey(it.desc)] = it.catId;
      else if (!it.skip) db.ignoredImports.push(it.importId);
    }
    const added = new Set(ready.map((it) => it.importId));
    db.ignoredImports = db.ignoredImports.filter((id) => !added.has(id));
    ready.forEach((it, n) => db.expenses.push({
      id: uid(), createdAt: Date.now() + n, importId: it.importId,
      date: it.date, catId: it.catId, amount: it.amount, split: it.split, note: it.note,
    }));
    pendingImport = null;
    commit(`Imported ${ready.length} expense${ready.length > 1 ? 's' : ''}`);
  },
  reset() {
    if (!confirm('Erase all expenses, categories and settings? This cannot be undone.')) return;
    db = freshDb();
    startup();
    ui.view = 'home';
    commit('All data erased');
  },
};

document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-action]');
  if (el && !el.disabled && actions[el.dataset.action]) actions[el.dataset.action](el);
});

function onFieldChange(ev) {
  if (!ev.target.closest('#sheet-body')) return;
  updateExpenseForm();
  updateCloseForm();
}
document.addEventListener('input', onFieldChange);
document.addEventListener('change', (ev) => {
  onFieldChange(ev);
  if (ev.target.dataset.imp) onImportField(ev.target);
  if (ev.target.id === 'budget') {
    db.budget = parseAmount(ev.target.value);
    db.months[monthKey()].budget = db.budget;
    save();
    toast('Budget saved');
  }
});

// Enter key in the sheet submits it.
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') closeSheet();
  if (ev.key !== 'Enter' || !ev.target.closest('#sheet-body')) return;
  const primary = $sheetBody.querySelector('.primary');
  if (primary && !primary.disabled) {
    ev.preventDefault();
    primary.click();
  }
});

// Keep the bottom sheet above the on-screen keyboard.
if (window.visualViewport) {
  const vv = window.visualViewport;
  const sync = () => {
    const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    document.documentElement.style.setProperty('--kb', `${kb}px`);
    document.documentElement.style.setProperty('--vvh', `${vv.height}px`);
  };
  vv.addEventListener('resize', sync);
  vv.addEventListener('scroll', sync);
  sync();
}

// Ask once per month-end to move leftovers into savings. "Later" leaves a banner on Home instead.
let promptedFor = null;
function promptCloseOut() {
  const pending = unclosedMonth();
  if (pending && pending !== promptedFor && !$sheet.classList.contains('open')) {
    promptedFor = pending;
    closeMonthSheet(pending);
  }
}

// A new month may have started while the app sat in the background.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !$sheet.classList.contains('open')) {
    startup();
    render();
    promptCloseOut();
  }
});

// ---------- Boot ----------

startup();
render();
promptCloseOut();

// Offline caching is skipped on localhost so local previews always show your latest edits.
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js');
}
navigator.storage?.persist?.();
