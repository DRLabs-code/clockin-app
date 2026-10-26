import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, Text, TextInput, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { data, Role, Session } from './src/data';
import { t } from './src/i18n';
import { Btn, C, s } from './src/ui';
import Boss from './src/Boss';
import WorkerScreen from './src/Worker';

function Setup({ onDone }: { onDone: (x: Session) => void }) {
  const [role, setRole] = useState<Role | null>(null);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');

  const submit = async () => {
    if (!name.trim() || (role === 'worker' && code.length !== 6)) return Alert.alert(t.errInput);
    try {
      onDone(role === 'boss' ? await data.createTeam(name.trim()) : await data.joinTeam(code, name.trim()));
    } catch {
      Alert.alert(t.errCode);
    }
  };

  if (!role)
    return (
      <View style={s.body}>
        <Text style={s.title}>{t.appName}</Text>
        <Text style={s.h2}>{t.chooseRole}</Text>
        <Btn label={t.boss} color={C.blue} onPress={() => setRole('boss')} />
        <Btn label={t.worker} color={C.green} onPress={() => setRole('worker')} />
      </View>
    );
  return (
    <View style={s.body}>
      <Text style={s.title}>{role === 'boss' ? t.boss : t.worker}</Text>
      {role === 'worker' && (
        <TextInput style={s.input} placeholder={t.codeHint} keyboardType="number-pad" maxLength={6} value={code} onChangeText={setCode} />
      )}
      <TextInput style={s.input} placeholder={role === 'boss' ? t.teamName : t.yourName} value={name} onChangeText={setName} />
      <Btn label={role === 'boss' ? t.create : t.join} onPress={submit} />
      <Btn label={t.back} color={C.gray} onPress={() => setRole(null)} />
    </View>
  );
}

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  useEffect(() => {
    data.getSession().then(setSession);
  }, []);
  const logout = async () => {
    await data.clearSession();
    setSession(null);
  };

  return (
    <View style={s.screen}>
      <StatusBar style="dark" />
      {session === undefined ? (
        <ActivityIndicator style={{ marginTop: 100 }} />
      ) : session === null ? (
        <ScrollView keyboardShouldPersistTaps="handled">
          <Setup onDone={setSession} />
        </ScrollView>
      ) : session.role === 'boss' ? (
        <Boss session={session} onLogout={logout} />
      ) : (
        <WorkerScreen session={session} onLogout={logout} />
      )}
    </View>
  );
}
