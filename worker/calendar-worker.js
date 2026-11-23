// Daily Desk — helper (Cloudflare Worker, free plan).
//
// 1. Reads your iCloud "Public Calendar" links and returns events as JSON.
// 2. Holds the daily suggestions written by the 6:30am Claude check, plus a
//    small "context" the app shares (open task titles, accepted/dismissed
//    suggestions, your rules) so the check avoids duplicates and learns.
// Your calendar links live here as secrets, never in the app's code.
//
// Settings in Cloudflare (Worker → Settings → Variables and Secrets / Bindings):
//   TOKEN      (secret)  a long random password; also typed into the app's Settings
//   CALENDARS  (secret, optional)  one calendar per line:  Personal=webcal://p…icloud.com/…
//              Leave it out and the app simply shows no calendar.
//   ALLOWED_ORIGIN       your app's address, e.g. https://yourname.github.io
//   TIMEZONE             optional, default Europe/London
//   DESK       (KV namespace binding) storage for suggestions & context
//
// Routes (all need header  Authorization: Bearer <TOKEN>):
//   GET  /?days=1        calendar → { days: [{ date, events }], errors }
//   GET  /context        what the app last shared
//   PUT  /context        app shares its context
//   GET  /suggestions    → { suggestions: [...], learned: [...] }  (last 7 days)
//   POST /suggestions    the daily check adds { suggestions: [...], learned: [...] }

export default {
  async fetch(request, env) {
    const cors = {
      'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS',
      'Vary': 'Origin'
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    const auth = request.headers.get('Authorization') || '';
    if (!env.TOKEN || auth !== `Bearer ${env.TOKEN}`) return json({ error: 'unauthorised' }, 401, cors);

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (path === '/context' || path === '/suggestions') {
      if (!env.DESK) return json({ error: 'storage not set up: add a KV binding called DESK' }, 501, cors);
      return storage(path, request, env, cors);
    }
    if (path === '/' || path === '/calendar') return calendarRoute(url, env, cors);
    return json({ error: 'not found' }, 404, cors);
  }
};

async function storage(path, request, env, cors) {
  const readJson = async (key, fallback) => {
    try { return JSON.parse(await env.DESK.get(key)) ?? fallback; } catch { return fallback; }
  };
  if (path === '/context') {
    if (request.method === 'GET') return json(await readJson('context', {}), 200, cors);
    if (request.method === 'PUT') {
      const body = await request.text();
      if (body.length > 200000) return json({ error: 'too large' }, 413, cors);
      JSON.parse(body); // reject anything that isn't JSON
      await env.DESK.put('context', body);
      return json({ ok: true }, 200, cors);
    }
  }
  if (path === '/suggestions') {
    const store = await readJson('suggestions', { suggestions: [], learned: [] });
    const cutoff = Date.now() - 7 * 864e5;
    store.suggestions = (store.suggestions || []).filter((s) => Date.parse(s.createdAt) > cutoff);
    if (request.method === 'GET') return json(store, 200, cors);
    if (request.method === 'POST') {
      const body = await request.json();
      const now = new Date().toISOString();
      const have = new Set(store.suggestions.map((s) => s.id));
      let added = 0;
      for (const s of (body.suggestions || []).slice(0, 20)) {
        if (!s || !s.title) continue;
        const id = String(s.id || `s-${now.slice(0, 10)}-${Math.random().toString(36).slice(2, 8)}`).slice(0, 80);
        if (have.has(id)) continue;
        store.suggestions.push({
          id, createdAt: now,
          title: String(s.title).slice(0, 200), reason: String(s.reason || '').slice(0, 300), source: String(s.source || '').slice(0, 120),
          category: s.category || null, priority: ['must', 'should', 'could'].includes(s.priority) ? s.priority : null,
          due: /^\d{4}-\d{2}-\d{2}$/.test(s.due || '') ? s.due : null, score: Number(s.score) || 0
        });
        have.add(id);
        added++;
      }
      if (Array.isArray(body.learned)) store.learned = body.learned.map(String).slice(0, 40);
      await env.DESK.put('suggestions', JSON.stringify(store));
      return json({ ok: true, added }, 200, cors);
    }
  }
  return json({ error: 'method not allowed' }, 405, cors);
}

async function calendarRoute(url, env, cors) {
    const tz = env.TIMEZONE || 'Europe/London';
    const days = Math.min(14, Math.max(1, parseInt(url.searchParams.get('days') || '1', 10) || 1));
    const start = localDate(new Date(), tz);
    const dates = Array.from({ length: days }, (_, i) => addDays(start, i));
    const end = addDays(start, days);

    const feeds = String(env.CALENDARS || '')
      .split(/\n+/).map((l) => l.trim()).filter(Boolean)
      .map((line) => {
        const i = line.indexOf('=');
        return i > 0 ? { name: line.slice(0, i).trim(), url: line.slice(i + 1).trim() } : { name: 'Calendar', url: line };
      });

    if (!feeds.length) return json({ days: [], errors: [], configured: false }, 200, cors);

    const errors = [];
    const all = [];
    await Promise.all(feeds.map(async (feed) => {
      try {
        const res = await fetch(feed.url.replace(/^webcal:/i, 'https:'), { cf: { cacheTtl: 300 } });
        if (!res.ok) throw new Error(`calendar replied ${res.status}`);
        const events = expand(parseIcs(await res.text()), start, end, tz);
        events.forEach((e) => all.push({ ...e, calendar: feed.name }));
      } catch (e) {
        errors.push({ calendar: feed.name, error: e.message || 'could not read' });
      }
    }));

    const out = dates.map((date) => ({
      date,
      events: all.filter((e) => e.date === date)
        .sort((a, b) => (a.allDay === b.allDay ? (a.start || '').localeCompare(b.start || '') : a.allDay ? -1 : 1))
        .map(({ date: _d, ...rest }) => rest)
    }));
    return json({ days: out, errors, checkedAt: new Date().toISOString() }, 200, cors);
}

const json = (data, status, headers) =>
  new Response(JSON.stringify(data), { status, headers: { ...headers, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

// ── Dates as 'YYYYMMDD' strings in the chosen time zone ─────────
function localDate(d, tz) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const g = (t) => p.find((x) => x.type === t).value;
  return `${g('year')}-${g('month')}-${g('day')}`;
}
function localTime(d, tz) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
}
function addDays(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}
const dow = (ymd) => new Date(`${ymd}T12:00:00Z`).getUTCDay();

// ── Minimal iCalendar parser ─────────────────────────────────
function parseIcs(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const events = [];
  let cur = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = { exdates: [] }; continue; }
    if (line === 'END:VEVENT') { if (cur) events.push(cur); cur = null; continue; }
    if (!cur) continue;
    const i = line.indexOf(':');
    if (i < 0) continue;
    const [name, ...params] = line.slice(0, i).split(';');
    const value = line.slice(i + 1);
    const p = Object.fromEntries(params.map((x) => x.split('=')));
    switch (name) {
      case 'UID': cur.uid = value; break;
      case 'SUMMARY': cur.title = value.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1'); break;
      case 'DTSTART': cur.start = { value, ...p }; break;
      case 'DTEND': cur.end = { value, ...p }; break;
      case 'RRULE': cur.rrule = Object.fromEntries(value.split(';').map((x) => x.split('='))); break;
      case 'EXDATE': value.split(',').forEach((v) => cur.exdates.push(v.slice(0, 8))); break;
      case 'RECURRENCE-ID': cur.recurrenceId = value.slice(0, 8); break;
      case 'STATUS': cur.status = value; break;
    }
  }
  return events.filter((e) => e.start && e.status !== 'CANCELLED');
}

// Convert a DTSTART/DTEND into { date: 'YYYY-MM-DD', time: 'HH:MM' | null }
function when(prop, tz) {
  const v = prop.value;
  const date = `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
  if (prop.VALUE === 'DATE' || v.length === 8) return { date, time: null };
  if (v.endsWith('Z')) {
    const d = new Date(Date.UTC(+v.slice(0, 4), +v.slice(4, 6) - 1, +v.slice(6, 8), +v.slice(9, 11), +v.slice(11, 13)));
    return { date: localDate(d, tz), time: localTime(d, tz) };
  }
  // Local or TZID time: show the wall-clock time as written.
  return { date, time: `${v.slice(9, 11)}:${v.slice(11, 13)}` };
}

// ── Expand events (including simple repeats) into the window ─
function expand(events, from, to, tz) {
  const out = [];
  const overrides = new Set(events.filter((e) => e.recurrenceId).map((e) => `${e.uid}|${e.recurrenceId}`));

  for (const ev of events) {
    const s = when(ev.start, tz);
    const e = ev.end ? when(ev.end, tz) : null;
    const item = (date) => ({ date, title: ev.title || '(no title)', allDay: !s.time, start: s.time, end: e?.time || null });

    if (!ev.rrule || ev.recurrenceId) {
      // Single event (multi-day all-day events show on each day)
      const last = s.time ? s.date : e ? addDays(e.date, -1) : s.date;
      for (let d = s.date; d <= last && d < to; d = addDays(d, 1)) if (d >= from) out.push(item(d));
      continue;
    }

    const r = ev.rrule;
    const interval = parseInt(r.INTERVAL || '1', 10);
    const until = r.UNTIL ? `${r.UNTIL.slice(0, 4)}-${r.UNTIL.slice(4, 6)}-${r.UNTIL.slice(6, 8)}` : null;
    const count = r.COUNT ? parseInt(r.COUNT, 10) : Infinity;
    const byDay = r.BYDAY ? r.BYDAY.split(',').map((x) => ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'].indexOf(x.slice(-2))) : null;
    const nth = r.BYDAY && /^-?\d/.test(r.BYDAY); // e.g. "2MO" — not supported, skip
    if (nth) continue;

    let n = 0;
    for (let d = s.date, guard = 0; d < to && n < count && guard < 20000; d = addDays(d, 1), guard++) {
      if (until && d > until) break;
      const days = Math.round((Date.parse(d) - Date.parse(s.date)) / 864e5);
      let hit = false;
      if (r.FREQ === 'DAILY') hit = days % interval === 0;
      else if (r.FREQ === 'WEEKLY') {
        const weeks = Math.floor((days + dow(s.date)) / 7);
        hit = weeks % interval === 0 && (byDay ? byDay.includes(dow(d)) : dow(d) === dow(s.date));
      } else if (r.FREQ === 'MONTHLY') {
        const months = (+d.slice(0, 4) - +s.date.slice(0, 4)) * 12 + (+d.slice(5, 7) - +s.date.slice(5, 7));
        hit = d.slice(8) === s.date.slice(8) && months % interval === 0;
      } else if (r.FREQ === 'YEARLY') {
        hit = d.slice(5) === s.date.slice(5) && (+d.slice(0, 4) - +s.date.slice(0, 4)) % interval === 0;
      }
      if (!hit) continue;
      n++;
      const key = d.replace(/-/g, '');
      if (d >= from && !ev.exdates.includes(key) && !overrides.has(`${ev.uid}|${key}`)) out.push(item(d));
    }
  }
  return out;
}
