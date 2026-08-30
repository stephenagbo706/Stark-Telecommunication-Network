/* ============================================================
 * STARK TURBO — real on-device diagnostics engine
 *
 * Every value displayed by Stark Turbo comes from an actual
 * measurement performed on this device. Nothing is simulated:
 *
 *   • availability  → real HTTPS reachability probe (not just navigator.onLine)
 *   • connection    → browser network information API (labeled honestly)
 *   • API latency   → real round-trip to GET /api/v1/diagnostics/ping
 *   • throughput    → real timed download (≈200 KB, capped, cancellable)
 *   • stability     → 6 real probes → loss / jitter classification
 *   • grade         → deterministic weighted score of the above
 *
 * Stark Turbo never claims to boost towers, increase ISP bandwidth,
 * or alter carrier networks. It measures and reports — that's all.
 * ============================================================ */

export interface TurboStage {
  id: "availability" | "type" | "latency" | "speed" | "stability";
  label: string;
  value: string;
  score: number; // 0–100 for the row's progress bar
  note: string;
}

export interface TurboReport {
  measuredAt: number; // epoch ms — §22 freshness
  online: boolean;
  reachable: boolean; // real probe succeeded
  connectionType: string; // WIFI / 4G / 3G / 2G / ETHERNET / OFFLINE
  downlinkEstimateMbps: number | null; // browser estimate — labeled as such
  apiLatencyMs: number | null;
  apiRegion: string | null; // from the ping response — never invented
  apiSource: "stark-backend" | "public-edge" | "unavailable";
  throughputMbps: number | null;
  samples: number;
  failedSamples: number;
  jitterMs: number | null;
  lossPct: number;
  stability: "Stable" | "Fair" | "Unstable" | "Offline";
  grade: number; // 0–100, deterministic
  gradeBand: "Excellent" | "Good" | "Fair" | "Poor" | "Offline";
  recommendations: string[];
  stages: TurboStage[];
}

/* ------------------------- tunables ------------------------- */

/** Result considered stale after 5 minutes (§22). */
export const TURBO_STALE_MS = 5 * 60 * 1000;
/** Throughput probe size — bandwidth-conscious, never a "big file" (§5). */
export const TURBO_TEST_BYTES = 200_000;
/** Stability probe count (§8: 5–10). */
export const TURBO_STABILITY_SAMPLES = 6;
/** Per-probe timeout. */
const PROBE_TIMEOUT_MS = 4000;
/** Whole-throughput-test cap so slow networks can't hang the run. */
const SPEED_TEST_CAP_MS = 6000;

const REACHABILITY_TARGETS = [
  "https://www.gstatic.com/generate_204",
  "https://cp.cloudflare.com/generate_204",
];
const PUBLIC_PING = "https://cp.cloudflare.com/generate_204";
const SPEED_TARGET = `https://speed.cloudflare.com/__down?bytes=${TURBO_TEST_BYTES}`;

/* ----------------------- small utilities --------------------- */

function fetchWithTimeout(url: string, ms: number, init?: RequestInit): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  return fetch(url, { ...init, cache: "no-store", signal: ctl.signal }).finally(() => clearTimeout(timer));
}

async function timedProbe(url: string): Promise<number | null> {
  const t0 = performance.now();
  try {
    const res = await fetchWithTimeout(url, PROBE_TIMEOUT_MS, { method: "GET" });
    // Drain a little so timing reflects transfer, not just headers.
    if (res.body) { try { await res.body.cancel(); } catch { /* ignore */ } }
    return performance.now() - t0;
  } catch {
    return null; // timeout / DNS / TLS / reset / offline
  }
}

/* ------------------- connection type (§4) -------------------- */

interface NetInfo {
  effectiveType?: string;
  downlink?: number;
  rtt?: number;
  type?: string;
}

export function detectConnectionType(): { type: string; downlinkMbps: number | null } {
  if (typeof navigator === "undefined" || !navigator.onLine) return { type: "OFFLINE", downlinkMbps: null };
  const conn: NetInfo | undefined = (navigator as unknown as { connection?: NetInfo }).connection;
  const eff = (conn?.effectiveType ?? "").toLowerCase();
  if (conn?.type === "wifi" || eff === "4g") {
    // The browser reports 4G for most Wi-Fi; prefer the transport name when available.
    if (conn?.type === "wifi") return { type: "WI-FI", downlinkMbps: conn?.downlink ?? null };
    return { type: "4G", downlinkMbps: conn?.downlink ?? null };
  }
  if (eff === "3g") return { type: "3G", downlinkMbps: conn?.downlink ?? null };
  if (eff === "2g" || eff === "slow-2g") return { type: "2G", downlinkMbps: conn?.downlink ?? null };
  if (conn?.type === "ethernet") return { type: "ETHERNET", downlinkMbps: conn?.downlink ?? null };
  if (conn?.type && conn.type !== "unknown") return { type: conn.type.toUpperCase(), downlinkMbps: conn?.downlink ?? null };
  return { type: "ONLINE", downlinkMbps: conn?.downlink ?? null }; // type unknown — say so, never guess
}

/* ------------------- reachability probe (§3) ------------------ */

export async function checkReachability(): Promise<boolean> {
  for (const url of REACHABILITY_TARGETS) {
    const ms = await timedProbe(url);
    if (ms !== null) return true;
  }
  return false;
}

/* --------------------- API latency (§6/§7) -------------------- */

export interface ApiLatencyResult {
  ms: number | null;
  region: string | null;
  source: "stark-backend" | "public-edge" | "unavailable";
}

/**
 * Real round-trip against the Stark backend's lightweight ping endpoint.
 * If the backend is not configured/reachable, we measure a public edge and
 * LABEL IT AS SUCH — we never claim "Lagos edge" unless the Stark API
 * itself reports that region (§24).
 */
export async function measureApiLatency(apiBase?: string): Promise<ApiLatencyResult> {
  const base = apiBase ?? (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_STARK_API_URL;
  if (base) {
    const t0 = performance.now();
    try {
      const res = await fetchWithTimeout(`${base.replace(/\/$/, "")}/api/v1/diagnostics/ping`, PROBE_TIMEOUT_MS);
      const ms = Math.round(performance.now() - t0);
      let region: string | null = null;
      try {
        const body = await res.json();
        region = body?.data?.region ?? body?.region ?? null;
      } catch { /* non-JSON is fine — latency is still real */ }
      return { ms, region, source: "stark-backend" };
    } catch { /* fall through to public edge */ }
  }
  // No Stark backend configured/reachable — measure a public edge honestly.
  const ms = await timedProbe(PUBLIC_PING);
  if (ms !== null) return { ms: Math.round(ms), region: null, source: "public-edge" };
  return { ms: null, region: null, source: "unavailable" };
}

/* --------------------- throughput (§5) ------------------------ */

export async function measureThroughput(): Promise<number | null> {
  const ctl = new AbortController();
  const cap = setTimeout(() => ctl.abort(), SPEED_TEST_CAP_MS);
  const t0 = performance.now();
  let bytes = 0;
  try {
    const res = await fetch(SPEED_TARGET, { cache: "no-store", signal: ctl.signal });
    if (!res.ok || !res.body) return null;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value?.length ?? 0;
      if (performance.now() - t0 > SPEED_TEST_CAP_MS - 500) { await reader.cancel(); break; }
    }
    const secs = (performance.now() - t0) / 1000;
    if (secs <= 0 || bytes === 0) return null;
    const mbps = (bytes * 8) / 1_000_000 / secs;
    return Math.round(mbps * 10) / 10;
  } catch {
    return null; // blocked / captive portal / offline — reported as unmeasured, never faked
  } finally {
    clearTimeout(cap);
  }
}

/* --------------------- stability (§8) --------------------------
 * Thresholds (documented, fixed):
 *   Stable   — loss ≤ 2%  AND jitter ≤ 30 ms
 *   Fair     — loss ≤ 15% AND jitter ≤ 80 ms
 *   Unstable — anything worse (while still reachable)
 * Jitter = mean absolute deviation of samples from their mean.        */

export interface StabilityResult {
  samples: number;
  failed: number;
  lossPct: number;
  jitterMs: number | null;
  minMs: number | null;
  maxMs: number | null;
  avgMs: number | null;
  stability: "Stable" | "Fair" | "Unstable" | "Offline";
}

export function classifyStability(lossPct: number, jitterMs: number | null): StabilityResult["stability"] {
  if (lossPct >= 100) return "Offline";
  const j = jitterMs ?? 0;
  if (lossPct <= 2 && j <= 30) return "Stable";
  if (lossPct <= 15 && j <= 80) return "Fair";
  return "Unstable";
}

export async function measureStability(): Promise<StabilityResult> {
  const url = REACHABILITY_TARGETS[0];
  let failed = 0;
  const times: number[] = [];
  for (let i = 0; i < TURBO_STABILITY_SAMPLES; i++) {
    const ms = await timedProbe(url);
    if (ms === null) failed++;
    else times.push(ms);
  }
  const lossPct = Math.round((failed / TURBO_STABILITY_SAMPLES) * 100);
  let jitter: number | null = null;
  let avg: number | null = null;
  if (times.length >= 2) {
    avg = times.reduce((a, b) => a + b, 0) / times.length;
    jitter = times.reduce((a, t) => a + Math.abs(t - avg!), 0) / times.length;
    jitter = Math.round(jitter);
    avg = Math.round(avg);
  }
  return {
    samples: TURBO_STABILITY_SAMPLES,
    failed,
    lossPct,
    jitterMs: jitter,
    minMs: times.length ? Math.round(Math.min(...times)) : null,
    maxMs: times.length ? Math.round(Math.max(...times)) : null,
    avgMs: avg,
    stability: classifyStability(lossPct, jitter),
  };
}

/* ----------------- deterministic scoring (§9) -------------------
 * Weights (documented, fixed):
 *   Connectivity 20 — online & reachable = full; captive-portal-ish = 6
 *   Latency      25 — ≤50 ms full → 0 at ≥500 ms (linear between)
 *   Speed        25 — ≥5 Mbps full → 0 at ≤0.2 Mbps (linear); unmeasured = 0
 *   Stability    30 — scaled by loss and jitter (see stabilityScore)
 * Same inputs always produce the same score. No randomness.         */

export function latencyScore(ms: number | null): number {
  if (ms === null) return 0;
  if (ms <= 50) return 25;
  if (ms >= 500) return 0;
  return Math.round(25 * (1 - (ms - 50) / 450));
}

export function speedScore(mbps: number | null): number {
  if (mbps === null) return 0;
  if (mbps >= 5) return 25;
  if (mbps <= 0.2) return 0;
  return Math.round(25 * ((mbps - 0.2) / 4.8));
}

export function stabilityScore(s: StabilityResult): number {
  if (s.stability === "Offline") return 0;
  const lossFactor = Math.max(0, 1 - s.lossPct * 0.06); // 0% loss → 1, ~17% → 0
  const j = s.jitterMs ?? 0;
  const jitterFactor = j <= 25 ? 1 : j >= 120 ? 0 : 1 - (j - 25) / 95;
  return Math.round(30 * lossFactor * jitterFactor);
}

export interface GradeInputs {
  reachable: boolean;
  online: boolean;
  apiMs: number | null;
  mbps: number | null;
  stability: StabilityResult;
}

export function computeGrade(g: GradeInputs): { grade: number; band: TurboReport["gradeBand"] } {
  if (!g.online || !g.reachable) return { grade: 0, band: "Offline" };
  const connectivity = g.reachable ? 20 : 6;
  const total = connectivity + latencyScore(g.apiMs) + speedScore(g.mbps) + stabilityScore(g.stability);
  const grade = Math.max(0, Math.min(100, total));
  const band = grade >= 85 ? "Excellent" : grade >= 65 ? "Good" : grade >= 45 ? "Fair" : "Poor";
  return { grade, band };
}

/* ------------------ recommendations (§10) -----------------------
 * Rules read the actual measurements; a recommendation can never
 * contradict the numbers that produced it.                          */

export function buildRecommendations(r: Omit<TurboReport, "recommendations" | "grade" | "gradeBand" | "stages">): string[] {
  if (!r.online || !r.reachable) {
    return ["No internet connection. Connect to Wi-Fi or mobile data and try again.",
      "Financial services need a connection — nothing is charged while offline."];
  }
  const out: string[] = [];
  if (r.apiSource === "unavailable") {
    out.push("Stark services are temporarily unreachable. Please try again shortly.");
  }
  if (r.apiLatencyMs !== null && r.apiLatencyMs > 250) {
    out.push("High network latency detected. Transaction confirmation may take longer.");
  }
  if (r.throughputMbps !== null && r.throughputMbps < 1) {
    out.push("Your current connection is slow. Large requests may take longer.");
  }
  if (r.stability === "Unstable") {
    out.push("Connection instability detected. Keep the app open during purchases.");
  } else if (r.stability === "Fair") {
    out.push("Connection is fair. If a purchase stalls, it stays PROCESSING and reconciles — no double charges.");
  }
  if (r.apiLatencyMs !== null && r.apiLatencyMs <= 250 && r.stability === "Stable" && (r.throughputMbps === null || r.throughputMbps >= 1)) {
    out.unshift(r.apiLatencyMs <= 120
      ? "Excellent connection. Transactions should confirm quickly."
      : "Good connection. Transactions should normally confirm quickly.");
  }
  if (out.length === 0) out.push("Connection looks healthy. Auto-renewals and webhooks will settle in real time.");
  return out.slice(0, 3);
}

/* ----------------------- orchestrator (§12) --------------------- */

let activeRun = 0; // concurrency guard — one diagnostic at a time

export async function runDiagnostics(
  onStage: (s: TurboStage) => void,
  apiBase?: string
): Promise<TurboReport | null> {
  const runId = ++activeRun;
  const alive = () => activeRun === runId;
  const stages: TurboStage[] = [];
  const emit = (s: TurboStage) => { stages.push(s); onStage(s); };

  /* 1 — availability: real reachability, not just navigator.onLine */
  const online = typeof navigator === "undefined" ? false : navigator.onLine;
  const reachable = online ? await checkReachability() : false;
  if (!alive()) return null;
  emit({
    id: "availability",
    label: "Network availability",
    value: reachable ? "Online" : online ? "No internet" : "Offline",
    score: reachable ? 100 : 0,
    note: reachable
      ? "Internet verified with a live reachability probe."
      : online
        ? "Wi-Fi/mobile is on, but no internet reached the device (captive portal or outage)."
        : "Reconnect to use financial services.",
  });

  /* 2 — connection type (browser-reported, honestly labeled) */
  const { type, downlinkMbps } = detectConnectionType();
  if (!alive()) return null;
  emit({
    id: "type",
    label: "Connection type",
    value: type + (downlinkMbps ? ` • ~${downlinkMbps} Mbps est.` : ""),
    score: reachable ? (type === "WI-FI" || type === "4G" || type === "ETHERNET" ? 90 : type === "3G" ? 65 : type === "2G" ? 35 : 70) : 0,
    note: downlinkMbps
      ? "Reported by the device's network API — an estimate, not a speed test."
      : "The device did not expose a connection class — no guess is shown.",
  });

  /* 3 — real API latency */
  const api = reachable ? await measureApiLatency(apiBase) : { ms: null, region: null, source: "unavailable" as const };
  if (!alive()) return null;
  emit({
    id: "latency",
    label: "API latency",
    value: api.ms !== null ? `${api.ms} ms` : "Unavailable",
    score: api.ms !== null ? Math.round(latencyScore(api.ms) * 4) : 0,
    note: api.source === "stark-backend"
      ? `Real round-trip to the Stark API${api.region ? ` • ${api.region}` : ""}.`
      : api.source === "public-edge"
        ? "Stark API not configured here — measured against a public edge instead."
        : "The Stark API could not be reached from this network.",
  });

  /* 4 — real throughput */
  const mbps = reachable ? await measureThroughput() : null;
  if (!alive()) return null;
  emit({
    id: "speed",
    label: "Download throughput",
    value: mbps !== null ? `${mbps} Mbps` : "Unmeasured",
    score: mbps !== null ? Math.round(speedScore(mbps) * 4) : 0,
    note: mbps !== null
      ? `Timed ${(TURBO_TEST_BYTES / 1000).toFixed(0)} KB test download — bandwidth-conscious by design.`
      : "The speed endpoint was blocked on this network — no number is invented.",
  });

  /* 5 — stability from real samples */
  const stab = reachable ? await measureStability() : {
    samples: TURBO_STABILITY_SAMPLES, failed: TURBO_STABILITY_SAMPLES, lossPct: 100,
    jitterMs: null, minMs: null, maxMs: null, avgMs: null, stability: "Offline" as const,
  };
  if (!alive()) return null;
  emit({
    id: "stability",
    label: "Connection stability",
    value: stab.stability,
    score: Math.round(stabilityScore(stab) * (100 / 30)),
    note: stab.stability === "Offline"
      ? "No samples could complete while offline."
      : `${stab.samples - stab.failed}/${stab.samples} probes succeeded • jitter ${stab.jitterMs ?? "—"} ms • loss ${stab.lossPct}%.`,
  });

  /* score + recommendations — pure functions of the measurements */
  const base = {
    measuredAt: Date.now(), online, reachable,
    connectionType: type, downlinkEstimateMbps: downlinkMbps,
    apiLatencyMs: api.ms, apiRegion: api.region, apiSource: api.source,
    throughputMbps: mbps, samples: stab.samples, failedSamples: stab.failed,
    jitterMs: stab.jitterMs, lossPct: stab.lossPct, stability: stab.stability,
  };
  const { grade, band } = computeGrade({ reachable, online, apiMs: api.ms, mbps, stability: stab });
  return { ...base, grade, gradeBand: band, recommendations: buildRecommendations(base), stages };
}

/** Whether a completed report should no longer be presented as current (§22). */
export function isStale(report: TurboReport, now = Date.now()): boolean {
  return now - report.measuredAt > TURBO_STALE_MS;
}

/** Subscribe to real network changes (§11). Returns an unsubscribe fn. */
export function watchNetwork(onChange: () => void): () => void {
  const conn: (NetInfo & { onchange?: (() => void) | null }) | undefined =
    (navigator as unknown as { connection?: NetInfo & { onchange?: (() => void) | null } }).connection;
  const fire = () => onChange();
  window.addEventListener("online", fire);
  window.addEventListener("offline", fire);
  if (conn) conn.onchange = fire;
  return () => {
    window.removeEventListener("online", fire);
    window.removeEventListener("offline", fire);
    if (conn) conn.onchange = null;
  };
}
