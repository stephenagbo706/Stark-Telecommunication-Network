/* ============================================================
 * STARK → Paystack (client-side)
 *
 * PUBLIC key only. The SECRET key lives exclusively on the Go
 * backend (PAYSTACK_SECRET_KEY env var) — it must NEVER appear
 * in this app, its bundle, or version control.
 *
 * The client opens Paystack's hosted checkout and reports the
 * outcome. Authoritative settlement (webhook signature → verify
 * → idempotent ledger credit) happens on the Go server.
 * ============================================================ */

export const PAYSTACK_PUBLIC_KEY = "pk_live_3dc969401938578002f371d395ac3711036c7558";

declare global {
  interface Window {
    PaystackPop?: {
      setup: (opts: Record<string, unknown>) => { openIframe: () => void };
    };
  }
}

let loader: Promise<void> | null = null;
function loadScript(): Promise<void> {
  if (window.PaystackPop) return Promise.resolve();
  if (!loader) {
    loader = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://js.paystack.co/v1/inline.js";
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("Could not reach Paystack. Check your connection and retry."));
      document.head.appendChild(s);
    });
  }
  return loader;
}

export interface PaystackResult {
  reference: string;      // Paystack's genuine transaction reference
  status: "success" | "closed";
}

/**
 * Open Paystack's secure hosted checkout. amountNaira is converted to
 * integer kobo — floats never touch money. Resolves only when the
 * customer completes a real payment; resolves {status:"closed"} if they
 * dismiss the sheet (nothing is charged).
 */
export function openPaystackCheckout(opts: {
  email: string;
  amountNaira: number;
  name?: string;
  meta?: Record<string, string>;
}): Promise<PaystackResult> {
  return loadScript().then(
    () =>
      new Promise<PaystackResult>((resolve) => {
        const amountKobo = Math.round(opts.amountNaira * 100);
        const handler = window.PaystackPop!.setup({
          key: PAYSTACK_PUBLIC_KEY,
          email: opts.email,
          amount: amountKobo,
          currency: "NGN",
          ref: `STK-${Date.now()}-${Math.floor(Math.random() * 1e8).toString(36).toUpperCase()}`,
          metadata: { custom_fields: [{ display_name: "App", variable_name: "app", value: "Stark Telecommunication" }], ...opts.meta },
          callback: (res: { reference: string }) => resolve({ reference: res.reference, status: "success" }),
          onClose: () => resolve({ reference: "", status: "closed" }),
        });
        handler.openIframe();
      })
  );
}
