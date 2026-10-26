import { useEffect, useState } from 'react';
import { Linking, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { data, Session } from './src/data';
import { parseSite, setScanned } from './src/qr';
import { Skeleton, st, Toasts, Transition } from './src/ui';
import Auth from './src/Auth';
import Boss from './src/Boss';
import WorkerScreen from './src/Worker';

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  useEffect(() => {
    data.getSession().then(setSession);
    Linking.getInitialURL().then((u) => setScanned(parseSite(u))); // opened from a site QR code
  }, []);
  const logout = async () => {
    await data.clearSession();
    setSession(null);
  };
  const key = session === undefined ? 'load' : session === null ? 'auth' : session.role + session.workerId;

  return (
    <View style={st.screen}>
      <StatusBar style="dark" />
      <View style={st.inner}>
        <Transition k={key}>
          {session === undefined ? <View style={st.body}><Skeleton n={3} /></View>
            : session === null ? <Auth onDone={setSession} />
            : session.role === 'boss' ? <Boss session={session} onLogout={logout} />
            : <WorkerScreen session={session} onLogout={logout} />}
        </Transition>
      </View>
      <Toasts />
    </View>
  );
}
