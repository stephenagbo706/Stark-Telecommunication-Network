/* ============================================================
 * STARK REFERRALS — client engine mirroring the Go API contract.
 *
 * Production endpoints (stark-api/internal/referrals):
 *   GET  /api/v1/referrals/me        → ReferralStats
 *   GET  /api/v1/referrals/history   → ReferralRecord[]
 *   POST /api/v1/referrals/withdraw  → transfer earnings → wallet
 *
 * Business rule (§2): a referrer earns ₦500 ONLY when a referred
 * friend completes a qualifying SUCCESSFUL transaction. Registration
 * alone never pays. All money moves through the double-entry ledger;
 * the client never computes earnings with `earned += 500`.
 *
 * In this sandbox the engine runs the identical state machine locally
 * so the full pipeline is demonstrable; in production each action maps
 * 1:1 to the Go handlers, which are the source of truth.
 * ============================================================ */
import { create } from "zustand";

export type ReferralStatus =
  | "REGISTERED" | "VERIFIED" | "FUNDED" | "ACTIVE"
  | "REWARDED" | "PENDING_REVIEW" | "REJECTED" | "EXPIRED";

export type RewardStatus = "PENDING" | "APPROVED" | "REJECTED" | "PAID";
export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";

export interface ReferralRecord {
  id: string;
  referredName: string;
  status: ReferralStatus;
  createdAt: number;
  activatedAt?: number;
  funded: boolean;
  verified: boolean;
  qualifyingTxRef?: string;
  rewardKobo: number;          // 50000 = ₦500
  rewardStatus: RewardStatus;
  ledgerRef?: string;
  risk: RiskLevel;
}

export interface ReferralStats {
  referralCode: string;
  referralLink: string;
  invited: number;
  active: number;
  earnedKobo: number;   // APPROVED + PAID rewards
  pendingKobo: number;  // PENDING / PENDING_REVIEW rewards
}

export const REFERRAL_REWARD_KOBO = 50000; // ₦500 — configurable server-side, never hardcoded in UI logic
export const MIN_TRANSFER_KOBO = 50000;

const uid = () => Math.random().toString(36).slice(2, 10);
const D = 86400000;

/** REF-XXXXXXXX ledger reference (§17). */
const ledgerRef = () => `REF-${Math.random().toString(16).slice(2, 10).toUpperCase()}`;

interface ReferralState {
  loading: boolean;
  error: string | null;
  referralCode: string;
  records: ReferralRecord[];
  /** available (approved/paid, not yet withdrawn) referral-balance kobo */
  availableKobo: number;
  withdrawnKobo: number;
  lastWithdrawRef: string | null;

  load: (code: string) => Promise<void>;
  /** Drive a referred friend through the qualification pipeline. */
  advance: (id: string, step: "verify" | "fund" | "purchase" | "fail-purchase") => void;
  /** Demo aid: add a fresh REGISTERED friend (₦0 earned) to walk the pipeline. */
  simulate: () => void;
  transferToWallet: () => { ok: boolean; message: string };
  stats: () => ReferralStats;
}

/* No seeded referrals, no seeded rewards — every account starts at zero.
   `simulate()` (invoked explicitly from the UI) creates a brand-new
   REGISTERED friend worth ₦0 so the qualification pipeline can be
   walked interactively; nothing is pre-earned. */
const SIM_NAMES = ["Chidi Okafor", "Blessing Eze", "Emeka Nwosu", "Amina Bello", "Tunde Balogun", "Ngozi Anyanwu"];

export const useReferrals = create<ReferralState>((set, get) => ({
  loading: false,
  error: null,
  referralCode: "",
  records: [],
  availableKobo: 0,
  withdrawnKobo: 0,
  lastWithdrawRef: null,

  load: async (code) => {
    set({ loading: true, error: null, referralCode: code });
    // Production: const res = await api.get('/api/v1/referrals/me')
    await new Promise((r) => setTimeout(r, 650));
    set((s) => ({ loading: false, records: s.records, ...recompute(s.records, s.withdrawnKobo) }));
  },

  /** UI-only demo aid: register a fresh friend at REGISTERED with ₦0
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
            if (r.status === "REGISTERED") return { ...r, verified: true, status: "VERIFIED" as ReferralStatus };
            return r;
          case "fund":
            if (r.status === "VERIFIED" || r.status === "REGISTERED")
              return { ...r, verified: true, funded: true, status: "FUNDED" as ReferralStatus };
            return r;
          case "purchase": {
            // §12–15: only a SUCCESSFUL qualifying tx activates + rewards.
            if (r.status !== "FUNDED") return r;
            const txRef = `STK-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.random().toString(16).slice(2, 10).toUpperCase()}`;
            // §24: fraud gate — HIGH blocks, MEDIUM holds for review, LOW approves.
            if (r.risk === "HIGH") return { ...r, status: "REJECTED" as ReferralStatus };
            if (r.risk === "MEDIUM")
              return { ...r, qualifyingTxRef: txRef, activatedAt: Date.now(), status: "PENDING_REVIEW" as ReferralStatus, rewardKobo: REFERRAL_REWARD_KOBO, rewardStatus: "PENDING" as RewardStatus };
            return {
              ...r, qualifyingTxRef: txRef, activatedAt: Date.now(),
              status: "REWARDED" as ReferralStatus, rewardKobo: REFERRAL_REWARD_KOBO,
              rewardStatus: "APPROVED" as RewardStatus, ledgerRef: ledgerRef(),
            };
          }
          case "fail-purchase":
            // §14: a FAILED qualifying tx never activates, never rewards.
            return r.status === "FUNDED" ? { ...r, status: "FUNDED" as ReferralStatus } : r;
          default:
            return r;
        }
      });
      return { records, ...recompute(records, s.withdrawnKobo) };
    });
  },

  transferToWallet: () => {
    const { availableKobo } = get();
    if (availableKobo < MIN_TRANSFER_KOBO)
      return { ok: false, message: `Minimum transfer is ₦${MIN_TRANSFER_KOBO / 100}.` };
    const ref = `REFW-${Math.random().toString(16).slice(2, 8).toUpperCase()}`;
    set((s) => ({ availableKobo: 0, withdrawnKobo: s.withdrawnKobo + availableKobo, lastWithdrawRef: ref }));
    return { ok: true, message: `₦${availableKobo / 100} moved to your Stark wallet.` };
  },

  stats: () => {
    const s = get();
    const invited = s.records.length;
    const active = s.records.filter((r) => ["ACTIVE", "REWARDED"].includes(r.status)).length;
    const earnedKobo = s.records
      .filter((r) => ["APPROVED", "PAID"].includes(r.rewardStatus))
      .reduce((a, r) => a + r.rewardKobo, 0);
    const pendingKobo = s.records
      .filter((r) => r.rewardStatus === "PENDING" && r.rewardKobo > 0)
      .reduce((a, r) => a + r.rewardKobo, 0);
    return {
      referralCode: s.referralCode,
      referralLink: `https://stark.app/r/${s.referralCode}`,
      invited, active, earnedKobo, pendingKobo,
    };
  },
}));

/** Recompute the available referral balance from reward records. */
function recompute(records: ReferralRecord[], withdrawnKobo: number) {
  const earned = records
    .filter((r) => ["APPROVED", "PAID"].includes(r.rewardStatus))
    .reduce((a, r) => a + r.rewardKobo, 0);
  return { availableKobo: Math.max(0, earned - withdrawnKobo) };
}

/* ---------------- status display helpers ---------------- */

export const STATUS_LABEL: Record<ReferralStatus, string> = {
  REGISTERED: "Registered",
  VERIFIED: "Verified",
  FUNDED: "Funded",
  ACTIVE: "Active",
  REWARDED: "Rewarded",
  PENDING_REVIEW: "Pending Review",
  REJECTED: "Rejected",
  EXPIRED: "Expired",
};

export function statusHue(s: ReferralStatus): string {
  switch (s) {
    case "REWARDED": return "#22C55E";
    case "ACTIVE": return "#00E5FF";
    case "FUNDED": return "#38BDF8";
    case "VERIFIED": return "#8B5CF6";
    case "REGISTERED": return "#8191A3";
    case "PENDING_REVIEW": return "#F59E0B";
    case "REJECTED": return "#EF4444";
    default: return "#8191A3";
  }
}
