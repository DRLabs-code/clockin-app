import { Platform, Share } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { t } from './i18n';
import { fmtDT, fmtTime, Shift } from './hours';

const cell = (s: string | number) => `"${String(s).replace(/"/g, '""')}"`;
const h = (m: number) => (m / 60).toFixed(2);

export type Item = { name: string; shift: Shift; siteName: string; approved: boolean; edits: number };

/** One row per shift. Unapproved shifts are either left out (onlyApproved) or marked. BOM so Excel reads UTF-8. */
export function detailCsv(items: Item[], onlyApproved: boolean): string {
  const head = [t.workers, t.csvDate, t.site, t.csvIn, t.csvOut, t.csvInGeo, t.csvOutGeo, t.csvBreak, t.csvBreakSrc, t.csvHours, t.csvApproved, t.csvEdits, t.csvAuto];
  const rows = items
    .filter((i) => i.approved || !onlyApproved)
    .sort((a, b) => a.name.localeCompare(b.name) || a.shift.start - b.shift.start)
    .map(({ name, shift: s, siteName, approved, edits }) => [
      name, fmtDT(s.start).slice(0, 10), siteName, fmtTime(s.start), s.end ? fmtTime(s.end) : '', t.geo[s.inGeo], s.outGeo ? t.geo[s.outGeo] : '',
      s.breakMin, t.breakSrc[s.breakSource], h(s.minutes), approved ? t.yes : t.notApproved, edits, s.auto ? t.yes : '',
    ]);
  return '\uFEFF' + [head, ...rows].map((l) => l.map(cell).join(',')).join('\r\n');
}

export async function shareCsv(csv: string, ws: number) {
  const name = `timesheet-${fmtDT(ws).slice(0, 10)}.csv`;
  if (Platform.OS === 'web') {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = name;
    a.click();
    return;
  }
  const f = new File(Paths.cache, name);
  f.create({ overwrite: true });
  f.write(csv);
  await Sharing.shareAsync(f.uri, { mimeType: 'text/csv', dialogTitle: t.shareTitle, UTI: 'public.comma-separated-values-text' });
}

/** Returns true if text was put on the clipboard (web), false if a share sheet was shown. */
export async function shareText(text: string): Promise<boolean> {
  if (Platform.OS === 'web') { await navigator.clipboard?.writeText(text); return true; }
  await Share.share({ message: text });
  return false;
}
