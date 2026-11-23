// Small date helpers. Dates are stored as 'YYYY-MM-DD' strings in local time.

export const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = () => ymd(new Date());

export function parseYmd(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(s, n) {
  const d = parseYmd(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
}

export const diffDays = (a, b) => Math.round((parseYmd(a) - parseYmd(b)) / 86400000);

// "Today", "Tomorrow", "Fri", "27 Nov"
export function friendly(s) {
  if (!s) return '';
  const n = diffDays(s, today());
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  const d = parseYmd(s);
  if (n > 1 && n < 7) return d.toLocaleDateString('en-GB', { weekday: 'short' });
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
