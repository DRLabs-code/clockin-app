import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Platform, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { Correction, data, Punch, Session, Site, Team, Worker } from './data';
import { DAY, fmtDT, fmtTime, geoState, needsReminder, openShift, parseDT, shiftsOf, startOfDay, weekStart } from './hours';
import { t } from './i18n';
import { getFix } from './location';
import { takeScanned } from './qr';
import { ShiftRow } from './ShiftRow';
import { Banner, Btn, buzz, C, Card, Chip, Field, GeoTag, H2, Loc, S, Sheet, Skeleton, st, SyncBar, toast, toastErr } from './ui';

const ND = Platform.OS !== 'web';
const pad = (n: number) => String(n).padStart(2, '0');

/** Big punch button: colour cross-fade, label pop, success check and a live timer while on shift. */
function PunchButton({ since, busy, check, onPress }: { since?: number; busy: boolean; check: number; onPress: () => void }) {
  const on = since != null;
  const mode = useRef(new Animated.Value(on ? 1 : 0)).current; // 0 = off shift (green), 1 = on shift (red)
  const pop = useRef(new Animated.Value(1)).current;
  const tick = useRef(new Animated.Value(0)).current;
  const press = useRef(new Animated.Value(1)).current;
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    Animated.timing(mode, { toValue: on ? 1 : 0, duration: 350, useNativeDriver: ND }).start();
    pop.setValue(0.85);
    Animated.spring(pop, { toValue: 1, friction: 5, useNativeDriver: ND }).start();
  }, [on, mode, pop]);
  useEffect(() => {
    if (!check) return;
    tick.setValue(0);
    Animated.sequence([Animated.spring(tick, { toValue: 1, friction: 4, useNativeDriver: ND }), Animated.delay(700), Animated.timing(tick, { toValue: 0, duration: 250, useNativeDriver: ND })]).start();
  }, [check, tick]);
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [on]);
  const el = on ? Math.max(0, Math.floor((now - since!) / 1000)) : 0;
  const to = (x: number) => Animated.spring(press, { toValue: x, speed: 40, bounciness: 0, useNativeDriver: ND }).start();
  return (
    <Pressable disabled={busy} onPress={onPress} onPressIn={() => to(0.95)} onPressOut={() => to(1)} accessibilityRole="button">
      <Animated.View style={{ width: 232, height: 232, borderRadius: 116, alignSelf: 'center', overflow: 'hidden', transform: [{ scale: press }], opacity: busy ? 0.7 : 1, justifyContent: 'center', alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 6 }}>
        <View style={{ ...abs, backgroundColor: C.green }} />
        <Animated.View style={{ ...abs, backgroundColor: C.red, opacity: mode }} />
        <Animated.View style={{ alignItems: 'center', transform: [{ scale: pop }], opacity: tick.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }}>
          <Text style={{ color: '#fff', fontSize: 34, fontWeight: '800' }}>{busy ? t.working3 : on ? t.clockOut : t.clockIn}</Text>
          {on && <Text style={{ color: '#fff', fontSize: 24, marginTop: 6, fontVariant: ['tabular-nums'] }}>{pad(Math.floor(el / 3600))}:{pad(Math.floor(el / 60) % 60)}:{pad(el % 60)}</Text>}
        </Animated.View>
        <Animated.Text style={{ position: 'absolute', color: '#fff', fontSize: 110, fontWeight: '800', opacity: tick, transform: [{ scale: tick }] }}>✓</Animated.Text>
      </Animated.View>
    </Pressable>
  );
}
const abs = { position: 'absolute' as const, left: 0, right: 0, top: 0, bottom: 0 };

export default function WorkerScreen({ session, onLogout }: { session: Session; onLogout: () => void }) {
  const [team, setTeam] = useState<Team>();
  const [me, setMe] = useState<Worker>();
  const [sites, setSites] = useState<Site[]>([]);
  const [punches, setPunches] = useState<Punch[]>([]);
  const [corr, setCorr] = useState<Correction[]>([]);
  const [siteId, setSiteId] = useState<string>();
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [check, setCheck] = useState(0);
  const [photo, setPhoto] = useState(false);
  const [breakText, setBreakText] = useState('');
  const [fix, setFix] = useState<Punch>();
  const [edit, setEdit] = useState<{ inId: string; outId: string | null; newIn: string; newOut: string; reason: string }>();
  const lastKey = `clockin.lastSite.${session.workerId}`;

  const load = useCallback(async () => {
    const code = session.teamCode;
    await data.sweep(code);
    const [tm, ws, ss, ps, cs] = await Promise.all([
      data.getTeam(code), data.listWorkers(code), data.listSites(code),
      data.listPunches(code, weekStart(0) - 2 * DAY, Date.now() + DAY), data.listCorrections(code),
    ]);
    setTeam(tm);
    setMe(ws.find((w) => w.id === session.workerId));
    setSites(ss);
    setPunches(ps.filter((p) => p.workerId === session.workerId));
    setCorr(cs.filter((c) => c.workerId === session.workerId));
    setLoaded(true);
  }, [session]);

  useEffect(() => { load(); const id = setInterval(load, 20_000); return () => clearInterval(id); }, [load]);

  // site: scanned QR > last used > the only site
  useEffect(() => {
    if (!sites.length || siteId) return;
    (async () => {
      const sc = takeScanned();
      const last = await AsyncStorage.getItem(lastKey);
      const pick = sites.find((s) => sc && sc.code === session.teamCode && s.id === sc.id) ?? sites.find((s) => s.id === last) ?? (sites.length === 1 ? sites[0] : undefined);
      if (pick) { setSiteId(pick.id); if (sc && pick.id === sc.id) toast(t.scanned(pick.name)); }
    })();
  }, [sites, siteId, lastKey, session.teamCode]);

  if (!loaded || !team) return <ScrollView contentContainerStyle={st.body}><Skeleton n={1} h={40} /><Skeleton n={1} h={232} /><Skeleton n={2} /></ScrollView>;

  if (me?.status !== 'approved')
    return (
      <ScrollView contentContainerStyle={st.body}>
        <Text style={st.title}>{session.name}</Text>
        <Card>
          <Text style={{ fontSize: 20, fontWeight: '700', color: me?.status === 'rejected' ? C.red : C.ink }}>{me?.status === 'rejected' ? t.rejectedTitle : t.waitTitle}</Text>
          <Text style={st.muted}>{me?.status === 'rejected' ? t.rejectedHint : t.waitHint}</Text>
        </Card>
        {me?.status !== 'rejected' && <Btn label={t.refresh} onPress={load} />}
        <Btn label={t.logout} ghost onPress={onLogout} />
      </ScrollView>
    );

  const cur = openShift(punches, team);
  const shifts = shiftsOf(punches, team).filter((s) => s.start >= weekStart(0));
  const today = shifts.filter((s) => s.start >= startOfDay(Date.now())).reduce((a, s) => a + s.minutes, 0);
  const siteName = (id?: string) => sites.find((s) => s.id === id)?.name;
  const curSite = cur ? cur.siteId : siteId;

  const punch = async () => {
    if (!cur && sites.length && !siteId) return toast(t.pickSite, 'err');
    setBusy(true);
    try {
      let photoUri: string | undefined;
      if (photo) {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) toast(t.noCamera, 'err');
        else { const r = await ImagePicker.launchCameraAsync({ quality: 0.4 }); if (!r.canceled) photoUri = r.assets[0].uri; }
      }
      const f = await getFix(); // one reading per tap, never blocks the punch
      const geo = geoState(f, sites.find((s) => s.id === curSite));
      const mins = parseInt(breakText, 10);
      const p = await data.addPunch({
        teamCode: session.teamCode, workerId: session.workerId!, siteId: curSite, type: cur ? 'out' : 'in', ts: Date.now(),
        lat: f?.lat, lng: f?.lng, geo, photoUri, source: 'self', breakMin: cur && mins >= 0 ? mins : undefined,
      });
      if (!cur && siteId) AsyncStorage.setItem(lastKey, siteId);
      setBreakText('');
      setFix(p);
      setCheck((n) => n + 1);
      buzz('ok');
      toast(`${cur ? t.clockedOut : t.clockedIn} ${fmtTime(p.ts)} · ${t.geo[geo]}`);
      await data.sync();
      await load();
    } catch (e) {
      toastErr(e);
    } finally {
      setBusy(false);
    }
  };

  const openEdit = (s: { start: number; end: number | null; inId: string; outId: string | null }) =>
    setEdit({ inId: s.inId, outId: s.outId, newIn: fmtDT(s.start), newOut: fmtDT(s.end ?? Date.now()), reason: '' });
  const submitEdit = async () => {
    const a = parseDT(edit!.newIn), b = parseDT(edit!.newOut);
    if (a == null || b == null || b <= a) return toast(t.errTime, 'err');
    if (!edit!.reason.trim()) return toast(t.err.reason, 'err');
    try {
      await data.requestCorrection({ teamCode: session.teamCode, workerId: session.workerId!, inId: edit!.inId, outId: edit!.outId, newIn: a, newOut: b, reason: edit!.reason.trim() });
      setEdit(undefined);
      toast(t.corrSent);
      load();
    } catch (e) { toastErr(e); }
  };

  return (
    <>
      <ScrollView contentContainerStyle={st.body} keyboardShouldPersistTaps="handled">
        <View style={st.rowBetween}>
          <View style={{ flexShrink: 1 }}>
            <Text style={st.title}>{session.name}</Text>
            <Text style={st.muted}>{team.name} · {cur ? t.working : t.offDuty}</Text>
          </View>
          <Btn label={t.logout} small ghost onPress={onLogout} />
        </View>
        <SyncBar refresh={load} />
        {needsReminder(cur, team) && <Banner tone="red" text={t.remind(Math.floor((Date.now() - cur!.start) / 3_600_000), team.autoCloseHours)} />}

        {!cur && (
          sites.length ? (
            <View style={{ gap: S.xs }}>
              <Text style={st.label}>{t.chooseSite}</Text>
              <View style={st.row}>{sites.map((s) => <Chip key={s.id} label={s.name} on={s.id === siteId} onPress={() => setSiteId(s.id)} />)}</View>
            </View>
          ) : <Text style={st.muted}>{t.noSitesWorker}</Text>
        )}
        {cur && <Text style={st.label}>{t.site}：{siteName(cur.siteId) ?? t.noSite}</Text>}

        <PunchButton since={cur?.start} busy={busy} check={check} onPress={punch} />

        {cur && <Field label={t.breakInput} placeholder={t.breakHint(team.breakMinutes)} keyboardType="number-pad" maxLength={3} value={breakText} onChangeText={setBreakText} />}
        <View style={st.rowBetween}>
          <Text style={{ fontSize: 16, color: C.ink }}>{t.takePhoto}</Text>
          <Switch value={photo} onValueChange={setPhoto} trackColor={{ true: C.green }} />
        </View>
        {fix && (
          <Card>
            <View style={st.row}><Text style={{ fontWeight: '700' }}>{fix.type === 'in' ? t.clockIn : t.clockOut} {fmtTime(fix.ts)}</Text><GeoTag geo={fix.geo} /></View>
            {fix.geo === 'none' ? <Text style={st.muted}>{t.noGps}</Text> : <Loc lat={fix.lat} lng={fix.lng} />}
          </Card>
        )}
        <Text style={st.muted}>{t.locationNote}</Text>

        <Card>
          <Text style={st.muted}>{t.todayHours}</Text>
          <Text style={{ fontSize: 30, fontWeight: '800', color: C.ink }}>{t.hm(today)}</Text>
        </Card>

        <H2>{t.myShifts}</H2>
        {shifts.length === 0 && <Text style={st.muted}>{t.none}</Text>}
        {[...shifts].reverse().map((s, i) => {
          const c = corr.find((x) => x.inId === s.inId && x.status === 'pending');
          return <ShiftRow key={s.inId} s={s} i={i} site={siteName(s.siteId)} action={c ? undefined : s.end ? { label: t.requestFix, onPress: () => openEdit(s) } : undefined} />;
        })}
        {corr.length > 0 && <H2>{t.myCorrections}</H2>}
        {[...corr].reverse().slice(0, 5).map((c) => (
          <Card key={c.id}><Text>{fmtDT(c.newIn)} → {c.newOut ? fmtDT(c.newOut) : '-'}</Text><Text style={st.muted}>{c.reason} · {t.status[c.status]}</Text></Card>
        ))}
      </ScrollView>
      <Sheet visible={!!edit} onClose={() => setEdit(undefined)} title={t.requestFix}>
        <Field label={t.newIn} value={edit?.newIn} onChangeText={(v) => setEdit((e) => e && { ...e, newIn: v })} />
        <Field label={t.newOut} value={edit?.newOut} onChangeText={(v) => setEdit((e) => e && { ...e, newOut: v })} />
        <Field label={t.reason} placeholder={t.reasonHint} value={edit?.reason} onChangeText={(v) => setEdit((e) => e && { ...e, reason: v })} />
        <Btn label={t.submit} onPress={submitEdit} />
      </Sheet>
    </>
  );
}
