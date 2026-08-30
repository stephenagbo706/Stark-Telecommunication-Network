import { create } from "zustand";
import { persist } from "zustand/middleware";
import { FEES, CASHBACK_RATE, SERVICE_META, type NetworkId } from "./data";
import {
  normalizeEmail, normalizePhone, checkIdentity, formatPhone,
  IDENTITY_CODES, IDENTITY_MESSAGES,
  type KnownAccount, type StarkSession, type AuditEvent, type AuditKind, type IdentityCode,
} from "./identity";
import { useIdentityRegistry } from "./registry";

/* ================= types ================= */
export type LedgerKind = "CREDIT" | "DEBIT" | "RESERVE" | "RELEASE" | "REVERSAL" | "REFUND" | "CASHBACK" | "REWARD" | "CLAIM" | "FEE" | "WITHDRAW";
export interface LedgerEntry { id: string; ts: number; kind: LedgerKind; amount: number; note: string; ref?: string }

export type Service = "airtime" | "data" | "cable" | "electricity" | "exam" | "betting" | "sms" | "gift" | "funding" | "withdraw";
export interface TxMeta { network?: NetworkId; phone?: string; plan?: string; size?: string; iuc?: string; customer?: string; providerName?: string; disco?: string; meter?: string; meterType?: string; token?: string; examBody?: string; item?: string; qty?: number; pins?: { serial: string; pin: string }[]; platform?: string; betId?: string; senderId?: string; units?: number; message?: string; giftType?: string; bank?: string; account?: string; accountName?: string }
export interface Tx {
  id: string; ref: string; service: Service; title: string; amount: number; fee: number; total: number;
  status: "PENDING" | "PROCESSING" | "SUCCESSFUL" | "FAILED" | "REVERSED";
  provider: string; providerRef?: string; createdAt: number; completedAt?: number; failReason?: string; meta: TxMeta;
}

export interface Profile {
  name: string; phone: string; email: string; pin: string;
  emailVerified: boolean; phoneVerified: boolean; biometric: boolean; twoFA: boolean; frozen: boolean;
  joinedAt: number; referralCode: string; refEarned: number;
  referrals: { name: string; date: number; status: string; earned: number }[];
  avatar?: string;
}

export interface Beneficiary { id: string; service: Service; label: string; value: string; network?: string; extra?: string; fav?: boolean; ts: number }
export interface Notice { id: string; ts: number; read: boolean; kind: "success" | "error" | "info" | "security" | "reward"; title: string; body: string }
export interface Ticket { id: string; ts: number; subject: string; category: string; body: string; status: "OPEN" | "UNDER_REVIEW" | "RESOLVED"; ref?: string }
export interface Sub { id: string; name: string; provider: string; price: number; cycle: string; nextRenewal: number; autoRenew: boolean; history: { ts: number; ref: string }[] }
export interface Device { id: string; name: string; platform: string; lastActive: number; current?: boolean }
export interface Toast { id: string; msg: string; kind: "ok" | "bad" | "info" }

/* ================= helpers ================= */
export const uid = () => Math.random().toString(36).slice(2, 12);
export const hashStr = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
};
const pad = (n: number) => String(n).padStart(2, "0");
export const makeRef = () => {
  const d = new Date();
  return `STK-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${uid().slice(0, 8).toUpperCase()}`;
};
export const money = (n: number) => `₦${n.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const money0 = (n: number) => `₦${Math.round(n).toLocaleString("en-NG")}`;
export const fmtDate = (ts: number) => new Date(ts).toLocaleDateString("en-NG", { day: "numeric", month: "short" });
export const fmtTime = (ts: number) => new Date(ts).toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" });
export const timeAgo = (ts: number) => {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};
export const initials = (name: string) => name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const entry = (kind: LedgerKind, amount: number, note: string, ref?: string): LedgerEntry => ({ id: uid(), ts: Date.now(), kind, amount, note, ref });
const auditEv = (kind: AuditKind, detail: string): AuditEvent => ({ id: uid(), ts: Date.now(), kind, detail });

/* ledger-derived balances (the ONLY source of balance truth) */
const sum = (l: LedgerEntry[], kinds: LedgerKind[]) => l.filter((e) => kinds.includes(e.kind)).reduce((a, e) => a + e.amount, 0);
export const availableOf = (l: LedgerEntry[]) => sum(l, ["CREDIT", "REVERSAL", "REFUND"]) - sum(l, ["RESERVE", "FEE", "WITHDRAW"]);
export const reservedOf = (l: LedgerEntry[]) => sum(l, ["RESERVE"]) - sum(l, ["RELEASE", "REVERSAL", "REFUND"]);
export const cashbackOf = (l: LedgerEntry[]) => sum(l, ["CASHBACK", "REWARD"]) - sum(l, ["CLAIM"]);
export const depositsOf = (l: LedgerEntry[]) => sum(l, ["CREDIT"]);
export const spendOf = (l: LedgerEntry[]) => sum(l, ["DEBIT"]);

const THIS_DEVICE = { name: "This browser", platform: "Web • Chrome", ip: "105.112.34.18", location: "Lagos, NG" };
const newSession = (): StarkSession => ({
  id: uid(), device: THIS_DEVICE.name, platform: THIS_DEVICE.platform,
  ip: THIS_DEVICE.ip, location: THIS_DEVICE.location,
  createdAt: Date.now(), lastUsedAt: Date.now(), current: true, trusted: true,
});

/* ================= state ================= */
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
  accounts: KnownAccount[];
  sessions: StarkSession[];
  audit: AuditEvent[];

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
        const id = uid();
        set((s) => ({ toasts: [...s.toasts, { id, msg, kind }] }));
        setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 3800);
      },
      notify: (n) => set((s) => ({ notifications: [{ id: uid(), ts: Date.now(), read: false, ...n }, ...s.notifications] })),

      /* ---- auth (identity uniqueness enforced via the registry) ---- */
      register: ({ name, phone, email, pin }) => {
        const emailN = normalizeEmail(email);
        const phoneN = normalizePhone(phone);
        if (!phoneN) return { ok: false, code: IDENTITY_CODES.PHONE_ALREADY_REGISTERED, message: "Enter a valid Nigerian phone number." };

        const check = checkIdentity(emailN, phoneN, useIdentityRegistry.getState().identities);
        if (!check.ok) {
          const kind: AuditKind =
            check.code === IDENTITY_CODES.ACCOUNT_EXISTS ? "duplicate_email_registration_attempt" as never
            : check.code === IDENTITY_CODES.PHONE_ALREADY_REGISTERED ? "duplicate_phone_registration_attempt" as never
            : "identity_conflict_registration_attempt" as never;
          set((s) => ({ audit: [auditEv(kind, `Blocked: ${check.message}`), ...s.audit] }));
          return check;
        }

        const profile: Profile = {
          name: name.trim(), phone: phoneN, email: emailN, pin, emailVerified: false, phoneVerified: true,
          biometric: false, twoFA: false, frozen: false, joinedAt: Date.now(),
          referralCode: `STARK-${name.trim().slice(0, 3).toUpperCase()}${Math.floor(1000 + Math.random() * 9000)}`,
          refEarned: 0, referrals: [],
        };
        const acct: KnownAccount = { id: uid(), name: profile.name, email: emailN, phone: phoneN, status: "active" };
        useIdentityRegistry.getState().add(acct);
        set((s) => ({
          authed: true, profile, ledger: [], txs: [], beneficiaries: [], points: 0, tickets: [], subs: [],
          accounts: [...s.accounts, acct],
          sessions: [newSession()],
          audit: [auditEv("account_created", `Account created for ${emailN} (${formatPhone(phoneN)})`), ...s.audit],
          notifications: [{ id: uid(), ts: Date.now(), read: false, kind: "info", title: "Welcome to STARK", body: "Your wallet starts at ₦0.00. Add money with Paystack to buy airtime, data, cable and electricity." }],
          logins: [{ ts: Date.now(), device: THIS_DEVICE.name, ip: THIS_DEVICE.ip, location: THIS_DEVICE.location, status: "success" }],
        }));
        return { ok: true };
      },

      login: (phone, pin) => {
        const p = get().profile;
        if (!p) return "No account found on this device. Create an account to get started.";
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
        const hasCurrent = get().sessions.some((x) => x.current);
        const fresh = !hasCurrent;
        set((s) => ({
          authed: true,
          sessions: [...s.sessions.filter((x) => !x.current), newSession()],
          audit: [auditEv("login_success", `Signed in from ${THIS_DEVICE.name}`), ...(fresh ? [auditEv("new_device_login", `${THIS_DEVICE.name} • ${THIS_DEVICE.location}`)] : []), ...s.audit],
          logins: [{ ts: Date.now(), device: THIS_DEVICE.name, ip: THIS_DEVICE.ip, location: THIS_DEVICE.location, status: "success" }, ...s.logins],
        }));
        if (fresh) get().notify({ kind: "security", title: "New device signed in", body: `${THIS_DEVICE.name} in ${THIS_DEVICE.location} signed into your Stark account. If this wasn't you, freeze the account from Security.` });
        return null;
      },

      logout: () => {
        set((s) => ({
          authed: false,
          sessions: s.sessions.filter((x) => !x.current),
          audit: [auditEv("logout", `Session revoked on ${THIS_DEVICE.name}`), ...s.audit],
        }));
      },

      revokeSession: (id) => {
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
        set({ profile: { ...p, pin: newPin }, audit: [auditEv("pin_changed", "Transaction PIN updated"), ...get().audit] });
        get().notify({ kind: "security", title: "Transaction PIN changed", body: "Your transaction PIN was updated. If you didn't do this, contact support immediately." });
        return null;
      },
      toggleFreeze: () => {
        const p = get().profile;
        if (!p) return;
        set({ profile: { ...p, frozen: !p.frozen }, audit: [auditEv(p.frozen ? "account_unfrozen" : "account_frozen", p.frozen ? "Account unfrozen" : "Account frozen by user"), ...get().audit] });
        get().notify({
          kind: "security",
          title: p.frozen ? "Account unfrozen" : "Account frozen",
          body: p.frozen ? "All wallet and purchase functions are active again." : "All purchases, wallet funding and withdrawals are blocked.",
        });
      },
      setTheme: (t) => set({ theme: t }),
      logoutOthers: () => {
        set((s) => ({ sessions: s.sessions.filter((x) => x.current), audit: [auditEv("session_revoked", "All other sessions revoked"), ...s.audit] }));
        get().toast("Other devices signed out", "ok");
      },

      /* ---- wallet funding (records a genuine Paystack reference) ---- */
      addFunds: async (amount, paystackRef) => {
        if (typeof navigator !== "undefined" && !navigator.onLine) throw new Error("You're offline — reconnect to fund your wallet.");
        const ref = makeRef();
        const id = uid();
        const tx: Tx = { id, ref, service: "funding", title: "Wallet funding • Paystack", amount, fee: 0, total: amount, status: "PENDING", provider: "Paystack", createdAt: Date.now(), meta: {} };
        set((s) => ({ txs: [tx, ...s.txs] }));
        // The charge already completed inside Paystack's hosted checkout, so
        // record it with the genuine reference. In production the Go backend
        // verifies the signed webhook and posts this credit server-side.
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

      /* ---- purchase pipeline: reserve → settle/reverse ---- */
      purchase: async ({ service, title, amount, meta = {} }) => {
        const s0 = get();
        const p = s0.profile;
        if (!p) throw new Error("You are signed out. Sign in again to continue.");
        if (typeof navigator !== "undefined" && !navigator.onLine) throw new Error("You're offline. Cached info stays visible, but purchases need a live connection.");
        if (p.frozen) throw new Error("Your account is frozen. Unfreeze it from Security Centre to make purchases.");
        const fee = FEES[service] ?? 0;
        if (amount <= 0) throw new Error("Enter a valid amount.");
        const avail = availableOf(s0.ledger);
        if (amount + fee > avail) throw new Error(`Insufficient balance. This purchase needs ${money(amount + fee)} but your available balance is ${money(avail)}. Fund your wallet with Paystack first.`);

        const id = uid();
        const ref = makeRef();
        const tx: Tx = { id, ref, service, title, amount, fee, total: amount + fee, status: "PENDING", provider: SERVICE_META[service]?.provider ?? "VTU Engine", createdAt: Date.now(), meta };
        set((s) => ({
          txs: [tx, ...s.txs],
          ledger: [entry("RESERVE", amount, `Reserved — ${title}`, ref), ...(fee > 0 ? [entry("FEE", fee, `Service fee — ${title}`, ref)] : []), ...s.ledger],
        }));

        await sleep(700);
        set((s) => ({ txs: s.txs.map((t) => (t.id === id ? { ...t, status: "PROCESSING" } : t)) }));
        await sleep(1100);

        const failed = Math.random() < 0.1; // provider failure simulation
        if (failed) {
          set((s) => ({
            ledger: [entry("REVERSAL", amount, `Auto-reversal — ${title} failed`, ref), ...(fee > 0 ? [entry("REFUND", fee, `Fee refunded — ${title} failed`, ref)] : []), ...s.ledger],
            txs: s.txs.map((t) => (t.id === id ? { ...t, status: "FAILED", failReason: "Provider timed out before confirming. No value was delivered. Your reserved funds were returned.", completedAt: Date.now() } : t)),
          }));
          get().notify({ kind: "error", title: "Transaction failed", body: `${title} failed at the provider. The reserved ${money(amount)} was returned to your wallet.` });
        } else {
          const cb = (service === "data" || service === "electricity") ? Math.round(amount * CASHBACK_RATE) : 0;
          const pts = Math.floor((amount + fee) / 100);
          set((s) => ({
            ledger: [
              entry("RELEASE", amount, `Released to provider — ${title}`, ref),
              entry("DEBIT", amount, `Settlement — ${title}`, ref),
              ...(cb > 0 ? [entry("CASHBACK", cb, `Cashback — ${title}`)] : []),
              ...s.ledger,
            ],
            txs: s.txs.map((t) => (t.id === id ? { ...t, status: "SUCCESSFUL", providerRef: `PV-${uid().toUpperCase()}`, completedAt: Date.now(), meta: { ...t.meta, ...(service === "electricity" ? { token: `${Math.floor(1000 + Math.random() * 9000)}-${Math.floor(1000 + Math.random() * 9000)}-${Math.floor(1000 + Math.random() * 9000)}-${Math.floor(1000 + Math.random() * 9000)}` } : {}) } } : t)),
            points: s.points + pts,
          }));
          get().notify({ kind: "success", title: `${SERVICE_META[service]?.label ?? "Purchase"} successful`, body: `${title} was delivered. ${pts > 0 ? `You earned ${pts} STARK points.` : ""}` });
        }
        return get().txs.find((t) => t.id === id)!;
      },

      redeemPoints: (pts) => {
        const s = get();
        if (pts < 50) return "Minimum redemption is 50 points.";
        if (pts > s.points) return "Not enough points.";
        const value = Math.round(pts / 4); // 100 pts = ₦25
        set({ points: s.points - pts, ledger: [entry("REWARD", value, `Redeemed ${pts} STARK points`), ...s.ledger] });
        get().notify({ kind: "reward", title: `+${value} cashback`, body: `${pts} points redeemed for ${money(value)} cashback.` });
        return null;
      },
      claimCashback: () => {
        const cb = cashbackOf(get().ledger);
        if (cb < 1) return "No cashback to claim yet.";
        set((s) => ({
          ledger: [entry("CLAIM", cb, "Cashback claimed"), entry("CREDIT", cb, "Cashback moved to wallet"), ...s.ledger],
        }));
        return null;
      },

      markAllRead: () => set((s) => ({ notifications: s.notifications.map((n) => ({ ...n, read: true })) })),
      markRead: (id) => set((s) => ({ notifications: s.notifications.map((n) => (n.id === id ? { ...n, read: true } : n)) })),
      addTicket: (t) => {
        set((s) => ({ tickets: [{ id: uid(), ts: Date.now(), status: "OPEN", ...t }, ...s.tickets] }));
        get().notify({ kind: "info", title: "Support ticket created", body: `${t.subject} — our team will respond shortly.` });
      },
      addBeneficiary: (b) => set((s) => ({ beneficiaries: [{ id: uid(), ts: Date.now(), ...b }, ...s.beneficiaries] })),
      removeBeneficiary: (id) => set((s) => ({ beneficiaries: s.beneficiaries.filter((b) => b.id !== id) })),
      toggleFav: (id) => set((s) => ({ beneficiaries: s.beneficiaries.map((b) => (b.id === id ? { ...b, fav: !b.fav } : b)) })),
      toggleAutoRenew: (id) => set((s) => ({ subs: s.subs.map((x) => (x.id === id ? { ...x, autoRenew: !x.autoRenew } : x)) })),
    }),
    {
      /* v2: fresh start — previous demo balances are discarded so every
         wallet begins at ₦0.00 (real funding only). */
      name: "stark-store-v2",
      partialize: (s) => ({
        authed: s.authed, profile: s.profile, ledger: s.ledger, txs: s.txs, beneficiaries: s.beneficiaries,
        notifications: s.notifications, tickets: s.tickets, subs: s.subs, devices: s.devices, logins: s.logins,
        /* `accounts` deliberately NOT persisted — the identity registry
           (users-table mirror) is the single source of truth. */
        points: s.points, theme: s.theme, sessions: s.sessions, audit: s.audit,
      }),
    }
  )
);

/* keep the reactive accounts mirror in sync with the global registry */
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
