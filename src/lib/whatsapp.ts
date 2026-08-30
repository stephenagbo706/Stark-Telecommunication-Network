/* ============================================================
 * STARK HELP CENTER — WhatsApp Support Service
 *
 * Mirrors the Flutter service contract:
 *   stark-flutter/lib/core/services/whatsapp_service.dart
 *
 * Flow: validate → trim → build message → URL-encode → wa.me URL
 *       → open WhatsApp externally (user reviews & taps Send).
 *
 * SECURITY: no API keys, no secrets — the support number is public.
 * The app can NEVER send the message silently; WhatsApp opens and
 * the user must press Send themselves.
 * ============================================================ */

export const STARK_WHATSAPP_NUMBER = "2347047576657"; // international format, no '+'
export const STARK_WHATSAPP_DISPLAY = "+234 704 757 6657";

export interface TicketInput {
  subject: string;
  category: string;
  description: string;
}

export interface TicketUser {
  name: string;
  phone: string;
  email: string;
}

export interface TicketTransaction {
  id: string;        // Stark reference, e.g. STK-20260823-8F42A91C
  service: string;   // e.g. "MTN 10GB Data"
  amount: string;    // formatted, e.g. "₦5,000"
  status: string;
  provider?: string;
}

export type TicketValidation =
  | { ok: true; subject: string; category: string; description: string }
  | { ok: false; error: string };

const RULE = "-".repeat(30);

/** STEP 1–4 of the submit flow: required-field validation + trim. */
export function validateTicket(input: TicketInput): TicketValidation {
  const subject = (input.subject ?? "").trim();
  const category = (input.category ?? "").trim();
  const description = (input.description ?? "").trim();

  if (!subject) return { ok: false, error: "Please enter a subject." };
  if (!category) return { ok: false, error: "Please select a category." };
  if (!description) return { ok: false, error: "Please describe the issue." };

  return { ok: true, subject, category, description };
}

/** STEP 5 — the professional support message, exactly per spec. */
export function buildSupportMessage(
  t: { subject: string; category: string; description: string },
  opts: { ticketId?: string; user?: TicketUser; tx?: TicketTransaction } = {}
): string {
  const lines: string[] = [];
  lines.push("🆘 STARK TELECOMMUNICATION");
  lines.push("SUPPORT TICKET");
  lines.push("");

  if (opts.ticketId) {
    lines.push("Ticket ID:");
    lines.push(opts.ticketId);
    lines.push("");
  }

  lines.push("Subject:");
  lines.push(t.subject);
  lines.push("");
  lines.push("Category:");
  lines.push(t.category);
  lines.push("");

  if (opts.user) {
    lines.push("Customer:");
    lines.push(opts.user.name);
    lines.push("");
    lines.push("Phone:");
    lines.push(opts.user.phone);
    lines.push("");
    lines.push("Email:");
    lines.push(opts.user.email);
    lines.push("");
  }

  if (opts.tx) {
    lines.push("Transaction ID:");
    lines.push(opts.tx.id);
    lines.push("");
    lines.push("Service:");
    lines.push(opts.tx.service);
    lines.push("");
    lines.push(`Amount:`);
    lines.push(opts.tx.amount);
    lines.push("");
    lines.push("Transaction status:");
    lines.push(opts.tx.status);
    if (opts.tx.provider) {
      lines.push("");
      lines.push("Provider:");
      lines.push(opts.tx.provider);
    }
    lines.push("");
  }

  lines.push("Description:");
  lines.push(t.description);
  lines.push("");
  lines.push(RULE);
  lines.push("STARK HELP CENTER");
  lines.push("Please assist with this issue.");
  lines.push(RULE);

  return lines.join("\n");
}

/** wa.me deep link — message fully URL-encoded (spaces, ₦, newlines…). */
export function buildWhatsAppUrl(message: string): string {
  return `https://wa.me/${STARK_WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
}

/** WhatsApp Web fallback with the same encoded message. */
export function buildWhatsAppWebUrl(message: string): string {
  return `https://web.whatsapp.com/send?phone=${STARK_WHATSAPP_NUMBER}&text=${encodeURIComponent(message)}`;
}

/**
 * Sequential support-ticket reference, e.g. STK-TKT-000184.
 * In production the Go backend mints these (see internal/support) so the
 * record persists in PostgreSQL even after the WhatsApp chat ends.
 */
export function nextTicketId(): string {
  const KEY = "stark.ticket.seq";
  let seq = 183;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) seq = parseInt(raw, 10) || 183;
  } catch { /* private mode — fall through */ }
  seq += 1;
  try { localStorage.setItem(KEY, String(seq)); } catch { /* ignore */ }
  return `STK-TKT-${String(seq).padStart(6, "0")}`;
}

/** Copy the prepared message to the clipboard. */
export async function copySupportMessage(message: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(message);
    return true;
  } catch {
    return false;
  }
}

/**
 * Launch WhatsApp externally. Returns false when the browser blocked the
 * window or no handler responded — callers must keep the form intact.
 */
export function launchWhatsApp(url: string): boolean {
  const win = window.open(url, "_blank", "noopener,noreferrer");
  return win !== null;
}
