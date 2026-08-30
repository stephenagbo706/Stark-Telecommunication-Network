/* ============================================================
 * STARK IDENTITY — account uniqueness & normalization engine
 *
 * Mirrors the Go implementation (stark-api/internal/auth/identity.go)
 * so the preview enforces the same rules the backend does:
 *
 *   ONE EMAIL        → ONE ACCOUNT
 *   ONE PHONE NUMBER → ONE ACCOUNT
 *
 * Flutter may pre-check for UX, but PostgreSQL unique indexes are the
 * final authority in production. Race-condition duplicate inserts are
 * caught by the DB constraint and mapped to these exact codes.
 * ============================================================ */

export const IDENTITY_CODES = {
  ACCOUNT_EXISTS: "ACCOUNT_EXISTS",
  PHONE_ALREADY_REGISTERED: "PHONE_ALREADY_REGISTERED",
  IDENTITY_CONFLICT: "IDENTITY_CONFLICT",
  ACCOUNT_FROZEN: "ACCOUNT_FROZEN",
  ACCOUNT_SUSPENDED: "ACCOUNT_SUSPENDED",
} as const;

export type IdentityCode = (typeof IDENTITY_CODES)[keyof typeof IDENTITY_CODES];

export const IDENTITY_MESSAGES: Record<IdentityCode, string> = {
  ACCOUNT_EXISTS: "An account with this email already exists. Please sign in.",
  PHONE_ALREADY_REGISTERED: "This phone number is already registered. Please sign in.",
  IDENTITY_CONFLICT:
    "This email and phone number belong to different Stark accounts. For your safety they can't be registered together — contact Stark Support to resolve it.",
  ACCOUNT_FROZEN: "This account is frozen. Contact support to recover it.",
  ACCOUNT_SUSPENDED: "This account is suspended. Contact support for details.",
};

/* ------------------------- email ------------------------- */

/** Trim + lowercase — Clark@Example.com ≡ clark@example.com (§5). */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, "");
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(normalizeEmail(email));
}

/* ------------------------- phone ------------------------- */

/**
 * Canonical Nigerian form: +234XXXXXXXXXX (§6).
 * Accepts 08012345678, +2348012345678, 2348012345678, spaced/dashed variants.
 * Returns null when the number can't be confidently normalized.
 */
export function normalizePhone(raw: string): string | null {
  let d = raw.replace(/[^\d]/g, "");
  if (d.startsWith("00234")) d = d.slice(3);          // 00234… international prefix
  else if (d.startsWith("234") && d.length === 13) d = d.slice(3);
  else if (d.startsWith("0") && d.length === 11) d = d.slice(1);
  if (d.length !== 10) return null;                    // Nigerian subscriber numbers are 10 digits
  if (!/^[789]\d{9}$/.test(d)) return null;            // must start 070/080/081/090/091…
  return `+234${d}`;
}

/** Human display of a canonical number: +234 801 234 5678 */
export function formatPhone(canonical: string): string {
  const d = canonical.replace(/\D/g, "").slice(3);
  return `+234 ${d.slice(0, 3)} ${d.slice(3, 7)} ${d.slice(7)}`;
}

export function samePhone(a: string, b: string): boolean {
  const na = normalizePhone(a);
  const nb = normalizePhone(b);
  return !!na && na === nb;
}

/* ----------------------- uniqueness ----------------------- */

export interface KnownAccount {
  id: string;
  name: string;
  email: string;   // normalized
  phone: string;   // canonical +234…
  status: "active" | "pending_verification" | "frozen" | "suspended";
}

export type RegisterCheck =
  | { ok: true }
  | { ok: false; code: IdentityCode; message: string };

/**
 * Pre-registration identity check (§9–§12). The same decision tree runs
 * server-side; PostgreSQL constraints are the final backstop for races.
 */
export function checkIdentity(email: string, phone: string, accounts: KnownAccount[]): RegisterCheck {
  const e = normalizeEmail(email);
  const p = normalizePhone(phone);
  const byEmail = accounts.find((a) => a.email === e);
  const byPhone = p ? accounts.find((a) => a.phone === p) : undefined;

  if (byEmail && byPhone && byEmail.id !== byPhone.id) {
    return { ok: false, code: IDENTITY_CODES.IDENTITY_CONFLICT, message: IDENTITY_MESSAGES.IDENTITY_CONFLICT };
  }
  if (byEmail) return { ok: false, code: IDENTITY_CODES.ACCOUNT_EXISTS, message: IDENTITY_MESSAGES.ACCOUNT_EXISTS };
  if (byPhone) return { ok: false, code: IDENTITY_CODES.PHONE_ALREADY_REGISTERED, message: IDENTITY_MESSAGES.PHONE_ALREADY_REGISTERED };
  return { ok: true };
}

/* --------------------- session helpers --------------------- */

export interface StarkSession {
  id: string;
  device: string;
  platform: string;
  ip: string;
  location: string;
  createdAt: number;
  lastUsedAt: number;
  current: boolean;
  trusted: boolean;
}

export type AuditKind =
  | "account_created" | "login_success" | "login_failed" | "new_device_login"
  | "logout" | "session_revoked" | "pin_changed" | "pin_reset"
  | "account_frozen" | "account_unfrozen"
  /* §24 — blocked duplicate registration attempts are security events */
  | "duplicate_email_registration_attempt"
  | "duplicate_phone_registration_attempt"
  | "identity_conflict_registration_attempt";

export interface AuditEvent {
  id: string;
  ts: number;
  kind: AuditKind;
  detail: string;
}
