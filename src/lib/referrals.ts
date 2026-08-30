/* ============================================================
 * STARK Referrals — qualification pipeline engine.
 *
 * Rules (mirrors the Go activator worker):
 *   REGISTERED → VERIFIED → FUNDED → qualifying purchase → ACTIVE
 *   → one ₦500 reward posted through the ledger (REFERRAL account).
 *   A failed purchase NEVER activates or pays. One reward per referral.
 *
 * Starts at ZERO — no seeded friends, no seeded money. The user drives
 * the pipeline; "simulate a friend joining" registers a fresh friend at
 * REGISTERED with ₦0 earned.
 * ============================================================ */
import { create } from "zustand";

export type ReferralStatus =
  | "REGISTERED" | "VERIFIED" | "FUNDED" | "ACTIVE"
  | "REWARDED" | "PENDING_REVIEW" | "REJECTED" | "EXPIRED";

export type RewardStatus = "PENDING" | "APPROVED" | "REJECTED" | "PAID";
export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";

export const REFERRAL_REWARD_KOBO = 50000; // ₦500
export const MIN_TRANSFER_KOBO = 50000;    // ₦500 minimum transfer to wallet

export interface ReferralRecord {
  id: string;
  referredName: string;
  status: ReferralStatus;
  createdAt: number;
  activatedAt?: number;
  funded?: boolean;
  verified?: boolean;
  qualifyingTxRef?: string;
  rewardKobo: number;
  rewardStatus: RewardStatus;
  ledgerRef?: string;
  risk: RiskLevel;
}

export interface ReferralStats {
  referralCode: string;
  referralLink: string;
  invited: number;
  active: number;
  earnedKobo: number;
  pendingKobo: number;
  availableKobo: number;
  withdrawnKobo: number;
}

const uid = () => Math.random().toString(36).slice(2, 10);
const D = 86400000;
const SIM_NAMES = ["Chiamaka Obi", "Tunde Bakare", "Ngozi Eze", "Kelechi Umeh", "Aisha Sani", "Femi Ogun", "Zainab Yusuf", "Obinna Nwafor"];
const ledgerRef = () => `REF-${uid().toUpperCase()}`;

function recompute(records: ReferralRecord[], withdrawnKobo: number) {
  const earned = records.filter((r) => r.rewardStatus === "PAID" || r.rewardStatus === "APPROVED").reduce((a, r) => a + r.rewardKobo, 0);
  const available = Math.max(0, earned - withdrawnKobo);
  const pending = records.filter((r) => r.rewardStatus === "PENDING" && (r.status === "ACTIVE" || r.status === "PENDING_REVIEW")).reduce((a, r) => a + r.rewardKobo, 0);
  return { earnedKobo: earned, availableKobo: available, pendingKobo: pending, withdrawnKobo };
}

interface ReferralState {
  loading: boolean;
  error: string | null;
  referralCode: string;
  records: ReferralRecord[];
  availableKobo: number;
  withdrawnKobo: number;
  earnedKobo: number;
  pendingKobo: number;
  load: (code: string) => Promise<void>;
  advance: (id: string, step: "verify" | "fund" | "purchase" | "fail-purchase") => void;
  simulate: () => void;
  transferToWallet: () => { ok: boolean; message: string };
  stats: () => ReferralStats;
}

export const useReferrals = create<ReferralState>((set, get) => ({
  loading: false,
  error: null,
  referralCode: "",
  records: [],
  availableKobo: 0,
  withdrawnKobo: 0,
  earnedKobo: 0,
  pendingKobo: 0,

  load: async (code) => {
    set({ loading: true, error: null, referralCode: code });
    // Production: const res = await api.get('/api/v1/referrals/me')
    await new Promise((r) => setTimeout(r, 650));
    set((s) => ({ loading: false, records: s.records, ...recompute(s.records, s.withdrawnKobo) }));
  },

  /* UI-only demo aid: register a fresh friend at REGISTERED with ₦0
     earned — the user then drives the pipeline themselves. */
  simulate: () => {
    const name = SIM_NAMES[Math.floor(Math.random() * SIM_NAMES.length)];
    set((s) => {
      const rec: ReferralRecord = {
        id: uid(), referredName: name, status: "REGISTERED",
        createdAt: Date.now(), funded: false, verified: false,
        rewardKobo: 0, rewardStatus: "PENDING", risk: "LOW",
      };
      const records = [rec, ...s.records];
      return { records, ...recompute(records, s.withdrawnKobo) };
    });
  },

  advance: (id, step) => {
    set((s) => {
      const records = s.records.map((r) => {
        if (r.id !== id) return r;
        switch (step) {
          case "verify":
            return r.status === "REGISTERED" ? { ...r, verified: true, status: "VERIFIED" as ReferralStatus } : r;
          case "fund":
            return (r.status === "REGISTERED" || r.status === "VERIFIED") ? { ...r, funded: true, status: "FUNDED" as ReferralStatus } : r;
          case "purchase": {
            if (r.status !== "FUNDED") return r;
            const risk: RiskLevel = Math.random() < 0.12 ? "MEDIUM" : "LOW";
            return {
              ...r, activatedAt: Date.now(), qualifyingTxRef: `STK-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${uid().slice(0, 6).toUpperCase()}`,
              status: (risk === "MEDIUM" ? "PENDING_REVIEW" : "ACTIVE") as ReferralStatus,
              risk, rewardKobo: REFERRAL_REWARD_KOBO,
              rewardStatus: (risk === "MEDIUM" ? "PENDING" : "APPROVED") as RewardStatus,
              ledgerRef: ledgerRef(),
            };
          }
          case "fail-purchase":
            return r.status === "FUNDED" ? { ...r, status: "REJECTED" as ReferralStatus, rewardStatus: "REJECTED" as RewardStatus } : r;
          default:
            return r;
        }
      });
      return { records, ...recompute(records, s.withdrawnKobo) };
    });
  },

  transferToWallet: () => {
    const s = get();
    if (s.availableKobo < MIN_TRANSFER_KOBO) {
      return { ok: false, message: "You need at least ₦500 available to transfer." };
    }
    set({ withdrawnKobo: s.withdrawnKobo + s.availableKobo, availableKobo: 0 });
    return { ok: true, message: `₦${(s.availableKobo / 100).toLocaleString()} referral earnings moved to your wallet via ledger.` };
  },

  stats: () => {
    const s = get();
    const active = s.records.filter((r) => r.status === "ACTIVE" || r.status === "REWARDED" || r.status === "PENDING_REVIEW").length;
    return {
      referralCode: s.referralCode,
      referralLink: s.referralCode ? `https://stark.app/r/${s.referralCode}` : "",
      invited: s.records.length,
      active,
      ...recompute(s.records, s.withdrawnKobo),
    };
  },
}));

export const STATUS_LABEL: Record<ReferralStatus, string> = {
  REGISTERED: "Registered",
  VERIFIED: "Verified",
  FUNDED: "Funded",
  ACTIVE: "Active",
  REWARDED: "Rewarded",
  PENDING_REVIEW: "Pending review",
  REJECTED: "Rejected",
  EXPIRED: "Expired",
};

export function statusHue(status: ReferralStatus): string {
  switch (status) {
    case "ACTIVE": case "REWARDED": return "var(--st-ok)";
    case "VERIFIED": case "FUNDED": return "var(--st-info)";
    case "REGISTERED": return "var(--st-sub)";
    case "PENDING_REVIEW": return "var(--st-warn)";
    case "REJECTED": case "EXPIRED": return "var(--st-bad)";
  }
}

export { D as DAY_MS };
