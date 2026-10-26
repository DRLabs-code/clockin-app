import { Linking, Pressable, StyleSheet, Text, ViewStyle } from 'react-native';
import { mapUrl } from './location';
import { t } from './i18n';

export const C = { green: '#16a34a', red: '#dc2626', blue: '#2563eb', gray: '#6b7280', bg: '#f3f4f6' };

export function Btn({ label, onPress, color = C.blue, style }: { label: string; onPress: () => void; color?: string; style?: ViewStyle }) {
  return (
    <Pressable onPress={onPress} style={[s.btn, { backgroundColor: color }, style]}>
      <Text style={s.btnText}>{label}</Text>
    </Pressable>
  );
}

export function Loc({ lat, lng, label }: { lat?: number; lng?: number; label?: boolean }) {
  if (lat == null || lng == null) return <Text style={{ color: C.gray }}>{label ? '📍 ' : ''}{t.noLocation}</Text>;
  return (
    <Pressable onPress={() => Linking.openURL(mapUrl(lat, lng))}>
      <Text style={{ color: C.blue }}>📍 {lat.toFixed(5)}, {lng.toFixed(5)} · {t.openMap}</Text>
    </Pressable>
  );
}

export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  body: { padding: 20, paddingTop: 60, gap: 14 },
  title: { fontSize: 26, fontWeight: '700' },
  h2: { fontSize: 18, fontWeight: '600', marginTop: 8 },
  muted: { color: C.gray },
  input: { backgroundColor: '#fff', borderRadius: 10, padding: 14, fontSize: 18 },
  btn: { borderRadius: 12, paddingVertical: 14, paddingHorizontal: 18, alignItems: 'center' },
  btnText: { color: '#fff', fontSize: 18, fontWeight: '600' },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 14 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
