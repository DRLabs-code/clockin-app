// Pure logic (no React Native imports) so it can be unit-tested with plain node.
import type { Geo, Punch, Settings } from './data';

export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;
export const BREAK_AFTER_MIN = 300; // shifts longer than 5h get the default break

export const startOfDay = (ts: number) => {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** Monday 00:00 (local) of the week `offset` weeks from `now`. */
export const weekStart = (offset = 0, now = Date.now()) => {
  const d = new Date(startOfDay(now));
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + offset * 7);
  return d.getTime();
};

const p2 = (n: number) => String(n).padStart(2, '0');
export const fmtTime = (ts: number) => { const d = new Date(ts); return `${p2(d.getHours())}:${p2(d.getMinutes())}`; };
export const fmtDate = (ts: number) => { const d = new Date(ts); return `${d.getMonth() + 1}/${d.getDate()}`; };
/** "YYYY-MM-DD HH:mm" in local time: used for editable text fields. */
export const fmtDT = (ts: number) => { const d = new Date(ts); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${fmtTime(ts)}`; };
export const parseDT = (s: string): number | undefined => {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return undefined;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const dt = new Date(y, mo - 1, d, h, mi);
  return dt.getMonth() === mo - 1 && dt.getHours() === h ? dt.getTime() : undefined;
};

export const distanceM = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const r = (x: number) => (x * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
};

/** Tri-state: no fix → none; no site centre to compare → none; else within radius → on, otherwise off. */
export function geoState(fix: { lat: number; lng: number } | undefined, site?: { lat?: number; lng?: number; radius: number }): Geo {
  if (!fix || !site || site.lat == null || site.lng == null) return 'none';
  return distanceM(fix, { lat: site.lat, lng: site.lng }) <= site.radius ? 'on' : 'off';
}

export type Shift = {
  workerId: string;
  inId: string;
  outId: string | null;
  siteId?: string;
  start: number;
  end: number | null; // null = still open
  auto: boolean; // auto-closed after the max shift length
  gross: number; // minutes before break
  breakMin: number;
  breakSource: 'rule' | 'worker' | 'boss';
  minutes: number; // net minutes
  inGeo: Geo;
  outGeo?: Geo;
  manual: boolean; // created/edited by the boss
  synced: boolean;
};

/** Break rule per shift: boss override > worker-entered > default rule (gross > 5h → breakMinutes). */
export function breakFor(gross: number, cfg: Settings, boss?: number, worker?: number): Pick<Shift, 'breakMin' | 'breakSource'> {
  if (boss != null) return { breakMin: boss, breakSource: 'boss' };
  if (worker != null) return { breakMin: worker, breakSource: 'worker' };
  return { breakMin: gross > BREAK_AFTER_MIN ? cfg.breakMinutes : 0, breakSource: 'rule' };
}

/**
 * Pair in/out punches into shifts, per worker. An open shift runs until `now`,
 * but never longer than cfg.autoCloseHours (then it is reported as auto-closed).
 */
export function shiftsOf(punches: Punch[], cfg: Settings, now = Date.now()): Shift[] {
  const out: Shift[] = [];
  const open = new Map<string, Punch>();
  const limit = cfg.autoCloseHours * HOUR;
  const make = (i: Punch, o: Punch | null): Shift => {
    let end = o ? o.ts : null;
    let auto = o?.source === 'auto';
    if (!o && now - i.ts >= limit) { end = i.ts + limit; auto = true; }
    const gross = Math.max(0, Math.round(((end ?? now) - i.ts) / MIN));
    const b = breakFor(gross, cfg, i.breakOverride, o?.breakMin);
    return {
      workerId: i.workerId, inId: i.id, outId: o?.id ?? null, siteId: i.siteId, start: i.ts, end, auto, gross, ...b,
      minutes: Math.max(0, gross - b.breakMin), inGeo: i.geo, outGeo: o?.geo,
      manual: i.source === 'boss' || o?.source === 'boss', synced: i.synced && (o ? o.synced : true),
    };
  };
  for (const p of [...punches].sort((a, b) => a.ts - b.ts)) {
    const cur = open.get(p.workerId);
    if (p.type === 'in' && !cur) open.set(p.workerId, p);
    else if (p.type === 'out' && cur) { out.push(make(cur, p)); open.delete(p.workerId); }
  }
  for (const i of open.values()) out.push(make(i, null));
  return out.sort((a, b) => a.start - b.start);
}

/** Open (not yet closed) shift of a worker, if any and not yet past the auto-close limit. */
export const openShift = (punches: Punch[], cfg: Settings, now = Date.now()) =>
  shiftsOf(punches, cfg, now).find((s) => s.end === null);

/** Out-punches that must be created to auto-close shifts open longer than cfg.autoCloseHours. */
export function autoCloseDue(punches: Punch[], cfg: Settings, now = Date.now()): Omit<Punch, 'id' | 'synced'>[] {
  const ins = new Map(punches.map((p) => [p.id, p]));
  return shiftsOf(punches, cfg, now)
    .filter((s) => s.end !== null && s.auto && !s.outId)
    .map((s) => {
      const i = ins.get(s.inId)!;
      return { teamCode: i.teamCode, workerId: i.workerId, siteId: i.siteId, type: 'out' as const, ts: s.end!, geo: 'none' as Geo, source: 'auto' as const };
    });
}

/** Should the worker see the "still on shift?" banner? */
export const needsReminder = (s: Shift | undefined, cfg: Settings, now = Date.now()) =>
  !!s && s.end === null && now - s.start >= cfg.remindHours * HOUR;

export type Row = { workerId: string; name: string; days: number[]; total: number; over: number };

/** Weekly totals per worker. `over` = sum over days of (daily minutes − overtime threshold). */
export function weekRows(workers: { id: string; name: string }[], shifts: Shift[], cfg: Settings, ws: number): Row[] {
  return workers.map((w) => {
    const days = [0, 0, 0, 0, 0, 0, 0];
    for (const s of shifts) {
      const i = Math.round((startOfDay(s.start) - ws) / DAY);
      if (s.workerId === w.id && i >= 0 && i < 7) days[i] += s.minutes;
    }
    const over = days.reduce((a, m) => a + Math.max(0, m - cfg.overtimeHours * 60), 0);
    return { workerId: w.id, name: w.name, days, total: days.reduce((a, b) => a + b, 0), over };
  });
}
