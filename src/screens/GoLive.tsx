import { useEffect, useMemo, useState } from "react";
import { ScreenHeader, SBtn, useNav } from "../components/ui";
import { ICheck, IChevD, ICopy, ILock, IPlay } from "../components/icons";

/* ============================================================
 * STARK — LAUNCH CONSOLE
 * A pre-flight checklist for taking real-money Paystack payments
 * live. Every command & config is copy-ready. Progress persists.
 * ============================================================ */

type Cmd = { label: string; code: string; note?: string };
type Stage = {
  id: string;
  num: string;
  kicker: string;
  title: string;
  tone: "bad" | "warn" | "cyan" | "ok" | "vio";
  summary: string;
  cmds?: Cmd[];
  steps?: string[];
};

const ENV_BLOCK = `STARK_ENV=production
STARK_PORT=8080

# — data plane —
STARK_DB_URL=postgres://USER:PASS@HOST:5432/stark?sslmode=require
STARK_REDIS_URL=rediss://USER:PASS@HOST:6379

# — auth secrets (generate with: openssl rand -hex 32) —
STARK_JWT_ACCESS_SECRET=PASTE_A_LONG_RANDOM_STRING
STARK_JWT_REFRESH_SECRET=PASTE_A_DIFFERENT_LONG_RANDOM_STRING

# — payments (server-only — never in the app) —
PAYSTACK_SECRET_KEY=PASTE_YOUR_ROTATED_sk_live_KEY
PAYSTACK_BASE_URL=https://api.paystack.co

# — public endpoints —
STARK_API_BASE_URL=https://api.YOURDOMAIN.com
STARK_CORS_ORIGINS=https://YOURDOMAIN.com,https://app.YOURDOMAIN.com`;

const STAGES: Stage[] = [
  {
    id: "keys", num: "00", kicker: "SECURITY FIRST", title: "Rotate your Live Secret Key",
    tone: "bad",
    summary: "The previous secret key was shared in a chat, so treat it as compromised. Generate a fresh one before anything else.",
    steps: [
      "Paystack Dashboard → Settings → API Keys & Webhooks",
      "Regenerate the Live Secret Key (sk_live_…)",
      "Copy the new key somewhere safe — it is shown only once",
      "The Public Key (pk_live_…) already ships in the app and is fine as-is",
    ],
  },
  {
    id: "host", num: "01", kicker: "BACKEND", title: "Host the Go API on a public server",
    tone: "cyan",
    summary: "The stark-api service needs a machine reachable over HTTPS. Render is the easiest; Railway, Fly.io or DigitalOcean also work.",
    cmds: [
      { label: "Build the binary", code: "CGO_ENABLED=0 go build -o stark ./cmd/server" },
      { label: "Run it", code: "./stark   # listens on $STARK_PORT (default 8080)", note: "Optional second process for background jobs: ./stark -worker" },
    ],
    steps: [
      "Render → New → Web Service → point it at the stark-api folder",
      "Set the build & start commands above",
      "Add the environment variables (next stage)",
    ],
  },
  {
    id: "db", num: "02", kicker: "DATA", title: "Provision PostgreSQL + Redis",
    tone: "cyan",
    summary: "PostgreSQL is the financial source of truth; Redis holds ephemeral state. Use managed services so they're backed up.",
    cmds: [
      { label: "Postgres connection string", code: "postgres://USER:PASS@HOST:5432/stark?sslmode=require" },
      { label: "Redis connection string", code: "rediss://USER:PASS@HOST:6379" },
    ],
    steps: [
      "Managed Postgres: Render PostgreSQL, Neon, or Supabase",
      "Managed Redis: Render Redis or Upstash",
      "Paste both connection strings into the env (next stage)",
    ],
  },
  {
    id: "domain", num: "03", kicker: "NETWORK", title: "Point a domain at the API with HTTPS",
    tone: "warn",
    summary: "Paystack only delivers webhooks to a public HTTPS URL, so the API needs a real domain.",
    steps: [
      "Buy a domain (Namecheap, Cloudflare) — e.g. yourdomain.com",
      "Add a DNS record pointing api.yourdomain.com at your host",
      "Enable HTTPS — Render/Railway issue a free certificate automatically",
    ],
  },
  {
    id: "env", num: "04", kicker: "SECRETS", title: "Set the production environment",
    tone: "vio",
    summary: "These variables go in your host's secret/env settings — never committed to Git, never in the Flutter app.",
    cmds: [
      { label: "Full .env template", code: ENV_BLOCK, note: "Replace every PASTE_… / USER:PASS@HOST / YOURDOMAIN value" },
      { label: "Generate a strong secret", code: "openssl rand -hex 32" },
    ],
  },
  {
    id: "migrate", num: "05", kicker: "DATABASE", title: "Run the database migrations",
    tone: "cyan",
    summary: "Creates the users, ledger, transactions and payments tables. Safe and idempotent via Goose.",
    cmds: [
      { label: "Apply migrations", code: 'goose -dir stark-api/migrations postgres "$STARK_DB_URL" up' },
      { label: "Verify", code: 'goose -dir stark-api/migrations postgres "$STARK_DB_URL" status', note: "Applies 000001_init · 000002_identity · 000003_payments" },
    ],
  },
  {
    id: "webhook", num: "06", kicker: "PAYSTACK", title: "Register the webhook URL",
    tone: "ok",
    summary: "This is how Paystack tells your server a payment succeeded. The backend verifies the signature before crediting anything.",
    cmds: [
      { label: "Webhook URL to register", code: "https://api.YOURDOMAIN.com/api/v1/payments/paystack/webhook", note: "Replace YOURDOMAIN with your real domain" },
    ],
    steps: [
      "Paystack Dashboard → Settings → API Keys & Webhooks → Webhooks → Add",
      "Paste the URL above (use your real domain)",
      "The handler rejects unsigned or tampered events, so it's safe to expose",
      "Optional: enable the IP whitelist and add your server's public IPv4",
    ],
  },
  {
    id: "clients", num: "07", kicker: "CONNECT", title: "Point the apps at your API",
    tone: "cyan",
    summary: "Until this step, the preview records funding locally. Pointing it at the backend makes the server the authority.",
    cmds: [
      { label: "Flutter", code: "flutter run --dart-define=STARK_API_URL=https://api.YOURDOMAIN.com" },
      { label: "Web preview", code: "VITE_STARK_API_URL=https://api.YOURDOMAIN.com npm run dev" },
    ],
  },
  {
    id: "test", num: "08", kicker: "PROOF", title: "Run one real end-to-end charge",
    tone: "ok",
    summary: "Verify the whole loop with a tiny real payment before opening it to customers.",
    steps: [
      "Make a real ₦100 funding payment in the app",
      "Confirm it appears in your Paystack dashboard",
      "Check the API logs for a “wallet funded” entry (webhook received)",
      "Confirm the ledger shows one CREDIT and the wallet balance rose ₦100",
      "Replay the webhook (or pay again) and confirm no double-credit",
      "Only now: you are live for real customers",
    ],
  },
];

const TONE: Record<Stage["tone"], { text: string; chip: string; dot: string }> = {
  bad:  { text: "text-bad",  chip: "bg-bad/10 text-bad border-bad/30",  dot: "bg-bad" },
  warn: { text: "text-warn", chip: "bg-warn/10 text-warn border-warn/30", dot: "bg-warn" },
  cyan: { text: "text-cyan", chip: "bg-cyan/10 text-cyan border-cyan/30", dot: "bg-cyan" },
  ok:   { text: "text-ok",   chip: "bg-ok/10 text-ok border-ok/30",     dot: "bg-ok" },
  vio:  { text: "text-vio",  chip: "bg-vio/10 text-vio border-vio/30",  dot: "bg-vio" },
};

const KEY = "stark.golive.v1";

export default function GoLive() {
  const nav = useNav();
  const [done, setDone] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem(KEY) ?? "{}"); } catch { return {}; }
  });
  const [open, setOpen] = useState<string | null>("keys");
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(done)); } catch { /* private mode */ } }, [done]);

  const doneCount = useMemo(() => STAGES.filter((s) => done[s.id]).length, [done]);
  const pct = Math.round((doneCount / STAGES.length) * 100);
  const armed = doneCount === STAGES.length;
  const keysDone = !!done["keys"];
  /* Never show a high readiness while the compromised key is unrotated. */
  const shownPct = keysDone ? pct : Math.min(pct, 10);

  const toggle = (id: string) => setDone((d) => ({ ...d, [id]: !d[id] }));

  return (
    <div className="h-full flex flex-col">
      <ScreenHeader
        title="Launch Console"
        sub="Take real-money Paystack payments live"
        onBack={nav.pop}
        right={
          <span className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[10px] font-bold ${armed ? "text-ok bg-ok/10 border-ok/25" : "text-warn bg-warn/10 border-warn/25"}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${armed ? "bg-ok" : "bg-warn"} a-blink`} />
            {armed ? "LIVE-READY" : "PRE-FLIGHT"}
          </span>
        }
      />

      <div className="flex-1 overflow-y-auto no-scrollbar px-5 pb-32 space-y-5">
        {/* readiness + money path */}
        <div className="relative rounded-3xl border border-line overflow-hidden p-5" style={{ background: "linear-gradient(150deg, var(--st-card), var(--st-raised))" }}>
          <div className="absolute inset-0 grid-bg opacity-20 grid-fade" />
          <div className="relative flex items-center gap-5">
            <div className="relative w-24 h-24 shrink-0">
              <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
                <circle cx="50" cy="50" r="42" fill="none" stroke="var(--st-line)" strokeWidth="8" />
                <circle cx="50" cy="50" r="42" fill="none" stroke={armed ? "var(--st-ok)" : "var(--st-cyan)"} strokeWidth="8" strokeLinecap="round"
                  strokeDasharray={`${(shownPct / 100) * 264} 264`} style={{ transition: "stroke-dasharray 0.8s cubic-bezier(0.2,0.7,0.2,1)" }} />
              </svg>
              <div className="absolute inset-0 grid place-items-center">
                <span className="font-display font-bold text-xl tnum">{shownPct}%</span>
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-bold tracking-[0.2em] text-mute">LAUNCH READINESS</p>
              <p className="font-display font-bold text-2xl leading-tight mt-0.5">
                {armed ? "Cleared for launch" : keysDone ? "Systems check in progress" : "Secure your keys first"}
              </p>
              <p className="text-xs text-sub mt-1">{doneCount} of {STAGES.length} stages complete</p>
            </div>
          </div>

          {/* the live money path */}
          <div className="relative mt-5 pt-4 border-t border-line/60">
            <p className="text-[9px] font-bold tracking-[0.25em] text-mute mb-3">THE LIVE MONEY PATH</p>
            <div className="relative">
              <div className="absolute left-0 right-0 top-1/2 h-px bg-line -translate-y-1/2" />
              <div className="absolute top-1/2 -translate-y-1/2 h-1 w-8 rounded-full a-travel"
                style={{ background: "linear-gradient(90deg, transparent, var(--st-cyan))", boxShadow: "0 0 12px var(--st-glow)" }} />
              <div className="relative flex justify-between">
                {["Flutter", "Stark API", "Paystack", "Webhook", "Ledger"].map((n, i) => (
                  <div key={n} className="flex flex-col items-center gap-1.5">
                    <span className={`w-2.5 h-2.5 rounded-full border-2 ${i <= (armed ? 4 : 1) ? "bg-cyan border-cyan shadow-[0_0_8px_var(--st-glow)]" : "bg-void border-line"}`} />
                    <span className="text-[9px] font-semibold text-mute">{n}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5 mt-4">
              {["Client checkout: LIVE", "Backend code: COMPLETE", "Webhook handler: COMPLETE", "Ledger: COMPLETE"].map((c) => (
                <span key={c} className="text-[9px] font-bold text-ok bg-ok/10 border border-ok/25 rounded-md px-2 py-1">{c}</span>
              ))}
              {["Hosting", "Domain + HTTPS", "Key rotation", "Webhook URL"].map((c) => (
                <span key={c} className="text-[9px] font-bold text-warn bg-warn/10 border border-warn/25 rounded-md px-2 py-1">{c}: pending</span>
              ))}
            </div>
          </div>
        </div>

        {/* pre-flight checklist */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-display font-bold text-[15px]">Pre-flight checklist</h2>
            <button onClick={() => { if (confirm("Reset the launch checklist?")) setDone({}); }}
              className="press text-[10px] font-bold text-mute hover:text-bad transition-colors">Reset</button>
          </div>

          <div className="space-y-2.5">
            {STAGES.map((s) => {
              const isDone = !!done[s.id];
              const isOpen = open === s.id;
              const t = TONE[s.tone];
              return (
                <div key={s.id} className={`card overflow-hidden transition-colors ${isDone ? "opacity-80" : ""} ${s.id === "keys" && !keysDone ? "border-bad/40" : ""}`}>
                  <button onClick={() => setOpen(isOpen ? null : s.id)} className="w-full flex items-center gap-3 px-4 py-3.5 text-left press">
                    <span onClick={(e) => { e.stopPropagation(); toggle(s.id); }}
                      className={`shrink-0 w-6 h-6 rounded-lg grid place-items-center border transition-colors cursor-pointer ${isDone ? "bg-ok border-ok text-cyanink" : "border-line bg-well text-mute hover:border-cyan/50"}`}
                      aria-label={isDone ? "Mark incomplete" : "Mark complete"}>
                      {isDone && <ICheck size={13} sw={3} />}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[10px] font-bold text-mute">{s.num}</span>
                        <span className={`text-[9px] font-bold tracking-widest px-1.5 py-0.5 rounded border ${t.chip}`}>{s.kicker}</span>
                      </div>
                      <p className={`font-display font-semibold text-[13.5px] mt-0.5 ${isDone ? "text-sub line-through decoration-line" : "text-ink"}`}>{s.title}</p>
                    </div>
                    <IChevD size={16} className={`text-mute transition-transform ${isOpen ? "rotate-180" : ""}`} />
                  </button>

                  {isOpen && (
                    <div className="px-4 pb-4 pt-1 border-t border-line/60 a-rise">
                      <p className="text-xs text-sub leading-relaxed mt-2.5">{s.summary}</p>

                      {s.steps && (
                        <ol className="mt-3 space-y-1.5">
                          {s.steps.map((st, i) => (
                            <li key={i} className="flex gap-2.5 text-xs text-sub leading-relaxed">
                              <span className={`font-mono text-[10px] font-bold ${t.text} shrink-0 mt-0.5`}>{String(i + 1).padStart(2, "0")}</span>
                              <span>{st}</span>
                            </li>
                          ))}
                        </ol>
                      )}

                      {s.cmds && (
                        <div className="mt-3 space-y-2.5">
                          {s.cmds.map((c) => (
                            <div key={c.label}>
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-[10px] font-bold tracking-widest text-mute uppercase">{c.label}</span>
                                <CopyBtn code={c.code} />
                              </div>
                              <pre className="font-mono text-[11px] leading-relaxed bg-well border border-line rounded-xl px-3.5 py-3 overflow-x-auto no-scrollbar text-cyan/90 whitespace-pre">{c.code}</pre>
                              {c.note && <p className="text-[10px] text-mute mt-1.5 flex items-center gap-1.5"><span className={`w-1 h-1 rounded-full ${t.dot}`} />{c.note}</p>}
                            </div>
                          ))}
                        </div>
                      )}

                      {!isDone && (
                        <button onClick={() => toggle(s.id)} className={`press mt-3 text-[11px] font-bold ${t.text} hover:opacity-80`}>
                          Mark “{s.title}” as done →
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ignition */}
        <div className={`relative rounded-3xl border overflow-hidden p-5 ${armed ? "border-ok/40" : "border-line"}`}
          style={{ background: armed ? "linear-gradient(150deg, rgba(34,197,94,0.12), rgba(34,197,94,0.02))" : "linear-gradient(150deg, var(--st-card), var(--st-raised))" }}>
          <div className="flex items-center gap-4">
            <span className={`shrink-0 w-12 h-12 rounded-2xl grid place-items-center border ${armed ? "bg-ok/15 text-ok border-ok/30" : "bg-well text-mute border-line"}`}>
              {armed ? <IPlay size={22} /> : <ILock size={22} />}
            </span>
            <div className="flex-1">
              <p className="font-display font-bold text-[15px]">{armed ? "Ignition armed" : "Ignition locked"}</p>
              <p className="text-xs text-sub mt-0.5 leading-relaxed">
                {armed
                  ? "All stages complete. Real customer payments will now settle through your backend, verified by Paystack and recorded immutably in the ledger."
                  : `Complete all ${STAGES.length} pre-flight stages — starting with rotating your secret key — to unlock live payments.`}
              </p>
            </div>
          </div>
          {armed && (
            <p className="a-rise mt-4 text-[10px] font-bold tracking-widest text-ok bg-ok/10 border border-ok/25 rounded-xl px-3 py-2.5 text-center">
              ✦ STARK PAYMENTS ARE LIVE — MONITOR THE FIRST FEW TRANSACTIONS CLOSELY ✦
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function CopyBtn({ code }: { code: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard?.writeText(code).then(() => { setOk(true); setTimeout(() => setOk(false), 1400); }); }}
      className={`press inline-flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-1 rounded-lg border transition-colors ${ok ? "text-ok border-ok/40 bg-ok/10" : "text-sub border-line hover:text-cyan hover:border-cyan/40"}`}
    >
      {ok ? <ICheck size={12} sw={3} /> : <ICopy size={12} />}
      {ok ? "Copied" : "Copy"}
    </button>
  );
}
