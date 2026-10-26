// Local DataSource: the "server" DB and the offline queue live in one key-value store on this phone.
// Data is NOT shared between phones until a remote implementation replaces it. No React Native imports here (unit-testable).
import type { Approval, Audit, Correction, DataSource, ErrCode, Punch, Session, Settings, Site, Team, Worker } from './data';
import { autoCloseDue, weekStart } from './hours';

export type KV = { get(k: string): Promise<string | null>; set(k: string, v: string): Promise<void>; del(k: string): Promise<void> };
type DB = { teams: (Team & { pin: string })[]; workers: (Worker & { pin: string })[]; sites: Site[]; punches: Punch[]; audit: Audit[]; corrections: Correction[]; approvals: Approval[] };

const DEFAULTS: Settings = { breakMinutes: 30, overtimeHours: 8, autoCloseHours: 12, remindHours: 10 };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const fail = (c: ErrCode): never => { throw new Error(c); };
const PIN = /^\d{4}$/;

export function createLocal(kv: KV, isOnline: () => Promise<boolean>): DataSource {
  const empty = (): DB => ({ teams: [], workers: [], sites: [], punches: [], audit: [], corrections: [], approvals: [] });
  const load = async (): Promise<DB> => ({ ...empty(), ...JSON.parse((await kv.get('clockin.db2')) ?? '{}') });
  const save = (db: DB) => kv.set('clockin.db2', JSON.stringify(db));
  let lock: Promise<unknown> = Promise.resolve();
  /** Serialised read-modify-write. */
  const tx = <T>(f: (db: DB) => T | Promise<T>): Promise<T> => {
    const r = lock.then(async () => { const db = await load(); const v = await f(db); await save(db); return v; });
    lock = r.catch(() => {});
    return r;
  };
  const view = async <T>(f: (db: DB) => T): Promise<T> => { await lock; return f(await load()); };
  const session = async (s: Session) => { await kv.set('clockin.session', JSON.stringify(s)); return s; };
  const team = (db: DB, code: string) => db.teams.find((x) => x.code === code) ?? fail('code');
  const strip = <T extends { pin?: string }>({ pin: _p, ...rest }: T) => rest;
  const isLocked = (db: DB, workerId: string, ts: number) => db.approvals.some((a) => a.workerId === workerId && a.weekStart === weekStart(0, ts));
  const needReason = (r: string) => (r.trim() ? r.trim() : fail('reason'));
  const pick = <T extends object>(o: T, keys: string[]) => Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, (o as any)[k]])) as Partial<Punch>;
  const log = (db: DB, p: Punch, by: string, action: Audit['action'], before: Partial<Punch> | undefined, after: Partial<Punch> | undefined, reason: string) =>
    db.audit.push({ id: uid(), teamCode: p.teamCode, punchId: p.id, workerId: p.workerId, by, at: Date.now(), action, before, after, reason });
  const addAs = (db: DB, by: string, p: Omit<Punch, 'id' | 'synced'>, reason: string) => {
    if (isLocked(db, p.workerId, p.ts)) fail('locked');
    const punch: Punch = { ...p, id: uid(), synced: true, receivedTs: Date.now() };
    db.punches.push(punch);
    log(db, punch, by, 'add', undefined, pick(punch, ['type', 'ts', 'siteId']), reason);
    return punch;
  };
  const change = (db: DB, by: string, id: string, patch: Partial<Punch>, reason: string) => {
    const p = db.punches.find((x) => x.id === id) ?? fail('notfound');
    if (isLocked(db, p.workerId, p.ts) || (patch.ts != null && isLocked(db, p.workerId, patch.ts))) fail('locked');
    const keys = Object.keys(patch);
    const before = pick(p, keys);
    Object.assign(p, patch);
    log(db, p, by, 'edit', before, pick(p, keys), reason);
  };

  return {
    getSession: async () => JSON.parse((await kv.get('clockin.session')) ?? 'null'),
    clearSession: () => kv.del('clockin.session'),

    createTeam: (name, pin) =>
      tx(async (db) => {
        if (!PIN.test(pin)) fail('pin');
        let code: string;
        do code = String(Math.floor(100000 + Math.random() * 900000));
        while (db.teams.some((x) => x.code === code));
        db.teams.push({ code, name, pin, ...DEFAULTS });
        return session({ role: 'boss', teamCode: code, name });
      }),
    listTeams: () => view((db) => db.teams.map((x) => ({ code: x.code, name: x.name }))),
    loginBoss: (code, pin) =>
      tx(async (db) => {
        const t = team(db, code);
        return t.pin === pin ? session({ role: 'boss', teamCode: code, name: t.name }) : fail('pin');
      }),

    joinTeam: (code, name, pin) =>
      tx(async (db) => {
        team(db, code);
        if (!PIN.test(pin)) fail('pin');
        const n = name.trim();
        if (db.workers.some((w) => w.teamCode === code && w.name === n && w.pin === pin && w.status !== 'rejected')) fail('dup');
        const w = { id: uid(), teamCode: code, name: n, pin, status: 'pending' as const, createdAt: Date.now() };
        db.workers.push(w);
        return session({ role: 'worker', teamCode: code, name: n, workerId: w.id });
      }),
    loginWorker: (code, name, pin) =>
      tx(async (db) => {
        team(db, code);
        const w = db.workers.find((x) => x.teamCode === code && x.name === name.trim() && x.pin === pin);
        return w ? session({ role: 'worker', teamCode: code, name: w.name, workerId: w.id }) : fail('pin');
      }),

    getTeam: (code) => view((db) => strip(team(db, code)) as Team),
    updateSettings: (code, patch) => tx((db) => void Object.assign(team(db, code), patch)),
    listWorkers: (code) => view((db) => db.workers.filter((w) => w.teamCode === code).map(strip) as Worker[]),
    decideWorker: (id, approve) =>
      tx((db) => { (db.workers.find((w) => w.id === id) ?? fail('notfound')).status = approve ? 'approved' : 'rejected'; }),

    listSites: (code) => view((db) => db.sites.filter((s) => s.teamCode === code)),
    saveSite: (s) =>
      tx((db) => {
        const i = s.id ? db.sites.findIndex((x) => x.id === s.id) : -1;
        const site: Site = { ...s, id: s.id ?? uid() };
        if (i >= 0) db.sites[i] = site;
        else db.sites.push(site);
        return site;
      }),
    deleteSite: (id) => tx((db) => { db.sites = db.sites.filter((s) => s.id !== id); }),

    addPunch: (p) =>
      tx((db) => {
        if (db.workers.find((w) => w.id === p.workerId)?.status !== 'approved') fail('status');
        const punch: Punch = { ...p, id: uid(), synced: false };
        db.punches.push(punch);
        return punch;
      }),
    addPunchAs: (by, p, reason) => tx((db) => addAs(db, by, p, needReason(reason))),
    updatePunch: (by, id, patch, reason) => tx((db) => change(db, by, id, patch, needReason(reason))),
    deletePunch: (by, id, reason) =>
      tx((db) => {
        needReason(reason);
        const p = db.punches.find((x) => x.id === id) ?? fail('notfound');
        if (isLocked(db, p.workerId, p.ts)) fail('locked');
        db.punches = db.punches.filter((x) => x.id !== id);
        log(db, p, by, 'delete', pick(p, ['type', 'ts', 'siteId']), undefined, reason.trim());
      }),
    listPunches: (code, from, to) => view((db) => db.punches.filter((p) => p.teamCode === code && p.ts >= from && p.ts < to)),
    listAudit: (code) => view((db) => db.audit.filter((a) => a.teamCode === code).sort((a, b) => b.at - a.at)),

    sweep: (code, now = Date.now()) =>
      tx((db) => {
        const due = autoCloseDue(db.punches.filter((p) => p.teamCode === code), team(db, code), now);
        for (const d of due) {
          const p: Punch = { ...d, id: uid(), synced: true, receivedTs: now };
          db.punches.push(p);
          log(db, p, 'auto', 'auto', undefined, { type: 'out', ts: p.ts }, 'auto-close');
        }
        return due.length;
      }),

    requestCorrection: (c) =>
      tx((db) => { db.corrections.push({ ...c, id: uid(), status: 'pending', createdAt: Date.now() }); }),
    listCorrections: (code) => view((db) => db.corrections.filter((c) => c.teamCode === code)),
    decideCorrection: (by, id, approve) =>
      tx((db) => {
        const c = db.corrections.find((x) => x.id === id) ?? fail('notfound');
        if (approve) {
          const p = db.punches.find((x) => x.id === c.inId) ?? fail('notfound');
          if (c.outId && c.newOut != null) change(db, by, c.outId, { ts: c.newOut }, c.reason);
          else if (c.newOut != null) addAs(db, by, { teamCode: c.teamCode, workerId: c.workerId, siteId: p.siteId, type: 'out', ts: c.newOut, geo: 'none', source: 'boss' }, c.reason);
          change(db, by, c.inId, { ts: c.newIn }, c.reason);
        }
        c.status = approve ? 'approved' : 'rejected';
      }),

    listApprovals: (code) => view((db) => db.approvals.filter((a) => a.teamCode === code)),
    setApproval: (by, code, workerId, ws, on) =>
      tx((db) => {
        db.approvals = db.approvals.filter((a) => !(a.workerId === workerId && a.weekStart === ws));
        if (on) db.approvals.push({ teamCode: code, workerId, weekStart: ws, by, at: Date.now() });
      }),

    pendingCount: () => view((db) => db.punches.filter((p) => !p.synced).length),
    sync: () =>
      tx(async (db) => {
        if (!(await isOnline())) return;
        const now = Date.now();
        for (const p of db.punches) if (!p.synced) Object.assign(p, { synced: true, receivedTs: now });
      }),
  };
}
