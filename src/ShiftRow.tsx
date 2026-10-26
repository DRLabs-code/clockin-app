import { Text, View } from 'react-native';
import type { Audit } from './data';
import { fmtDate, fmtDT, fmtTime, Shift } from './hours';
import { t } from './i18n';
import { Btn, C, Card, FadeIn, GeoTag, Tag } from './ui';

export const auditLine = (a: Audit) => {
  const ch = a.before?.ts != null || a.after?.ts != null ? ` ${a.before?.ts ? fmtDT(a.before.ts) : '-'} → ${a.after?.ts ? fmtDT(a.after.ts) : '-'}` : '';
  const br = a.after && 'breakOverride' in a.after ? ` ${t.breakWord} ${a.before?.breakOverride ?? '-'} → ${a.after.breakOverride ?? '-'}` : '';
  return `${fmtDT(a.at)} · ${a.by} · ${t.auditAction[a.action]}${t.auditKind[a.after?.type ?? a.before?.type ?? 'in']}${ch}${br} · ${a.reason}`;
};

/** One shift with its break rule, GPS states, sync status and flags. `action` adds an edit/correct button. */
export function ShiftRow({ s, i = 0, site, who, action }: { s: Shift; i?: number; site?: string; who?: string; action?: { label: string; onPress: () => void } }) {
  const brk = s.breakSource === 'rule' ? (s.breakMin ? t.breakRuleApplied(s.breakMin) : t.breakNone) : t.breakSet(s.breakMin, t.breakSrc[s.breakSource]);
  return (
    <FadeIn i={i}>
      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ fontSize: 17, fontWeight: '700', color: C.ink, flexShrink: 1 }}>{who ? `${who} · ` : ''}{fmtDate(s.start)} {fmtTime(s.start)}–{s.end ? fmtTime(s.end) : t.ongoing}</Text>
          <Text style={{ fontSize: 17, fontWeight: '700', color: C.ink }}>{t.hm(s.minutes)}</Text>
        </View>
        <Text style={{ color: C.muted }}>{site ?? t.noSite}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          <GeoTag geo={s.inGeo} prefix={t.inShort} />
          {s.outGeo && <GeoTag geo={s.outGeo} prefix={t.outShort} />}
          {s.auto && <Tag label={t.autoClosed} fg={C.red} bg={C.redBg} />}
          {s.manual && <Tag label={t.manual} fg={C.amber} bg={C.amberBg} />}
          <Tag label={s.synced ? `✓ ${t.syncedOne}` : `⏳ ${t.unsyncedOne}`} fg={s.synced ? C.green : C.amber} bg={s.synced ? C.greenBg : C.amberBg} />
        </View>
        <Text style={{ color: C.muted, fontSize: 14 }}>{brk}</Text>
        {action && <Btn label={action.label} small ghost onPress={action.onPress} />}
      </Card>
    </FadeIn>
  );
}
