import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import NetInfo from '@react-native-community/netinfo';
import { data, Punch, Session } from './data';
import { DAY, isOnSite, shiftsOf, startOfDay } from './hours';
import { t } from './i18n';
import { getFix } from './location';
import { Btn, C, Loc, s } from './ui';

export default function WorkerScreen({ session, onLogout }: { session: Session; onLogout: () => void }) {
  const [punches, setPunches] = useState<Punch[]>([]);
  const [breakMin, setBreakMin] = useState(30);
  const [pending, setPending] = useState(0);
  const [photo, setPhoto] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [, tick] = useState(0);

  const load = useCallback(async () => {
    const now = Date.now();
    const all = await data.listPunches(session.teamCode, startOfDay(now) - DAY, now + DAY);
    setPunches(all.filter((p) => p.workerId === session.workerId));
    setBreakMin((await data.getTeam(session.teamCode)).breakMinutes);
    setPending(await data.pendingCount());
  }, [session]);

  const sync = useCallback(async () => {
    await data.sync();
    await load();
  }, [load]);

  useEffect(() => {
    sync();
    const unsub = NetInfo.addEventListener((st) => st.isConnected && sync());
    const id = setInterval(() => tick((n) => n + 1), 30_000);
    return () => {
      unsub();
      clearInterval(id);
    };
  }, [sync]);

  const on = isOnSite(punches);
  const today = startOfDay(Date.now());
  const minutes = shiftsOf(punches, breakMin)
    .filter((x) => x.start >= today)
    .reduce((a, x) => a + x.minutes, 0);
  const last = [...punches].sort((a, b) => b.ts - a.ts)[0];

  const punch = async () => {
    setBusy(true);
    try {
      let photoUri: string | undefined;
      if (photo) {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) return;
        const r = await ImagePicker.launchCameraAsync({ quality: 0.4 });
        if (r.canceled) return;
        photoUri = r.assets[0].uri;
      }
      setNotice(t.locating);
      const fix = await getFix();
      const lat = fix?.lat, lng = fix?.lng;
      setNotice(fix ? '' : t.noGps);
      await data.addPunch({
        teamCode: session.teamCode,
        workerId: session.workerId!,
        type: on ? 'out' : 'in',
        ts: Date.now(),
        lat,
        lng,
        photoUri,
      });
      await sync();
    } catch (e) {
      setNotice('');
      Alert.alert(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={s.body}>
      <View style={s.row}>
        <Text style={s.title}>{session.name}</Text>
        <Pressable onPress={onLogout}><Text style={{ color: C.blue }}>{t.logout}</Text></Pressable>
      </View>
      <Text style={s.muted}>{t.teamCode} {session.teamCode} · {on ? t.working : t.offDuty}</Text>
      <Pressable
        disabled={busy}
        onPress={punch}
        style={{ backgroundColor: on ? C.red : C.green, borderRadius: 120, height: 240, width: 240, alignSelf: 'center', alignItems: 'center', justifyContent: 'center', opacity: busy ? 0.5 : 1 }}>
        <Text style={{ color: '#fff', fontSize: 34, fontWeight: '700' }}>{on ? t.clockOut : t.clockIn}</Text>
      </Pressable>
      {!!notice && <Text style={{ textAlign: 'center', color: notice === t.noGps ? C.red : C.gray }}>{notice}</Text>}
      <View style={s.row}>
        <Text style={{ fontSize: 16 }}>{t.takePhoto}</Text>
        <Switch value={photo} onValueChange={setPhoto} />
      </View>
      <View style={s.card}>
        <Text style={s.muted}>{t.todayHours}</Text>
        <Text style={{ fontSize: 30, fontWeight: '700' }}>{t.hm(minutes)}</Text>
        {last && <Text style={s.muted}>{t.lastPunch}：{last.type === 'in' ? t.clockIn : t.clockOut} {new Date(last.ts).toLocaleString()}</Text>}
        {last && <Loc lat={last.lat} lng={last.lng} label />}
      </View>
      <View style={s.row}>
        <Text style={s.muted}>{pending ? t.pending(pending) : t.synced}</Text>
        {pending > 0 && <Btn label={t.syncNow} onPress={sync} style={{ paddingVertical: 8 }} />}
      </View>
    </ScrollView>
  );
}
