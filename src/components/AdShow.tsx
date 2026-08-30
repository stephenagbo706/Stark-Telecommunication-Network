import React, { useEffect, useRef, useState } from "react";

export interface AdSlide {
  img: string;
  tag: string;
  hue: string;
  headline: React.ReactNode;
  sub: string;
  chips?: string[];
  cta?: { label: string; onClick: () => void };
}

const HOLD_MS = 5600;

/** Billboard-style ad slideshow: auto-advances, Ken Burns zoom on the live
    slide, swipe + arrows + click-to-jump progress meters. */
export default function AdShow({ slides }: { slides: AdSlide[] }) {
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (paused || slides.length < 2) return;
    timer.current = window.setTimeout(() => setIdx((i) => (i + 1) % slides.length), HOLD_MS);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [idx, paused, slides.length]);

  const go = (i: number) => setIdx(((i % slides.length) + slides.length) % slides.length);

  /* swipe */
  const touch = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => { touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (!touch.current) return;
    const dx = e.changedTouches[0].clientX - touch.current.x;
    const dy = e.changedTouches[0].clientY - touch.current.y;
    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy)) go(idx + (dx < 0 ? 1 : -1));
    touch.current = null;
  };

  return (
    <div
      className="relative rounded-[20px] overflow-hidden border border-line select-none"
      style={{ height: 232 }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {slides.map((s, i) => (
        <div key={s.tag} className={`absolute inset-0 transition-opacity duration-700 ${i === idx ? "opacity-100 z-10" : "opacity-0 z-0 pointer-events-none"}`}>
          {/* image + ken burns */}
          <img src={s.img} alt="" className={`absolute inset-0 w-full h-full object-cover ${i === idx ? "a-kenburns" : ""}`} draggable={false} />
          {/* scrims for legibility */}
          <div className="absolute inset-0" style={{ background: "linear-gradient(100deg, rgba(3,7,13,0.92) 8%, rgba(3,7,13,0.55) 48%, rgba(3,7,13,0.15) 100%)" }} />
          <div className="absolute inset-0" style={{ background: "linear-gradient(0deg, rgba(3,7,13,0.85) 0%, transparent 45%)" }} />
          <div className="absolute inset-0 grid-bg opacity-20 grid-fade" />

          {/* content */}
          <div className="relative h-full flex flex-col justify-between p-5 text-white">
            <div className="flex items-center gap-2">
              <span className="text-[9px] font-bold tracking-[0.22em] px-2 py-1 rounded-md border" style={{ color: s.hue, borderColor: `${s.hue}66`, background: "rgba(3,7,13,0.55)" }}>
                {s.tag}
              </span>
              <span className="flex items-center gap-1.5 text-[9px] font-bold tracking-widest text-white/80">
                <span className="w-1.5 h-1.5 rounded-full a-blink" style={{ background: s.hue }} /> TRENDING
              </span>
            </div>
            <div>
              <h3 className="font-display font-bold text-[24px] leading-[1.08] tracking-tight">{s.headline}</h3>
              <p className="text-[12px] text-white/75 mt-1.5 leading-snug max-w-[300px]">{s.sub}</p>
              {s.chips && (
                <div className="flex gap-1.5 mt-2.5 flex-wrap">
                  {s.chips.map((c) => (
                    <span key={c} className="text-[9.5px] font-bold px-2 py-0.5 rounded-md bg-white/10 border border-white/20 text-white/90">{c}</span>
                  ))}
                </div>
              )}
              {s.cta && (
                <button onClick={s.cta.onClick} className="press mt-3 inline-flex items-center gap-2 text-[12px] font-bold px-4 py-2.5 rounded-xl shadow-lg"
                  style={{ background: s.hue, color: "#05121F", boxShadow: `0 8px 24px -8px ${s.hue}` }}>
                  {s.cta.label} <span aria-hidden>→</span>
                </button>
              )}
            </div>
          </div>
        </div>
      ))}

      {/* arrows */}
      {slides.length > 1 && (
        <>
          <button onClick={() => go(idx - 1)} aria-label="Previous"
            className="press absolute left-2.5 top-1/2 -translate-y-1/2 z-20 w-8 h-8 rounded-full bg-black/40 text-white/80 grid place-items-center opacity-0 hover:opacity-100 focus:opacity-100 transition-opacity backdrop-blur">‹</button>
          <button onClick={() => go(idx + 1)} aria-label="Next"
            className="press absolute right-2.5 top-1/2 -translate-y-1/2 z-20 w-8 h-8 rounded-full bg-black/40 text-white/80 grid place-items-center opacity-0 hover:opacity-100 focus:opacity-100 transition-opacity backdrop-blur">›</button>
        </>
      )}

      {/* progress meters */}
      <div className="absolute bottom-2.5 right-4 z-20 flex gap-1.5">
        {slides.map((_, i) => (
          <button key={i} onClick={() => go(i)} aria-label={`Slide ${i + 1}`}
            className="relative h-1.5 rounded-full overflow-hidden transition-all" style={{ width: i === idx ? 26 : 12, background: "rgba(255,255,255,0.25)" }}>
            {i === idx && (
              <span key={idx + String(paused)} className="absolute inset-y-0 left-0 a-adfill"
                style={{ background: slides[i].hue, animationDuration: paused ? undefined : `${HOLD_MS}ms`, animationPlayState: paused ? "paused" : "running", width: paused ? undefined : undefined }} />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
