// Single data-layer interface. The UI only imports `data` from here.
// To switch to Supabase: implement `DataSource` (see supabase/schema.sql) and change the last line.
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';

export type Role = 'boss' | 'worker';
export type Team = { code: string; name: string; breakMinutes: number };
export type Worker = { id: string; teamCode: string; name: string };
export type Punch = {
  id: string;
  teamCode: string;
  workerId: string;
  type: 'in' | 'out';
  ts: number; // epoch ms
  lat?: number;
  lng?: number;
  photoUri?: string;
  synced: boolean;
};
export type NewPunch = Omit<Punch, 'id' | 'synced'>;
export type Session = { role: Role; teamCode: string; name: string; workerId?: string };

export interface DataSource {
  getSession(): Promise<Session | null>;
  clearSession(): Promise<void>;
  createTeam(teamName: string): Promise<Session>;
  joinTeam(code: string, workerName: string): Promise<Session>; // throws Error('code') if unknown
  getTeam(code: string): Promise<Team>;
  setBreakMinutes(code: string, minutes: number): Promise<void>;
  listWorkers(code: string): Promise<Worker[]>;
  /** Never blocks on network: stored locally first, uploaded by sync(). */
  addPunch(p: NewPunch): Promise<Punch>;
  /** Includes not-yet-synced punches. from <= ts < to. */
  listPunches(code: string, from: number, to: number): Promise<Punch[]>;
  pendingCount(): Promise<number>;
  /** Upload queued punches if online. */
  sync(): Promise<void>;
}

type DB = { teams: Team[]; workers: Worker[]; punches: Punch[] };
const K = { db: 'clockin.db', queue: 'clockin.queue', session: 'clockin.session' };
const read = async <T>(k: string, d: T): Promise<T> => JSON.parse((await AsyncStorage.getItem(k)) ?? 'null') ?? d;
const write = (k: string, v: unknown) => AsyncStorage.setItem(k, JSON.stringify(v));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

let lock: Promise<unknown> = Promise.resolve();
const serial = <T>(f: () => Promise<T>): Promise<T> => {
  const r = lock.then(f, f);
  lock = r.catch(() => {});
  return r;
};

// Local implementation: "server" DB and the offline queue both live in AsyncStorage on this device.
// Data is therefore NOT shared between phones until a remote implementation replaces it.
const local: DataSource = {
  getSession: () => read<Session | null>(K.session, null),
  clearSession: () => AsyncStorage.removeItem(K.session),

  createTeam: (name) =>
    serial(async () => {
      const db = await read<DB>(K.db, { teams: [], workers: [], punches: [] });
      let code: string;
      do code = String(Math.floor(100000 + Math.random() * 900000));
      while (db.teams.some((x) => x.code === code));
      db.teams.push({ code, name, breakMinutes: 30 });
      await write(K.db, db);
      const s: Session = { role: 'boss', teamCode: code, name };
      await write(K.session, s);
      return s;
    }),

  joinTeam: (code, name) =>
    serial(async () => {
      const db = await read<DB>(K.db, { teams: [], workers: [], punches: [] });
      if (!db.teams.some((x) => x.code === code)) throw new Error('code');
      let w = db.workers.find((x) => x.teamCode === code && x.name === name);
      if (!w) {
        w = { id: uid(), teamCode: code, name };
        db.workers.push(w);
        await write(K.db, db);
      }
      const s: Session = { role: 'worker', teamCode: code, name, workerId: w.id };
      await write(K.session, s);
      return s;
    }),

  getTeam: async (code) => {
    const db = await read<DB>(K.db, { teams: [], workers: [], punches: [] });
    const t = db.teams.find((x) => x.code === code);
    if (!t) throw new Error('code');
    return t;
  },

  setBreakMinutes: (code, minutes) =>
    serial(async () => {
      const db = await read<DB>(K.db, { teams: [], workers: [], punches: [] });
      const t = db.teams.find((x) => x.code === code);
      if (t) t.breakMinutes = minutes;
      await write(K.db, db);
    }),

  listWorkers: async (code) =>
    (await read<DB>(K.db, { teams: [], workers: [], punches: [] })).workers.filter((w) => w.teamCode === code),

  addPunch: (p) =>
    serial(async () => {
      const q = await read<Punch[]>(K.queue, []);
      const punch: Punch = { ...p, id: uid(), synced: false };
      q.push(punch);
      await write(K.queue, q);
      return punch;
    }),

  listPunches: async (code, from, to) => {
    const db = await read<DB>(K.db, { teams: [], workers: [], punches: [] });
    const q = await read<Punch[]>(K.queue, []);
    return [...db.punches, ...q].filter((p) => p.teamCode === code && p.ts >= from && p.ts < to);
  },

  pendingCount: async () => (await read<Punch[]>(K.queue, [])).length,

  sync: () =>
    serial(async () => {
      if ((await NetInfo.fetch()).isConnected === false) return;
      const q = await read<Punch[]>(K.queue, []);
      if (!q.length) return;
      const db = await read<DB>(K.db, { teams: [], workers: [], punches: [] });
      db.punches.push(...q.map((p) => ({ ...p, synced: true })));
      await write(K.db, db);
      await write(K.queue, []);
    }),
};

export const data: DataSource = local;
