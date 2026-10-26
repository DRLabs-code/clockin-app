import type { Punch } from './data';

export const MIN = 60_000;
export const DAY = 24 * 60 * MIN;

export const startOfDay = (ts: number) => {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** Monday 00:00 (local) of the week `offset` weeks from now. */
export const weekStart = (offset = 0, now = Date.now()) => {
  const d = new Date(startOfDay(now));
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + offset * 7);
  return d.getTime();
};

export type Shift = { start: number; end: number | null; minutes: number };

/** Pair in/out punches into shifts. Open shift runs until `now`. Break deducted if > 5h. */
export function shiftsOf(punches: Punch[], breakMin: number, now = Date.now()): Shift[] {
  const out: Shift[] = [];
  let start: number | null = null;
  const make = (s: number, e: number | null): Shift => {
    const m = Math.max(0, Math.round(((e ?? now) - s) / MIN));
    return { start: s, end: e, minutes: m > 300 ? m - breakMin : m };
  };
  for (const p of [...punches].sort((a, b) => a.ts - b.ts)) {
    if (p.type === 'in' && start === null) start = p.ts;
    else if (p.type === 'out' && start !== null) {
      out.push(make(start, p.ts));
      start = null;
    }
  }
  if (start !== null) out.push(make(start, null));
  return out;
}

export const isOnSite = (punches: Punch[]) =>
  punches.length > 0 && [...punches].sort((a, b) => a.ts - b.ts).at(-1)!.type === 'in';

/** Minutes per day (Mon..Sun) for shifts that start in the week at `ws`. */
export function weekMinutes(punches: Punch[], breakMin: number, ws: number): number[] {
  const days = [0, 0, 0, 0, 0, 0, 0];
  for (const s of shiftsOf(punches, breakMin)) {
    const i = Math.floor((startOfDay(s.start) - ws) / DAY + 0.5);
    if (i >= 0 && i < 7) days[i] += s.minutes;
  }
  return days;
}
