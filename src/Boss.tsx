import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { data, Punch, Session, Team, Worker } from './data';
import { DAY, isOnSite, startOfDay, weekMinutes, weekStart } from './hours';
import { Row, shareCsv, toCsv } from './export';
import { t } from './i18n';
import { Btn, C, s } from './ui';

export default function Boss({ session, onLogout }: { session: Session; onLogout: () => void }) {
  const [team, setTeam] = useState<Team>();
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [punches, setPunches] = useState<Punch[]>([]);
  const [week, setWeek] = useState(0);
  const ws = weekStart(week);

  const load = useCallback(async () => {
    await data.sync();
    setTeam(await data.getTeam(session.teamCode));
    setWorkers(await data.listWorkers(session.teamCode));
    setPunches(await data.listPunches(session.teamCode, Math.min(ws, startOfDay(Date.now()) - DAY), ws + 8 * DAY));
  }, [session, ws]);

  useEffect(() => {
    load();
    const id = setInterval(load, 15_000);
    return () => clearInterval(id);
  }, [load]);

  const setBreak = async (m: number) => {
    await data.setBreakMinutes(session.teamCode, Math.max(0, m));
    load();
  };

  const mine = (w: Worker) => punches.filter((p) => p.workerId === w.id);
  const rows: Row[] = workers.map((w) => {
    const days = weekMinutes(mine(w), team?.breakMinutes ?? 30, ws);
    return { name: w.name, days, total: days.reduce((a, b) => a + b, 0) };
  });
  const fmtDay = (i: number) => {
    const d = new Date(ws + i * DAY + 3_600_000);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };

  return (
    <ScrollView contentContainerStyle={s.body}>
      <View style={s.row}>
        <Text style={s.title}>{team?.name}</Text>
        <Pressable onPress={onLogout}><Text style={{ color: C.blue }}>{t.logout}</Text></Pressable>
      </View>
      <View style={s.card}>
        <Text style={s.muted}>{t.teamCode}</Text>
        <Text style={{ fontSize: 36, fontWeight: '700', letterSpacing: 4 }} selectable>{session.teamCode}</Text>
      </View>

      <Text style={s.h2}>{t.workers}</Text>
      {workers.length === 0 && <Text style={s.muted}>{t.noWorkers}</Text>}
      {workers.map((w) => {
        const on = isOnSite(mine(w));
        return (
          <View key={w.id} style={[s.card, s.row]}>
            <Text style={{ fontSize: 18 }}>{w.name}</Text>
            <Text style={{ color: on ? C.green : C.gray, fontWeight: '600' }}>{on ? `● ${t.onSite}` : t.offDuty}</Text>
          </View>
        );
      })}

      <Text style={s.h2}>{t.weekly}</Text>
      <View style={s.row}>
        <Btn label="‹" onPress={() => setWeek(week - 1)} style={{ paddingVertical: 6 }} />
        <Text style={{ fontSize: 16 }}>{fmtDay(0)} – {fmtDay(6)}</Text>
        <Btn label="›" onPress={() => setWeek(week + 1)} style={{ paddingVertical: 6 }} />
      </View>
      <View style={s.card}>
        <View style={s.row}>
          <Text style={s.muted}>{t.breakRule(team?.breakMinutes ?? 30)}</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Btn label="−" onPress={() => setBreak((team?.breakMinutes ?? 30) - 5)} style={{ paddingVertical: 4 }} />
            <Btn label="+" onPress={() => setBreak((team?.breakMinutes ?? 30) + 5)} style={{ paddingVertical: 4 }} />
          </View>
        </View>
        <View style={[s.row, { marginTop: 10 }]}>
          <Text style={{ flex: 2 }} />
          {t.days.map((d) => <Text key={d} style={{ flex: 1, textAlign: 'center', fontWeight: '600' }}>{d}</Text>)}
          <Text style={{ flex: 1.5, textAlign: 'right', fontWeight: '600' }}>{t.total}</Text>
        </View>
        {rows.map((r) => (
          <View key={r.name} style={[s.row, { marginTop: 8 }]}>
            <Text style={{ flex: 2 }} numberOfLines={1}>{r.name}</Text>
            {r.days.map((m, i) => <Text key={i} style={{ flex: 1, textAlign: 'center' }}>{m ? (m / 60).toFixed(1) : '-'}</Text>)}
            <Text style={{ flex: 1.5, textAlign: 'right', fontWeight: '700' }}>{(r.total / 60).toFixed(1)}h</Text>
          </View>
        ))}
      </View>
      <Btn label={t.export} color={C.green} onPress={() => shareCsv(toCsv(rows, ws), ws)} />
    </ScrollView>
  );
}
