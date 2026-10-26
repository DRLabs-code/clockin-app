import { Platform } from 'react-native';
import * as Location from 'expo-location';

export type Fix = { lat: number; lng: number };
const TIMEOUT = 8000;

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T | undefined> =>
  new Promise((resolve) => {
    const id = setTimeout(() => resolve(undefined), ms);
    p.then(
      (v) => { clearTimeout(id); resolve(v); },
      () => { clearTimeout(id); resolve(undefined); },
    );
  });

/** One-shot fix (no tracking). Never throws, never hangs longer than ~8s. Returns undefined when there is no fix. */
export async function getFix(): Promise<Fix | undefined> {
  if (Platform.OS === 'web') {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return undefined;
    return new Promise((resolve) => {
      const id = setTimeout(() => resolve(undefined), TIMEOUT + 1000); // hard guard
      navigator.geolocation.getCurrentPosition(
        (p) => { clearTimeout(id); resolve({ lat: p.coords.latitude, lng: p.coords.longitude }); },
        () => { clearTimeout(id); resolve(undefined); },
        { enableHighAccuracy: true, timeout: TIMEOUT, maximumAge: 15000 },
      );
    });
  }
  const run = async (): Promise<Fix | undefined> => {
    if (!(await Location.requestForegroundPermissionsAsync()).granted) return undefined;
    const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }); // fresh fix, never a stale cached one
    return { lat: p.coords.latitude, lng: p.coords.longitude };
  };
  return withTimeout(run(), TIMEOUT);
}

export const mapUrl = (lat: number, lng: number) => `https://maps.google.com/?q=${lat},${lng}`;
