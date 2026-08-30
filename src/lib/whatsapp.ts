/* STARK Help Center — WhatsApp support service.
   The support number is public; no secrets live here. */

export const STARK_WHATSAPP_NUMBER = "2347047576657"; // international format, no '+'
export const STARK_WHATSAPP_DISPLAY = "+234 704 757 6657";

export interface TicketInput { subject: string; category: string; description: string }
export interface TicketUser { name: string; phone: string; email: string }
export interface TicketTransaction { id: string; service: string; amount: string; status: string; provider?: string }

export type TicketValidation =
  | { ok: true; subject: string; category: string; description: string }
  | { ok: false; error: string };

const RULE = "-".repeat(30);

export function validateTicket(input: TicketInput): TicketValidation {
  const subject = (input.subject ?? "").trim();
  const category = (input.category ?? "").trim();
  const description = (input.description ?? "").trim();
  if (!subject) return { ok: false, error: "Please enter a subject." };
  if (!category) return { ok: false, error: "Please select a category." };
  if (!description) return { ok: false, error: "Please describe the issue." };
  return { ok: true, subject, category, description };
}

export function buildSupportMessage(
  t: { subject: string; category: string; description: string },
  opts: { ticketId?: string; user?: TicketUser; tx?: TicketTransaction } = {}
): string {
  const lines: string[] = [];
  lines.push("🆘 STARK TELECOMMUNICATION", "SUPPORT TICKET", "");
  if (opts.ticketId) lines.push("Ticket ID:", opts.ticketId, "");
  lines.push("Subject:", t.subject, "", "Category:", t.category, "");
  if (opts.user) lines.push("Customer:", opts.user.name, "", "Phone:", opts.user.phone, "", "Email:", opts.user.email, "");
  if (opts.tx) {
    lines.push("Transaction ID:", opts.tx.id, "", "Service:", opts.tx.service, "", "Amount:", opts.tx.amount, "", "Transaction status:", opts.tx.status);
    if (opts.tx.provider) lines.push("", "Provider:", opts.tx.provider);
    lines.push("");
  }
  lines.push("Description:", t.description, "", RULE, "STARK HELP CENTER", "Please assist with this issue.", RULE);
  return lines.join("\n");
}

export function buildWhatsAppUrl(message: string): string {
  return `https://wa.me/${STARK_WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
}

export function buildWhatsAppWebUrl(message: string): string {
  return `https://web.whatsapp.com/send?phone=${STARK_WHATSAPP_NUMBER}&text=${encodeURIComponent(message)}`;
}

export function nextTicketId(): string {
  const KEY = "stark.ticket.seq";
  let seq = 183;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) seq = parseInt(raw, 10) || 183;
  } catch { /* private mode */ }
  seq += 1;
  try { localStorage.setItem(KEY, String(seq)); } catch { /* ignore */ }
  return `STK-TKT-${String(seq).padStart(6, "0")}`;
}

export async function copySupportMessage(message: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(message); return true; } catch { return false; }
}

export function launchWhatsApp(url: string): boolean {
  return window.open(url, "_blank", "noopener,noreferrer") !== null;
}
