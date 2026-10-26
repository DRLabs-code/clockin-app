import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { Approval, Audit, Correction, data, Punch, Session, Settings, Site, Team, Worker } from './data';
import { DAY, fmtDate, fmtDT, fmtTime, parseDT, shiftsOf, Shift, startOfDay, weekRows, weekStart } from './hours';
import { detailCsv, shareCsv, shareText } from './export';
import { t } from './i18n';
import { getFix } from './location';
import { printQr, Qr, siteUrl } from './qr';
import { auditLine, ShiftRow } from './ShiftRow';
import { Banner, Btn, buzz, C, Card, Chip, Field, GeoTag, H2, Loc, S, Sheet, Skeleton, st, Stepper, SyncBar, Tag, toast, toastErr, Transition } from './ui';
import { FadeIn } from './ui';

const sameMin = (x: number, y: number) => Math.floor(x / 60_000) === Math.floor(y / 60_000);
type D = { team: Team; workers: Worker[]; sites: Site[]; punches: Punch[]; audit: Audit[]; corr: Correction[]; appr: Approval[] };
type Tab = 'now' | 'week' | 'sites' | 'todo' | 'set';
type P = { d: D; reload: () => Promise<void>; boss: string };

const siteName = (d: D, id?: string) => d.sites.find((s) => s.id === id)?.name;
const approvedWorkers = (d: D) => d.workers.filter((w) => w.status === 'approved');

function NowTab({ d, go }: { d: D; go: (t: Tab) => void }) {
  const open = shiftsOf(d.punches, d.team).filter((s) => s.end === null);
  const name = (id: string) => d.workers.find((w) => w.id === id)?.name ?? '';
  const todo = d.workers.filter((w) => w.status === 'pending').length + d.corr.filter((c) => c.status === 'pending').length;
  return (
    <>
      {todo > 0 && <Pressable onPress={() => go('todo')}><Banner text={t.todoBanner(todo)} /></Pressable>}
      <Card>
        <Text style={st.muted}>{t.onSiteNow}</Text>
        <Text style={{ fontSize: 40, fontWeight: '800', color: C.green }}>{open.length}<Text style={{ fontSize: 18, color: C.muted }}> / {approvedWorkers(d).length} {t.people}</Text></Text>
      </Card>
      {open.length === 0 && <Text style={st.muted}>{t.nobodyOn}</Text>}
      {open.map((s, i) => (
        <FadeIn key={s.inId} i={i}>
          <Card>
            <View style={st.rowBetween}><Text style={{ fontSize: 18, fontWeight: '700', color: C.ink }}>{name(s.workerId)}</Text><GeoTag geo={s.inGeo} /></View>
            <Text style={st.muted}>{siteName(d, s.siteId) ?? t.noSite} · {t.since} {fmtTime(s.start)} · {t.hm(Math.round((Date.now() - s.start) / 60000))}</Text>
            {!s.synced && <Tag label={`⏳ ${t.unsyncedOne}`} fg={C.amber} bg={C.amberBg} />}
          </Card>
        </FadeIn>
      ))}
    </>
  );
}

type Ed = { mode: 'edit' | 'add'; shift?: Shift; workerId: string; siteId?: string; inT: string; outT: string; brk: string; reason: string };

function WeekTab({ d, reload, boss }: P) {
  const [week, setWeek] = useState(0);
  const [open, setOpen] = useState<string>();
  const [ed, setEd] = useState<Ed>();
  const [onlyOk, setOnlyOk] = useState(false);
  const ws = weekStart(week);
  const shifts = shiftsOf(d.punches, d.team).filter((s) => s.start >= ws && s.start < ws + 7 * DAY);
  const workers = approvedWorkers(d);
  const rows = weekRows(workers, shifts, d.team, ws);
  const isOk = (id: string) => d.appr.some((a) => a.workerId === id && a.weekStart === ws);
  const approve = async (id: string, on: boolean) => { await data.setApproval(boss, d.team.code, id, ws, on); buzz('ok'); toast(on ? t.approvedOk : t.unapprovedOk); await reload(); };
  const wname = (id: string) => workers.find((w) => w.id === id)?.name ?? '';
  const fmtDay = (i: number) => fmtDate(ws + i * DAY + 3_600_000);

  const openEd = (mode: 'edit' | 'add', workerId: string, s?: Shift) =>
    setEd({ mode, shift: s, workerId, siteId: s ? s.siteId : d.sites[0]?.id, inT: fmtDT(s?.start ?? Math.max(ws, startOfDay(Date.now())) + 7 * 3_600_000), outT: s?.end ? fmtDT(s.end) : '', brk: s?.breakSource === 'boss' ? String(s.breakMin) : '', reason: '' });

  const save = async () => {
    const e = ed!;
    const a = parseDT(e.inT), b = e.outT.trim() ? parseDT(e.outT) : null;
    const brk = e.brk.trim() === '' ? undefined : parseInt(e.brk, 10);
    if (a == null || b === undefined || (b !== null && b <= a) || (brk !== undefined && !(brk >= 0))) return toast(t.errTime, 'err');
    if (!e.reason.trim()) return toast(t.err.reason, 'err');
    const base = { teamCode: d.team.code, workerId: e.workerId, siteId: e.siteId, geo: 'none' as const, source: 'boss' as const };
    try {
      if (e.mode === 'add') {
        await data.addPunchAs(boss, { ...base, type: 'in', ts: a, breakOverride: brk }, e.reason);
        if (b) await data.addPunchAs(boss, { ...base, type: 'out', ts: b }, e.reason);
      } else {
        const s = e.shift!;
        const patch: Parameters<typeof data.updatePunch>[2] = {};
        if (!sameMin(a, s.start)) patch.ts = a;
        if (e.siteId !== s.siteId) patch.siteId = e.siteId;
        const cur = s.breakSource === 'boss' ? s.breakMin : undefined;
        if (brk !== cur) patch.breakOverride = brk;
        if (Object.keys(patch).length) await data.updatePunch(boss, s.inId, patch, e.reason);
        if (s.outId && b === null) await data.deletePunch(boss, s.outId, e.reason);
        else if (s.outId && b !== null && !sameMin(b, s.end!)) await data.updatePunch(boss, s.outId, { ts: b! }, e.reason);
        else if (!s.outId && b) await data.addPunchAs(boss, { ...base, type: 'out', ts: b }, e.reason);
      }
      setEd(undefined);
      toast(t.saved);
      await reload();
    } catch (x) { toastErr(x); }
  };
  const del = async () => {
    const e = ed!;
    if (!e.reason.trim()) return toast(t.err.reason, 'err');
    try {
      if (e.shift!.outId) await data.deletePunch(boss, e.shift!.outId, e.reason);
      await data.deletePunch(boss, e.shift!.inId, e.reason);
      setEd(undefined);
      toast(t.deleted);
      await reload();
    } catch (x) { toastErr(x); }
  };
  const exportCsv = async () => {
    const edits = (s: Shift) => d.audit.filter((a) => a.action === 'edit' && (a.punchId === s.inId || a.punchId === s.outId)).length;
    const items = shifts.map((s) => ({ name: wname(s.workerId), shift: s, siteName: siteName(d, s.siteId) ?? '', approved: isOk(s.workerId), edits: edits(s) }));
    await shareCsv(detailCsv(items, onlyOk), ws);
  };
  const hist = ed?.shift ? d.audit.filter((a) => a.punchId === ed.shift!.inId || a.punchId === ed.shift!.outId) : [];

  return (
    <>
      <View style={st.rowBetween}>
        <Btn label="‹" small ghost onPress={() => setWeek(week - 1)} style={{ width: 52 }} />
        <Text style={{ fontSize: 17, fontWeight: '700' }}>{fmtDay(0)} – {fmtDay(6)}{week === 0 ? ` (${t.thisWeek})` : ''}</Text>
        <Btn label="›" small ghost disabled={week >= 0} onPress={() => setWeek(week + 1)} style={{ width: 52 }} />
      </View>
      <Text style={st.muted}>{t.breakRule(d.team.breakMinutes)} · {t.otRule(d.team.overtimeHours)}</Text>
      <Card style={{ paddingHorizontal: 10 }}>
        <View style={st.row}>
          <Text style={{ flex: 2.2, fontSize: 12, color: C.muted }} />
          {t.days.map((x) => <Text key={x} style={{ flex: 1, textAlign: 'center', fontWeight: '600', fontSize: 13 }}>{x}</Text>)}
          <Text style={{ flex: 1.5, textAlign: 'right', fontWeight: '700', fontSize: 13 }}>{t.total}</Text>
          <Text style={{ flex: 1.5, textAlign: 'right', fontWeight: '700', fontSize: 13, color: C.red }}>{t.over(d.team.overtimeHours)}</Text>
        </View>
        {rows.length === 0 && <Text style={st.muted}>{t.noWorkers}</Text>}
        {rows.map((r) => (
          <Pressable key={r.workerId} onPress={() => setOpen(open === r.workerId ? undefined : r.workerId)} style={{ paddingVertical: 10, borderTopWidth: 1, borderColor: C.line }}>
            <View style={st.row}>
              <Text style={{ flex: 2.2, fontSize: 15, fontWeight: '600' }} numberOfLines={1}>{isOk(r.workerId) ? '✓ ' : ''}{r.name}</Text>
              {r.days.map((m, i) => <Text key={i} style={{ flex: 1, textAlign: 'center', fontSize: 13 }}>{m ? (m / 60).toFixed(1) : '-'}</Text>)}
              <Text style={{ flex: 1.5, textAlign: 'right', fontWeight: '700', fontSize: 14 }}>{(r.total / 60).toFixed(1)}</Text>
              <Text style={{ flex: 1.5, textAlign: 'right', fontSize: 14, color: r.over ? C.red : C.muted }}>{r.over ? (r.over / 60).toFixed(1) : '-'}</Text>
            </View>
          </Pressable>
        ))}
      </Card>
      {rows.map((r) => open === r.workerId && (
        <View key={r.workerId} style={{ gap: S.sm }}>
          <View style={st.rowBetween}>
            <H2>{r.name}</H2>
            <Tag label={isOk(r.workerId) ? t.approvedTag : t.notApproved} fg={isOk(r.workerId) ? C.green : C.amber} bg={isOk(r.workerId) ? C.greenBg : C.amberBg} />
          </View>
          {shifts.filter((s) => s.workerId === r.workerId).map((s, i) => (
            <ShiftRow key={s.inId} s={s} i={i} site={siteName(d, s.siteId)} action={isOk(r.workerId) ? undefined : { label: t.editShift, onPress: () => openEd('edit', r.workerId, s) }} />
          ))}
          {isOk(r.workerId) && <Text style={st.muted}>{t.lockedHint}</Text>}
          <View style={st.row}>
            <View style={{ flex: 1 }}><Btn label={isOk(r.workerId) ? t.unapprove : t.approveWeek} color={isOk(r.workerId) ? C.amber : C.green} onPress={() => approve(r.workerId, !isOk(r.workerId))} /></View>
            {!isOk(r.workerId) && <View style={{ flex: 1 }}><Btn label={t.addShift} ghost onPress={() => openEd('add', r.workerId)} /></View>}
          </View>
        </View>
      ))}
      {rows.some((r) => !isOk(r.workerId) && r.total > 0) && (
        <Btn label={t.approveAll} color={C.green} onPress={async () => { for (const r of rows) if (!isOk(r.workerId) && r.total > 0) await data.setApproval(boss, d.team.code, r.workerId, ws, true); buzz('ok'); toast(t.approvedOk); await reload(); }} />
      )}
      <Card>
        <View style={st.rowBetween}><Text style={{ flex: 1, fontSize: 16 }}>{t.onlyApproved}</Text><Switch value={onlyOk} onValueChange={setOnlyOk} trackColor={{ true: C.green }} /></View>
        <Btn label={t.export} onPress={exportCsv} />
      </Card>

      <Sheet visible={!!ed} onClose={() => setEd(undefined)} title={ed?.mode === 'add' ? `${t.addShift} · ${wname(ed.workerId)}` : t.editShift}>
        {d.sites.length > 0 && <View style={st.row}>{d.sites.map((s) => <Chip key={s.id} label={s.name} on={ed?.siteId === s.id} onPress={() => setEd((x) => x && { ...x, siteId: s.id })} />)}</View>}
        <Field label={t.newIn} value={ed?.inT} onChangeText={(v) => setEd((x) => x && { ...x, inT: v })} />
        <Field label={t.newOutOpen} value={ed?.outT} onChangeText={(v) => setEd((x) => x && { ...x, outT: v })} />
        <Field label={t.breakOverride} placeholder={t.breakOverrideHint(d.team.breakMinutes)} keyboardType="number-pad" value={ed?.brk} onChangeText={(v) => setEd((x) => x && { ...x, brk: v })} />
        <Field label={`${t.reason} *`} placeholder={t.reasonHint} value={ed?.reason} onChangeText={(v) => setEd((x) => x && { ...x, reason: v })} />
        <Btn label={t.save} onPress={save} />
        {ed?.mode === 'edit' && <Btn label={t.deleteShift} color={C.red} ghost onPress={del} />}
        {hist.length > 0 && <H2>{t.history}</H2>}
        {hist.map((a) => <Text key={a.id} style={{ color: C.muted, fontSize: 14 }}>{auditLine(a)}</Text>)}
      </Sheet>
    </>
  );
}

type SiteForm = { id?: string; name: string; address: string; lat?: number; lng?: number; radius: number };
const blank: SiteForm = { name: '', address: '', radius: 250 };

function SitesTab({ d, reload }: P) {
  const [f, setF] = useState<SiteForm>(blank);
  const [qr, setQr] = useState<Site>();
  const [confirm, setConfirm] = useState<string>();
  const here = async () => {
    const x = await getFix();
    if (!x) return toast(t.noGps, 'err');
    setF((p) => ({ ...p, lat: x.lat, lng: x.lng }));
    toast(t.locSet);
  };
  const save = async () => {
    if (!f.name.trim()) return toast(t.errInput, 'err');
    await data.saveSite({ ...f, teamCode: d.team.code, name: f.name.trim(), address: f.address.trim() || undefined });
    setF(blank);
    toast(t.saved);
    await reload();
  };
  const url = qr ? siteUrl(d.team.code, qr.id) : '';
  return (
    <>
      <Card>
        <H2>{f.id ? t.editSite : t.newSite}</H2>
        <Field label={t.siteName} value={f.name} onChangeText={(v) => setF({ ...f, name: v })} />
        <Field label={t.address} value={f.address} onChangeText={(v) => setF({ ...f, address: v })} />
        <Btn label={f.lat != null ? t.relocate : t.useHere} ghost onPress={here} />
        {f.lat != null && <Loc lat={f.lat} lng={f.lng} />}
        <Stepper label={t.radius} value={f.radius} unit=" m" min={50} max={1000} step={50} onChange={(v) => setF({ ...f, radius: v })} />
        <Btn label={t.save} onPress={save} />
        {f.id && <Btn label={t.cancel} ghost color={C.gray} onPress={() => setF(blank)} />}
      </Card>
      {d.sites.length === 0 && <Text style={st.muted}>{t.noSitesBoss}</Text>}
      {d.sites.map((s, i) => (
        <FadeIn key={s.id} i={i}>
          <Card>
            <Text style={{ fontSize: 18, fontWeight: '700' }}>{s.name}</Text>
            {!!s.address && <Text style={st.muted}>{s.address}</Text>}
            <Text style={st.muted}>{s.lat != null ? `📍 ${t.radiusN(s.radius)}` : t.noCenter}</Text>
            <View style={st.row}>
              <Btn label={t.qr} small onPress={() => setQr(s)} />
              <Btn label={t.edit} small ghost onPress={() => setF({ id: s.id, name: s.name, address: s.address ?? '', lat: s.lat, lng: s.lng, radius: s.radius })} />
              <Btn label={confirm === s.id ? t.confirmDelete : t.delete} small ghost color={C.red} onPress={async () => { if (confirm !== s.id) return setConfirm(s.id); await data.deleteSite(s.id); setConfirm(undefined); await reload(); }} />
            </View>
          </Card>
        </FadeIn>
      ))}
      <Sheet visible={!!qr} onClose={() => setQr(undefined)} title={qr?.name ?? ''}>
        {qr && <Qr text={url} size={260} />}
        <Text style={[st.muted, { textAlign: 'center' }]}>{t.qrHint}</Text>
        <Btn label={t.print} onPress={() => { if (!printQr(qr!.name, url)) toast(t.printWebOnly, 'err'); }} />
        <Btn label={t.shareLink} ghost onPress={async () => { if (await shareText(url)) toast(t.copied); }} />
      </Sheet>
    </>
  );
}

function TodoTab({ d, reload, boss }: P) {
  const pending = d.workers.filter((w) => w.status === 'pending');
  const corr = d.corr.filter((c) => c.status === 'pending');
  const name = (id: string) => d.workers.find((w) => w.id === id)?.name ?? '';
  const act = (f: () => Promise<void>) => async () => { try { await f(); buzz('ok'); await reload(); } catch (e) { toastErr(e); } };
  return (
    <>
      <H2>{t.joinRequests}</H2>
      {pending.length === 0 && <Text style={st.muted}>{t.none}</Text>}
      {pending.map((w, i) => (
        <FadeIn key={w.id} i={i}>
          <Card>
            <Text style={{ fontSize: 18, fontWeight: '700' }}>{w.name}</Text>
            <Text style={st.muted}>{t.requestedAt(fmtDT(w.createdAt))}</Text>
            <View style={st.row}>
              <View style={{ flex: 1 }}><Btn label={t.approve} color={C.green} onPress={act(() => data.decideWorker(w.id, true))} /></View>
              <View style={{ flex: 1 }}><Btn label={t.reject} color={C.red} ghost onPress={act(() => data.decideWorker(w.id, false))} /></View>
            </View>
          </Card>
        </FadeIn>
      ))}
      <H2>{t.corrRequests}</H2>
      {corr.length === 0 && <Text style={st.muted}>{t.none}</Text>}
      {corr.map((c, i) => {
        const p = d.punches.find((x) => x.id === c.inId);
        return (
          <FadeIn key={c.id} i={i}>
            <Card>
              <Text style={{ fontSize: 17, fontWeight: '700' }}>{name(c.workerId)}</Text>
              {p && <Text style={st.muted}>{t.currentTime}：{fmtDT(p.ts)}</Text>}
              <Text>{t.requested}：{fmtDT(c.newIn)} → {c.newOut ? fmtDT(c.newOut) : '-'}</Text>
              <Text style={st.muted}>{t.reason}：{c.reason}</Text>
              <View style={st.row}>
                <View style={{ flex: 1 }}><Btn label={t.approve} color={C.green} onPress={act(() => data.decideCorrection(boss, c.id, true))} /></View>
                <View style={{ flex: 1 }}><Btn label={t.reject} color={C.red} ghost onPress={act(() => data.decideCorrection(boss, c.id, false))} /></View>
              </View>
            </Card>
          </FadeIn>
        );
      })}
    </>
  );
}

function SettingsTab({ d, reload }: P) {
  const set = async (patch: Partial<Settings>) => { await data.updateSettings(d.team.code, patch); await reload(); };
  const tm = d.team;
  return (
    <>
      <Card>
        <Text style={st.muted}>{t.teamCode}</Text>
        <Text style={{ fontSize: 40, fontWeight: '800', letterSpacing: 4, color: C.primary }}>{tm.code}</Text>
        <Text style={st.muted}>{t.inviteHint}</Text>
      </Card>
      <Card style={{ gap: S.md }}>
        <Stepper label={t.setBreak} value={tm.breakMinutes} unit={t.minUnit} min={0} max={120} step={5} onChange={(v) => set({ breakMinutes: v })} />
        <Stepper label={t.setOver} value={tm.overtimeHours} unit="h" min={1} max={16} onChange={(v) => set({ overtimeHours: v })} />
        <Stepper label={t.setAuto} value={tm.autoCloseHours} unit="h" min={2} max={24} onChange={(v) => set({ autoCloseHours: v, remindHours: Math.min(tm.remindHours, v - 1) })} />
        <Stepper label={t.setRemind} value={tm.remindHours} unit="h" min={1} max={tm.autoCloseHours - 1} onChange={(v) => set({ remindHours: v })} />
      </Card>
      <Card><Text style={st.muted}>{t.breakRule(tm.breakMinutes)}</Text><Text style={st.muted}>{t.locationNote}</Text></Card>
    </>
  );
}

const TABS: [Tab, string][] = [['now', t.tabNow], ['week', t.tabWeek], ['sites', t.tabSites], ['todo', t.tabTodo], ['set', t.tabSet]];

export default function Boss({ session, onLogout }: { session: Session; onLogout: () => void }) {
  const [d, setD] = useState<D>();
  const [tab, setTab] = useState<Tab>('now');
  const code = session.teamCode;
  const reload = useCallback(async () => {
    await data.sweep(code);
    const from = Math.min(weekStart(-8), startOfDay(Date.now()) - 2 * DAY);
    const [team, workers, sites, punches, audit, corr, appr] = await Promise.all([
      data.getTeam(code), data.listWorkers(code), data.listSites(code), data.listPunches(code, from, Date.now() + DAY),
      data.listAudit(code), data.listCorrections(code), data.listApprovals(code),
    ]);
    setD({ team, workers, sites, punches, audit, corr, appr });
  }, [code]);
  useEffect(() => { reload(); const id = setInterval(reload, 15_000); return () => clearInterval(id); }, [reload]);

  const todo = d ? d.workers.filter((w) => w.status === 'pending').length + d.corr.filter((c) => c.status === 'pending').length : 0;
  const p: P | undefined = d && { d, reload, boss: session.name };
  return (
    <View style={{ flex: 1 }}>
      <View style={[st.rowBetween, { paddingHorizontal: S.md, paddingTop: 52, paddingBottom: S.sm }]}>
        <Text style={[st.title, { flexShrink: 1 }]} numberOfLines={1}>{session.name}</Text>
        <Btn label={t.logout} small ghost onPress={onLogout} />
      </View>
      <View style={{ paddingHorizontal: S.md }}><SyncBar refresh={reload} /></View>
      <Transition k={tab}>
        <ScrollView contentContainerStyle={[st.body, { paddingTop: S.sm }]} keyboardShouldPersistTaps="handled">
          {!p ? <Skeleton n={4} /> : tab === 'now' ? <NowTab d={p.d} go={setTab} /> : tab === 'week' ? <WeekTab {...p} /> : tab === 'sites' ? <SitesTab {...p} /> : tab === 'todo' ? <TodoTab {...p} /> : <SettingsTab {...p} />}
        </ScrollView>
      </Transition>
      <View style={{ flexDirection: 'row', backgroundColor: '#fff', borderTopWidth: 1, borderColor: C.line, paddingBottom: 12 }}>
        {TABS.map(([k, label]) => (
          <Pressable key={k} onPress={() => { buzz('tap'); setTab(k); }} style={{ flex: 1, minHeight: 56, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 15, fontWeight: tab === k ? '800' : '500', color: tab === k ? C.primary : C.muted }}>{label}{k === 'todo' && todo > 0 ? ` (${todo})` : ''}</Text>
            {tab === k && <View style={{ height: 3, width: 24, borderRadius: 2, backgroundColor: C.primary, marginTop: 4 }} />}
          </Pressable>
        ))}
      </View>
    </View>
  );
}
