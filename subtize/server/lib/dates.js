/**
 * Subscriptions run on Indian calendar days, whatever timezone the server
 * sits in. A plan bought at 11:30pm IST starts that day, not the next one.
 */
const TZ = process.env.APP_TZ || 'Asia/Kolkata';

const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

/** Test hook: SUBTIZE_TODAY=2026-10-15 pins "today". */
export const today = () => process.env.SUBTIZE_TODAY || fmt.format(new Date());

export const thisMonth = () => today().slice(0, 7);

const parse = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
const iso = (dt) => dt.toISOString().slice(0, 10);

export function addDays(isoDate, n) {
  const d = parse(isoDate);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
}

/** Same day-of-month n months later, clamped (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(isoDate, n) {
  const d = parse(isoDate);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return iso(d);
}

/** Last day of a plan that starts on `start` and runs `months` months. */
export const planEnd = (start, months) => addDays(addMonths(start, months), -1);

export const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / 864e5);

export function monthBounds(month) {
  const start = `${month}-01`;
  return { start, end: addDays(addMonths(start, 1), -1) };
}

export const dayKey = (isoDate) => ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][parse(isoDate).getUTCDay()];

const clock = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

/** 'YYYY-MM-DD HH:MM:SS' in the app timezone, for rows whose date part is compared against today(). */
export const localStamp = () => `${today()} ${clock.format(new Date())}`;
