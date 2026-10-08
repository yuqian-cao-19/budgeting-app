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

function stats(key) {
  const m = db.months[key] || newMonth();
  const fixed = Object.values(m.fixed).reduce((a, b) => a + b, 0);
  const exps = expensesIn(key);
  const spent = exps.reduce((a, e) => a + counted(e), 0);
  let carry = 0;
  if (key === db.startMonth) carry = db.startCarry;
  else if (key > db.startMonth) carry = stats(addMonths(key, -1)).remaining;
  const available = m.budget + carry - fixed;
  return { budget: m.budget, fixed, spent, carry, available, remaining: available - spent, exps };
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

  const used = new Set(db.expenses.map((e) => e.catId));
  Object.values(db.months).forEach((m) => Object.keys(m.fixed).forEach((id) => used.add(id)));
  db.categories = db.categories.filter((c) => !c.deleted || used.has(c.id));
}

function startup() {
  ensureMonths();
  prune();
  save();
  if (ui.month < db.startMonth || ui.month > monthKey()) ui.month = monthKey();
}

// ---------- Views ----------

const ui = { view: 'home', month: monthKey() };
const $app = document.getElementById('app');

function render() {
  $app.innerHTML = ui.view === 'history' ? historyView() : ui.view === 'settings' ? settingsView() : homeView();
  document.querySelectorAll('.tabbar [data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === ui.view));
  document.body.classList.toggle('on-settings', ui.view === 'settings');
  document.body.classList.toggle('on-home', ui.view === 'home');
}

const stat = (label, value) => `<div class="stat"><b>${value}</b><span>${label}</span></div>`;

function homeView() {
  const key = ui.month;
  const s = stats(key);
  const isCurrent = key === monthKey();
  const neg = s.remaining < 0;
  const pctLeft = s.available > 0 ? Math.max(0, Math.min(100, (s.remaining / s.available) * 100)) : 0;

  let sub = '';
  if (neg) {
    sub = `Over budget by ${fmt(-s.remaining)}`;
  } else if (isCurrent && s.remaining > 0) {
    const d = new Date();
    const daysLeft = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate() - d.getDate() + 1;
    sub = `≈ ${fmt(Math.floor(s.remaining / daysLeft))} / day · ${daysLeft} day${daysLeft > 1 ? 's' : ''} left`;
  }

  const setup = !db.budget
    ? `<button class="card setup" data-action="go" data-view="settings">👋 Start by setting your monthly budget and fixed bills <span>›</span></button>`
    : '';

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
      <div class="hero-amount">${fmtLeft(s.remaining)}</div>
      <div class="meter"><span style="width:${pctLeft}%"></span></div>
      ${sub ? `<div class="hero-sub">${sub}</div>` : ''}
    </section>
    <section class="card stats">
      ${stat('Budget', fmtShort(s.budget))}
      ${s.carry ? stat('Rollover', fmtSigned(s.carry)) : ''}
      ${stat('Fixed', fmtShort(s.fixed))}
      ${stat('Spent', fmtShort(s.spent))}
    </section>
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
    rows.push(`
      <button class="row" data-action="open-month" data-month="${k}">
        <span class="row-main">
          <span class="row-title">${monthLabel(k)}</span>
          <span class="row-sub">Spent ${fmt(s.spent)} · Fixed ${fmt(s.fixed)}</span>
        </span>
        <span class="row-amt ${s.remaining < 0 ? 'neg' : 'pos'}">${fmtLeft(s.remaining)}<span class="row-sub">${s.remaining < 0 ? 'over' : 'left'}</span></span>
        <span class="chev">›</span>
      </button>`);
  }
  return `
    <header class="page-head"><h1>History</h1><p>The last ${KEEP_MONTHS} months are kept on this device.</p></header>
    <section class="card">${rows.join('')}</section>`;
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
  if (ev.target.closest('#sheet-body')) updateExpenseForm();
}
document.addEventListener('input', onFieldChange);
document.addEventListener('change', (ev) => {
  onFieldChange(ev);
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

// A new month may have started while the app sat in the background.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !$sheet.classList.contains('open')) {
    startup();
    render();
  }
});

// ---------- Boot ----------

startup();
render();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js');
}
navigator.storage?.persist?.();
