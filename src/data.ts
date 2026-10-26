// Single data-layer interface. The UI only imports `data` from here.
// To switch to Supabase: implement `DataSource` (see supabase/schema.sql) and change the last line.
// All business rules (auth, approval, locking, audit) live behind this interface so a server can enforce them.
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { createLocal } from './local';

export type Role = 'boss' | 'worker';
export type Geo = 'on' | 'off' | 'none'; // 在场 / 不在场 / 无定位
export type Status = 'pending' | 'approved' | 'rejected';

export type Settings = {
  breakMinutes: number; // deducted from shifts longer than 5h
  overtimeHours: number; // daily "over X h" threshold
  autoCloseHours: number; // forgotten clock-out is closed after this long
  remindHours: number; // in-app reminder to worker after this long
};
export type Team = Settings & { code: string; name: string };
export type Worker = { id: string; teamCode: string; name: string; status: Status; createdAt: number };
export type Site = { id: string; teamCode: string; name: string; address?: string; lat?: number; lng?: number; radius: number };
export type Punch = {
  id: string;
  teamCode: string;
  workerId: string;
  siteId?: string;
  type: 'in' | 'out';
  ts: number; // device time of the tap (or the corrected time)
  receivedTs?: number; // when "the server" got it (differs from ts when offline)
  lat?: number;
  lng?: number;
  geo: Geo;
  photoUri?: string;
  source: 'self' | 'boss' | 'auto';
  breakMin?: number; // 'out' punch: worker-entered break
  breakOverride?: number; // 'in' punch: boss override for the whole shift
  synced: boolean;
};
export type NewPunch = Omit<Punch, 'id' | 'synced' | 'receivedTs'>;
export type Audit = { id: string; teamCode: string; punchId: string; workerId: string; by: string; at: number; action: 'add' | 'edit' | 'delete' | 'auto'; before?: Partial<Punch>; after?: Partial<Punch>; reason: string };
export type Correction = { id: string; teamCode: string; workerId: string; inId: string; outId: string | null; newIn: number; newOut?: number; reason: string; status: Status; createdAt: number };
export type Approval = { teamCode: string; workerId: string; weekStart: number; by: string; at: number };
/** Worker may have a pending/rejected status; the UI shows a waiting screen until approved. */
export type Session = { role: Role; teamCode: string; name: string; workerId?: string };

/** Errors thrown by DataSource carry one of these codes in `message`. */
export type ErrCode = 'code' | 'pin' | 'dup' | 'status' | 'locked' | 'reason' | 'notfound';

export interface DataSource {
  getSession(): Promise<Session | null>;
  clearSession(): Promise<void>;
  createTeam(teamName: string, pin: string): Promise<Session>;
  listTeams(): Promise<{ code: string; name: string }[]>; // teams the boss can reopen on this device
  loginBoss(code: string, pin: string): Promise<Session>; // throws 'pin' | 'code'
  /** Creates a NEW pending worker (never reuses a name). Throws 'code' | 'dup' (same name + PIN). */
  joinTeam(code: string, workerName: string, pin: string): Promise<Session>;
  loginWorker(code: string, workerName: string, pin: string): Promise<Session>; // throws 'pin' | 'code'
  getTeam(code: string): Promise<Team>;
  updateSettings(code: string, patch: Partial<Settings>): Promise<void>;
  listWorkers(code: string): Promise<Worker[]>;
  decideWorker(workerId: string, approve: boolean): Promise<void>;
  listSites(code: string): Promise<Site[]>;
  saveSite(site: Omit<Site, 'id'> & { id?: string }): Promise<Site>;
  deleteSite(id: string): Promise<void>;
  /** Worker tap. Never blocks on network: stored locally first (synced=false), uploaded by sync(). Throws 'status' unless worker is approved. */
  addPunch(p: NewPunch): Promise<Punch>;
  /** Boss-only changes; all require a reason, keep an audit entry, and throw 'locked' if that worker's week is approved. */
  addPunchAs(by: string, p: NewPunch, reason: string): Promise<Punch>;
  updatePunch(by: string, id: string, patch: Partial<Pick<Punch, 'ts' | 'siteId' | 'breakMin' | 'breakOverride'>>, reason: string): Promise<void>;
  deletePunch(by: string, id: string, reason: string): Promise<void>;
  /** Includes not-yet-synced punches. from <= ts < to. */
  listPunches(code: string, from: number, to: number): Promise<Punch[]>;
  listAudit(code: string): Promise<Audit[]>;
  /** Closes shifts left open longer than autoCloseHours. Returns how many were closed. */
  sweep(code: string, now?: number): Promise<number>;
  requestCorrection(c: Pick<Correction, 'teamCode' | 'workerId' | 'inId' | 'outId' | 'newIn' | 'newOut' | 'reason'>): Promise<void>;
  listCorrections(code: string): Promise<Correction[]>;
  decideCorrection(by: string, id: string, approve: boolean): Promise<void>; // approve applies the change (audited)
  listApprovals(code: string): Promise<Approval[]>;
  setApproval(by: string, code: string, workerId: string, weekStart: number, on: boolean): Promise<void>;
  pendingCount(): Promise<number>;
  /** Upload queued punches if online. */
  sync(): Promise<void>;
}

export const data: DataSource = createLocal(
  { get: (k) => AsyncStorage.getItem(k), set: (k, v) => AsyncStorage.setItem(k, v), del: (k) => AsyncStorage.removeItem(k) },
  async () => (await NetInfo.fetch()).isConnected !== false,
);
