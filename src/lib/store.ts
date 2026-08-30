import { create } from "zustand";
import { persist } from "zustand/middleware";
import { FEES, CASHBACK_RATE, SERVICE_META, type NetworkId } from "./data";
import {
  normalizeEmail, normalizePhone, checkIdentity, formatPhone,
  IDENTITY_CODES, IDENTITY_MESSAGES,
  type KnownAccount, type StarkSession, type AuditEvent, type AuditKind, type IdentityCode,
} from "./identity";
import { useIdentityRegistry } from "./registry";

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

  setAvatar: (dataUrl?: string) => void;
  updateProfile: (p: Partial<Profile>) => void;
  changePin: (oldPin: string, newPin: string) => string | null;
  toggleFreeze: () => void;
  setTheme: (t: "dark" | "light") => void;
  logoutOthers: () => void;

  addFunds: (amount: number, paystackRef?: string) => Promise<Tx>;
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

        /* The GLOBAL registry (mirror of the shared users table) is checked —
           not this device's local state. Blocked attempts become §24 audit events. */
        const check = checkIdentity(emailN, phoneN, useIdentityRegistry.getState().identities);
        if (!check.ok) {
          const kind: AuditKind =
            check.code === IDENTITY_CODES.ACCOUNT_EXISTS ? "duplicate_email_registration_attempt"
            : check.code === IDENTITY_CODES.PHONE_ALREADY_REGISTERED ? "duplicate_phone_registration_attempt"
            : "identity_conflict_registration_attempt";
          set((s) => ({ audit: [auditEv(kind, `Blocked: ${check.message}`), ...s.audit] }));
          return check;
        }

        const profile: Profile = {
          name: name.trim(), phone: phoneN, email: emailN, pin, emailVerified: false, phoneVerified: true, biometric: false, twoFA: false,
          frozen: false, joinedAt: Date.now(), referralCode: `STARK-${name.trim().slice(0, 3).toUpperCase()}${Math.floor(1000 + Math.random() * 9000)}`,
          refEarned: 0, referrals: [],
        };
        const acct: KnownAccount = { id: uid(), name: profile.name, email: emailN, phone: phoneN, status: "active" };
        /* Persist the identity to the GLOBAL registry (the users-table mirror)
           BEFORE flipping local state — the registry is the source of truth. */
        useIdentityRegistry.getState().add(acct);
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
        if (!p) return "No account found on this device. Create an account to get started.";
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

      addFunds: async (amount, paystackRef) => {
        if (typeof navigator !== "undefined" && !navigator.onLine) throw new Error("You're offline — reconnect to fund your wallet.");
        const ref = makeRef();
        const id = uid();
        const tx: Tx = { id, ref, service: "funding", title: `Wallet funding • Paystack`, amount, fee: 0, total: amount, status: "PENDING", provider: "Paystack", createdAt: Date.now(), meta: {} };
        set((s) => ({ txs: [tx, ...s.txs] }));
        // The charge has ALREADY completed inside Paystack's hosted checkout
        // before this is called, so we record it here with the genuine
        // Paystack reference. In production the Go backend verifies the
        // signed webhook and posts this credit server-side (idempotently).
        set((s) => ({
          ledger: [entry("CREDIT", amount, "Wallet funding — Paystack", ref), ...s.ledger],
          txs: s.txs.map((t) => (t.id === id ? { ...t, status: "SUCCESSFUL", providerRef: paystackRef, completedAt: Date.now() } : t)),
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
      /* v2: fresh start — previous demo balances are intentionally discarded
         so every wallet begins at ₦0.00 (real funding only). */
      name: "stark-store-v2",
      partialize: (s) => ({
        authed: s.authed, profile: s.profile, ledger: s.ledger, txs: s.txs, beneficiaries: s.beneficiaries,
        notifications: s.notifications, tickets: s.tickets, subs: s.subs, devices: s.devices, logins: s.logins,
        /* `accounts` deliberately NOT persisted here — the identity registry
           (users-table mirror) is the single source of truth (§22). */
        points: s.points, theme: s.theme, sessions: s.sessions, audit: s.audit,
      }),
    }
  )
);

/* Keep the reactive `accounts` mirror in sync with the global identity
   registry — the registry (like PostgreSQL) is authoritative, the store
   just re-renders the UI from it. */
useStark.setState({ accounts: useIdentityRegistry.getState().identities });
useIdentityRegistry.subscribe((s) => useStark.setState({ accounts: s.identities }));

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
