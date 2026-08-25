/* ============================================================
 * STARK GLOBAL IDENTITY REGISTRY (preview mirror of PostgreSQL)
 *
 * In production, account uniqueness lives in the `users` table with
 * uq_users_email_norm / uq_users_phone_norm — global, shared by every
 * device. The preview mirrors that contract: this registry persists
 * under its OWN storage key, completely separate from the app's
 * session state, and is NEVER cleared by logout or app reset.
 *
 *   A device is not an account. A session is not an account.
 *   The registry below plays the role of the shared users table.
 * ============================================================ */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { KnownAccount } from "./identity";

interface RegistryState {
  identities: KnownAccount[];
  add: (a: KnownAccount) => void;
}

/* Seed identities simulate accounts that already exist in the global
   Stark database before this device ever opens the app — exactly the
   "register on Device 1, then try Device 2" scenario. They appear only
   when no persisted registry exists yet (i.e. first run anywhere). */
const SEEDS: KnownAccount[] = [
  { id: "usr-demo-ada", name: "Adaeze Okafor", email: "ada.okafor@gmail.com", phone: "+2348034721189", status: "active" },
  { id: "usr-demo-chidi", name: "Chidi Okafor", email: "chidi.okafor@example.com", phone: "+2348011111111", status: "active" },
];

export const useIdentityRegistry = create<RegistryState>()(
  persist(
    (set) => ({
      identities: SEEDS,
      add: (a) =>
        set((s) =>
          s.identities.some((x) => x.email === a.email || x.phone === a.phone)
            ? s
            : { identities: [...s.identities, a] }
        ),
    }),
    {
      name: "stark-identity-registry-v1", // deliberately NOT the app session key
      partialize: (s) => ({ identities: s.identities }),
    }
  )
);
