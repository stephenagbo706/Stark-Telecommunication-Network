import { useEffect, useState } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { SBtn, ScreenHeader, useNav } from "../components/ui";
import { ICheck, ICopy, ILock } from "../components/icons";
import { useStark } from "../lib/store";

interface Stage { id: string; title: string; body: string; cmd?: string; warn?: boolean }

const STAGES: Stage[] = [
  { id: "rotate", title: "1 · Rotate your Live Secret Key", warn: true, body: "Because the key was shared in chat, treat it as compromised. In the Paystack Dashboard → Settings → API Keys & Webhooks → Regenerate Live Secret Key. Use the NEW key everywhere below.", cmd: "Paystack Dashboard → Settings → API Keys → Regenerate" },
  { id: "host", title: "2 · Host the Go API over HTTPS", body: "Deploy stark-api/ to a public host (Render, Railway, Fly, DigitalOcean). It must be reachable at a public https:// URL — Paystack only sends webhooks to public HTTPS endpoints.", cmd: "cd stark-api && docker compose up -d api worker" },
  { id: "db", title: "3 · Provision PostgreSQL + Redis", body: "Use managed Postgres 16 and Redis 7 (same host or managed). Set STARK_DB_URL and STARK_REDIS_URL on the API.", cmd: "STARK_DB_URL=postgres://…  STARK_REDIS_URL=redis://…" },
  { id: "domain", title: "4 · Point a domain at the API", body: "e.g. api.yourdomain.com → your host, with TLS. This is the base for your webhook and callback URLs.", cmd: "https://api.yourdomain.com" },
  { id: "env", title: "5 · Set production environment", body: "Configure the backend with your ROTATED secret key (server-side only). Never put it in the app or in Git.", cmd: "PAYSTACK_SECRET_KEY=sk_live_…  STARK_API_BASE_URL=https://api.yourdomain.com" },
  { id: "migrate", title: "6 · Run migrations", body: "Applies the init, identity, and payments schemas (including payment_webhooks idempotency).", cmd: "goose -dir migrations up" },
  { id: "webhook", title: "7 · Register the webhook in Paystack", body: "Dashboard → Settings → Webhooks → add your URL. The handler verifies the HMAC signature, re-verifies the charge server-to-server, then credits the ledger exactly once.", cmd: "https://api.yourdomain.com/api/v1/payments/paystack/webhook" },
  { id: "point", title: "8 · Point the apps at your API", body: "Set the API base in the Flutter app (STARK_API_URL) and/or web preview (VITE_STARK_API_URL) so funding and purchases hit your backend.", cmd: "STARK_API_URL=https://api.yourdomain.com" },
  { id: "test", title: "9 · Run one real ₦100 charge", body: "Fund the wallet with a real card, confirm: it lands in Paystack, the webhook fires, the ledger gets ONE credit, and a replayed webhook does NOT double-credit. Then you're live.", cmd: "Fund ₦100 → check ledger + payment_webhooks" },
];

const useLaunch = create<{ done: string[]; toggle: (id: string) => void; reset: () => void }>()(
  persist(
    (set) => ({
      done: [],
      toggle: (id) => set((s) => ({ done: s.done.includes(id) ? s.done.filter((x) => x !== id) : [...s.done, id] })),
      reset: () => set({ done: [] }),
    }),
    { name: "stark-launch-console-v1" }
  )
);

export default function GoLive() {
  const nav = useNav();
  const { toast } = useStark();
  const { done, toggle, reset } = useLaunch();
  const [copied, setCopied] = useState<string | null>(null);

  const pct = Math.round((done.length / STAGES.length) * 100);
  const live = done.length === STAGES.length;

  useEffect(() => { document.title = live ? "STARK • LIVE" : "STARK • Launch Console"; }, [live]);

  const copy = async (id: string, text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(id); toast("Copied to clipboard", "ok"); setTimeout(() => setCopied(null), 1500); }
    catch { toast("Couldn't copy", "bad"); }
  };

  return (
    <div className="h-full flex flex-col">
      <ScreenHeader title="Launch Console" sub="Take live Paystack payments live" onBack={() => nav.pop()}
        right={live ? <span className="flex items-center gap-1.5 text-[10px] font-bold text-ok bg-ok/10 border border-ok/25 px-2.5 py-1.5 rounded-lg"><span className="w-1.5 h-1.5 rounded-full bg-ok a-blink" /> ARMED</span> : undefined} />
      <div className="flex-1 overflow-y-auto no-scrollbar px-5 pb-28 space-y-4">
        {/* readiness gauge + money path */}
        <div className="card p-5 relative overflow-hidden">
          <div className="absolute inset-0 grid-bg opacity-20 grid-fade" />
          <div className="relative flex items-center justify-between">
            <div>
              <p className="text-[10px] font-bold tracking-widest text-mute">PRODUCTION READINESS</p>
              <p className="font-display font-bold text-[32px] tnum leading-tight" style={{ color: live ? "var(--st-ok)" : "var(--st-cyan)" }}>{pct}%</p>
              <p className="text-[10px] text-mute font-semibold mt-1">{done.length} of {STAGES.length} stages complete</p>
            </div>
            <div className="relative w-20 h-20">
              <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
                <circle cx="50" cy="50" r="42" fill="none" stroke="var(--st-line)" strokeWidth="8" />
                <circle cx="50" cy="50" r="42" fill="none" stroke={live ? "var(--st-ok)" : "var(--st-cyan)"} strokeWidth="8" strokeLinecap="round" strokeDasharray={`${(pct / 100) * 264} 264`} style={{ transition: "stroke-dasharray 0.8s cubic-bezier(0.2,0.7,0.2,1)" }} />
              </svg>
              <div className="absolute inset-0 grid place-items-center">{live ? <ICheck size={26} className="text-ok" /> : <ILock size={22} className="text-cyan" />}</div>
            </div>
          </div>
          {/* money path */}
          <div className="relative mt-4">
            <div className="flex items-center justify-between text-[8.5px] font-bold tracking-widest text-mute">
              {["FLUTTER", "STARK API", "PAYSTACK", "WEBHOOK", "LEDGER"].map((s, i) => (
                <span key={s} className={i <= Math.floor((pct / 100) * 4) ? "text-cyan" : ""}>{s}</span>
              ))}
            </div>
            <div className="relative h-1 rounded-full bg-well mt-2 overflow-visible">
              <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: "linear-gradient(90deg, var(--st-cyan), var(--st-ok))" }} />
              {pct > 0 && pct < 100 && <span className="absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-cyan shadow-[0_0_10px_var(--st-glow)] a-travel" style={{ left: `${pct}%` }} />}
            </div>
          </div>
        </div>

        {live && (
          <div className="card p-4 border-ok/30 bg-ok/5 a-pop">
            <p className="text-[13px] font-bold text-ok flex items-center gap-2"><ICheck size={16} sw={2.4} /> All stages armed.</p>
            <p className="text-[11px] text-sub mt-1.5 leading-relaxed">Wallet funding now settles through your Go backend: signed webhook → server verification → idempotent ledger credit. Real customer money is protected end-to-end.</p>
            <button onClick={reset} className="press text-[10px] font-bold text-mute mt-2 hover:text-bad">Reset checklist</button>
          </div>
        )}

        {/* stages */}
        {STAGES.map((s) => {
          const isDone = done.includes(s.id);
          return (
            <div key={s.id} className={`card p-4 transition-colors ${isDone ? "border-ok/30 bg-ok/5" : s.warn ? "border-warn/30" : ""}`}>
              <div className="flex items-start gap-3">
                <button onClick={() => toggle(s.id)} aria-label={isDone ? "Mark incomplete" : "Mark complete"}
                  className={`press shrink-0 w-6 h-6 rounded-lg border-2 grid place-items-center mt-0.5 transition-colors ${isDone ? "bg-ok border-ok text-void" : "border-line hover:border-cyan"}`}>
                  {isDone && <ICheck size={14} sw={2.6} />}
                </button>
                <div className="flex-1 min-w-0">
                  <p className={`text-[13px] font-bold ${isDone ? "text-mute line-through" : s.warn ? "text-warn" : ""}`}>{s.title}</p>
                  <p className="text-[11px] text-sub leading-relaxed mt-1">{s.body}</p>
                  {s.cmd && (
                    <div className="mt-2.5 flex items-center gap-2 bg-well border border-line rounded-lg px-3 py-2">
                      <code className="flex-1 text-[10px] font-mono text-cyan truncate">{s.cmd}</code>
                      <button onClick={() => copy(s.id, s.cmd!)} className="press shrink-0 text-mute hover:text-cyan" aria-label="Copy command">
                        {copied === s.id ? <ICheck size={13} className="text-ok" /> : <ICopy size={13} />}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        <p className="text-[10px] text-mute leading-relaxed px-1">
          The secret key lives ONLY on the Go backend (PAYSTACK_SECRET_KEY env). It is never in this app, the APK, or version control. Progress is saved on this device.
        </p>
      </div>
    </div>
  );
}
