import test from 'node:test';
import assert from 'node:assert/strict';
import { autoCloseDue, breakFor, fmtDT, geoState, HOUR, MIN, needsReminder, openShift, parseDT, shiftsOf, weekRows, weekStart } from '../src/hours';
import { createLocal } from '../src/local';
import type { Punch, Settings } from '../src/data';

const cfg: Settings = { breakMinutes: 30, overtimeHours: 8, autoCloseHours: 12, remindHours: 10 };
const T0 = new Date(2026, 9, 26, 7, 0).getTime(); // Mon 26 Oct 2026 07:00 local
let n = 0;
const p = (type: 'in' | 'out', ts: number, x: Partial<Punch> = {}): Punch => ({
  id: 'p' + n++, teamCode: 'c', workerId: 'w1', type, ts, geo: 'none', source: 'self', synced: true, ...x,
});
const mem = () => {
  const m = new Map<string, string>();
  return { get: async (k: string) => m.get(k) ?? null, set: async (k: string, v: string) => void m.set(k, v), del: async (k: string) => void m.delete(k) };
};
const code = async (e: Promise<unknown>) => { try { await e; return 'ok'; } catch (x) { return (x as Error).message; } };

test('shiftsOf pairs per worker and deducts break only over 5h', () => {
  const s = shiftsOf([p('in', T0), p('out', T0 + 9 * HOUR), p('in', T0, { workerId: 'w2' }), p('out', T0 + 4 * HOUR, { workerId: 'w2' })], cfg, T0 + 20 * HOUR);
  const a = s.find((x) => x.workerId === 'w1')!, b = s.find((x) => x.workerId === 'w2')!;
  assert.deepEqual([a.gross, a.breakMin, a.minutes, a.breakSource], [540, 30, 510, 'rule']);
  assert.deepEqual([b.gross, b.breakMin, b.minutes], [240, 0, 240]);
});

test('break override precedence: boss > worker > rule', () => {
  assert.deepEqual(breakFor(600, cfg), { breakMin: 30, breakSource: 'rule' });
  assert.deepEqual(breakFor(600, cfg, undefined, 45), { breakMin: 45, breakSource: 'worker' });
  assert.deepEqual(breakFor(600, cfg, 0, 45), { breakMin: 0, breakSource: 'boss' });
  const s = shiftsOf([p('in', T0, { breakOverride: 60 }), p('out', T0 + 9 * HOUR, { breakMin: 20 })], cfg)[0];
  assert.equal(s.minutes, 480);
});

test('open shift is capped at autoCloseHours and flagged auto', () => {
  const ins = [p('in', T0)];
  const open = shiftsOf(ins, cfg, T0 + 5 * HOUR)[0];
  assert.equal(open.end, null);
  assert.ok(needsReminder(openShift(ins, cfg, T0 + 11 * HOUR), cfg, T0 + 11 * HOUR));
  assert.ok(!needsReminder(openShift(ins, cfg, T0 + 5 * HOUR), cfg, T0 + 5 * HOUR));
  const late = shiftsOf(ins, cfg, T0 + 30 * HOUR)[0];
  assert.deepEqual([late.end, late.auto, late.gross], [T0 + 12 * HOUR, true, 720]);
  assert.equal(openShift(ins, cfg, T0 + 30 * HOUR), undefined);
  const due = autoCloseDue(ins, cfg, T0 + 30 * HOUR);
  assert.deepEqual([due.length, due[0].ts, due[0].source], [1, T0 + 12 * HOUR, 'auto']);
  assert.equal(autoCloseDue([...ins, p('out', T0 + 8 * HOUR)], cfg, T0 + 30 * HOUR).length, 0);
});

test('geoState tri-state', () => {
  const site = { lat: -31.95, lng: 115.86, radius: 250 };
  assert.equal(geoState(undefined, site), 'none');
  assert.equal(geoState({ lat: -31.95, lng: 115.86 }, site), 'on');
  assert.equal(geoState({ lat: -31.96, lng: 115.86 }, site), 'off'); // ~1.1 km
  assert.equal(geoState({ lat: -31.95, lng: 115.86 }, { radius: 250 }), 'none');
});

test('weekRows: daily totals and overtime over threshold', () => {
  const ws = weekStart(0, T0);
  const shifts = shiftsOf([p('in', T0), p('out', T0 + 11 * HOUR), p('in', T0 + 24 * HOUR), p('out', T0 + 31 * HOUR)], cfg);
  const [r] = weekRows([{ id: 'w1', name: 'A' }], shifts, cfg, ws);
  assert.deepEqual([r.days[0], r.days[1], r.total, r.over], [630, 390, 1020, 150]);
});

test('date text round-trip', () => {
  assert.equal(parseDT(fmtDT(T0)), T0);
  assert.equal(parseDT('2026-02-31 10:00'), undefined);
  assert.equal(parseDT('abc'), undefined);
});

test('join: unique ids, never reuses name, needs approval, PIN login', async () => {
  const d = createLocal(mem(), async () => true);
  const boss = await d.createTeam('T', '1234');
  assert.equal(await code(d.loginBoss(boss.teamCode, '0000')), 'pin');
  assert.equal((await d.loginBoss(boss.teamCode, '1234')).role, 'boss');
  assert.equal((await d.listTeams()).length, 1);
  const a = await d.joinTeam(boss.teamCode, '张三', '1111');
  const b = await d.joinTeam(boss.teamCode, '张三', '2222'); // same name, different person
  assert.notEqual(a.workerId, b.workerId);
  assert.equal(await code(d.joinTeam(boss.teamCode, '张三', '1111')), 'dup');
  assert.equal(await code(d.joinTeam('999999', 'x', '1111')), 'code');
  assert.equal(await code(d.joinTeam(boss.teamCode, 'x', '12')), 'pin');
  // wrong PIN cannot impersonate
  assert.equal(await code(d.loginWorker(boss.teamCode, '张三', '9999')), 'pin');
  assert.equal((await d.loginWorker(boss.teamCode, '张三', '2222')).workerId, b.workerId);
  // pending worker cannot punch
  const np = { teamCode: boss.teamCode, workerId: a.workerId!, type: 'in' as const, ts: Date.now(), geo: 'none' as const, source: 'self' as const };
  assert.equal(await code(d.addPunch(np)), 'status');
  await d.decideWorker(a.workerId!, true);
  await d.decideWorker(b.workerId!, false);
  assert.equal(await code(d.addPunch(np)), 'ok');
  assert.equal(await code(d.addPunch({ ...np, workerId: b.workerId! })), 'status');
  assert.deepEqual((await d.listWorkers(boss.teamCode)).map((w) => w.status), ['approved', 'rejected']);
  assert.ok(!('pin' in (await d.listWorkers(boss.teamCode))[0]));
});

test('offline queue, sync, sweep, edits+audit+lock, corrections', async () => {
  let online = false;
  const d = createLocal(mem(), async () => online);
  const boss = await d.createTeam('T', '1234');
  const c = boss.teamCode;
  const w = (await d.joinTeam(c, 'A', '1111')).workerId!;
  await d.decideWorker(w, true);
  const base = { teamCode: c, workerId: w, geo: 'none' as const, source: 'self' as const };
  const pin = await d.addPunch({ ...base, type: 'in', ts: T0 });
  assert.equal(await d.pendingCount(), 1);
  await d.sync();
  assert.equal(await d.pendingCount(), 1); // still offline
  online = true;
  await d.sync();
  assert.equal(await d.pendingCount(), 0);
  // auto-close
  assert.equal(await d.sweep(c, T0 + 5 * HOUR), 0);
  assert.equal(await d.sweep(c, T0 + 13 * HOUR), 1);
  assert.equal(await d.sweep(c, T0 + 14 * HOUR), 1 - 1);
  const all = await d.listPunches(c, 0, Infinity);
  const sh = shiftsOf(all, await d.getTeam(c), T0 + 14 * HOUR);
  assert.deepEqual([sh.length, sh[0].auto, sh[0].gross], [1, true, 720]);
  // boss edit requires reason, keeps audit
  assert.equal(await code(d.updatePunch('boss', pin.id, { ts: T0 + MIN }, ' ')), 'reason');
  await d.updatePunch('boss', pin.id, { ts: T0 + 10 * MIN, breakOverride: 15 }, 'late start');
  const au = (await d.listAudit(c)).filter((x) => x.action === 'edit');
  assert.deepEqual([au.length, au[0].before?.ts, au[0].after?.ts, au[0].reason], [1, T0, T0 + 10 * MIN, 'late start']);
  // manual add + delete
  const extra = await d.addPunchAs('boss', { ...base, type: 'in', ts: T0 + 48 * HOUR, source: 'boss' }, 'missed');
  await d.deletePunch('boss', extra.id, 'wrong');
  assert.equal((await d.listAudit(c)).filter((x) => x.punchId === extra.id).length, 2);
  // worker correction request, approved → applied + audited
  const out = all.find((x) => x.type === 'out')!;
  await d.requestCorrection({ teamCode: c, workerId: w, inId: pin.id, outId: out.id, newIn: T0, newOut: T0 + 9 * HOUR, reason: 'forgot' });
  const [cr] = await d.listCorrections(c);
  await d.decideCorrection('boss', cr.id, true);
  const after = shiftsOf(await d.listPunches(c, 0, Infinity), await d.getTeam(c))[0];
  assert.deepEqual([after.start, after.end], [T0, T0 + 9 * HOUR]);
  assert.equal((await d.listCorrections(c))[0].status, 'approved');
  // approve week locks edits
  const ws = weekStart(0, T0);
  await d.setApproval('boss', c, w, ws, true);
  assert.equal(await code(d.updatePunch('boss', pin.id, { ts: T0 + MIN }, 'x')), 'locked');
  assert.equal(await code(d.deletePunch('boss', out.id, 'x')), 'locked');
  assert.equal((await d.listApprovals(c)).length, 1);
  await d.setApproval('boss', c, w, ws, false);
  assert.equal(await code(d.updatePunch('boss', pin.id, { ts: T0 + MIN }, 'x')), 'ok');
});
