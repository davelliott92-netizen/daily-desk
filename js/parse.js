// Quick-add parser: "Book dentist #health fri !could"
//   #word   → category (first category whose name starts with word)
//   !must !should !could (or !m !s !c) → priority
//   today / tomorrow / tmr / mon…sun / monday…sunday / 27/11 / +3d → due date
import { today, addDays, ymd } from './dates.js';

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const PRIO = { must: 'must', m: 'must', should: 'should', s: 'should', could: 'could', c: 'could' };

function dayIndex(word) {
  return DAYS.findIndex((d) => word === d || word === d.slice(0, 3) || (word.length >= 4 && d.startsWith(word)));
}

export function parseDate(word) {
  const t = today();
  if (word === 'today' || word === 'tod') return t;
  if (word === 'tomorrow' || word === 'tmr' || word === 'tom') return addDays(t, 1);
  const plus = word.match(/^\+(\d{1,3})d$/);
  if (plus) return addDays(t, Number(plus[1]));
  const dm = word.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (dm) {
    const now = new Date();
    let d = new Date(now.getFullYear(), Number(dm[2]) - 1, Number(dm[1]));
    if (d.getDate() !== Number(dm[1])) return null; // e.g. 31/2
    if (ymd(d) < t) d = new Date(now.getFullYear() + 1, Number(dm[2]) - 1, Number(dm[1]));
    return ymd(d);
  }
  const i = dayIndex(word);
  if (i >= 0) {
    const ahead = (i - new Date().getDay() + 7) % 7;
    return addDays(t, ahead);
  }
  return null;
}

export function parseQuick(text, categories) {
  const out = {};
  const keep = [];
  for (const tok of text.trim().split(/\s+/)) {
    if (!tok) continue;
    const low = tok.toLowerCase();
    if (low.length > 1 && low.startsWith('#')) {
      const q = low.slice(1);
      const cat = categories.find((c) => c.id === q || c.name.toLowerCase().startsWith(q));
      if (cat) { out.category = cat.id; continue; }
    }
    if (low.startsWith('!') && PRIO[low.slice(1)]) { out.priority = PRIO[low.slice(1)]; continue; }
    if (!out.due) {
      const d = parseDate(low);
      if (d) { out.due = d; continue; }
    }
    keep.push(tok);
  }
  out.title = keep.join(' ');
  return out;
}
