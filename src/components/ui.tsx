import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { useStark, hashStr, initials } from "../lib/store";
import { IBack, ICheck, IFinger, IInfo, IX, StarkMark } from "./icons";

/* Floating-layer counter — while a Sheet or PinPad is open the bottom tab
   bar slides away so controls are never covered. Counter-based so nested
   layers (sheet → pin pad) compose correctly. */
export const useFloatLayer = create<{ count: number; inc: () => void; dec: () => void }>((set) => ({
  count: 0,
  inc: () => set((s) => ({ count: s.count + 1 })),
  dec: () => set((s) => ({ count: Math.max(0, s.count - 1) })),
}));

/* ---------------- navigation ---------------- */
export type TabId = "home" | "wallet" | "ai" | "activity" | "profile";
export type Overlay =
  | { name: "buy"; service: string }
  | { name: "tx"; id: string }
  | { name: "notifications" } | { name: "security" } | { name: "referrals" }
  | { name: "rewards" } | { name: "help"; txId?: string } | { name: "diagnostics" }
  | { name: "analytics" } | { name: "subscriptions" } | { name: "beneficiaries" }
  | { name: "golive" };

interface Nav {
  tab: TabId;
  setTab: (t: TabId) => void;
  overlay: Overlay | null;
  push: (o: Overlay) => void;
  pop: () => void;
}
const NavCtx = createContext<Nav>({ tab: "home", setTab: () => {}, overlay: null, push: () => {}, pop: () => {} });
export const useNav = () => useContext(NavCtx);
export const NavProvider = NavCtx.Provider;

/* ---------------- button ---------------- */
export function SBtn({ children, onClick, variant = "primary", className = "", disabled, loading, small }: {
  children: React.ReactNode; onClick?: () => void; variant?: "primary" | "ghost" | "outline" | "danger" | "violet";
  className?: string; disabled?: boolean; loading?: boolean; small?: boolean;
}) {
  const base = `press inline-flex items-center justify-center gap-2 font-semibold rounded-xl transition-all duration-200 disabled:opacity-40 disabled:pointer-events-none ${small ? "text-[13px] px-3.5 py-2" : "text-sm px-5 py-3"} ${className}`;
  const styles = {
    primary: "bg-cyan text-cyanink shadow-[0_8px_24px_-8px_var(--st-glow)] hover:brightness-110",
    violet: "bg-vio text-white shadow-[0_8px_24px_-8px_rgba(139,92,246,0.5)] hover:brightness-110",
    ghost: "bg-raised text-ink border border-line hover:border-cyan/50",
    outline: "bg-transparent text-cyan border border-cyan/40 hover:bg-cyan/10",
    danger: "bg-bad/15 text-bad border border-bad/30 hover:bg-bad/25",
  }[variant];
  return (
    <button onClick={onClick} disabled={disabled || loading} className={`${base} ${styles}`}>
      {loading && <span className="w-4 h-4 rounded-full border-2 border-current border-t-transparent animate-spin" />}
      {children}
    </button>
  );
}

export function Chip({ children, active, onClick, hue }: { children: React.ReactNode; active?: boolean; onClick?: () => void; hue?: string }) {
  return (
    <button onClick={onClick} className={`press shrink-0 px-3.5 py-1.5 rounded-full text-xs font-semibold border transition-colors ${active ? "bg-cyan text-cyanink border-cyan" : "bg-panel text-sub border-line hover:text-ink"}`}
      style={active && hue ? { background: hue, borderColor: hue, color: "#06121F" } : undefined}>
      {children}
    </button>
  );
}

/* ---------------- badges ---------------- */
export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { c: string; dot: string }> = {
    SUCCESSFUL: { c: "text-ok bg-ok/10 border-ok/25", dot: "bg-ok" },
    PENDING: { c: "text-warn bg-warn/10 border-warn/25", dot: "bg-warn" },
    PROCESSING: { c: "text-info bg-info/10 border-info/25", dot: "bg-info" },
    FAILED: { c: "text-bad bg-bad/10 border-bad/25", dot: "bg-bad" },
    REVERSED: { c: "text-warn bg-warn/10 border-warn/25", dot: "bg-warn" },
    OPEN: { c: "text-info bg-info/10 border-info/25", dot: "bg-info" },
    UNDER_REVIEW: { c: "text-warn bg-warn/10 border-warn/25", dot: "bg-warn" },
    RESOLVED: { c: "text-ok bg-ok/10 border-ok/25", dot: "bg-ok" },
    ACTIVE: { c: "text-ok bg-ok/10 border-ok/25", dot: "bg-ok" },
  };
  const m = map[status] ?? map.PENDING;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-[10px] font-bold tracking-wide ${m.c}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${m.dot} ${status === "PROCESSING" ? "a-blink" : ""}`} />
      {status.replace("_", " ")}
    </span>
  );
}

export function KindBadge({ kind }: { kind: string }) {
  const hue: Record<string, string> = { CREDIT: "text-ok", REVERSAL: "text-warn", REFUND: "text-warn", DEBIT: "text-sub", RESERVE: "text-info", RELEASE: "text-mute", FEE: "text-warn", CASHBACK: "text-cyan", REWARD: "text-vio", CLAIM: "text-mute", WITHDRAW: "text-sub" };
  return <span className={`text-[10px] font-bold tracking-widest ${hue[kind] ?? "text-sub"}`}>{kind}</span>;
}

/* ---------------- avatar ---------------- */
export function Avatar({ name, src, size = 40, ring }: { name: string; src?: string; size?: number; ring?: boolean }) {
  return (
    <div className={`relative shrink-0 rounded-full overflow-hidden grid place-items-center font-display font-bold ${ring ? "ring-2 ring-cyan/60 ring-offset-2 ring-offset-void" : ""}`}
      style={{ width: size, height: size, background: src ? "var(--st-raised)" : "linear-gradient(135deg, rgba(0,229,255,0.25), rgba(139,92,246,0.25))", color: "var(--st-cyan)", fontSize: size * 0.36 }}>
      {src ? <img src={src} alt={name} className="w-full h-full object-cover" /> : initials(name)}
    </div>
  );
}

/* ---------------- field ---------------- */
export function Field({ label, hint, error, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label?: string; hint?: string; error?: string }) {
  return (
    <label className="block">
      {label && <span className="block text-[11px] font-bold tracking-widest text-mute uppercase mb-1.5">{label}</span>}
      <input {...props} className={`st-input ${error ? "!border-bad" : ""}`} />
      {error ? <span className="block text-[11px] text-bad mt-1">{error}</span> : hint ? <span className="block text-[11px] text-mute mt-1">{hint}</span> : null}
    </label>
  );
}

/* ---------------- bottom sheet ---------------- */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: string; children: React.ReactNode }) {
  useEffect(() => {
    if (open) useFloatLayer.getState().inc();
    return () => { if (open) useFloatLayer.getState().dec(); };
  }, [open]);
  if (!open) return null;
  return (
    <div className="absolute inset-0 z-40 flex flex-col justify-end">
      <button className="absolute inset-0 bg-black/60 a-fade" onClick={onClose} aria-label="Close" />
      <div className="relative a-sheet bg-raised border-t border-line rounded-t-3xl max-h-[88%] overflow-y-auto no-scrollbar">
        <div className="sticky top-0 bg-raised/95 backdrop-blur px-5 pt-3 pb-2 z-10">
          <div className="w-10 h-1 rounded-full bg-line mx-auto mb-3" />
          <div className="flex items-start justify-between gap-3">
            {title && <h3 className="font-display font-bold text-lg">{title}</h3>}
            <button onClick={onClose} aria-label="Cancel"
              className="press -mt-0.5 -mr-1 shrink-0 w-8 h-8 grid place-items-center rounded-lg border border-line text-mute hover:text-bad hover:border-bad/40 transition-colors">
              <IX size={15} sw={2.4} />
            </button>
          </div>
        </div>
        <div className="px-5 pb-9">{children}</div>
      </div>
    </div>
  );
}

/* ---------------- PIN pad ---------------- */
export function PinPad({ open, onClose, onSubmit, title = "Enter transaction PIN", subtitle, busy, error, showBio }: {
  open: boolean; onClose: () => void; onSubmit: (pin: string) => void; title?: string; subtitle?: string;
  busy?: boolean; error?: string | null; showBio?: boolean;
}) {
  const [pin, setPin] = useState("");
  const profile = useStark((s) => s.profile);
  useEffect(() => { if (open) setPin(""); }, [open, error]);
  useEffect(() => { if (pin.length === 4 && !busy) onSubmit(pin); }, [pin]);
  useEffect(() => {
    if (open) useFloatLayer.getState().inc();
    return () => { if (open) useFloatLayer.getState().dec(); };
  }, [open]);
  if (!open) return null;
  const press = (d: string) => !busy && setPin((p) => (p.length < 4 ? p + d : p));
  return (
    <div className="absolute inset-0 z-50 flex flex-col justify-end">
      <button className="absolute inset-0 bg-black/70 a-fade" onClick={() => !busy && onClose()} aria-label="Close" />
      <div className={`relative a-sheet bg-raised border-t border-line rounded-t-3xl px-6 pt-4 pb-8 ${error ? "a-shake" : ""}`}>
        <div className="w-10 h-1 rounded-full bg-line mx-auto mb-4" />
        <button onClick={() => !busy && onClose()} disabled={busy} aria-label="Cancel"
          className={`press absolute top-3.5 right-4 w-9 h-9 rounded-xl grid place-items-center border transition-colors ${busy ? "opacity-40 cursor-not-allowed border-line text-mute" : "border-line bg-panel text-sub hover:text-bad hover:border-bad/50 hover:bg-bad/10"}`}>
          <IX size={17} sw={2.2} />
        </button>
        <div className="text-center mb-5">
          <div className="inline-grid place-items-center w-12 h-12 rounded-2xl bg-cyan/10 text-cyan mb-3"><IFinger size={24} /></div>
          <h3 className="font-display font-bold text-lg">{title}</h3>
          {subtitle && <p className="text-xs text-mute mt-1">{subtitle}</p>}
        </div>
        <div className="flex justify-center gap-3 mb-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className={`w-3.5 h-3.5 rounded-full border-2 transition-all duration-200 ${i < pin.length ? "bg-cyan border-cyan shadow-[0_0_12px_var(--st-glow)]" : "border-line"}`} />
          ))}
        </div>
        {error && <p className="text-center text-xs text-bad font-semibold mb-1">{error}</p>}
        {busy && <p className="text-center text-xs text-info font-semibold mb-1 a-blink">Authorizing…</p>}
        <div className="grid grid-cols-3 gap-2.5 max-w-[260px] mx-auto mt-3">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
            <button key={d} onClick={() => press(d)} className="press h-14 rounded-xl bg-well border border-line font-display text-xl font-semibold hover:border-cyan/50">{d}</button>
          ))}
          <button onClick={() => showBio && !busy && onSubmit(profile?.pin ?? "")} className="press h-14 rounded-xl bg-cyan/10 border border-cyan/30 text-cyan grid place-items-center" aria-label="Use biometrics"><IFinger size={22} /></button>
          <button onClick={() => press("0")} className="press h-14 rounded-xl bg-well border border-line font-display text-xl font-semibold hover:border-cyan/50">0</button>
          <button onClick={() => !busy && setPin((p) => p.slice(0, -1))} className="press h-14 rounded-xl bg-well border border-line text-sub font-display text-sm hover:border-bad/40 hover:text-bad">⌫</button>
        </div>
        <p className="text-center text-[10px] text-mute mt-4">Your PIN never leaves this device in plaintext</p>
      </div>
    </div>
  );
}

/* ---------------- screen header ---------------- */
export function ScreenHeader({ title, sub, onBack, right }: { title: string; sub?: string; onBack?: () => void; right?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-5 pt-4 pb-3 sticky top-0 z-20 bg-void/90 backdrop-blur">
      {onBack && (
        <button onClick={onBack} className="press w-9 h-9 rounded-xl bg-panel border border-line grid place-items-center text-sub hover:text-cyan hover:border-cyan/40" aria-label="Back"><IBack size={18} /></button>
      )}
      <div className="flex-1 min-w-0">
        <h1 className="font-display font-bold text-lg leading-tight truncate">{title}</h1>
        {sub && <p className="text-[11px] text-mute truncate">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

/* ---------------- misc ---------------- */
export function Toggle({ on, onChange }: { on: boolean; onChange: () => void }) {
  return (
    <button onClick={onChange} role="switch" aria-checked={on} className={`relative w-11 rounded-full transition-colors duration-200 ${on ? "bg-cyan" : "bg-line"}`} style={{ height: 26 }}>
      <span className={`absolute top-[3px] w-5 h-5 rounded-full bg-white shadow transition-all duration-200 ${on ? "left-[22px]" : "left-[3px]"}`} />
    </button>
  );
}

export function Seg({ options, value, onChange }: { options: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex bg-well border border-line rounded-xl p-1 gap-1">
      {options.map((o) => (
        <button key={o} onClick={() => onChange(o)} className={`flex-1 text-xs font-semibold py-1.5 rounded-lg transition-all ${value === o ? "bg-raised text-cyan border border-line shadow" : "text-mute hover:text-sub"}`}>{o}</button>
      ))}
    </div>
  );
}

export function Progress({ value, hue = "var(--st-cyan)" }: { value: number; hue?: string }) {
  return (
    <div className="h-1.5 rounded-full bg-well overflow-hidden">
      <div className="h-full rounded-full transition-all duration-700" style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: hue }} />
    </div>
  );
}

export function EmptyState({ icon, title, body, action }: { icon: React.ReactNode; title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="card p-8 text-center a-rise">
      <div className="mx-auto w-14 h-14 rounded-2xl bg-cyan/10 text-cyan grid place-items-center mb-4 border border-cyan/25">{icon}</div>
      <p className="font-display font-bold text-[15px]">{title}</p>
      <p className="text-xs text-mute mt-2 leading-relaxed max-w-[260px] mx-auto">{body}</p>
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

/* ---------------- reveal on scroll ---------------- */
export function Reveal({ children, delay = 0, className = "" }: { children: React.ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setSeen(true); io.disconnect(); } }, { threshold: 0.08 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className={className} style={{ opacity: seen ? 1 : 0, transform: seen ? "none" : "translateY(12px)", transition: `opacity 0.5s ease ${delay}ms, transform 0.5s cubic-bezier(0.2,0.7,0.2,1) ${delay}ms` }}>
      {children}
    </div>
  );
}

/* ---------------- scramble decode ---------------- */
export function Scramble({ text, speed = 28 }: { text: string; speed?: number }) {
  const [out, setOut] = useState(text);
  useEffect(() => {
    const glyphs = "STARK⌁01<>/#";
    let frame = 0;
    const total = text.length * 3;
    const iv = setInterval(() => {
      frame++;
      const revealed = Math.floor((frame / total) * text.length);
      setOut(text.split("").map((c, i) => (i < revealed ? c : glyphs[Math.floor(Math.random() * glyphs.length)])).join(""));
      if (frame >= total) { setOut(text); clearInterval(iv); }
    }, speed);
    return () => clearInterval(iv);
  }, [text, speed]);
  return <span>{out}</span>;
}

/* ---------------- count up ---------------- */
export function useCountUp(target: number, dur = 900) {
  const [val, setVal] = useState(target);
  const prev = useRef(target);
  useEffect(() => {
    const from = prev.current;
    prev.current = target;
    if (from === target) return;
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / dur);
      const e = 1 - Math.pow(1 - p, 3);
      setVal(from + (target - from) * e);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, dur]);
  return val;
}

/* ---------------- sparkline ---------------- */
export function Spark({ data, w = 92, h = 34 }: { data: number[]; w?: number; h?: number }) {
  const max = Math.max(...data, 1);
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - (v / max) * (h - 4) - 2}`).join(" ");
  return (
    <svg width={w} height={h} className="overflow-visible">
      <polyline points={pts} fill="none" stroke="var(--st-cyan)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <polyline points={`0,${h} ${pts} ${w},${h}`} fill="var(--st-glow)" stroke="none" opacity="0.35" />
    </svg>
  );
}

/* ---------------- toasts ---------------- */
export function Toasts() {
  const toasts = useStark((s) => s.toasts);
  const hue: Record<string, string> = { ok: "var(--st-ok)", bad: "var(--st-bad)", info: "var(--st-info)" };
  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[70] flex flex-col gap-2 w-[min(92%,360px)] pointer-events-none">
      {toasts.map((t) => (
        <div key={t.id} className="a-pop card px-4 py-3 flex items-center gap-2.5 shadow-xl" style={{ borderColor: `${hue[t.kind]}55`, background: "color-mix(in srgb, var(--st-raised) 92%, transparent)" }}>
          <span className="w-2 h-2 rounded-full shrink-0 a-blink" style={{ background: hue[t.kind] }} />
          <p className="text-[12.5px] font-semibold leading-snug">{t.msg}</p>
        </div>
      ))}
    </div>
  );
}

/* ---------------- brand lockup ---------------- */
export function BrandLockup({ size = 44 }: { size?: number }) {
  return (
    <span className="text-cyan relative inline-block">
      <StarkMark size={size} />
      <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-ok a-blink" />
    </span>
  );
}
export { IInfo, ICheck };
