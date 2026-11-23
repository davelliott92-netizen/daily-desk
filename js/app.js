// Daily Desk — screens and interactions.
// Each screen is a function that returns HTML. Buttons carry
// data-action="…" and are handled in one place at the bottom.
import * as store from './store.js';
import { COLUMNS, PRIORITIES, CATEGORY_COLOURS, firebaseConfig } from './config.js';
import { parseQuick } from './parse.js';
import { today, addDays, friendly, diffDays, ymd, parseYmd } from './dates.js';
import { startSync } from './sync.js';

const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const S = () => store.get().settings;
const APP_VERSION = '1.5.3';

// ── Per-device view preferences (not synced) ─────────────────
const UI_KEY = 'dailydesk.ui';
const ui = Object.assign(
  { filter: 'all', boardCol: 'next', habitRange: 28, mustsExpanded: false, suggExpanded: false },
  (() => { try { return JSON.parse(localStorage.getItem(UI_KEY)) || {}; } catch { return {}; } })()
);
function setUi(patch) {
  Object.assign(ui, patch);
  try { localStorage.setItem(UI_KEY, JSON.stringify(ui)); } catch { /* ignore */ }
  render();
}

let syncApi = null;
let syncStatus = { state: 'off' };
let calendar = { state: 'idle', events: [], errors: [] };

// ── Icons (inline SVG, inherit text colour) ──────────────────
const svg = (d, extra = '') => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${d}</svg>`;
const ICON = {
  tick: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>', 'stroke-width="2.6"'),
  moon: svg('<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>'),
  sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>', 'stroke-width="2"'),
  star: svg('<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z"/>'),
  x: svg('<path d="M6 6l12 12M18 6L6 18"/>')
};

// ── Helpers ──────────────────────────────────────────────────
const PRIO_RANK = { must: 0, should: 1, could: 2 };
const prioLabel = (p) => PRIORITIES.find((x) => x.id === p)?.label || '';
const colLabel = (c) => COLUMNS.find((x) => x.id === c)?.label || c;
const catOf = (id) => S().categories.find((c) => c.id === id);
const dot = (color) => `<span class="dot" style="background:var(--cat-${esc(color || 'grey')})"></span>`;

function workHiddenNow() {
  const s = S();
  if (!s.hideWorkOutsideHours) return false;
  const now = new Date();
  const h = now.getHours() + now.getMinutes() / 60;
  const inHours = s.workHours.days.includes(now.getDay()) && h >= s.workHours.start && h < s.workHours.end;
  return !inHours;
}

function visibleTasks({ ignoreFilter = false } = {}) {
  const hideWork = workHiddenNow();
  return Object.values(store.get().tasks).filter((t) =>
    !t.deleted &&
    !(hideWork && t.category === 'work') &&
    (ignoreFilter || ui.filter === 'all' || t.category === ui.filter)
  );
}

const byPriority = (a, b) =>
  (PRIO_RANK[a.priority] ?? 3) - (PRIO_RANK[b.priority] ?? 3) ||
  (a.due || '9999').localeCompare(b.due || '9999') ||
  a.createdAt - b.createdAt;

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), 2200);
}

// ── Shared pieces ────────────────────────────────────────────
function filterChips() {
  const items = [{ id: 'all', name: 'All' }, ...S().categories];
  const hideWork = workHiddenNow();
  return `<div class="chips scroll-x" role="group" aria-label="Filter by category">${items
    .filter((c) => !(hideWork && c.id === 'work'))
    .map((c) => `<button type="button" class="chip ${ui.filter === c.id ? 'on' : ''}" data-action="filter" data-id="${esc(c.id)}" aria-pressed="${ui.filter === c.id}">${c.id !== 'all' ? dot(c.color) : ''}${esc(c.name)}</button>`)
    .join('')}</div>`;
}

const prioTag = (p) => (p ? `<span class="prio prio-${p}">${prioLabel(p)}</span>` : '');

function taskRow(t, { showDue = true } = {}) {
  const c = catOf(t.category);
  const done = t.column === 'done';
  const meta = [c?.name, showDue && t.due ? friendly(t.due) : null, t.column === 'doing' ? 'Doing' : null].filter(Boolean).join(' · ');
  return `<div class="row ${done ? 'is-done' : ''}">
    <button type="button" class="check ${done ? 'on' : ''}" data-action="toggle-done" data-id="${t.id}" aria-label="${done ? 'Mark not done' : 'Mark done'}: ${esc(t.title)}">${done ? ICON.tick : ''}</button>
    <button type="button" class="row-main" data-action="edit" data-id="${t.id}">
      <span class="row-title">${esc(t.title)}</span>
      ${meta ? `<span class="row-meta">${c ? dot(c.color) : ''}${esc(meta)}</span>` : ''}
    </button>
    ${done ? '' : prioTag(t.priority)}
  </div>`;
}

function habitChips(habits, date = today()) {
  return habits.map((h) => {
    const on = store.habitDone(date, h.id);
    return `<button type="button" class="habit ${on ? 'on' : ''}" data-action="habit" data-habit="${esc(h.id)}" aria-pressed="${on}">${esc(h.name)}</button>`;
  }).join('');
}

function calendarStrip() {
  if (!S().calendar.url) return '';
  if (calendar.state === 'error') return `<button type="button" class="cal cal-fix" data-action="go" data-id="settings">Calendar not checked today — tap to fix</button>`;
  if (calendar.state !== 'ok') return '';
  const events = calendar.events;
  const warn = calendar.errors.map((e) => `<button type="button" class="cal-warn" data-action="go" data-id="settings">${esc(e.calendar)} calendar not checked — tap to fix</button>`).join('');
  return `<div class="cal">
    <span class="label">Today's calendar</span>
    ${events.length
      ? `<ul class="cal-list">${events.map((e) => `<li><span class="cal-time">${e.allDay ? 'All day' : esc(e.start)}</span><span>${esc(e.title)}</span>${e.calendar ? `<span class="cal-src">${esc(e.calendar)}</span>` : ''}</li>`).join('')}</ul>`
      : '<span class="muted">Nothing in the calendar today.</span>'}
    ${warn}
  </div>`;
}

function openSuggestions() {
  const now = Date.now();
  return Object.values(store.get().suggestions)
    .filter((x) => !x.deleted && !x.status && now - (x.createdAt || 0) < 3 * 864e5)
    .sort((a, b) => (b.score || 0) - (a.score || 0) || (a.createdAt || 0) - (b.createdAt || 0));
}

function suggestionTray({ collapsed = false } = {}) {
  const list = openSuggestions();
  if (!list.length) return '';
  if (collapsed && !ui.suggExpanded) {
    return `<button type="button" class="sugg-collapsed" data-action="sugg-expand">${list.length} suggestion${list.length > 1 ? 's' : ''} from your inbox & calendar</button>`;
  }
  const shown = ui.suggExpanded ? list : list.slice(0, 5);
  return `<section class="sugg" aria-label="Suggested tasks">
    <div class="section-head"><span class="label">Suggested</span><span class="count">${list.length}</span></div>
    ${shown.map((x) => {
      const c = catOf(x.category);
      const meta = [c?.name, x.priority ? prioLabel(x.priority) : null, x.due ? friendly(x.due) : null].filter(Boolean).join(' · ');
      return `<div class="sugg-item">
        <div class="sugg-text">
          <span class="row-title">${esc(x.title)}</span>
          ${x.reason ? `<span class="sugg-reason">${esc(x.reason)}</span>` : ''}
          ${meta ? `<span class="row-meta">${c ? dot(c.color) : ''}${esc(meta)}${x.source ? ` · ${esc(x.source)}` : ''}</span>` : ''}
        </div>
        <div class="sugg-actions">
          <button type="button" class="btn small primary" data-action="sugg-accept" data-id="${esc(x.id)}">Add</button>
          <button type="button" class="btn small ghost" data-action="sugg-dismiss" data-id="${esc(x.id)}">Dismiss</button>
        </div>
      </div>`;
    }).join('')}
    ${list.length > 5 && !ui.suggExpanded ? `<button type="button" class="more" data-action="sugg-expand">+${list.length - 5} more, lower confidence</button>` : ''}
  </section>`;
}

// ── TODAY ────────────────────────────────────────────────────
function viewToday() {
  const s = S();
  if (s.busyMode) return viewBusy();
  const t = today();
  const tasks = visibleTasks();
  const open = tasks.filter((x) => x.column !== 'done');
  const todays = open.filter((x) => x.due === t || (x.column === 'doing' && !(x.due && x.due > t))).sort(byPriority);
  const doneToday = tasks.filter((x) => x.column === 'done' && x.doneAt && ymd(new Date(x.doneAt)) === t);
  const carried = open.filter((x) => x.due && x.due < t && x.column !== 'doing').sort((a, b) => a.due.localeCompare(b.due));
  const upcoming = open.filter((x) => x.due && x.due > t && diffDays(x.due, t) <= 7).sort((a, b) => a.due.localeCompare(b.due) || byPriority(a, b));
  const habitsDone = s.habits.filter((h) => store.habitDone(t, h.id)).length;
  const now = new Date();

  return `
  <header class="head">
    <div>
      <div class="eyebrow">${now.toLocaleDateString('en-GB', { weekday: 'long' })}</div>
      <h1>${now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}</h1>
    </div>
    <div class="head-actions">
      <button type="button" class="icon-btn" data-action="theme" aria-label="Switch day or night">${effectiveTheme() === 'night' ? ICON.sun : ICON.moon}</button>
      <button type="button" class="btn" data-action="busy-on">Busy</button>
    </div>
  </header>
  ${calendarStrip()}
  ${suggestionTray()}
  ${filterChips()}
  <section aria-label="Habits">
    <div class="section-head"><span class="label">Habits</span><span class="count">${habitsDone} / ${s.habits.length}</span></div>
    <div class="habits">${habitChips(s.habits)}</div>
  </section>
  <section class="list" aria-label="Today">
    <div class="section-head line"><span class="label">Today</span><span class="count">${doneToday.length} / ${todays.length + doneToday.length}</span></div>
    ${todays.length || doneToday.length
      ? todays.map((x) => taskRow(x, { showDue: false })).join('') + doneToday.map((x) => taskRow(x, { showDue: false })).join('')
      : '<p class="empty">Nothing set for today. Add something below — or enjoy the space.</p>'}
  </section>
  ${carried.length ? `<section aria-label="Carried over">
    <div class="section-head"><span class="label">Carried over</span><span class="count">${carried.length}</span></div>
    ${carried.map((x) => `<div class="carried">
      <button type="button" class="carried-title" data-action="edit" data-id="${x.id}">${esc(x.title)}<span class="row-meta">from ${esc(friendly(x.due))}</span></button>
      <button type="button" class="btn small tint" data-action="carry-today" data-id="${x.id}">Today</button>
      <button type="button" class="btn small ghost" data-action="let-go" data-id="${x.id}">Let go</button>
    </div>`).join('')}
  </section>` : ''}
  ${upcoming.length ? `<section aria-label="Coming up">
    <div class="section-head"><span class="label">Coming up</span></div>
    ${upcoming.map((x) => `<button type="button" class="upcoming" data-action="edit" data-id="${x.id}"><span>${esc(x.title)}</span><span class="muted">${esc(friendly(x.due))}</span></button>`).join('')}
  </section>` : ''}`;
}

// ── BUSY MODE ────────────────────────────────────────────────
function viewBusy() {
  const s = S();
  const open = visibleTasks({ ignoreFilter: true }).filter((x) => x.column !== 'done');
  const musts = open.filter((x) => x.priority === 'must')
    .sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999') || a.createdAt - b.createdAt);
  const limit = s.busyMustCount || 3;
  const shown = ui.mustsExpanded ? musts : musts.slice(0, limit);
  const core = s.habits.filter((h) => h.core);
  const parked = open.length - shown.length;

  return `
  <div class="busy-banner">
    <span>Busy mode · ${parked} thing${parked === 1 ? '' : 's'} parked safely</span>
    <button type="button" class="btn small" data-action="busy-off">Turn off</button>
  </div>
  <header class="busy-head">
    <h1>Just these.</h1>
    <p class="muted">Your Musts, soonest first. Everything else can wait.</p>
  </header>
  <section class="list" aria-label="Musts">
    ${shown.length ? shown.map((x) => taskRow(x)).join('') : '<p class="empty">No Musts right now. Breathe.</p>'}
    ${musts.length > limit ? `<button type="button" class="more" data-action="musts-toggle">${ui.mustsExpanded ? 'Show fewer' : `+${musts.length - limit} more`}</button>` : ''}
  </section>
  ${core.length ? `<section aria-label="Core habits">
    <div class="section-head"><span class="label">Habits</span></div>
    <div class="habits">${habitChips(core)}</div>
  </section>` : ''}
  ${suggestionTray({ collapsed: true })}
  <form class="dump" data-form="dump" autocomplete="off">
    <label class="sr-only" for="dump-input">Brain-dump</label>
    <input id="dump-input" name="q" placeholder="Brain-dump — sort it out later" enterkeyhint="done">
    <button type="submit" class="capture-add" aria-label="Add to Ideas">${ICON.plus}</button>
  </form>`;
}

// ── BOARD ────────────────────────────────────────────────────
function viewBoard() {
  const s = S();
  const cols = COLUMNS.filter((c) => c.id !== 'ideas' || s.showIdeas);
  if (!cols.some((c) => c.id === ui.boardCol)) ui.boardCol = 'next';
  const tasks = visibleTasks();
  const inCol = (id) => {
    const list = tasks.filter((t) => t.column === id);
    return id === 'done' ? list.sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0)).slice(0, 40) : list.sort(byPriority);
  };
  const hiddenIdeas = s.showIdeas ? 0 : tasks.filter((t) => t.column === 'ideas').length;

  const card = (t) => {
    const c = catOf(t.category);
    return `<button type="button" class="card ${t.column === 'done' ? 'is-done' : ''}" draggable="true" data-drag="${t.id}" data-action="edit" data-id="${t.id}">
      <span class="card-title">${esc(t.title)}</span>
      <span class="card-meta">${c ? `${dot(c.color)}<span class="grow">${esc(c.name)}</span>` : '<span class="grow"></span>'}${t.column !== 'done' && t.due ? `<span>${esc(friendly(t.due))}</span>` : ''}${t.column !== 'done' ? prioTag(t.priority) : ''}</span>
    </button>`;
  };

  return `
  <header class="head">
    <h1>Board</h1>
    <label class="switch-label">Show Ideas <input type="checkbox" class="switch" data-change="show-ideas" ${s.showIdeas ? 'checked' : ''}></label>
  </header>
  ${filterChips()}
  <div class="seg board-tabs" role="tablist" aria-label="Columns" style="--n:${cols.length}">
    ${cols.map((c) => `<button type="button" role="tab" class="${ui.boardCol === c.id ? 'on' : ''}" aria-selected="${ui.boardCol === c.id}" data-action="board-col" data-id="${c.id}">${esc(c.label)} <span class="count">${tasks.filter((t) => t.column === c.id).length}</span></button>`).join('')}
  </div>
  ${hiddenIdeas ? `<p class="muted small">${hiddenIdeas} idea${hiddenIdeas === 1 ? '' : 's'} resting out of sight. They're not late — they're just ideas.</p>` : ''}
  <div class="board" style="--n:${cols.length}">
    ${cols.map((c) => {
      const list = inCol(c.id);
      return `<section class="col ${ui.boardCol === c.id ? 'active' : ''}" data-col="${c.id}" aria-label="${esc(c.label)}">
        <div class="col-head"><span class="label">${esc(c.label)}</span><span class="count">${tasks.filter((t) => t.column === c.id).length}</span></div>
        ${list.length ? list.map(card).join('') : '<p class="empty small">Nothing here.</p>'}
      </section>`;
    }).join('')}
  </div>
  <p class="muted small hint">Tap a card to edit or move it. On iPad and Mac you can drag cards between columns.</p>`;
}

// ── HABITS ───────────────────────────────────────────────────
function viewHabits() {
  const s = S();
  const range = ui.habitRange;
  const t = today();
  const days = Array.from({ length: range }, (_, i) => addDays(t, i - range + 1));
  const cols = range === 28 ? 14 : range === 91 ? 13 : 28;
  return `
  <header class="head"><div>
    <h1>Habits</h1>
    <p class="muted">No streaks, no scores — just what happened. Tap a square to fix a day you forgot.</p>
  </div></header>
  <div class="seg" role="tablist" aria-label="Range" style="--n:3">
    ${[[28, '4 weeks'], [91, '3 months'], [364, 'Year']].map(([n, l]) => `<button type="button" role="tab" class="${range === n ? 'on' : ''}" aria-selected="${range === n}" data-action="range" data-id="${n}">${l}</button>`).join('')}
  </div>
  ${s.habits.map((h) => {
    const count = days.filter((d) => store.habitDone(d, h.id)).length;
    return `<section class="habit-card">
      <div class="section-head"><span class="habit-name">${esc(h.name)}</span><span class="muted small">${count} of ${range} days</span></div>
      <div class="grid" style="--cols:${cols}">
        ${days.map((d) => {
          const on = store.habitDone(d, h.id);
          return `<button type="button" class="cell ${on ? 'on' : ''} ${d === t ? 'today' : ''}" data-action="habit" data-habit="${esc(h.id)}" data-date="${d}" aria-pressed="${on}" aria-label="${esc(h.name)}, ${parseYmd(d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}"></button>`;
        }).join('')}
      </div>
    </section>`;
  }).join('')}
  <div class="legend"><span><i class="cell on"></i>Done</span><span><i class="cell"></i>Not ticked — that's fine</span></div>`;
}

// ── SETTINGS ─────────────────────────────────────────────────
function syncSection() {
  const st = syncStatus;
  if (st.state === 'off') return `<p class="muted">Sync isn't set up yet, so everything is saved on this device only. Follow step 2 in README.md, then come back here to sign in.</p>`;
  if (st.state === 'loading') return '<p class="muted">Connecting…</p>';
  if (st.state === 'unavailable') return `<p class="muted">${esc(st.error)}</p>`;
  if (st.state === 'signed-out') return `
    <form class="stack" data-form="signin" autocomplete="on">
      <label class="field"><span class="label">Email</span><input type="email" name="email" autocomplete="username" required></label>
      <label class="field"><span class="label">Password</span><input type="password" name="password" autocomplete="current-password" minlength="6" required></label>
      <div class="btn-row">
        <button type="submit" class="btn primary" name="mode" value="in">Sign in</button>
        <button type="submit" class="btn" name="mode" value="up">Create account</button>
        <button type="submit" class="btn ghost" name="mode" value="reset" formnovalidate>Forgot password</button>
      </div>
      <p class="muted small">Use the same email and password on your iPhone, iPad and Mac.</p>
    </form>`;
  const line = st.state === 'error' ? `Problem syncing: ${esc(st.error)}`
    : st.offline ? 'Offline — changes are saved and will sync when you reconnect.'
    : st.pending ? 'Saving to the cloud…' : 'Synced';
  return `<div class="sync-ok"><span>${ICON.tick}</span><div><div>${line}</div><div class="muted small">${esc(st.email || '')}</div></div>
    <button type="button" class="btn small ghost" data-action="sign-out">Sign out</button></div>`;
}

function viewSettings() {
  const s = S();
  const toggle = (label, hint, key, on) => `<label class="toggle-row"><span><span class="toggle-title">${label}</span><span class="muted small">${hint}</span></span><input type="checkbox" class="switch" data-change="${key}" ${on ? 'checked' : ''}></label>`;
  const atCap = s.habits.length >= s.habitCap;
  return `
  <header class="head"><h1>Settings</h1></header>

  <section class="settings-block">
    <div class="label">Appearance</div>
    <div class="seg" role="radiogroup" aria-label="Appearance" style="--n:3">
      ${[['auto', 'Auto'], ['day', 'Day'], ['night', 'Night']].map(([v, l]) => `<button type="button" role="radio" aria-checked="${s.appearance === v}" class="${s.appearance === v ? 'on' : ''}" data-action="appearance" data-id="${v}">${l}</button>`).join('')}
    </div>
    <p class="muted small">Auto follows your iPhone / Mac setting.</p>
  </section>

  <section class="settings-block card-list">
    ${toggle('Busy mode', `Top ${s.busyMustCount} Musts (soonest first) + core habits`, 'busy', s.busyMode)}
    ${toggle('Show Ideas on Board', 'Off = focus on things to action', 'show-ideas', s.showIdeas)}
    ${toggle('Hide Work outside work hours', `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].filter((_, i) => s.workHours.days.includes(i)).join(', ')} ${s.workHours.start}:00–${s.workHours.end}:00`, 'hide-work', s.hideWorkOutsideHours)}
    <div class="inline-fields">
      <label>Work starts <input type="number" min="0" max="23" value="${s.workHours.start}" data-change="work-start"></label>
      <label>ends <input type="number" min="1" max="24" value="${s.workHours.end}" data-change="work-end"></label>
    </div>
  </section>

  <section class="settings-block">
    <div class="section-head"><span class="label">Habits</span><span class="count">${s.habits.length} / max ${s.habitCap}</span></div>
    <p class="muted small">Star = core habit (shown in Busy mode).</p>
    <div class="edit-list">
      ${s.habits.map((h, i) => `<div class="edit-row">
        <button type="button" class="icon-btn small ${h.core ? 'starred' : ''}" data-action="habit-core" data-id="${i}" aria-pressed="${!!h.core}" aria-label="Core habit: ${esc(h.name)}">${ICON.star}</button>
        <input value="${esc(h.name)}" data-change="habit-name" data-id="${i}" aria-label="Habit name">
        <button type="button" class="icon-btn small" data-action="habit-remove" data-id="${i}" aria-label="Remove ${esc(h.name)}">${ICON.x}</button>
      </div>`).join('')}
    </div>
    <div class="btn-row">
      <button type="button" class="btn" data-action="habit-add" ${atCap ? 'disabled' : ''}>+ Add habit</button>
      <label class="inline">Max <input type="number" min="1" max="12" value="${s.habitCap}" data-change="habit-cap"></label>
    </div>
  </section>

  <section class="settings-block">
    <div class="label">Categories</div>
    <div class="edit-list">
      ${s.categories.map((c, i) => `<div class="edit-row">
        <button type="button" class="swatch-btn" data-action="cat-color" data-id="${i}" aria-label="Change colour of ${esc(c.name)}">${dot(c.color)}</button>
        <input value="${esc(c.name)}" data-change="cat-name" data-id="${i}" aria-label="Category name">
        <button type="button" class="icon-btn small" data-action="cat-remove" data-id="${i}" aria-label="Remove ${esc(c.name)}">${ICON.x}</button>
      </div>`).join('')}
    </div>
    <button type="button" class="btn" data-action="cat-add">+ Add category</button>
  </section>

  <section class="settings-block">
    <div class="label">Sync</div>
    ${syncSection()}
  </section>

  <section class="settings-block">
    <div class="label">Suggestions</div>
    <p class="muted small">Each morning Claude checks your personal Gmail and suggests up to 5 tasks. Write rules in plain English — one per line — to steer it.</p>
    <label class="field"><span class="label">Your rules</span>
      <textarea rows="4" data-change="sugg-rules" placeholder="e.g. Ignore Amazon dispatch emails&#10;Anything from school is at least a Should">${esc(s.suggestionRules)}</textarea></label>
    ${learned.length ? `<div class="label">Learned from what you dismiss</div>
      <div class="edit-list">${learned.map((r, i) => `<div class="edit-row"><span class="grow learned">${esc(r)}</span><button type="button" class="icon-btn small" data-action="learned-remove" data-id="${i}" aria-label="Forget this rule">${ICON.x}</button></div>`).join('')}</div>` : ''}
    <p class="muted small">${suggState.error ? `Last fetch failed: ${esc(suggState.error)}` : suggState.checkedAt ? `Last collected ${new Date(suggState.checkedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}.` : 'Needs the helper below.'}</p>
  </section>

  <section class="settings-block">
    <div class="label">Suggestions helper</div>
    <p class="muted small">Your helper's address and password (see worker/README.md).</p>
    <label class="field"><span class="label">Helper address</span><input type="url" value="${esc(s.calendar.url)}" data-change="cal-url" placeholder="https://…workers.dev"></label>
    <label class="field"><span class="label">Helper password</span><input type="password" value="${esc(s.calendar.token)}" data-change="cal-token" autocomplete="off"></label>
    ${s.calendar.url ? `<button type="button" class="btn" data-action="cal-refresh">Check now</button>
      <p class="muted small">${calendar.state === 'off' ? 'Connected. (No calendars set up — that\'s fine.)' : calendar.state === 'ok' ? `Last checked ${new Date(calendar.checkedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}.` : calendar.state === 'error' ? `Last check failed: ${esc(calendar.error)}` : ''}</p>` : ''}
  </section>

  <section class="settings-block">
    <div class="label">Backup</div>
    <div class="btn-row">
      <button type="button" class="btn" data-action="export">Export backup</button>
      <label class="btn">Import backup<input type="file" accept="application/json,.json" data-change="import" class="sr-only"></label>
    </div>
    <p class="muted small">A monthly export saved to iCloud Drive is a good safety net.</p>
  </section>
  <p class="muted small version">Daily Desk ${APP_VERSION}</p>`;
}

// ── EDIT SHEET ───────────────────────────────────────────────
function openSheet(id, preset = {}) {
  const s = S();
  const t = id ? store.get().tasks[id] : { title: '', notes: '', category: null, priority: null, due: null, column: 'next', ...preset };
  if (!t) return;
  const radio = (name, value, label, checked, extra = '') =>
    `<label class="opt"><input type="radio" name="${name}" value="${esc(value)}" ${checked ? 'checked' : ''}><span>${extra}${esc(label)}</span></label>`;
  const sheet = $('#sheet');
  sheet.innerHTML = `<form class="sheet-body" data-form="sheet" data-id="${id || ''}" autocomplete="off">
    <div class="grabber" aria-hidden="true"></div>
    <label class="field"><span class="label">${id ? 'Task' : 'New task'}</span>
      <input name="title" required value="${esc(t.title)}" placeholder="What needs doing?" class="big"></label>
    <fieldset class="field"><legend class="label">Category</legend>
      <div class="opts wrap">${radio('category', '', 'None', !t.category)}${s.categories.map((c) => radio('category', c.id, c.name, t.category === c.id, dot(c.color))).join('')}</div>
    </fieldset>
    <fieldset class="field"><legend class="label">Priority</legend>
      <div class="opts seg-like" style="--n:4">${radio('priority', '', 'None', !t.priority)}${PRIORITIES.map((p) => radio('priority', p.id, p.label, t.priority === p.id)).join('')}</div>
    </fieldset>
    <div class="field"><label class="label" for="sheet-due">Due</label>
      <div class="due-row">
        <input type="date" id="sheet-due" name="due" value="${t.due || ''}">
        <button type="button" class="btn small" data-due="0">Today</button>
        <button type="button" class="btn small" data-due="1">Tomorrow</button>
        <button type="button" class="btn small ghost" data-due="">Clear</button>
      </div>
    </div>
    <fieldset class="field"><legend class="label">Column</legend>
      <div class="opts seg-like" style="--n:4">${COLUMNS.map((c) => radio('column', c.id, c.label, t.column === c.id)).join('')}</div>
    </fieldset>
    <label class="field"><span class="label">Notes</span><textarea name="notes" rows="3">${esc(t.notes)}</textarea></label>
    <div class="sheet-actions">
      ${id ? `<button type="button" class="btn ghost" data-action="sheet-delete" data-id="${id}">Delete</button>` : ''}
      <span class="grow"></span>
      <button type="button" class="btn" data-action="sheet-close">Cancel</button>
      <button type="submit" class="btn primary">Save</button>
    </div>
  </form>`;
  sheet.showModal();
  if (!id) setTimeout(() => sheet.querySelector('input[name=title]').focus(), 50);
}

function saveSheet(form) {
  const fd = new FormData(form);
  const fields = {
    title: String(fd.get('title') || '').trim(),
    notes: String(fd.get('notes') || ''),
    category: fd.get('category') || null,
    priority: fd.get('priority') || null,
    due: fd.get('due') || null,
    column: fd.get('column') || 'next'
  };
  if (!fields.title) return;
  const id = form.dataset.id;
  if (id) store.updateTask(id, fields);
  else store.addTask(fields);
  $('#sheet').close();
}

// ── Capture bar ──────────────────────────────────────────────
function capturePreview() {
  const input = $('#capture-input');
  const box = $('#capture-preview');
  const q = input.value.trim();
  if (!q) { box.innerHTML = ''; return; }
  const p = parseQuick(q, S().categories);
  const c = catOf(p.category);
  const bits = [
    c ? `<span class="pchip">${dot(c.color)}${esc(c.name)}</span>` : '',
    p.due ? `<span class="pchip">${esc(friendly(p.due))}</span>` : '',
    p.priority ? `<span class="pchip">${prioLabel(p.priority)}</span>` : ''
  ].join('');
  box.innerHTML = bits ? `<span class="muted small">Understood as</span>${bits}` : '';
}

function addFromCapture(text) {
  const p = parseQuick(text, S().categories);
  if (!p.title) return;
  const onToday = currentView() === 'today';
  const column = p.category === 'ideas' ? 'ideas' : 'next';
  if (onToday && !p.due && column !== 'ideas') p.due = today();
  store.addTask({ ...p, column });
  toast(p.due === today() ? 'Added to Today' : p.due ? `Added for ${friendly(p.due)}` : `Added to ${colLabel(column)}`);
}

// ── Calendar helper ──────────────────────────────────────────
async function loadCalendar(force = false) {
  const { url, token } = S().calendar;
  if (!url) { calendar = { state: 'idle', events: [], errors: [] }; return; }
  const key = 'dailydesk.cal';
  if (!force) {
    try {
      const c = JSON.parse(sessionStorage.getItem(key));
      if (c && c.date === today() && Date.now() - c.checkedAt < 10 * 60 * 1000) { calendar = c; render(); return; }
    } catch { /* ignore */ }
  }
  calendar = { ...calendar, state: 'loading' };
  render();
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/?days=1`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(res.status === 401 ? 'wrong helper password' : `helper replied ${res.status}`);
    const data = await res.json();
    if (data.configured === false) {
      calendar = { state: 'off', date: today(), checkedAt: Date.now(), events: [], errors: [] };
      try { sessionStorage.setItem(key, JSON.stringify(calendar)); } catch { /* ignore */ }
      render();
      return;
    }
    const day = (data.days || [])[0] || { events: [] };
    calendar = { state: 'ok', date: today(), checkedAt: Date.now(), events: day.events || [], errors: data.errors || [] };
    try { sessionStorage.setItem(key, JSON.stringify(calendar)); } catch { /* ignore */ }
  } catch (e) {
    calendar = { state: 'error', events: [], errors: [], error: e.message || 'could not reach the helper' };
  }
  render();
}

// ── Suggestions (via the helper) ─────────────────────────────
// The 6:30am Claude check posts suggestions to the helper; the app
// collects them here. The app also shares a small "context" (open task
// titles, what you accepted/dismissed, your rules) so the check can
// avoid duplicates and learn what you don't want.
let learned = [];
let suggState = {};
const helperBase = () => S().calendar.url.replace(/\/$/, '');
const helperHeaders = (json) => ({ Authorization: `Bearer ${S().calendar.token}`, ...(json ? { 'Content-Type': 'application/json' } : {}) });

async function loadSuggestions() {
  if (!S().calendar.url) return;
  try {
    const res = await fetch(`${helperBase()}/suggestions`, { headers: helperHeaders() });
    if (!res.ok) throw new Error(res.status === 401 ? 'wrong helper password' : `helper replied ${res.status}`);
    const data = await res.json();
    const removed = new Set(S().learnedRulesRemoved || []);
    learned = (data.learned || []).filter((r) => !removed.has(r));
    suggState = { checkedAt: Date.now() };
    store.addSuggestions(data.suggestions || []);
  } catch (e) {
    suggState = { error: e.message || 'could not reach the helper' };
  }
  if (currentView() === 'settings') render();
}

function buildContext() {
  const st = store.get();
  const tasks = Object.values(st.tasks).filter((t) => !t.deleted);
  const cutoff = Date.now() - 30 * 864e5;
  const sugg = Object.values(st.suggestions).filter((x) => x.status && (x.updatedAt || 0) > cutoff);
  return {
    updatedAt: new Date().toISOString(),
    categories: S().categories.map((c) => ({ id: c.id, name: c.name })),
    openTasks: tasks.filter((t) => t.column !== 'done').slice(-150).map((t) => ({ title: t.title, category: t.category, due: t.due, priority: t.priority })),
    recentlyDone: tasks.filter((t) => t.column === 'done' && (t.doneAt || 0) > Date.now() - 14 * 864e5).map((t) => t.title),
    accepted: sugg.filter((x) => x.status === 'accepted').map((x) => ({ title: x.title, source: x.source, reason: x.reason })),
    dismissed: sugg.filter((x) => x.status === 'dismissed').map((x) => ({ title: x.title, source: x.source, reason: x.reason })),
    rules: S().suggestionRules || '',
    removedLearnedRules: S().learnedRulesRemoved || []
  };
}

let contextTimer = null;
let lastContext = '';
function scheduleContextPush() {
  if (!S().calendar.url) return;
  clearTimeout(contextTimer);
  contextTimer = setTimeout(async () => {
    const body = JSON.stringify(buildContext());
    const sig = body.replace(/"updatedAt":"[^"]*",/, '');
    if (sig === lastContext) return;
    try {
      const res = await fetch(`${helperBase()}/context`, { method: 'PUT', headers: helperHeaders(true), body });
      if (res.ok) lastContext = sig;
    } catch { /* try again on the next change */ }
  }, 4000);
}

// ── Theme ────────────────────────────────────────────────────
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
function effectiveTheme() {
  const a = S().appearance;
  return a === 'auto' ? (darkQuery.matches ? 'night' : 'day') : a;
}
function applyTheme() {
  document.documentElement.dataset.theme = S().appearance;
  const color = effectiveTheme() === 'night' ? '#121212' : '#F5F2EC';
  document.querySelectorAll('meta[name=theme-color]').forEach((m) => m.setAttribute('content', color));
}
darkQuery.addEventListener?.('change', () => render());

// ── Render ───────────────────────────────────────────────────
const VIEWS = { today: viewToday, board: viewBoard, habits: viewHabits, settings: viewSettings };
function currentView() {
  const v = location.hash.slice(1);
  return VIEWS[v] ? v : 'today';
}

function render() {
  applyTheme();
  const v = currentView();
  const main = $('#view');
  const scroll = window.scrollY;
  main.innerHTML = VIEWS[v]();
  main.className = `view view-${v}`;
  window.scrollTo(0, scroll);
  document.querySelectorAll('.nav a').forEach((a) => {
    const on = a.dataset.view === v;
    a.classList.toggle('on', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  const showCapture = (v === 'today' && !S().busyMode) || v === 'board';
  $('#capture').hidden = !showCapture;
  document.body.classList.toggle('has-capture', showCapture);
}

// ── Events ───────────────────────────────────────────────────
document.addEventListener('click', (e) => {
  const dueBtn = e.target.closest('[data-due]');
  if (dueBtn) {
    const input = $('#sheet-due');
    input.value = dueBtn.dataset.due === '' ? '' : addDays(today(), Number(dueBtn.dataset.due));
    return;
  }
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const { action, id } = el.dataset;
  const s = S();
  const tasks = store.get().tasks;

  switch (action) {
    case 'filter': setUi({ filter: id }); break;
    case 'toggle-done': {
      const wasDone = tasks[id]?.column === 'done';
      store.toggleDone(id);
      if (!wasDone) toast('Done');
      break;
    }
    case 'edit': if (!dragging) openSheet(id); break;
    case 'habit': store.toggleHabit(el.dataset.date || today(), el.dataset.habit); break;
    case 'theme': store.updateSettings({ appearance: effectiveTheme() === 'night' ? 'day' : 'night' }); break;
    case 'busy-on': store.updateSettings({ busyMode: true }); window.scrollTo(0, 0); break;
    case 'busy-off': store.updateSettings({ busyMode: false }); break;
    case 'musts-toggle': setUi({ mustsExpanded: !ui.mustsExpanded }); break;
    case 'carry-today': store.updateTask(id, { due: today() }); break;
    case 'let-go': store.updateTask(id, { due: null }); toast('Kept on the Board, no date'); break;
    case 'board-col': setUi({ boardCol: id }); break;
    case 'range': setUi({ habitRange: Number(id) }); break;
    case 'go': location.hash = id; break;
    case 'appearance': store.updateSettings({ appearance: id }); break;
    case 'sugg-expand': setUi({ suggExpanded: true }); break;
    case 'sugg-accept': {
      const x = store.get().suggestions[id];
      if (!x) break;
      store.addTask({ title: x.title, category: x.category || null, priority: x.priority || null, due: x.due || null, column: x.column || 'next', notes: [x.reason, x.source].filter(Boolean).join(' — ') });
      store.updateSuggestion(id, { status: 'accepted' });
      toast('Added');
      break;
    }
    case 'sugg-dismiss': store.updateSuggestion(id, { status: 'dismissed' }); break;
    case 'habit-core': {
      const habits = s.habits.map((h, i) => (i === Number(id) ? { ...h, core: !h.core } : h));
      store.updateSettings({ habits });
      break;
    }
    case 'habit-remove': {
      const h = s.habits[Number(id)];
      if (h && confirm(`Remove "${h.name}"? Its history stays saved.`)) store.updateSettings({ habits: s.habits.filter((_, i) => i !== Number(id)) });
      break;
    }
    case 'habit-add': {
      if (s.habits.length >= s.habitCap) break;
      const name = prompt('New habit');
      if (name && name.trim()) store.updateSettings({ habits: [...s.habits, { id: 'h' + Date.now().toString(36), name: name.trim(), core: false }] });
      break;
    }
    case 'cat-color': {
      const i = Number(id);
      const cur = CATEGORY_COLOURS.indexOf(s.categories[i].color);
      const categories = s.categories.map((c, j) => (j === i ? { ...c, color: CATEGORY_COLOURS[(cur + 1) % CATEGORY_COLOURS.length] } : c));
      store.updateSettings({ categories });
      break;
    }
    case 'cat-remove': {
      const c = s.categories[Number(id)];
      if (c && confirm(`Remove the "${c.name}" category? Its tasks stay, just uncategorised.`)) store.updateSettings({ categories: s.categories.filter((_, i) => i !== Number(id)) });
      break;
    }
    case 'cat-add': {
      const name = prompt('New category');
      if (name && name.trim()) {
        const used = new Set(s.categories.map((c) => c.color));
        const color = CATEGORY_COLOURS.find((c) => !used.has(c)) || 'grey';
        store.updateSettings({ categories: [...s.categories, { id: 'c' + Date.now().toString(36), name: name.trim(), color }] });
      }
      break;
    }
    case 'export': {
      const blob = new Blob([store.exportData()], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `daily-desk-backup-${today()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      break;
    }
    case 'cal-refresh': loadCalendar(true); loadSuggestions(); break;
    case 'learned-remove': {
      const rule = learned[Number(id)];
      if (rule) { store.updateSettings({ learnedRulesRemoved: [...(s.learnedRulesRemoved || []), rule] }); learned = learned.filter((r) => r !== rule); render(); }
      break;
    }
    case 'sign-out': syncApi?.signOut(); break;
    case 'sheet-close': $('#sheet').close(); break;
    case 'sheet-delete': {
      if (confirm('Delete this task?')) { store.deleteTask(id); $('#sheet').close(); toast('Deleted'); }
      break;
    }
  }
});

document.addEventListener('change', async (e) => {
  const el = e.target;
  const key = el.dataset.change;
  if (!key) return;
  const s = S();
  const i = Number(el.dataset.id);
  switch (key) {
    case 'show-ideas': store.updateSettings({ showIdeas: el.checked }); break;
    case 'busy': store.updateSettings({ busyMode: el.checked }); break;
    case 'hide-work': store.updateSettings({ hideWorkOutsideHours: el.checked }); break;
    case 'work-start': store.updateSettings({ workHours: { ...s.workHours, start: Math.min(23, Math.max(0, Number(el.value) || 0)) } }); break;
    case 'work-end': store.updateSettings({ workHours: { ...s.workHours, end: Math.min(24, Math.max(1, Number(el.value) || 17)) } }); break;
    case 'habit-name': if (el.value.trim()) store.updateSettings({ habits: s.habits.map((h, j) => (j === i ? { ...h, name: el.value.trim() } : h)) }); break;
    case 'habit-cap': store.updateSettings({ habitCap: Math.min(12, Math.max(1, Number(el.value) || 6)) }); break;
    case 'cat-name': if (el.value.trim()) store.updateSettings({ categories: s.categories.map((c, j) => (j === i ? { ...c, name: el.value.trim() } : c)) }); break;
    case 'cal-url': store.updateSettings({ calendar: { ...s.calendar, url: el.value.trim() } }); loadCalendar(true); break;
    case 'cal-token': store.updateSettings({ calendar: { ...s.calendar, token: el.value.trim() } }); loadCalendar(true); loadSuggestions(); break;
    case 'sugg-rules': store.updateSettings({ suggestionRules: el.value }); break;
    case 'import': {
      const file = el.files?.[0];
      if (!file) break;
      if (!confirm('Replace everything in the app with this backup?')) break;
      try { store.importData(await file.text()); toast('Backup restored'); } catch (err) { alert(err.message); }
      break;
    }
  }
});

document.addEventListener('submit', async (e) => {
  const form = e.target;
  const kind = form.dataset.form;
  if (!kind) return;
  e.preventDefault();
  if (kind === 'capture') {
    const input = $('#capture-input');
    const q = input.value.trim();
    if (!q) { openSheet(null, currentView() === 'today' ? { due: today() } : {}); return; }
    addFromCapture(q);
    input.value = '';
    capturePreview();
  } else if (kind === 'dump') {
    const input = form.querySelector('input');
    const q = input.value.trim();
    if (!q) return;
    store.addTask({ title: q, column: 'ideas' });
    input.value = '';
    toast('Parked in Ideas');
  } else if (kind === 'sheet') {
    saveSheet(form);
  } else if (kind === 'signin' && syncApi) {
    const fd = new FormData(form);
    const mode = e.submitter?.value || 'in';
    const email = String(fd.get('email') || '').trim();
    const pw = String(fd.get('password') || '');
    try {
      if (mode === 'reset') { if (!email) { alert('Type your email first.'); return; } await syncApi.resetPassword(email); toast('Reset email sent'); }
      else if (mode === 'up') await syncApi.signUp(email, pw);
      else await syncApi.signIn(email, pw);
    } catch (err) {
      alert((err.code || err.message || 'Something went wrong').replace('auth/', '').replace(/-/g, ' '));
    }
  }
});

$('#capture-input').addEventListener('input', capturePreview);

// Close the sheet when tapping the dimmed backdrop.
$('#sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet') e.target.close(); });

// Drag & drop between board columns (iPad / Mac).
let dragging = false;
document.addEventListener('dragstart', (e) => {
  const card = e.target.closest?.('[data-drag]');
  if (!card) return;
  dragging = true;
  e.dataTransfer.setData('text/plain', card.dataset.drag);
  e.dataTransfer.effectAllowed = 'move';
  card.classList.add('dragging');
});
document.addEventListener('dragend', (e) => {
  e.target.closest?.('[data-drag]')?.classList.remove('dragging');
  document.querySelectorAll('.col.drop').forEach((c) => c.classList.remove('drop'));
  setTimeout(() => { dragging = false; }, 50);
});
document.addEventListener('dragover', (e) => {
  const col = e.target.closest?.('.col');
  if (!col) return;
  e.preventDefault();
  document.querySelectorAll('.col.drop').forEach((c) => c !== col && c.classList.remove('drop'));
  col.classList.add('drop');
});
document.addEventListener('drop', (e) => {
  const col = e.target.closest?.('.col');
  if (!col) return;
  e.preventDefault();
  const id = e.dataTransfer.getData('text/plain');
  if (id && store.get().tasks[id]) store.updateTask(id, { column: col.dataset.col });
});

window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });

// Re-check the day and calendar when the app comes back to the front.
let lastDay = today();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (today() !== lastDay) { lastDay = today(); ui.mustsExpanded = false; }
  render();
  loadCalendar();
  loadSuggestions();
});
setInterval(() => { if (today() !== lastDay) { lastDay = today(); render(); loadCalendar(true); } }, 60 * 1000);

// ── Start ────────────────────────────────────────────────────
store.init();
store.subscribe(() => { render(); scheduleContextPush(); });
render();
loadCalendar();
loadSuggestions();
scheduleContextPush();
startSync(firebaseConfig, (st) => { syncStatus = st; if (currentView() === 'settings') render(); })
  .then((api) => { syncApi = api; });

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* offline support unavailable */ });
}
