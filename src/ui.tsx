import { ReactNode, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, TextInputProps, View, ViewStyle } from 'react-native';
import * as Haptics from 'expo-haptics';
import NetInfo from '@react-native-community/netinfo';
import { data, Geo } from './data';
import { mapUrl } from './location';
import { t } from './i18n';

// Calm, high-contrast palette (white on primary/green/red ≥ 4.5:1).
export const C = {
  bg: '#f3f5f4', card: '#ffffff', ink: '#1f2a33', muted: '#5b6770', line: '#e2e7e5',
  primary: '#1f5f8b', green: '#2e7d57', red: '#b94141', amber: '#a15c07', gray: '#5b6770',
  greenBg: '#e4f2ea', redBg: '#f8e7e7', amberBg: '#fbf0dc', blueBg: '#e5eff6', grayBg: '#eceff0',
};
export const S = { xs: 6, sm: 10, md: 16, lg: 24 };
const ND = Platform.OS !== 'web';

export const buzz = (kind: 'ok' | 'err' | 'tap' = 'tap') => {
  if (Platform.OS === 'web') return;
  (kind === 'tap' ? Haptics.selectionAsync() : Haptics.notificationAsync(kind === 'ok' ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error)).catch(() => {});
};

// ---- Toasts (non-blocking feedback) ----
let emit: (m: { text: string; kind: 'ok' | 'err' }) => void = () => {};
export const toast = (text: string, kind: 'ok' | 'err' = 'ok') => emit({ text, kind });
export const toastErr = (e: unknown) => {
  const c = e instanceof Error ? e.message : '';
  toast((t.err as Record<string, string>)[c] ?? t.errGeneric, 'err');
  buzz('err');
};
export function Toasts() {
  const [m, setM] = useState<{ text: string; kind: 'ok' | 'err' }>();
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    emit = (x) => {
      setM(x);
      Animated.sequence([Animated.timing(a, { toValue: 1, duration: 180, useNativeDriver: ND }), Animated.delay(2600), Animated.timing(a, { toValue: 0, duration: 220, useNativeDriver: ND })]).start();
    };
  }, [a]);
  if (!m) return null;
  return (
    <Animated.View pointerEvents="none" style={[st.toast, { backgroundColor: m.kind === 'ok' ? C.ink : C.red, opacity: a, transform: [{ translateY: a.interpolate({ inputRange: [0, 1], outputRange: [-16, 0] }) }] }]}>
      <Text style={st.toastText}>{m.text}</Text>
    </Animated.View>
  );
}

// ---- Buttons with press feedback; async handlers show a spinner instead of freezing ----
export function Btn({ label, onPress, color = C.primary, ghost, small, disabled, style }: { label: string; onPress: () => void | Promise<unknown>; color?: string; ghost?: boolean; small?: boolean; disabled?: boolean; style?: ViewStyle }) {
  const v = useRef(new Animated.Value(1)).current;
  const [busy, setBusy] = useState(false);
  const to = (x: number) => Animated.spring(v, { toValue: x, speed: 40, bounciness: 0, useNativeDriver: ND }).start();
  const press = async () => {
    if (busy || disabled) return;
    buzz('tap');
    const r = onPress();
    if (r instanceof Promise) {
      setBusy(true);
      try { await r; } finally { setBusy(false); }
    }
  };
  return (
    <Pressable onPress={press} onPressIn={() => to(0.96)} onPressOut={() => to(1)} accessibilityRole="button">
      <Animated.View style={[st.btn, small && st.btnSmall, ghost ? { borderWidth: 1.5, borderColor: color } : { backgroundColor: color }, { opacity: disabled ? 0.45 : v.interpolate({ inputRange: [0.96, 1], outputRange: [0.8, 1] }), transform: [{ scale: v }] }, style]}>
        {busy ? <ActivityIndicator color={ghost ? color : '#fff'} /> : <Text style={[st.btnText, small && { fontSize: 15 }, ghost && { color }]}>{label}</Text>}
      </Animated.View>
    </Pressable>
  );
}

export function Chip({ label, on, onPress }: { label: string; on?: boolean; onPress?: () => void }) {
  return (
    <Pressable onPress={() => { buzz('tap'); onPress?.(); }} style={[st.chip, on && { backgroundColor: C.primary, borderColor: C.primary }]}>
      <Text style={{ fontSize: 16, color: on ? '#fff' : C.ink, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

export const Tag = ({ label, fg, bg }: { label: string; fg: string; bg: string }) => (
  <View style={{ backgroundColor: bg, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 }}><Text style={{ color: fg, fontSize: 13, fontWeight: '600' }}>{label}</Text></View>
);

const GEO: Record<Geo, [string, string]> = { on: [C.green, C.greenBg], off: [C.red, C.redBg], none: [C.gray, C.grayBg] };
export const GeoTag = ({ geo, prefix }: { geo: Geo; prefix?: string }) => <Tag label={`${prefix ?? ''}${t.geo[geo]}`} fg={GEO[geo][0]} bg={GEO[geo][1]} />;

export function Field({ label, ...p }: TextInputProps & { label?: string }) {
  return (
    <View style={{ gap: 4 }}>
      {!!label && <Text style={st.label}>{label}</Text>}
      <TextInput placeholderTextColor="#8a949b" {...p} style={[st.input, p.style]} />
    </View>
  );
}

export function Stepper({ label, value, unit, min, max, step = 1, onChange }: { label: string; value: number; unit: string; min: number; max: number; step?: number; onChange: (v: number) => void }) {
  return (
    <View style={st.rowBetween}>
      <Text style={{ flex: 1, fontSize: 16, color: C.ink }}>{label}</Text>
      <Btn label="−" small ghost disabled={value <= min} onPress={() => onChange(Math.max(min, value - step))} style={{ width: 48 }} />
      <Text style={{ width: 64, textAlign: 'center', fontSize: 17, fontWeight: '700' }}>{value}{unit}</Text>
      <Btn label="+" small ghost disabled={value >= max} onPress={() => onChange(Math.min(max, value + step))} style={{ width: 48 }} />
    </View>
  );
}

export const Card = ({ children, style }: { children: ReactNode; style?: ViewStyle }) => <View style={[st.card, style]}>{children}</View>;
export const H2 = ({ children }: { children: ReactNode }) => <Text style={st.h2}>{children}</Text>;

// ---- Motion helpers ----
export function FadeIn({ i = 0, children }: { i?: number; children: ReactNode }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => { Animated.timing(v, { toValue: 1, duration: 260, delay: Math.min(i, 8) * 40, useNativeDriver: ND }).start(); }, [v, i]);
  return <Animated.View style={{ opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] }}>{children}</Animated.View>;
}

/** Fade + slight slide whenever `k` changes (screen / tab transitions). */
export function Transition({ k, children }: { k: string; children: ReactNode }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => { v.setValue(0); Animated.timing(v, { toValue: 1, duration: 220, useNativeDriver: ND }).start(); }, [k, v]);
  return <Animated.View style={{ flex: 1, opacity: v, transform: [{ translateX: v.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] }}>{children}</Animated.View>;
}

export function Skeleton({ n = 3, h = 72 }: { n?: number; h?: number }) {
  const v = useRef(new Animated.Value(0.45)).current;
  useEffect(() => {
    const l = Animated.loop(Animated.sequence([Animated.timing(v, { toValue: 1, duration: 700, useNativeDriver: ND }), Animated.timing(v, { toValue: 0.45, duration: 700, useNativeDriver: ND })]));
    l.start();
    return () => l.stop();
  }, [v]);
  return <>{Array.from({ length: n }, (_, i) => <Animated.View key={i} style={{ height: h, borderRadius: 14, backgroundColor: '#dde3e1', opacity: v }} />)}</>;
}

export function Sheet({ visible, onClose, title, children }: { visible: boolean; onClose: () => void; title: string; children: ReactNode }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(20,30,36,0.45)', justifyContent: 'flex-end' }}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <View style={st.sheet}>
          <View style={st.rowBetween}>
            <Text style={[st.h2, { marginTop: 0 }]}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={12}><Text style={{ color: C.primary, fontSize: 16, fontWeight: '600' }}>{t.close}</Text></Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: S.sm, paddingBottom: S.lg }}>{children}</ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export function Loc({ lat, lng }: { lat?: number; lng?: number }) {
  if (lat == null || lng == null) return null;
  return <Pressable onPress={() => Linking.openURL(mapUrl(lat, lng))}><Text style={{ color: C.primary, fontSize: 14 }}>📍 {lat.toFixed(5)}, {lng.toFixed(5)} · {t.openMap}</Text></Pressable>;
}

export function useOnline() {
  const [on, setOn] = useState(true);
  useEffect(() => NetInfo.addEventListener((x) => setOn(x.isConnected !== false)), []);
  return on;
}

/** Shows "offline – N records saved on this phone" / "N waiting to sync"; syncs when back online. */
export function SyncBar({ refresh }: { refresh?: () => void }) {
  const online = useOnline();
  const [n, setN] = useState(0);
  useEffect(() => {
    const run = async () => { if (online) { await data.sync(); refresh?.(); } setN(await data.pendingCount()); };
    run();
    const id = setInterval(run, 5000);
    return () => clearInterval(id);
  }, [online, refresh]);
  if (online && !n) return null;
  return (
    <View style={[st.bar, { backgroundColor: online ? C.blueBg : C.amberBg }]}>
      <Text style={{ color: online ? C.primary : C.amber, fontWeight: '600' }}>{online ? t.pending(n) : t.offline(n)}</Text>
    </View>
  );
}

export const Banner = ({ text, tone = 'amber' }: { text: string; tone?: 'amber' | 'red' }) => (
  <View style={[st.bar, { backgroundColor: tone === 'red' ? C.redBg : C.amberBg }]}><Text style={{ color: tone === 'red' ? C.red : C.amber, fontWeight: '600', fontSize: 15 }}>{text}</Text></View>
);

export const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg, alignItems: 'center' },
  inner: { flex: 1, width: '100%', maxWidth: 600 },
  body: { padding: S.md, paddingTop: Platform.OS === 'web' ? S.lg : 52, gap: S.md, paddingBottom: 40 },
  title: { fontSize: 26, fontWeight: '700', color: C.ink },
  h2: { fontSize: 18, fontWeight: '700', color: C.ink, marginTop: S.xs },
  muted: { color: C.muted, fontSize: 14 },
  label: { color: C.muted, fontSize: 14, fontWeight: '600' },
  input: { backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: C.line, paddingHorizontal: 14, paddingVertical: 13, fontSize: 18, color: C.ink, minHeight: 52 },
  btn: { borderRadius: 14, minHeight: 54, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' },
  btnSmall: { minHeight: 44, paddingHorizontal: 14 },
  btnText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  chip: { minHeight: 44, paddingHorizontal: 14, borderRadius: 22, borderWidth: 1.5, borderColor: C.line, backgroundColor: '#fff', justifyContent: 'center' },
  card: { backgroundColor: C.card, borderRadius: 16, padding: S.md, gap: S.xs, borderWidth: 1, borderColor: C.line },
  row: { flexDirection: 'row', alignItems: 'center', gap: S.sm, flexWrap: 'wrap' },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: S.sm },
  bar: { paddingVertical: 10, paddingHorizontal: S.md, borderRadius: 12 },
  toast: { position: 'absolute', top: Platform.OS === 'web' ? 16 : 48, left: S.md, right: S.md, maxWidth: 560, alignSelf: 'center', borderRadius: 14, paddingVertical: 14, paddingHorizontal: S.md, zIndex: 99 },
  toastText: { color: '#fff', fontSize: 16, fontWeight: '600', textAlign: 'center' },
  sheet: { backgroundColor: C.bg, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: S.md, maxHeight: '88%', width: '100%', maxWidth: 600, alignSelf: 'center', gap: S.sm },
});
