import { Platform, View } from 'react-native';
import qrcode from 'qrcode-generator';

const WEB_URL = 'https://drlabs-code.github.io/clockin-app/';
/** Phone camera opens this URL; the web app reads ?site= and preselects the site. */
export const siteUrl = (code: string, siteId: string) => `${WEB_URL}?site=${code}.${siteId}`;
export const parseSite = (url?: string | null) => {
  const v = url && /[?&]site=([\w.]+)/.exec(url)?.[1];
  const [code, id] = v ? v.split('.') : [];
  return code && id ? { code, id } : undefined;
};
let scanned: { code: string; id: string } | undefined;
export const setScanned = (x?: { code: string; id: string }) => { scanned = x; };
export const takeScanned = () => { const x = scanned; scanned = undefined; return x; };

const make = (text: string) => { const q = qrcode(0, 'M'); q.addData(text); q.make(); return q; };

/** Dark runs per row are merged into single Views (light on cheap rendering, no SVG dependency). */
export function Qr({ text, size = 240 }: { text: string; size?: number }) {
  const q = make(text), n = q.getModuleCount(), c = size / (n + 4);
  const runs: { r: number; x: number; w: number }[] = [];
  for (let r = 0; r < n; r++) for (let x = 0; x < n; x++) if (q.isDark(r, x)) {
    const last = runs[runs.length - 1];
    if (last && last.r === r && last.x + last.w === x) last.w++;
    else runs.push({ r, x, w: 1 });
  }
  return (
    <View style={{ width: size, height: size, backgroundColor: '#fff', alignSelf: 'center' }}>
      {runs.map((u, i) => <View key={i} style={{ position: 'absolute', left: (u.x + 2) * c, top: (u.r + 2) * c, width: u.w * c + 0.5, height: c + 0.5, backgroundColor: '#000' }} />)}
    </View>
  );
}

/** Web only: opens a clean printable page with the site name and QR. */
export function printQr(title: string, text: string): boolean {
  if (Platform.OS !== 'web') return false;
  const w = window.open('', '_blank');
  if (!w) return false;
  w.document.write(`<title>${title}</title><body style="font-family:sans-serif;text-align:center;margin:40px"><h1 style="font-size:48px">${title.replace(/</g, '&lt;')}</h1>${make(text).createSvgTag({ cellSize: 10, margin: 2 })}</body>`);
  w.document.close();
  w.focus();
  w.print();
  return true;
}
