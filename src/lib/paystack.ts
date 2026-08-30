/* ============================================================
 * STARK × PAYSTACK — client-side checkout (PUBLIC KEY ONLY)
 *
 * SECURITY CONTRACT — read before editing:
 *   • The PUBLIC key (pk_live_…) is SAFE to ship in client code.
 *     That is exactly what it is for: opening a checkout.
 *   • The SECRET key (sk_live_…) must NEVER appear in this file,
 *     in any .tsx, in Flutter, or in a committed .env. It lives
 *     ONLY on the Go backend (STARK_API env) where it signs
 *     webhooks and verifies transactions. Embedding it client-side
 *     would let anyone drain the merchant account via transfers.
 *   • This preview collects REAL money through Paystack's hosted
 *     checkout. Authoritative server-side verification of the charge
 *     is performed by the Go backend (internal/finance) in production.
 * ============================================================ */

/** Public key — safe for clients. Rotated only in the Paystack dashboard. */
export const PAYSTACK_PUBLIC_KEY = "pk_live_3dc969401938578002f371d395ac3711036c7558";

export interface PaystackSuccess {
  /** Paystack transaction reference — the real, server-minted id. */
  reference: string;
  /** Paystack transaction id (numeric), when provided. */
  trxref?: string;
}

type PaystackPop = {
  setup: (opts: {
    key: string;
    email: string;
    amount: number; // KOBO
    currency: string;
    ref: string;
    channels?: string[];
    callback: (response: { reference: string; trxref?: string }) => void;
    onClose: () => void;
  }) => { openIframe: () => void };
};

declare global {
  interface Window {
    PaystackPop?: PaystackPop;
  }
}

const INLINE_SRC = "https://js.paystack.co/v1/inline.js";

let loader: Promise<void> | null = null;

/** Loads Paystack's inline script exactly once. */
export function loadPaystackInline(): Promise<void> {
  if (typeof window !== "undefined" && window.PaystackPop) return Promise.resolve();
  if (loader) return loader;
  loader = new Promise<void>((resolve, reject) => {
    const el = document.createElement("script");
    el.src = INLINE_SRC;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => {
      loader = null;
      reject(new Error("Could not reach Paystack. Check your connection and try again."));
    };
    document.head.appendChild(el);
  });
  return loader;
}

/** Mints a client reference in Stark's format (server mints its own too). */
export function mintReference(): string {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(4)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
  return `STK-${ymd}-${rand}`;
}

/**
 * Opens the REAL Paystack hosted checkout and resolves with the genuine
 * transaction reference once the customer completes payment.
 * Rejects if the script fails to load. Calls `onClose` if the customer
 * dismisses the checkout without paying (no charge occurred).
 */
export async function openPaystackCheckout(opts: {
  email: string;
  amountNaira: number;
  onSuccess: (res: PaystackSuccess) => void;
  onClose: () => void;
}): Promise<void> {
  await loadPaystackInline();
  if (!window.PaystackPop) {
    throw new Error("Paystack is unavailable right now. Please try again.");
  }
  const ref = mintReference();
  window.PaystackPop.setup({
    key: PAYSTACK_PUBLIC_KEY,
    email: opts.email,
    amount: Math.round(opts.amountNaira * 100), // Paystack expects kobo
    currency: "NGN",
    ref,
    channels: ["card", "bank", "ussd", "mobile_money"],
    callback: (response) => {
      opts.onSuccess({
        reference: response.reference || response.trxref || ref,
        trxref: response.trxref,
      });
    },
    onClose: opts.onClose,
  }).openIframe();
}
