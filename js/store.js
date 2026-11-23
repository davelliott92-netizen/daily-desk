// The app's data. Everything lives in one object that is saved to this
// device (localStorage) after every change, and mirrored to Firebase by
// sync.js when sync is set up.
//
// Shape:
//   tasks:       { [id]: Task }
//   habitLog:    { 'YYYY-MM-DD': { [habitId]: true, updatedAt } }
//   suggestions: { [id]: Suggestion }   ← filled by the daily Claude check (v1.5)
//   settings:    see DEFAULT_SETTINGS in config.js
//
// Task: { id, title, notes, category, priority, due, column, prevColumn,
//         doneAt, createdAt, updatedAt, deleted }
import { DEFAULT_SETTINGS } from './config.js';

const KEY = 'dailydesk.v1';
let state;
let hook = null; // called with (kind, id, data) after every local change
const subscribers = new Set();

const clone = (o) => JSON.parse(JSON.stringify(o));
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

function fresh() {
  return { tasks: {}, habitLog: {}, suggestions: {}, settings: clone(DEFAULT_SETTINGS) };
}

function normalise(s) {
  const base = fresh();
  const out = { ...base, ...s };
  out.settings = { ...clone(DEFAULT_SETTINGS), ...(s.settings || {}) };
  out.settings.workHours = { ...DEFAULT_SETTINGS.workHours, ...(out.settings.workHours || {}) };
  out.settings.calendar = { ...DEFAULT_SETTINGS.calendar, ...(out.settings.calendar || {}) };
  for (const k of ['tasks', 'habitLog', 'suggestions']) if (!out[k] || typeof out[k] !== 'object') out[k] = {};
  return out;
}

export function init() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(KEY)); } catch { /* private mode or corrupt */ }
  state = normalise(saved || {});
  return state;
}

export const get = () => state;
export const subscribe = (fn) => { subscribers.add(fn); return () => subscribers.delete(fn); };
export const setHook = (fn) => { hook = fn; };

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { console.warn('Could not save', e); }
}
function emit() { save(); subscribers.forEach((fn) => fn(state)); }
function touch(kind, id) { if (hook) hook(kind, id, getItem(kind, id)); }

function bucket(kind) {
  return { task: state.tasks, habitDay: state.habitLog, suggestion: state.suggestions }[kind];
}
export function getItem(kind, id) {
  return kind === 'settings' ? state.settings : bucket(kind)?.[id];
}
export function allItems() {
  const out = [['settings', 'main', state.settings]];
  for (const kind of ['task', 'habitDay', 'suggestion']) {
    const b = bucket(kind);
    for (const id in b) out.push([kind, id, b[id]]);
  }
  return out;
}

// ── Sync entry points ────────────────────────────────────────
// Returns true if the remote copy was newer and was taken.
export function applyRemote(kind, id, data) {
  if (!data) return false;
  if (kind !== 'settings' && !bucket(kind)) return false;
  const local = getItem(kind, id);
  if (local && (local.updatedAt || 0) >= (data.updatedAt || 0)) return false;
  if (kind === 'settings') state.settings = normalise({ settings: data }).settings;
  else bucket(kind)[id] = data;
  return true;
}
export const remoteDone = () => emit();

// ── Tasks ────────────────────────────────────────────────────
export function addTask(fields) {
  const id = newId();
  const now = Date.now();
  state.tasks[id] = {
    id, title: '', notes: '', category: null, priority: null, due: null,
    column: 'next', prevColumn: null, doneAt: null, createdAt: now, deleted: false,
    ...fields, updatedAt: now
  };
  touch('task', id);
  emit();
  return id;
}

export function updateTask(id, patch) {
  const t = state.tasks[id];
  if (!t) return;
  if ('column' in patch && patch.column !== t.column) {
    if (patch.column === 'done') { patch.prevColumn = t.column; patch.doneAt = Date.now(); }
    else patch.doneAt = null;
  }
  Object.assign(t, patch, { updatedAt: Date.now() });
  touch('task', id);
  emit();
}

export function toggleDone(id) {
  const t = state.tasks[id];
  if (!t) return;
  if (t.column === 'done') updateTask(id, { column: t.prevColumn && t.prevColumn !== 'done' ? t.prevColumn : 'next' });
  else updateTask(id, { column: 'done' });
}

// Deleted tasks are kept as a hidden "tombstone" so the deletion syncs.
export const deleteTask = (id) => updateTask(id, { deleted: true });

// ── Habits ───────────────────────────────────────────────────
export function toggleHabit(date, habitId) {
  const day = state.habitLog[date] || (state.habitLog[date] = {});
  if (day[habitId] === true) delete day[habitId];
  else day[habitId] = true;
  day.updatedAt = Date.now();
  touch('habitDay', date);
  emit();
}
export const habitDone = (date, habitId) => state.habitLog[date]?.[habitId] === true;

// ── Suggestions (from the daily Claude check) ────────────────
export function updateSuggestion(id, patch) {
  const s = state.suggestions[id];
  if (!s) return;
  Object.assign(s, patch, { updatedAt: Date.now() });
  touch('suggestion', id);
  emit();
}

// ── Settings ─────────────────────────────────────────────────
export function updateSettings(patch) {
  Object.assign(state.settings, patch, { updatedAt: Date.now() });
  touch('settings', 'main');
  emit();
}

// ── Backup ───────────────────────────────────────────────────
export const exportData = () => JSON.stringify({ app: 'daily-desk', version: 1, exportedAt: new Date().toISOString(), ...state }, null, 2);

export function importData(json) {
  const data = JSON.parse(json);
  if (!data || typeof data !== 'object' || !data.tasks) throw new Error('That file does not look like a Daily Desk backup.');
  const { app, version, exportedAt, ...rest } = data;
  state = normalise(rest);
  // Mark everything as just-changed so it wins over older synced copies.
  const now = Date.now();
  for (const [kind, id, item] of allItems()) { item.updatedAt = now; touch(kind, id); }
  emit();
}
