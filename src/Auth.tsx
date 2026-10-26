import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { data, Session } from './data';
import { t } from './i18n';
import { Btn, C, Card, Chip, Field, S, st, toast, toastErr } from './ui';

type Mode = 'home' | 'boss' | 'bossNew' | 'worker' | 'join';
const pinProps = { keyboardType: 'number-pad' as const, maxLength: 4, secureTextEntry: true };

export default function Auth({ onDone }: { onDone: (s: Session) => void }) {
  const [mode, setMode] = useState<Mode>('home');
  const [teams, setTeams] = useState<{ code: string; name: string }[]>([]);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  useEffect(() => { data.listTeams().then((x) => { setTeams(x); if (x.length === 1) setCode(x[0].code); }); }, []);
  const go = (m: Mode) => { setMode(m); setPin(''); };

  const run = (f: () => Promise<Session>) => async () => {
    try { onDone(await f()); } catch (e) { toastErr(e); }
  };
  const need = (ok: boolean, f: () => Promise<Session>) => (ok ? run(f) : async () => toast(t.errInput, 'err'));
  const pinOk = /^\d{4}$/.test(pin);

  return (
    <ScrollView contentContainerStyle={st.body} keyboardShouldPersistTaps="handled">
      <Text style={[st.title, { fontSize: 32 }]}>{t.appName}</Text>
      {mode === 'home' && (
        <>
          <Text style={st.muted}>{t.chooseRole}</Text>
          <Btn label={t.boss} onPress={() => go(teams.length ? 'boss' : 'bossNew')} style={{ minHeight: 72 }} />
          <Btn label={t.worker} color={C.green} onPress={() => go('worker')} style={{ minHeight: 72 }} />
        </>
      )}
      {mode === 'boss' && (
        <>
          <Text style={st.h2}>{t.bossLogin}</Text>
          <View style={st.row}>{teams.map((x) => <Chip key={x.code} label={`${x.name} · ${x.code}`} on={code === x.code} onPress={() => setCode(x.code)} />)}</View>
          <Field label={t.pin} placeholder="••••" value={pin} onChangeText={setPin} {...pinProps} />
          <Btn label={t.login} onPress={need(!!code && pinOk, () => data.loginBoss(code, pin))} />
          <Btn label={t.createTeam} ghost onPress={() => go('bossNew')} />
        </>
      )}
      {mode === 'bossNew' && (
        <>
          <Text style={st.h2}>{t.createTeam}</Text>
          <Field label={t.teamName} value={name} onChangeText={setName} />
          <Field label={t.setPin} placeholder="••••" value={pin} onChangeText={setPin} {...pinProps} />
          <Text style={st.muted}>{t.pinHint}</Text>
          <Btn label={t.create} onPress={need(!!name.trim() && pinOk, () => data.createTeam(name.trim(), pin))} />
        </>
      )}
      {(mode === 'worker' || mode === 'join') && (
        <>
          <View style={st.row}><Chip label={t.login} on={mode === 'worker'} onPress={() => go('worker')} /><Chip label={t.join} on={mode === 'join'} onPress={() => go('join')} /></View>
          <Field label={t.teamCode} placeholder={t.codeHint} keyboardType="number-pad" maxLength={6} value={code} onChangeText={setCode} />
          <Field label={t.yourName} value={name} onChangeText={setName} />
          <Field label={mode === 'join' ? t.setPin : t.pin} placeholder="••••" value={pin} onChangeText={setPin} {...pinProps} />
          {mode === 'join' && <Card><Text style={st.muted}>{t.joinHint}</Text><Text style={st.muted}>{t.locationNote}</Text></Card>}
          <Btn label={mode === 'join' ? t.sendJoin : t.login} color={C.green}
            onPress={need(code.length === 6 && !!name.trim() && pinOk, () => (mode === 'join' ? data.joinTeam(code, name, pin) : data.loginWorker(code, name, pin)))} />
        </>
      )}
      {mode !== 'home' && <Btn label={t.back} ghost color={C.gray} onPress={() => go('home')} />}
    </ScrollView>
  );
}
