import { useMemo, useState } from "react";

// Native production codebase — embedded verbatim from the repo.
import pubspec from "../../stark-flutter/pubspec.yaml?raw";
import mainDart from "../../stark-flutter/lib/main.dart?raw";
import coreDart from "../../stark-flutter/lib/core/core.dart?raw";
import widgetsDart from "../../stark-flutter/lib/shared/widgets.dart?raw";
import featuresDart from "../../stark-flutter/lib/features/features.dart?raw";
import goMod from "../../stark-api/go.mod?raw";
import mainGo from "../../stark-api/cmd/server/main.go?raw";
import platformGo from "../../stark-api/internal/platform/platform.go?raw";
import authGo from "../../stark-api/internal/auth/auth.go?raw";
import financeGo from "../../stark-api/internal/finance/finance.go?raw";
import schemaSql from "../../stark-api/migrations/000001_init.up.sql?raw";
import composeYml from "../../stark-api/docker-compose.yml?raw";

type FileNode = { name: string; path: string; lang: string; content: string };

const FLUTTER_FILES: FileNode[] = [
  { name: "pubspec.yaml", path: "stark-flutter/pubspec.yaml", lang: "yaml", content: pubspec },
  { name: "main.dart", path: "stark-flutter/lib/main.dart", lang: "dart", content: mainDart },
  { name: "core.dart", path: "stark-flutter/lib/core/core.dart", lang: "dart", content: coreDart },
  { name: "widgets.dart", path: "stark-flutter/lib/shared/widgets.dart", lang: "dart", content: widgetsDart },
  { name: "features.dart", path: "stark-flutter/lib/features/features.dart", lang: "dart", content: featuresDart },
];

const GO_FILES: FileNode[] = [
  { name: "go.mod", path: "stark-api/go.mod", lang: "go", content: goMod },
  { name: "main.go", path: "stark-api/cmd/server/main.go", lang: "go", content: mainGo },
  { name: "platform.go", path: "stark-api/internal/platform/platform.go", lang: "go", content: platformGo },
  { name: "auth.go", path: "stark-api/internal/auth/auth.go", lang: "go", content: authGo },
  { name: "finance.go", path: "stark-api/internal/finance/finance.go", lang: "go", content: financeGo },
];

const INFRA_FILES: FileNode[] = [
  { name: "000001_init.up.sql", path: "stark-api/migrations/000001_init.up.sql", lang: "sql", content: schemaSql },
  { name: "docker-compose.yml", path: "stark-api/docker-compose.yml", lang: "yaml", content: composeYml },
];

const API_ROUTES: { group: string; routes: { m: string; p: string; d: string }[] }[] = [
  {
    group: "Auth",
    routes: [
      { m: "POST", p: "/api/v1/auth/register", d: "Create user + profile + wallet + ledger accounts atomically; OTP to Redis" },
      { m: "POST", p: "/api/v1/auth/login", d: "Argon2id verify, lockout, device registration, JWT pair" },
      { m: "POST", p: "/api/v1/auth/otp/verify", d: "Verify 6-digit OTP (5 min TTL, 5 attempts), activate account" },
      { m: "POST", p: "/api/v1/auth/refresh", d: "Refresh rotation — old JTI blacklisted in Redis" },
      { m: "POST", p: "/api/v1/auth/logout", d: "Revoke refresh token" },
    ],
  },
  {
    group: "Profile & Security",
    routes: [
      { m: "GET", p: "/api/v1/profile", d: "Profile incl. photo URL (never bytes)" },
      { m: "PUT", p: "/api/v1/profile", d: "Update name / phone" },
      { m: "POST", p: "/api/v1/profile/photo", d: "Multipart upload — MIME sniff, 2 MB cap, safe object key" },
      { m: "DELETE", p: "/api/v1/profile/photo", d: "Remove photo from object storage" },
      { m: "POST", p: "/api/v1/security/verify-pin", d: "Argon2id PIN check, 3-attempt lock" },
      { m: "PUT", p: "/api/v1/security/pin", d: "Change transaction PIN" },
      { m: "POST", p: "/api/v1/security/freeze", d: "Freeze account + security event" },
      { m: "GET", p: "/api/v1/devices", d: "Device list & last seen" },
      { m: "DELETE", p: "/api/v1/devices/others", d: "Sign out other devices" },
    ],
  },
  {
    group: "Wallet & Ledger",
    routes: [
      { m: "GET", p: "/api/v1/wallet", d: "Balances derived from ledger under row locks" },
      { m: "GET", p: "/api/v1/wallet/ledger", d: "Immutable double-entry history" },
      { m: "POST", p: "/api/v1/wallet/fund", d: "Initialize Paystack charge (secret key server-side)" },
      { m: "POST", p: "/api/v1/payments/webhook/paystack", d: "HMAC-SHA512 verify → re-verify → idempotent ledger credit" },
    ],
  },
  {
    group: "Transactions & VTU",
    routes: [
      { m: "POST", p: "/api/v1/transactions/purchase", d: "PIN → idempotency → reserve → provider failover → settle/reverse" },
      { m: "GET", p: "/api/v1/transactions", d: "History (state machine statuses)" },
      { m: "GET", p: "/api/v1/transactions/{id}", d: "Full receipt data incl. provider ref & token" },
      { m: "GET", p: "/api/v1/data/plans", d: "Dynamic plans from provider sync — never hardcoded" },
      { m: "GET", p: "/api/v1/cable/validate", d: "IUC validation via provider (no fabricated names)" },
      { m: "GET", p: "/api/v1/electricity/validate", d: "Meter validation via provider (no fake tokens)" },
    ],
  },
];

const TABLES = [
  "users", "profiles", "devices", "sessions", "wallets", "ledger_accounts", "ledger_entries",
  "transactions", "transaction_items", "payments", "payment_webhooks", "providers",
  "provider_products", "provider_transactions", "airtime_transactions", "data_transactions",
  "cable_transactions", "electricity_transactions", "beneficiaries", "subscriptions",
  "referrals", "rewards", "cashback_entries", "promotions", "notifications", "support_tickets",
  "disputes", "fraud_events", "security_events", "audit_logs", "api_keys",
];

const PHASES: { n: number; title: string; items: string[] }[] = [
  { n: 1, title: "Foundation & Identity", items: ["Flutter theme + router + Dio", "Go API + PostgreSQL + Redis", "Auth, OTP, PIN, profile photo"] },
  { n: 2, title: "Money", items: ["Double-entry ledger", "Wallet reserve/settle/reverse", "Paystack init + signed webhooks"] },
  { n: 3, title: "VTU Engine", items: ["Provider interface + priority", "Circuit breaker + failover", "Airtime & data flows"] },
  { n: 4, title: "Services", items: ["Cable + electricity + tokens", "Receipts, beneficiaries, reversals", "Reconciliation worker"] },
  { n: 5, title: "Growth", items: ["FCM notifications", "Subscriptions + auto-renew worker", "Referrals, rewards, cashback"] },
  { n: 6, title: "Security", items: ["Security center, 2FA", "Device management", "Fraud events + freeze"] },
  { n: 7, title: "Intelligence", items: ["Stark AI with PIN-gated actions", "Analytics + insights"] },
  { n: 8, title: "Platform", items: ["Admin console", "Business accounts", "Developer API keys"] },
];

function CodeView({ file }: { file: FileNode }) {
  const lines = useMemo(() => file.content.split("\n"), [file.content]);
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(file.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  };
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-line bg-panel/70 shrink-0">
        <span className="w-2 h-2 rounded-full bg-cyan shadow-[0_0_10px_var(--st-glow)]" />
        <span className="font-mono text-[12px] font-semibold text-ink truncate">{file.path}</span>
        <span className="text-[9px] font-bold uppercase tracking-widest text-mute border border-line rounded px-1.5 py-0.5">{file.lang}</span>
        <span className="ml-auto text-[10px] text-mute font-semibold tnum">{lines.length} lines</span>
        <button
          onClick={copy}
          className="press text-[10px] font-bold px-2.5 py-1 rounded-md bg-cyan/10 text-cyan border border-cyan/30 hover:bg-cyan/20"
        >
          {copied ? "Copied ✓" : "Copy file"}
        </button>
      </div>
      <pre className="flex-1 overflow-auto text-[11.5px] leading-[1.65] font-mono p-4 bg-[#060D18]">
        {lines.map((ln, i) => (
          <div key={i} className="flex hover:bg-white/[0.03]">
            <span className="select-none w-10 shrink-0 text-right pr-3 text-[#3A4D63]">{i + 1}</span>
            <span className="whitespace-pre text-[#C9D7E8]">{ln || " "}</span>
          </div>
        ))}
      </pre>
    </div>
  );
}

function FileTree({ files, active, onPick, root }: { files: FileNode[]; active: string; onPick: (f: FileNode) => void; root: string }) {
  return (
    <div className="text-[11px] font-mono">
      <p className="px-3 py-2 text-[9px] font-bold tracking-[0.2em] text-mute font-sans">{root}</p>
      {files.map((f) => (
        <button
          key={f.path}
          onClick={() => onPick(f)}
          className={`w-full text-left px-3 py-[7px] flex items-center gap-2 border-l-2 transition-colors press ${
            active === f.path ? "border-cyan bg-cyan/8 text-cyan" : "border-transparent text-sub hover:text-ink hover:bg-white/[0.03]"
          }`}
        >
          <span className={`w-1 h-1 rounded-full ${active === f.path ? "bg-cyan" : "bg-mute"}`} />
          {f.name}
        </button>
      ))}
    </div>
  );
}

type Tab = "overview" | "flutter" | "go" | "data" | "api" | "deploy";

export default function Console({ onExit }: { onExit: () => void }) {
  const [tab, setTab] = useState<Tab>("overview");
  const [file, setFile] = useState<FileNode>(GO_FILES[2]);

  const tabs: { id: Tab; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "flutter", label: "Flutter App" },
    { id: "go", label: "Go Backend" },
    { id: "data", label: "Database" },
    { id: "api", label: "API" },
    { id: "deploy", label: "Deploy" },
  ];

  return (
    <div className="min-h-screen bg-base text-ink">
      {/* console header */}
      <header className="sticky top-0 z-40 border-b border-line bg-base/85 backdrop-blur-md">
        <div className="max-w-[1400px] mx-auto px-5 h-14 flex items-center gap-4">
          <span className="font-display font-bold text-lg tracking-tight">
            STARK<span className="text-cyan">⌁</span>
          </span>
          <span className="hidden sm:inline text-[9px] font-bold tracking-[0.25em] text-mute border border-line rounded-full px-2.5 py-1">
            ENGINEERING CONSOLE
          </span>
          <nav className="ml-auto flex items-center gap-1 overflow-x-auto">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  setTab(t.id);
                  if (t.id === "flutter") setFile(FLUTTER_FILES[2]);
                  if (t.id === "go") setFile(GO_FILES[2]);
                  if (t.id === "data") setFile(INFRA_FILES[0]);
                  if (t.id === "deploy") setFile(INFRA_FILES[1]);
                }}
                className={`press px-3 py-1.5 rounded-lg text-[11px] font-bold whitespace-nowrap transition-colors ${
                  tab === t.id ? "bg-cyan text-cyanink" : "text-sub hover:text-ink hover:bg-panel"
                }`}
              >
                {t.label}
              </button>
            ))}
            <button
              onClick={onExit}
              className="press ml-2 px-3 py-1.5 rounded-lg text-[11px] font-bold text-cyan border border-cyan/40 hover:bg-cyan/10 whitespace-nowrap"
            >
              ← Product UI
            </button>
          </nav>
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto px-5 py-6">
        {tab === "overview" && <Overview goto={setTab} />}

        {(tab === "flutter" || tab === "go" || tab === "data" || tab === "deploy") && (
          <div className="grid lg:grid-cols-[230px_1fr] gap-4">
            <aside className="card p-2 h-fit lg:sticky lg:top-20 overflow-x-auto">
              {tab === "flutter" && <FileTree root="STARK-FLUTTER/" files={FLUTTER_FILES} active={file.path} onPick={setFile} />}
              {tab === "go" && <FileTree root="STARK-API/" files={GO_FILES} active={file.path} onPick={setFile} />}
              {(tab === "data" || tab === "deploy") && <FileTree root="INFRA/" files={INFRA_FILES} active={file.path} onPick={setFile} />}
              <div className="mt-2 px-3 py-3 border-t border-line">
                <p className="text-[10px] leading-relaxed text-mute font-sans">
                  {tab === "flutter"
                    ? "Riverpod + GoRouter + Dio. Tokens live only in flutter_secure_storage. Biometrics never leave the device."
                    : tab === "go"
                      ? "Chi + pgx + go-redis. Ledger postings are balanced, row-locked and idempotent. Paystack secrets stay here."
                      : "PostgreSQL 16 + Redis 7. Money is BIGINT kobo. Ledger entries are insert-only."}
                </p>
              </div>
            </aside>
            <section className="card overflow-hidden h-[calc(100vh-160px)] min-h-[480px]">
              <CodeView file={file} />
            </section>
          </div>
        )}

        {tab === "api" && (
          <div className="grid md:grid-cols-2 gap-4">
            {API_ROUTES.map((g) => (
              <section key={g.group} className="card p-5">
                <h3 className="font-display font-bold text-sm mb-3 text-cyan">{g.group}</h3>
                <div className="space-y-2.5">
                  {g.routes.map((r) => (
                    <div key={r.p} className="flex gap-2.5 items-start">
                      <span
                        className={`shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded mt-0.5 ${
                          r.m === "GET" ? "bg-info/12 text-info border border-info/30" :
                          r.m === "DELETE" ? "bg-bad/12 text-bad border border-bad/30" :
                          "bg-ok/12 text-ok border border-ok/30"
                        }`}
                      >
                        {r.m}
                      </span>
                      <div className="min-w-0">
                        <p className="font-mono text-[11.5px] font-semibold text-ink break-all">{r.p}</p>
                        <p className="text-[10.5px] text-mute leading-relaxed">{r.d}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function Overview({ goto }: { goto: (t: Tab) => void }) {
  return (
    <div className="space-y-5">
      {/* banner */}
      <div className="relative rounded-[20px] border border-cyan/25 p-6 overflow-hidden">
        <div className="absolute inset-0 grid-bg opacity-30 grid-fade" />
        <div className="relative">
          <p className="text-[9px] font-bold tracking-[0.3em] text-cyan">PRODUCTION STACK — GENERATED IN THIS REPO</p>
          <h1 className="font-display font-bold text-2xl sm:text-3xl mt-2 leading-tight">
            Flutter + Go + PostgreSQL + Redis<span className="text-cyan">.</span>
          </h1>
          <p className="text-[12.5px] text-sub max-w-2xl mt-2 leading-relaxed">
            The reference UI you approved is preserved as the visual source of truth (Product UI). The native
            implementation lives in <span className="font-mono text-cyan">stark-flutter/</span> and{" "}
            <span className="font-mono text-cyan">stark-api/</span> — browse every file in this console, copy it,
            and build it natively with <span className="font-mono text-ink">flutter run</span> and{" "}
            <span className="font-mono text-ink">docker compose up</span>.
          </p>
          <div className="flex flex-wrap gap-2 mt-4">
            {["Flutter 3.22", "Dart 3.4", "Riverpod", "GoRouter", "Dio", "local_auth", "FCM", "Go 1.23", "Chi", "pgx", "go-redis", "Argon2id", "JWT rotation", "PostgreSQL 16", "Redis 7", "Paystack", "Docker Compose"].map((t) => (
              <span key={t} className="text-[9.5px] font-bold px-2 py-1 rounded-md bg-panel border border-line text-sub">
                {t}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* architecture diagram */}
      <div className="card p-5">
        <h2 className="font-display font-bold text-sm mb-4">Architecture — money never trusts the client</h2>
        <div className="grid md:grid-cols-5 gap-2 items-stretch">
          <ArchNode title="Flutter App" sub="Riverpod · GoRouter · Dio · Biometrics on-device" hue="#00D9FF" />
          <ArchArrow label="HTTPS / REST · JWT · idempotency keys" />
          <ArchNode title="Go API + Workers" sub="Chi · Argon2id · JWT rotation · state machine" hue="#00E5FF" />
          <ArchArrow label="SQL tx + row locks · Redis locks" />
          <ArchNode title="PostgreSQL + Redis" sub="Immutable ledger · OTP · queues · caches" hue="#38BDF8" />
        </div>
        <div className="grid md:grid-cols-3 gap-2 mt-2">
          <ArchNode title="Paystack" sub="Init → signed webhook → re-verify → ledger credit" hue="#22C55E" small />
          <ArchNode title="VTU Provider Engine" sub="Priority · circuit breaker · failover · reconciliation" hue="#F59E0B" small />
          <ArchNode title="Object Storage" sub="Profile photos — DB stores keys, never bytes" hue="#8B5CF6" small />
        </div>
        <div className="mt-4 grid sm:grid-cols-3 gap-2 text-[10.5px] font-semibold">
          <p className="rounded-lg border border-ok/25 bg-ok/8 text-ok px-3 py-2">✓ Double-entry: every posting sums to zero</p>
          <p className="rounded-lg border border-ok/25 bg-ok/8 text-ok px-3 py-2">✓ Failure → automatic REVERSAL, wallet restored</p>
          <p className="rounded-lg border border-ok/25 bg-ok/8 text-ok px-3 py-2">✓ Uncertain → PROCESSING + reconciler, no blind retry</p>
        </div>
      </div>

      {/* quick stats + tables + phases */}
      <div className="grid lg:grid-cols-3 gap-4">
        <section className="card p-5">
          <h3 className="font-display font-bold text-sm mb-3">Delivered artifacts</h3>
          <div className="space-y-2">
            {[
              ["Flutter application", `${FLUTTER_FILES.length} files · ${FLUTTER_FILES.reduce((a, f) => a + f.content.split("\n").length, 0)} lines`, "#00D9FF"],
              ["Go backend", `${GO_FILES.length} files · ${GO_FILES.reduce((a, f) => a + f.content.split("\n").length, 0)} lines`, "#00E5FF"],
              ["PostgreSQL schema", `${TABLES.length} tables · UUIDs · FKs · idempotency indexes`, "#38BDF8"],
              ["Docker Compose stack", "postgres · redis · migrate · api · worker", "#F59E0B"],
            ].map(([t, s, c]) => (
              <div key={t} className="flex items-center gap-3 rounded-lg border border-line bg-panel px-3 py-2.5">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: c, boxShadow: `0 0 8px ${c}` }} />
                <div>
                  <p className="text-[12px] font-bold">{t}</p>
                  <p className="text-[10px] text-mute font-semibold">{s}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4">
            <p className="text-[9px] font-bold tracking-[0.2em] text-mute mb-2">DATABASE TABLES</p>
            <div className="flex flex-wrap gap-1">
              {TABLES.map((t) => (
                <span key={t} className="font-mono text-[9px] px-1.5 py-0.5 rounded bg-well border border-line text-sub">{t}</span>
              ))}
            </div>
          </div>
        </section>

        <section className="card p-5">
          <h3 className="font-display font-bold text-sm mb-3">Financial safety rules — enforced in code</h3>
          <ul className="space-y-2 text-[11px] leading-relaxed text-sub">
            {[
              "Ledger entries are INSERT-only; corrections are REVERSAL postings.",
              "Balances update under SELECT … FOR UPDATE; negative balance is a CHECK constraint.",
              "Duplicate purchases/webhooks rejected via Redis idempotency claims.",
              "Paystack secret key exists only in the Go process env.",
              "Refresh tokens rotate; reuse is treated as takeover and rejected.",
              "PIN & password hashed with Argon2id — plaintext never persists.",
              "Provider timeout ⇒ PROCESSING, reconciler settles or reverses once.",
              "Electricity tokens & cable customer names come only from providers.",
            ].map((s, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-cyan font-bold shrink-0">⌁</span>
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="card p-5">
          <h3 className="font-display font-bold text-sm mb-3">Build roadmap</h3>
          <div className="space-y-2">
            {PHASES.map((p) => (
              <details key={p.n} className="group rounded-lg border border-line bg-panel overflow-hidden">
                <summary className="press cursor-pointer list-none px-3 py-2 flex items-center gap-2.5 text-[11.5px] font-bold">
                  <span className={`w-5 h-5 grid place-items-center rounded-md text-[9.5px] font-bold ${p.n <= 4 ? "bg-cyan text-cyanink" : "bg-well text-sub border border-line"}`}>
                    {p.n}
                  </span>
                  {p.title}
                  <span className="ml-auto text-mute text-[10px] group-open:rotate-90 transition-transform">›</span>
                </summary>
                <ul className="px-3 pb-2.5 pt-0.5 space-y-1 text-[10.5px] text-sub font-semibold">
                  {p.items.map((it) => <li key={it}>• {it}</li>)}
                </ul>
              </details>
            ))}
          </div>
        </section>
      </div>

      {/* run commands */}
      <div className="card p-5">
        <h2 className="font-display font-bold text-sm mb-3">Run it natively</h2>
        <div className="grid md:grid-cols-2 gap-3">
          <div className="rounded-xl border border-line bg-[#060D18] p-4 font-mono text-[11.5px] leading-relaxed">
            <p className="text-mute"># backend + data plane</p>
            <p className="text-ink">cd stark-api</p>
            <p className="text-ink">cp .env.example .env <span className="text-mute"># set secrets</span></p>
            <p className="text-cyan">docker compose up --build</p>
            <p className="text-mute mt-2"># → API on :8080 · Postgres :5432 · Redis :6379</p>
          </div>
          <div className="rounded-xl border border-line bg-[#060D18] p-4 font-mono text-[11.5px] leading-relaxed">
            <p className="text-mute"># mobile app</p>
            <p className="text-ink">cd stark-flutter</p>
            <p className="text-ink">flutter pub get</p>
            <p className="text-cyan">flutter run --dart-define=STARK_API_URL=https://api.stark.example</p>
            <p className="text-mute mt-2"># → Riverpod · GoRouter · local_auth · FCM</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 mt-4">
          <button onClick={() => goto("go")} className="press text-[11px] font-bold px-3 py-2 rounded-lg bg-cyan text-cyanink hover:brightness-110">Browse Go backend →</button>
          <button onClick={() => goto("flutter")} className="press text-[11px] font-bold px-3 py-2 rounded-lg border border-cyan/40 text-cyan hover:bg-cyan/10">Browse Flutter app →</button>
          <button onClick={() => goto("data")} className="press text-[11px] font-bold px-3 py-2 rounded-lg border border-line text-sub hover:text-ink">Schema & migrations →</button>
        </div>
      </div>
    </div>
  );
}

function ArchNode({ title, sub, hue, small }: { title: string; sub: string; hue: string; small?: boolean }) {
  return (
    <div
      className={`rounded-xl border p-3.5 relative overflow-hidden ${small ? "" : "min-h-[92px]"}`}
      style={{ borderColor: `${hue}40`, background: `${hue}0D` }}
    >
      <span className="absolute top-0 left-0 right-0 h-[2px]" style={{ background: `linear-gradient(90deg, transparent, ${hue}, transparent)` }} />
      <p className="font-display font-bold text-[13px]" style={{ color: hue }}>{title}</p>
      <p className="text-[10px] text-sub font-semibold mt-1 leading-relaxed">{sub}</p>
    </div>
  );
}

function ArchArrow({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 py-1 md:py-0">
      <svg width="100%" height="14" className="text-cyan/50" aria-hidden>
        <line x1="8%" y1="7" x2="88%" y2="7" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 5" style={{ animation: "kf-dash 5s linear infinite" }} />
        <path d="M88% 7" />
      </svg>
      <span className="text-[8.5px] font-bold text-mute tracking-wide text-center leading-tight">{label}</span>
    </div>
  );
}
