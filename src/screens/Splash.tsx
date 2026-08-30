import { useEffect, useRef, useState } from "react";
import { StarkMark } from "../components/icons";
import { Scramble } from "../components/ui";

const BOOT_LINES = [
  { label: "securing session", tag: "argon2id", ms: 350 },
  { label: "syncing ledger", tag: "double-entry", ms: 850 },
  { label: "connecting providers", tag: "failover armed", ms: 1400 },
  { label: "stark ready", tag: "OK", ms: 1950 },
];
const TOTAL_MS = 2450;

export default function Splash({ onDone }: { onDone: () => void }) {
  const [progress, setProgress] = useState(0);
  const [linesOn, setLinesOn] = useState(0);
  const [sealing, setSealing] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const done = useRef(false);

  useEffect(() => {
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / TOTAL_MS);
      setProgress(Math.round(p * 100));
      if (!done.current) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const timers = BOOT_LINES.map((l, i) => setTimeout(() => setLinesOn(i + 1), l.ms));
    const seal = setTimeout(() => setSealing(true), TOTAL_MS - 350);
    const finish = setTimeout(() => {
      if (done.current) return;
      done.current = true;
      setLeaving(true);
      setTimeout(onDone, 420);
    }, TOTAL_MS);

    return () => {
      cancelAnimationFrame(raf);
      timers.forEach(clearTimeout);
      clearTimeout(seal);
      clearTimeout(finish);
    };
  }, [onDone]);

  return (
    <div className={`absolute inset-0 z-[80] bg-void flex flex-col transition-all duration-400 ${leaving ? "opacity-0 scale-[1.03]" : "opacity-100"}`} style={{ transitionDuration: "420ms" }}>
      <div className="absolute inset-0 grid-bg opacity-40 grid-fade" />
      <div className="absolute -top-24 -left-24 w-96 h-96 rounded-full a-float" style={{ background: "radial-gradient(circle, var(--st-glow), transparent 70%)" }} />
      <div className="absolute -bottom-32 -right-24 w-96 h-96 rounded-full a-float" style={{ background: "radial-gradient(circle, rgba(139,92,246,0.16), transparent 70%)", animationDelay: "1.2s" }} />
      <div className="absolute inset-0 noise" />

      {/* corner telemetry */}
      <div className="relative flex justify-between px-6 pt-5 text-[9px] font-mono tracking-widest text-mute">
        <span>STK://BOOT v4.2.0</span>
        <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-ok a-blink" /> LIVE</span>
      </div>

      {/* mark + wordmark */}
      <div className="relative flex-1 grid place-items-center">
        <div className="flex flex-col items-center">
          <div className="relative">
            {[0, 1, 2].map((i) => (
              <span key={i} className="absolute inset-0 rounded-full border border-cyan/40 a-ring" style={{ animationDelay: `${i * 0.5}s` }} />
            ))}
            <div className="relative w-24 h-24 rounded-3xl grid place-items-center border border-cyan/40"
              style={{ background: "linear-gradient(150deg, var(--st-card), var(--st-raised))", boxShadow: sealing ? "0 0 60px var(--st-glow)" : "0 0 30px var(--st-glow)", transition: "box-shadow 0.4s" }}>
              <span className={sealing ? "text-cyan" : "text-cyan"} style={{ filter: sealing ? "drop-shadow(0 0 12px var(--st-glow))" : "none", transition: "filter 0.4s" }}>
                <StarkMark size={46} />
              </span>
            </div>
          </div>
          <h1 className="font-display font-bold text-[42px] tracking-tight mt-7 text-ink">
            <Scramble text="STARK" speed={34} />
          </h1>
          <p className="text-[11px] tracking-[0.5em] text-cyan font-bold mt-1" style={{ animationDelay: "0.3s" }}>TELECOMMUNICATION</p>
        </div>
      </div>

      {/* boot log + progress */}
      <div className="relative px-8 pb-10 w-full max-w-sm mx-auto">
        <div className="font-mono text-[10.5px] space-y-1.5 mb-5 h-[76px]">
          {BOOT_LINES.slice(0, linesOn).map((l, i) => (
            <div key={l.label} className="a-rise flex items-center gap-2" style={{ animationDelay: `${i * 40}ms` }}>
              <span className="text-dim">▸</span>
              <span className="text-sub">{l.label}</span>
              <span className="ml-auto text-cyan">[{l.tag}]</span>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <div className="flex-1 h-1.5 rounded-full bg-well overflow-hidden">
            <div className="h-full rounded-full transition-all duration-150" style={{ width: `${progress}%`, background: "linear-gradient(90deg, var(--st-cyan), var(--st-blue))", boxShadow: "0 0 12px var(--st-glow)" }} />
          </div>
          <span className="font-mono text-[10px] text-mute tnum w-9 text-right">{progress}%</span>
        </div>
        <p className="text-center font-mono text-[9px] tracking-[0.3em] text-mute mt-3">{progress >= 100 ? "LAUNCH" : "INITIALIZING"}</p>
      </div>

      {/* footer strip */}
      <div className="relative flex justify-between px-6 pb-5 text-[8.5px] font-mono tracking-widest text-dim border-t border-line/60 pt-3 mx-6">
        <span>NGN • LAGOS • NG</span>
        <span>LEDGER LOCKED</span>
        <span>TLS 1.3</span>
      </div>
    </div>
  );
}
