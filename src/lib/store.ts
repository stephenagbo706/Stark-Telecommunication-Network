import { create } from "zustand";
import { persist } from "zustand/middleware";
import { FEES, CASHBACK_RATE, SERVICE_META, type NetworkId } from "./data";
import {
  normalizeEmail, normalizePhone, checkIdentity, formatPhone,
  IDENTITY_CODES, IDENTITY_MESSAGES,
  type KnownAccount, type StarkSession, type AuditEvent, type AuditKind, type IdentityCode,
} from "./identity";

/* ---------------- types ---------------- */
export type Service = "airtime" | "data" | "cable" | "electricity" | "exam" | "betting" | "sms" | "gift" | "funding" | "withdraw";
export type TxStatus = "PENDING" | "PROCESSING" | "SUCCESSFUL" | "FAILED" | "REVERSED";
export type LedgerKind = "CREDIT" | "DEBIT" | "RESERVE" | "RELEASE" | "REVERSAL" | "REFUND" | "FEE" | "CASHBACK" | "REWARD" | "CLAIM" | "WITHDRAW";

export interface LedgerEntry { id: string; ts: number; kind: LedgerKind; amount: number; note: string; ref?: string }
export interface TxMeta {
  network?: string; phone?: string; plan?: string; size?: string; providerName?: string; iuc?: string;
  customer?: string; disco?: string; meter?: string; meterType?: string; token?: string; examBody?: string;
  item?: string; qty?: number; pins?: { serial: string; pin: string }[]; platform?: string; betId?: string;
  senderId?: string; message?: string; recipients?: string[]; units?: number; giftType?: string; note?: string;
  bank?: string; account?: string; accountName?: string;
}
export interface Tx {
  id: string; ref: string; service: Service; title: string; amount: number; fee: number; total: number;
  status: TxStatus; provider: string; providerRef?: string; createdAt: number; completedAt?: number;
  failReason?: string; meta: TxMeta;
}
export interface Beneficiary { id: string; service: Service; label: string; value: string; network?: string; extra?: string; fav?: boolean; ts: number }
export interface Notice { id: string; ts: number; title: string; body: string; kind: "success" | "error" | "info" | "security" | "reward"; read: boolean }
export interface Ticket { id: string; ts: number; subject: string; category: string; body: string; status: "OPEN" | "UNDER_REVIEW" | "RESOLVED"; ref?: string }
export interface Sub { id: string; name: string; provider: string; price: number; cycle: string; nextRenewal: number; autoRenew: boolean; history: { ts: number; ref: string }[] }
export interface Device { id: string; name: string; platform: string; lastActive: number; current: boolean }
export interface Profile {
  name: string; phone: string; email: string; pin: string; avatar?: string;
  emailVerified: boolean; phoneVerified: boolean; biometric: boolean; twoFA: boolean; frozen: boolean;
  joinedAt: number; referralCode: string; refEarned: number;
  referrals: { name: string; date: number; status: "ACTIVE" | "PENDING"; earned: number }[];
}
export interface Toast { id: string; msg: string; kind: "ok" | "bad" | "info" }

/* ---------------- helpers ---------------- */
export const uid = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `id-${Date.now()}-${Math.floor(Math.random() * 1e9)}`);

export function makeRef() {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const bytes = new Uint8Array(5);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < 5; i++) bytes[i] = Math.floor(Math.random() * 256);
  const s = Array.from(bytes, (b) => b.toString(36)).join("").toUpperCase().replace(/[^A-Z0-9]/g, "X").padEnd(8, "7").slice(0, 8);
  return `STK-${ymd}-${s}`;
}

export function hashStr(str: string) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => {
    h |= 0; h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
export const money = (n: number) => "₦" + n.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const money0 = (n: number) => "₦" + Math.round(n).toLocaleString("en-NG");
export const timeAgo = (ts: number) => {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};
export const fmtDate = (ts: number) => new Date(ts).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" });
export const fmtTime = (ts: number) => new Date(ts).toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" });

/* ledger math — the wallet is ALWAYS derived from the ledger */
const sum = (l: LedgerEntry[], kinds: LedgerKind[]) => l.filter((e) => kinds.includes(e.kind)).reduce((a, e) => a + e.amount, 0);
export const availableOf = (l: LedgerEntry[]) => sum(l, ["CREDIT", "REVERSAL", "REFUND"]) - sum(l, ["RESERVE", "FEE"]);
export const reservedOf = (l: LedgerEntry[]) => sum(l, ["RESERVE"]) - sum(l, ["RELEASE", "REVERSAL", "REFUND"]);
export const cashbackOf = (l: LedgerEntry[]) => sum(l, ["CASHBACK", "REWARD"]) - sum(l, ["CLAIM"]);
export const depositsOf = (l: LedgerEntry[]) => sum(l, ["CREDIT"]);
export const spendOf = (l: LedgerEntry[]) => sum(l, ["DEBIT"]);

/* ---------------- store ---------------- */
interface StarkState {
  authed: boolean;
  profile: Profile | null;
  ledger: LedgerEntry[];
  txs: Tx[];
  beneficiaries: Beneficiary[];
  notifications: Notice[];
  tickets: Ticket[];
  subs: Sub[];
  devices: Device[];
  logins: { ts: number; device: string; ip: string; location: string; status: "success" | "failed" }[];
  points: number;
  theme: "dark" | "light";
  toasts: Toast[];

  /* identity & multi-device (§2, §16–§18, §27) — PostgreSQL is the
     authority in production; the preview mirrors the same rules. */
  accounts: KnownAccount[];          // registered identities (one per email & phone)
  sessions: StarkSession[];          // this account's live sessions
  audit: AuditEvent[];               // immutable security audit trail

  toast: (msg: string, kind?: Toast["kind"]) => void;
  notify: (n: Omit<Notice, "id" | "ts" | "read">) => void;

  register: (p: { name: string; phone: string; email: string; pin: string }) =>
    | { ok: true }
    | { ok: false; code: IdentityCode; message: string };
  login: (phone: string, pin: string) => string | null;
  logout: () => void;
  revokeSession: (id: string) => void;
  loadDemo: () => void;

  setAvatar: (dataUrl?: string) => void;
  updateProfile: (p: Partial<Profile>) => void;
  changePin: (oldPin: string, newPin: string) => string | null;
  toggleFreeze: () => void;
  setTheme: (t: "dark" | "light") => void;
  logoutOthers: () => void;

  addFunds: (amount: number) => Promise<Tx>;
  withdraw: (amount: number, bank: string, account: string, accountName: string) => Promise<Tx>;
  purchase: (input: { service: Service; title: string; amount: number; meta?: TxMeta }) => Promise<Tx>;
  redeemPoints: (pts: number) => string | null;
  claimCashback: () => string | null;

  markAllRead: () => void;
  markRead: (id: string) => void;
  addTicket: (t: { subject: string; category: string; body: string; ref?: string }) => void;
  addBeneficiary: (b: Omit<Beneficiary, "id" | "ts">) => void;
  removeBeneficiary: (id: string) => void;
  toggleFav: (id: string) => void;
  toggleAutoRenew: (id: string) => void;
}

const entry = (kind: LedgerKind, amount: number, note: string, ref?: string): LedgerEntry => ({ id: uid(), ts: Date.now(), kind, amount, note, ref });
const auditEv = (kind: AuditKind, detail: string): AuditEvent => ({ id: uid(), ts: Date.now(), kind, detail });

const THIS_DEVICE = { name: "This browser", platform: "Web • Chrome", ip: "105.112.34.18", location: "Lagos, NG" };
const newSession = (): StarkSession => ({
  id: uid(), device: THIS_DEVICE.name, platform: THIS_DEVICE.platform,
  ip: THIS_DEVICE.ip, location: THIS_DEVICE.location,
  createdAt: Date.now(), lastUsedAt: Date.now(), current: true, trusted: true,
});

const DEMO_NAMES = ["CHIDERA EZE", "ADAEZE OKAFOR", "TUNDE BALOGUN", "AMINA BELLO", "EMEKA OBI", "FATIMA USMAN", "SEUN ADEYEMI", "Ngozi Anyanwu"];

export const useStark = create<StarkState>()(
  persist(
    (set, get) => ({
      authed: false,
      profile: null,
      ledger: [],
      txs: [],
      beneficiaries: [],
      notifications: [],
      tickets: [],
      subs: [],
      devices: [{ id: "dev-1", name: "This browser", platform: "Web • Chrome", lastActive: Date.now(), current: true }],
      logins: [],
      points: 0,
      theme: "dark",
      toasts: [],
      accounts: [],
      sessions: [],
      audit: [],

      toast: (msg, kind = "info") => {
        const t: Toast = { id: uid(), msg, kind };
        set((s) => ({ toasts: [...s.toasts, t] }));
        setTimeout(() => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== t.id) })), 3600);
      },

      notify: (n) => set((s) => ({ notifications: [{ ...n, id: uid(), ts: Date.now(), read: false }, ...s.notifications] })),

      register: ({ name, phone, email, pin }) => {
        /* §5–§12 — normalize first, then enforce one-account-per-identity. */
        const emailN = normalizeEmail(email);
        const phoneN = normalizePhone(phone);
        if (!phoneN) return { ok: false, code: IDENTITY_CODES.PHONE_ALREADY_REGISTERED, message: "Enter a valid Nigerian phone number." };

        const check = checkIdentity(emailN, phoneN, get().accounts);
        if (!check.ok) return check;

        const profile: Profile = {
          name: name.trim(), phone: phoneN, email: emailN, pin, emailVerified: false, phoneVerified: true, biometric: false, twoFA: false,
          frozen: false, joinedAt: Date.now(), referralCode: `STARK-${name.trim().slice(0, 3).toUpperCase()}${Math.floor(1000 + Math.random() * 9000)}`,
          refEarned: 0, referrals: [],
        };
        const acct: KnownAccount = { id: uid(), name: profile.name, email: emailN, phone: phoneN, status: "active" };
        set((s) => ({
          authed: true, profile, ledger: [], txs: [], beneficiaries: [], points: 0, tickets: [], subs: [],
          accounts: [...s.accounts, acct],
          sessions: [newSession()],
          audit: [auditEv("account_created", `Account created for ${emailN} (${formatPhone(phoneN)})`), ...s.audit],
          notifications: [{ id: uid(), ts: Date.now(), read: false, kind: "info", title: "Welcome to STARK", body: "Your account is ready. Fund your wallet to start buying airtime, data, cable and electricity." }],
          logins: [{ ts: Date.now(), device: THIS_DEVICE.name, ip: THIS_DEVICE.ip, location: THIS_DEVICE.location, status: "success" }],
        }));
        return { ok: true };
      },

      login: (phone, pin) => {
        const p = get().profile;
        if (!p) return "No account found on this device. Create one or load the demo account.";
        /* Match by canonical phone so 0803… / +234803… / 234803… all resolve to the SAME account (§6, §16). */
        const want = normalizePhone(phone);
        const have = normalizePhone(p.phone);
        if (!want || want !== have) return "That phone number does not match the account on this device.";
        if (p.frozen) return IDENTITY_MESSAGES.ACCOUNT_FROZEN;
        if (p.pin !== pin) {
          set((s) => ({
            audit: [auditEv("login_failed", "Incorrect transaction PIN"), ...s.audit],
            logins: [{ ts: Date.now(), device: THIS_DEVICE.name, ip: THIS_DEVICE.ip, location: THIS_DEVICE.location, status: "failed" }, ...s.logins],
          }));
          return "Incorrect transaction PIN. Try again.";
        }

        /* §16–§19 — a new device creates a new session, never a new account. */
        const hasCurrent = get().sessions.some((x) => x.current);
        const fresh = !hasCurrent;
        set((s) => ({
          authed: true,
          sessions: [...s.sessions.filter((x) => !x.current).map((x) => ({ ...x, lastUsedAt: x.lastUsedAt })), newSession()],
          audit: [
            auditEv("login_success", `Signed in from ${THIS_DEVICE.name}`),
            ...(fresh ? [auditEv("new_device_login" as AuditKind, `${THIS_DEVICE.name} • ${THIS_DEVICE.location}`)] : []),
            ...s.audit,
          ],
          logins: [{ ts: Date.now(), device: THIS_DEVICE.name, ip: THIS_DEVICE.ip, location: THIS_DEVICE.location, status: "success" }, ...s.logins],
        }));
        if (fresh) get().notify({ kind: "security", title: "New device signed in", body: `${THIS_DEVICE.name} in ${THIS_DEVICE.location} signed into your Stark account. If this wasn't you, freeze the account from Security.` });
        return null;
      },

      logout: () => {
        /* §21 — revoke this session only; the account, wallet and history stay intact. */
        set((s) => ({
          authed: false,
          sessions: s.sessions.filter((x) => !x.current),
          audit: [auditEv("logout", `Session revoked on ${THIS_DEVICE.name}`), ...s.audit],
        }));
      },

      revokeSession: (id) => {
        /* §22 — ownership is enforced server-side; the preview revokes by id. */
        set((s) => ({
          sessions: s.sessions.filter((x) => x.id !== id),
          audit: [auditEv("session_revoked", "A session was revoked from Security → Devices"), ...s.audit],
        }));
        get().toast("Session revoked", "ok");
      },

      loadDemo: () => {
        const now = Date.now();
        const D = 86400000;
        const L: LedgerEntry[] = [];
        const T: Tx[] = [];
        const mk = (daysAgo: number, service: Service, title: string, amount: number, fee: number, meta: TxMeta, failed = false) => {
          const ts = now - daysAgo * D - Math.floor(Math.random() * 10) * 3600000;
          const ref = makeRef();
          T.push({
            id: uid(), ref, service, title, amount, fee, total: amount + fee,
            status: failed ? "FAILED" : "SUCCESSFUL", provider: SERVICE_META[service].provider,
            providerRef: failed ? undefined : `PV-${Math.random().toString(36).slice(2, 12).toUpperCase()}`,
            createdAt: ts, completedAt: failed ? ts + 4000 : ts + 9000,
            failReason: failed ? "Provider timed out before confirming. No value was delivered." : undefined, meta,
          });
          L.push({ id: uid(), ts, kind: "RESERVE", amount, note: `Reserved — ${title}`, ref });
          if (fee > 0) L.push({ id: uid(), ts, kind: "FEE", amount: fee, note: `Service fee — ${title}`, ref });
          if (failed) {
            L.push({ id: uid(), ts: ts + 4000, kind: "REVERSAL", amount, note: `Auto-reversal — ${title} failed`, ref });
            if (fee > 0) L.push({ id: uid(), ts: ts + 4000, kind: "REFUND", amount: fee, note: `Fee refunded — ${title} failed`, ref });
          } else {
            L.push({ id: uid(), ts: ts + 9000, kind: "RELEASE", amount, note: `Released to provider — ${title}`, ref });
            L.push({ id: uid(), ts: ts + 9000, kind: "DEBIT", amount, note: `Settlement — ${title}`, ref });
          }
        };

        L.push({ id: uid(), ts: now - 30 * D, kind: "CREDIT", amount: 49340, note: "Wallet funding — Paystack card", ref: makeRef() });
        mk(28, "airtime", "MTN Airtime • 0803 472 1189", 1000, 0, { network: "MTN", phone: "0803 472 1189" });
        mk(25, "data", "MTN 2GB • 0803 472 1189", 1200, 0, { network: "MTN", phone: "0803 472 1189", plan: "2GB", size: "2GB" });
        mk(22, "cable", "GOtv Jolli • 5093117722", 4850, 50, { providerName: "GOtv", iuc: "5093117722", customer: "ADAEZE OKAFOR", plan: "GOtv Jolli" });
        mk(19, "electricity", "IKEDC Prepaid • 45030122876", 5000, 100, { disco: "IKEDC", meter: "45030122876", meterType: "Prepaid", customer: "ADAEZE OKAFOR", token: "7742-0193-5568-2214" });
        L.push({ id: uid(), ts: now - 19 * D, kind: "CASHBACK", amount: 25, note: "Cashback — IKEDC electricity purchase" });
        mk(15, "airtime", "Glo Airtime • 0815 904 2231", 500, 0, { network: "GLO", phone: "0815 904 2231" });
        mk(12, "data", "Glo 2.9GB • 0815 904 2231", 2500, 0, { network: "GLO", phone: "0815 904 2231", plan: "2.9GB", size: "2.9GB" });
        L.push({ id: uid(), ts: now - 12 * D, kind: "CASHBACK", amount: 25, note: "Cashback — Glo data bundle" });
        mk(10, "exam", "WAEC Scratch Card ×1", 2850, 50, { examBody: "WAEC", item: "WASSCE Scratch Card", qty: 1, pins: [{ serial: "4501923307", pin: "771204558813" }] });
        mk(8, "betting", "Bet9ja top-up • 44192837", 1500, 0, { platform: "Bet9ja", betId: "44192837" });
        mk(6, "gift", "Gift — MTN 1GB to Chidi", 1000, 25, { network: "MTN", phone: "0812 774 9021", giftType: "data", plan: "1GB", message: "For the exams. — Ada" });
        mk(5, "sms", "Bulk SMS • 145 recipients", 580, 0, { senderId: "STARKNG", units: 145, message: "Town union meeting Saturday 4pm." });
        mk(3, "airtime", "MTN Airtime • 0706 118 3345", 200, 0, { network: "MTN", phone: "0706 118 3345" });
        mk(2, "airtime", "Airtel Airtime • 0901 220 8873", 425, 0, { network: "AIRTEL", phone: "0901 220 8873" });
        mk(1, "airtime", "MTN Airtime • 0803 472 1189", 1000, 0, { network: "MTN", phone: "0803 472 1189" }, true);
        const wts = now - 4 * D;
        const wref = makeRef();
        T.push({ id: uid(), ref: wref, service: "withdraw", title: "Withdrawal • GTBank ••6621", amount: 2000, fee: 10, total: 2010, status: "SUCCESSFUL", provider: "Paystack Transfer", providerRef: `PS-${Math.random().toString(36).slice(2, 10).toUpperCase()}`, createdAt: wts, completedAt: wts + 60000, meta: { bank: "GTBank", account: "0123456621", accountName: "ADAEZE OKAFOR" } });
        L.push({ id: uid(), ts: wts, kind: "RESERVE", amount: 2000, note: "Reserved — withdrawal to GTBank", ref: wref });
        L.push({ id: uid(), ts: wts, kind: "FEE", amount: 10, note: "Transfer fee", ref: wref });
        L.push({ id: uid(), ts: wts + 60000, kind: "RELEASE", amount: 2000, note: "Released — withdrawal payout", ref: wref });
        L.push({ id: uid(), ts: wts + 60000, kind: "WITHDRAW", amount: 2000, note: "Payout — GTBank ••6621", ref: wref });
        L.push({ id: uid(), ts: now - 7 * D, kind: "REWARD", amount: 25, note: "Redeemed 50 STARK points" });
        L.sort((a, b) => b.ts - a.ts);
        T.sort((a, b) => b.createdAt - a.createdAt);

        set({
          authed: true,
          profile: {
            name: "Adaeze Okafor", phone: "0803 472 1189", email: "ada.okafor@gmail.com", pin: "1234",
            emailVerified: true, phoneVerified: true, biometric: true, twoFA: false, frozen: false,
            joinedAt: now - 210 * D, referralCode: "STARK-ADA7", refEarned: 1500,
            referrals: [
              { name: "Chidi Okafor", date: now - 90 * D, status: "ACTIVE", earned: 500 },
              { name: "Blessing Eze", date: now - 41 * D, status: "ACTIVE", earned: 500 },
              { name: "Ibrahim Musa", date: now - 6 * D, status: "PENDING", earned: 0 },
            ],
          },
          ledger: L, txs: T, points: 1240,
          beneficiaries: [
            { id: uid(), service: "airtime", label: "My line", value: "0803 472 1189", network: "MTN", fav: true, ts: now - 60 * D },
            { id: uid(), service: "airtime", label: "Mama", value: "0815 904 2231", network: "GLO", fav: true, ts: now - 55 * D },
            { id: uid(), service: "data", label: "Chidi", value: "0812 774 9021", network: "MTN", ts: now - 30 * D },
            { id: uid(), service: "electricity", label: "Home meter", value: "45030122876", extra: "IKEDC", ts: now - 19 * D },
            { id: uid(), service: "cable", label: "Home GOtv", value: "5093117722", extra: "GOtv", ts: now - 22 * D },
          ],
          notifications: [
            { id: uid(), ts: now - 3600000, read: false, kind: "error", title: "Transaction reversed", body: "MTN Airtime ₦1,000 failed at the provider. The reserved ₦1,000 was returned to your wallet." },
            { id: uid(), ts: now - 5 * 3600000, read: false, kind: "reward", title: "+25 points", body: "You earned STARK points on your Airtel airtime purchase." },
            { id: uid(), ts: now - 26 * 3600000, read: false, kind: "security", title: "New device signed in", body: "Chrome on Windows signed in from Lagos, NG. If this wasn't you, freeze your account immediately." },
            { id: uid(), ts: now - 2 * D, read: true, kind: "success", title: "Airtime successful", body: "MTN Airtime ₦200 to 0706 118 3345 was delivered." },
            { id: uid(), ts: now - 4 * D, read: true, kind: "info", title: "Withdrawal completed", body: "₦2,000 was sent to GTBank ••6621." },
            { id: uid(), ts: now - 6 * D, read: true, kind: "reward", title: "Referral reward", body: "Blessing Eze completed her first purchase. ₦500 referral bonus is pending settlement." },
          ],
          tickets: [{ id: uid(), ts: now - 12 * D, subject: "GOtv bouquet not reflecting", category: "Cable TV", body: "Jolli bouquet paid but decoder still shows Free channels.", status: "RESOLVED", ref: "STK-REF" }],
          subs: [{ id: "sub-1", name: "GOtv Jolli", provider: "GOtv • IUC 5093117722", price: 4850, cycle: "Monthly", nextRenewal: now + 12 * D, autoRenew: true, history: [{ ts: now - 22 * D, ref: "Auto" }, { ts: now - 52 * D, ref: "Manual" }] }],
          devices: [
            { id: "dev-1", name: "Pixel 8 Pro", platform: "Android 15 • STARK App", lastActive: now, current: true },
            { id: "dev-2", name: "Chrome • Windows", platform: "Web session", lastActive: now - 26 * 3600000, current: false },
          ],
          logins: [
            { ts: now - 3600000, device: "Pixel 8 Pro", ip: "105.112.34.18", location: "Lagos, NG", status: "success" },
            { ts: now - 26 * 3600000, device: "Chrome • Windows", ip: "197.210.64.9", location: "Lagos, NG", status: "success" },
            { ts: now - 3 * D, device: "Unknown • Linux", ip: "41.184.22.310", location: "Accra, GH", status: "failed" },
          ],
          /* The demo identity joins the registry — re-registering with the same
             email or phone now correctly reports ACCOUNT_EXISTS. */
          accounts: [
            ...get().accounts.filter((a) => a.email !== "ada.okafor@gmail.com"),
            { id: "usr-demo", name: "Adaeze Okafor", email: "ada.okafor@gmail.com", phone: "+2348034721189", status: "active" },
          ],
          sessions: [
            { id: "ses-demo-1", device: "Pixel 8 Pro", platform: "Android 15 • STARK App", ip: "105.112.34.18", location: "Lagos, NG", createdAt: now - 3 * D, lastUsedAt: now, current: true, trusted: true },
            { id: "ses-demo-2", device: "Chrome • Windows", platform: "Web session", ip: "197.210.64.9", location: "Lagos, NG", createdAt: now - 26 * 3600000, lastUsedAt: now - 26 * 3600000, current: false, trusted: false },
          ],
          audit: [
            auditEv("login_success", "Signed in from Pixel 8 Pro"),
            auditEv("new_device_login", "Chrome • Windows • Lagos, NG"),
            auditEv("login_failed", "Unknown device • Accra, GH — wrong PIN"),
            auditEv("account_created", "Account created for ada.okafor@gmail.com (+234 803 472 1189)"),
          ],
        });
        get().toast("Demo account loaded — PIN 1234", "ok");
      },

      setAvatar: (dataUrl) => set((s) => (s.profile ? { profile: { ...s.profile, avatar: dataUrl } } : {})),
      updateProfile: (p) => set((s) => (s.profile ? { profile: { ...s.profile, ...p } } : {})),
      changePin: (oldPin, newPin) => {
        const p = get().profile;
        if (!p) return "No account.";
        if (p.pin !== oldPin) return "Current PIN is incorrect.";
        if (newPin.length !== 4) return "New PIN must be 4 digits.";
        set({ profile: { ...p, pin: newPin } });
        get().notify({ kind: "security", title: "Transaction PIN changed", body: "Your transaction PIN was updated. If you didn't do this, contact support immediately." });
        return null;
      },
      toggleFreeze: () => {
        const p = get().profile;
        if (!p) return;
        set({ profile: { ...p, frozen: !p.frozen } });
        get().notify({
          kind: "security",
          title: p.frozen ? "Account unfrozen" : "Account frozen",
          body: p.frozen ? "All wallet and purchase functions are active again." : "All purchases, wallet funding and withdrawals are blocked. Sessions remain read-only.",
        });
      },
      setTheme: (t) => set({ theme: t }),
      logoutOthers: () => {
        set((s) => ({ devices: s.devices.filter((d) => d.current), logins: s.logins }));
        get().notify({ kind: "security", title: "Other sessions signed out", body: "All other devices were signed out of your account." });
        get().toast("Other devices signed out", "ok");
      },

      addFunds: async (amount) => {
        if (typeof navigator !== "undefined" && !navigator.onLine) throw new Error("You're offline — reconnect to fund your wallet.");
        const ref = makeRef();
        const id = uid();
        const tx: Tx = { id, ref, service: "funding", title: `Wallet funding • Paystack`, amount, fee: 0, total: amount, status: "PENDING", provider: "Paystack", createdAt: Date.now(), meta: {} };
        set((s) => ({ txs: [tx, ...s.txs] }));
        await sleep(900);
        set((s) => ({ txs: s.txs.map((t) => (t.id === id ? { ...t, status: "PROCESSING" } : t)) }));
        await sleep(1300);
        set((s) => ({
          ledger: [entry("CREDIT", amount, "Wallet funding — Paystack card", ref), ...s.ledger],
          txs: s.txs.map((t) => (t.id === id ? { ...t, status: "SUCCESSFUL", providerRef: `PS-${Math.random().toString(36).slice(2, 10).toUpperCase()}`, completedAt: Date.now() } : t)),
        }));
        get().notify({ kind: "success", title: "Wallet funded", body: `${money(amount)} was added to your wallet via Paystack.` });
        return get().txs.find((t) => t.id === id)!;
      },

      withdraw: async (amount, bank, account, accountName) => {
        const tx = await get().purchase({ service: "withdraw", title: `Withdrawal • ${bank} ••${account.slice(-4)}`, amount, meta: { bank, account, accountName } });
        if (tx.status === "SUCCESSFUL") {
          set((s) => ({ ledger: [entry("WITHDRAW", amount, `Payout — ${bank} ••${account.slice(-4)}`, tx.ref), ...s.ledger] }));
        }
        return tx;
      },

      purchase: async ({ service, title, amount, meta = {} }) => {
        const s0 = get();
        const p = s0.profile;
        if (!p) throw new Error("You are signed out. Sign in again to continue.");
        if (typeof navigator !== "undefined" && !navigator.onLine) throw new Error("You're offline. Cached info stays visible, but purchases need a live connection.");
        if (p.frozen) throw new Error("Your account is frozen. Unfreeze it from Security Centre to make purchases.");
        const fee = FEES[service] ?? 0;
        if (amount <= 0) throw new Error("Enter a valid amount.");
        const avail = availableOf(s0.ledger);
        if (amount + fee > avail) throw new Error(`Insufficient balance. This purchase needs ${money(amount + fee)} but your available balance is ${money(avail)}.`);

        const id = uid();
        const ref = makeRef();
        const tx: Tx = { id, ref, service, title, amount, fee, total: amount + fee, status: "PENDING", provider: SERVICE_META[service].provider, createdAt: Date.now(), meta };
        const init: LedgerEntry[] = [entry("RESERVE", amount, `Reserved — ${title}`, ref)];
        if (fee > 0) init.push(entry("FEE", fee, `Service fee — ${title}`, ref));
        set((s) => ({ ledger: [...init, ...s.ledger], txs: [tx, ...s.txs] }));

        await sleep(750);
        set((s) => ({ txs: s.txs.map((t) => (t.id === id ? { ...t, status: "PROCESSING" } : t)) }));
        await sleep(1100 + Math.random() * 900);

        const failed = Math.random() < 0.12;
        const st = get();
        if (failed) {
          const back: LedgerEntry[] = [entry("REVERSAL", amount, `Auto-reversal — ${title} failed`, ref)];
          if (fee > 0) back.push(entry("REFUND", fee, `Fee refunded — ${title} failed`, ref));
          set((s) => ({
            ledger: [...back, ...s.ledger],
            txs: s.txs.map((t) => (t.id === id ? { ...t, status: "FAILED", completedAt: Date.now(), failReason: "The provider did not respond in time. Your reserved funds were returned automatically." } : t)),
          }));
          st.notify({ kind: "error", title: "Transaction reversed", body: `${title} failed at the provider. ${money(amount)} was returned to your wallet.` });
        } else {
          const done: LedgerEntry[] = [entry("RELEASE", amount, `Released to provider — ${title}`, ref), entry("DEBIT", amount, `Settlement — ${title}`, ref)];
          const cbRate = CASHBACK_RATE[service] ?? 0;
          const cb = Math.round(amount * cbRate * 100) / 100;
          if (cb >= 1) done.push(entry("CASHBACK", cb, `Cashback — ${title}`, ref));
          const rnd = hashStr(ref);
          let extra: TxMeta = { ...meta };
          if (service === "electricity") {
            const g = () => String(Math.floor(rnd() * 100000)).padStart(5, "0");
            extra.token = `${g()}-${g()}-${g()}-${g()}`;
          }
          if (service === "exam") {
            const q = meta.qty ?? 1;
            extra.pins = Array.from({ length: q }, (_, i) => {
              const r2 = hashStr(ref + i);
              return { serial: String(Math.floor(r2() * 9e9) + 1e9), pin: String(Math.floor(r2() * 9e11) + 1e11) };
            });
          }
          set((s) => ({
            ledger: [...done, ...s.ledger],
            points: s.points + Math.floor((amount + fee) / 100),
            txs: s.txs.map((t) => (t.id === id ? { ...t, status: "SUCCESSFUL", providerRef: `PV-${Math.random().toString(36).slice(2, 12).toUpperCase()}`, completedAt: Date.now(), meta: extra } : t)),
          }));
          if (cb >= 1) st.notify({ kind: "reward", title: `Cashback earned`, body: `${money(cb)} cashback from ${title}.` });
          st.notify({ kind: "success", title: `${SERVICE_META[service].label} successful`, body: `${title} — ${money(amount + fee)} total.` });
          const phoneLike = meta.phone ?? meta.meter ?? meta.iuc;
          if (phoneLike) {
            const exists = st.beneficiaries.some((b) => b.value.replace(/\s/g, "") === String(phoneLike).replace(/\s/g, ""));
            if (!exists && st.beneficiaries.length < 30) {
              set((s) => ({ beneficiaries: [...s.beneficiaries, { id: uid(), service, label: meta.customer ?? SERVICE_META[service].label, value: String(phoneLike), network: meta.network as NetworkId | undefined, extra: meta.providerName ?? meta.disco, ts: Date.now() }] }));
            }
          }
        }
        return get().txs.find((t) => t.id === id)!;
      },

      redeemPoints: (pts) => {
        const s = get();
        if (pts < 100) return "Minimum redemption is 100 points.";
        if (pts > s.points) return "You don't have that many points.";
        const naira = Math.round((pts / 100) * 50 * 100) / 100;
        set((st) => ({ points: st.points - pts, ledger: [entry("REWARD", naira, `Redeemed ${pts} STARK points`), ...st.ledger] }));
        s.notify({ kind: "reward", title: "Points redeemed", body: `${pts} points converted to ${money(naira)} cashback balance.` });
        return null;
      },

      claimCashback: () => {
        const s = get();
        const bal = cashbackOf(s.ledger);
        if (bal < 1) return "Cashback balance is too small to move.";
        set((st) => ({ ledger: [entry("CLAIM", bal, "Cashback moved to wallet"), entry("CREDIT", bal, "Cashback claim to wallet"), ...st.ledger] }));
        s.notify({ kind: "reward", title: "Cashback moved", body: `${money(bal)} was moved from cashback to your available balance.` });
        return null;
      },

      markAllRead: () => set((s) => ({ notifications: s.notifications.map((n) => ({ ...n, read: true })) })),
      markRead: (id) => set((s) => ({ notifications: s.notifications.map((n) => (n.id === id ? { ...n, read: true } : n)) })),
      addTicket: ({ subject, category, body, ref }) => {
        set((s) => ({ tickets: [{ id: uid(), ts: Date.now(), subject, category, body, status: "OPEN", ref }, ...s.tickets] }));
        get().notify({ kind: "info", title: "Support ticket recorded", body: `“${subject}” was prepared for WhatsApp delivery${ref ? ` (${ref})` : ""}. Send the message in WhatsApp to reach Stark Support.` });
        get().toast("Support ticket recorded", "ok");
      },
      addBeneficiary: (b) => { set((s) => ({ beneficiaries: [{ ...b, id: uid(), ts: Date.now() }, ...s.beneficiaries] })); get().toast("Beneficiary saved", "ok"); },
      removeBeneficiary: (id) => set((s) => ({ beneficiaries: s.beneficiaries.filter((b) => b.id !== id) })),
      toggleFav: (id) => set((s) => ({ beneficiaries: s.beneficiaries.map((b) => (b.id === id ? { ...b, fav: !b.fav } : b)) })),
      toggleAutoRenew: (id) => set((s) => ({ subs: s.subs.map((x) => (x.id === id ? { ...x, autoRenew: !x.autoRenew } : x)) })),
    }),
    {
      name: "stark-store-v1",
      partialize: (s) => ({
        authed: s.authed, profile: s.profile, ledger: s.ledger, txs: s.txs, beneficiaries: s.beneficiaries,
        notifications: s.notifications, tickets: s.tickets, subs: s.subs, devices: s.devices, logins: s.logins,
        points: s.points, theme: s.theme, accounts: s.accounts, sessions: s.sessions, audit: s.audit,
      }),
    }
  )
);

/* derived balances hook */
export function useBalances() {
  const ledger = useStark((s) => s.ledger);
  return {
    available: availableOf(ledger),
    reserved: reservedOf(ledger),
    cashback: cashbackOf(ledger),
    deposits: depositsOf(ledger),
    spend: spendOf(ledger),
  };
}

export const initials = (name: string) => name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
export const demoName = (seedKey: string) => { const r = hashStr(seedKey); return DEMO_NAMES[Math.floor(r() * DEMO_NAMES.length)]; };
