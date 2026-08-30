import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { KnownAccount } from "./identity";

/* Global identity registry — the preview's mirror of PostgreSQL's `users`
   table. It persists SEPARATELY from session state so an account identity
   survives logout: registering the same email/phone again from any session
   correctly reports ACCOUNT_EXISTS. A device is not an account. */
interface RegistryState {
  identities: KnownAccount[];
  add: (a: KnownAccount) => void;
  setStatus: (email: string, status: KnownAccount["status"]) => void;
}

export const useIdentityRegistry = create<RegistryState>()(
  persist(
    (set) => ({
      identities: [],
      add: (a) =>
        set((s) => ({
          identities: [...s.identities.filter((x) => x.email !== a.email && x.phone !== a.phone), a],
        })),
      setStatus: (email, status) =>
        set((s) => ({
          identities: s.identities.map((x) => (x.email === email ? { ...x, status } : x)),
        })),
    }),
    { name: "stark-identity-registry-v1" }
  )
);
