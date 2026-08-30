import { useEffect, useRef, useState } from "react";
import { Scramble } from "../components/ui";

const BOOT_LINES = [
  { t: "securing session", k: "argon2id" },
  { t: "syncing ledger", k: "double-entry" },
  { t: "connecting providers", k: "failover armed" },
  { t: "stark ready", k: "OK" },
];

export default function Splash({ onDone }: { onDone: () => void }) {
  const reduced = useRef(
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
  const [step, setStep] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const doneRef = useRef(false);

  useEffect(() => {
    const fast = reduced.current;
    const gap = fast ? 140 : 520;
    const timers: number[] = [];
    BOOT_LINES.forEach((_, i) => {
      timers.push(window.setTimeout(() => setStep(i + 1), 420 + i * gap));
    });
    timers.push(window.setTimeout(() => setLeaving(true), 420 + BOOT_LINES.length * gap + 260));
    timers.push(window.setTimeout(() => { if (!doneRef.current) { doneRef.current = true; onDone(); } }, 420 + BOOT_LINES.length * gap + 260 + (fast ? 120 : 560)));
    return () => timers.forEach(clearTimeout);
  }, [onDone]);

  const pct = Math.min(100, Math.round((step / BOOT_LINES.length) * 100));

  return (
    <div
      className={`fixed inset-0 z-[100] bg-void text-ink font-body noise scanlines overflow-hidden transition-all duration-500 ease-out ${
        leaving ? "opacity-0 scale-[1.04] pointer-events-none" : "opacity-100 scale-100"
      }`}
      aria-label="Loading Stark"
      role="status"
    >
      {/* ambient layers */}
      <div className="absolute inset-0 grid-bg grid-fade opacity-60" />
      <div className="absolute inset-0 pointer-events-none" style={{ background: "radial-gradient(55% 45% at 50% 38%, var(--st-glow), transparent 70%)" }} />
      <div className="absolute top-[16%] left-[12%] w-72 h-72 rounded-full a-float pointer-events-none" style={{ background: "radial-gradient(circle, var(--st-glow), transparent 70%)" }} />
      <div className="absolute bottom-[10%] right-[8%] w-80 h-80 rounded-full a-float pointer-events-none" style={{ animationDelay: "1.8s", background: "radial-gradient(circle, rgba(139,92,246,0.12), transparent 70%)" }} />

      {/* corner telemetry */}
      <div className="absolute top-5 left-6 text-[9px] font-mono font-bold text-mute tracking-[0.25em]">STK://BOOT v4.2.0</div>
      <div className="absolute top-5 right-6 flex items-center gap-2 text-[9px] font-mono font-bold text-cyan tracking-[0.2em]">
        <span className="w-1.5 h-1.5 rounded-full bg-cyan a-blink" /> LIVE
      </div>

      <div className="relative h-full flex flex-col items-center justify-center px-8">
        {/* bolt mark with signal rings */}
        <div className="relative mb-8">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="absolute inset-0 rounded-full border border-cyan/30 a-ring"
              style={{ animationDelay: `${i * 0.65}s` }}
              aria-hidden
            />
          ))}
          <div className="relative w-24 h-24 rounded-[26px] border border-cyan/40 bg-panel/80 backdrop-blur-sm grid place-items-center shadow-[0_0_60px_-10px_var(--st-glow)]">
            <svg width="52" height="52" viewBox="0 0 52 52" fill="none" aria-hidden>
              <path
                d="M30 4 12 30h11l-3 18 20-28H28l2-16Z"
                stroke="var(--st-cyan)"
                strokeWidth="2.5"
                strokeLinejoin="round"
                className="splash-bolt"
                style={{ fill: step >= 4 ? "var(--st-cyan)" : "transparent", transition: "fill 400ms ease" }}
              />
            </svg>
          </div>
        </div>

        {/* wordmark */}
        <h1 className="font-display font-bold text-[44px] leading-none tracking-tight">
          <Scramble text="STARK" />
          <span className="text-cyan">⌁</span>
        </h1>
        <p
          className="mt-2 text-[10px] font-bold tracking-[0.55em] text-sub splash-sub"
          style={{ paddingLeft: "0.55em" }}
        >
          TELECOMMUNICATION
        </p>

        {/* boot log */}
        <div className="mt-9 w-full max-w-[300px] font-mono text-[10.5px] space-y-1.5" aria-live="polite">
          {BOOT_LINES.map((l, i) => {
            const on = step > i;
            const active = step === i + 1;
            return (
              <div
                key={l.t}
                className={`flex items-center gap-2 transition-all duration-300 ${
                  on ? "opacity-100 translate-x-0" : "opacity-0 -translate-x-3"
                }`}
              >
                <span className={`shrink-0 ${on ? "text-cyan" : "text-mute"}`}>›</span>
                <span className={`flex-1 truncate ${i === BOOT_LINES.length - 1 && on ? "text-ok font-bold" : "text-sub"}`}>
                  {l.t}
                </span>
                {on && (
                  <span className={`text-[8.5px] font-bold px-1.5 py-0.5 rounded border ${
                    active && i < BOOT_LINES.length - 1
                      ? "text-warn border-warn/40 bg-warn/10"
                      : i === BOOT_LINES.length - 1
                        ? "text-ok border-ok/40 bg-ok/10"
                        : "text-cyan border-cyan/40 bg-cyan/10"
                  }`}>
                    {l.k}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {/* progress */}
        <div className="mt-7 w-full max-w-[300px]">
          <div className="h-[3px] rounded-full bg-well overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500 ease-out"
              style={{ width: `${pct}%`, background: "linear-gradient(90deg, var(--st-cyan), #38BDF8)", boxShadow: "0 0 12px var(--st-glow)" }}
            />
          </div>
          <div className="mt-2 flex justify-between text-[9px] font-mono font-bold text-mute tracking-[0.2em]">
            <span>{pct < 100 ? "INITIALIZING" : "LAUNCH"}</span>
            <span className="tnum text-cyan">{pct}%</span>
          </div>
        </div>
      </div>

      {/* footer strip */}
      <div className="absolute bottom-5 inset-x-0 flex items-center justify-between px-6 text-[9px] font-mono font-bold text-mute tracking-[0.2em]">
        <span>NGN • LAGOS • NG</span>
        <span className="flex items-center gap-1.5">
          <span className="w-1 h-1 rounded-full bg-ok" /> LEDGER LOCKED
          <span className="w-1 h-1 rounded-full bg-cyan ml-2" /> TLS 1.3
        </span>
      </div>

      <style>{`
        .splash-bolt { stroke-dasharray: 190; stroke-dashoffset: 190; animation: kf-boltdraw 1.1s ease-out 0.15s forwards; }
        @keyframes kf-boltdraw { to { stroke-dashoffset: 0; } }
        .splash-sub { animation: kf-subin 700ms ease-out 500ms both; }
        @keyframes kf-subin { from { opacity: 0; letter-spacing: 0.9em; } to { opacity: 1; letter-spacing: 0.55em; } }
        .a-ring { animation: kf-ring 2s ease-out infinite; opacity: 0; }
        @keyframes kf-ring { 0% { transform: scale(1); opacity: 0.55; } 100% { transform: scale(2.1); opacity: 0; } }
        @media (prefers-reduced-motion: reduce) {
          .splash-bolt { animation: none; stroke-dashoffset: 0; }
          .splash-sub, .a-ring { animation: none; opacity: 1; }
          .a-ring { display: none; }
        }
      `}</style>
    </div>
  );
}
