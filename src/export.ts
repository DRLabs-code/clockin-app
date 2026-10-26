import { Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { t } from './i18n';

export type Row = { name: string; days: number[]; total: number };

const h = (m: number) => (m / 60).toFixed(2);
const cell = (s: string) => `"${s.replace(/"/g, '""')}"`;

export function toCsv(rows: Row[], ws: number): string {
  const dates = t.days.map((d, i) => {
    const x = new Date(ws + i * 86_400_000 + 3_600_000);
    return `${x.getMonth() + 1}/${x.getDate()} 周${d}`;
  });
  const lines = [[t.workers, ...dates, t.total + '(小时)'], ...rows.map((r) => [r.name, ...r.days.map(h), h(r.total)])];
  // BOM so Excel reads UTF-8 Chinese correctly
  return '\uFEFF' + lines.map((l) => l.map((c) => cell(String(c))).join(',')).join('\r\n');
}

export async function shareCsv(csv: string, ws: number) {
  const name = `timesheet-${new Date(ws).toISOString().slice(0, 10)}.csv`;
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
