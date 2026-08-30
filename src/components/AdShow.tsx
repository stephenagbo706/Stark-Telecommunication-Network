import { useEffect, useRef, useState } from "react";

/* ------------------------------------------------------------------ */
/*  AdShow — Stark's billboard-style advertisement slideshow.          */
/*  Auto-advancing slides with Ken Burns breathing, progress meters,   */
/*  hover-pause, swipe and arrows. Reused on the welcome screen and    */
/*  anywhere a promotion needs to move like a real ad slot.            */
/* ------------------------------------------------------------------ */

export type AdSlide = {
  img: string;
  tag: string;
  hue: string;
  headline: React.ReactNode;
  sub: string;
  chips?: string[];
  cta?: { label: string; onClick: () => void };
};

export default function AdShow({ slides, interval = 5600 }: { slides: AdSlide[]; interval?: number }) {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  const startX = useRef<number | null>(null);
  const n = slides.length;

  pausedRef.current = paused;
  useEffect(() => {
    if (n < 2) return;
    const id = setInterval(() => {
      if (!pausedRef.current) setI((v) => (v + 1) % n);
    }, interval);
    return () => clearInterval(id);
  }, [n, interval]);

  const go = (d: number) => setI((v) => (v + d + n) % n);

  return (
    <div
      className="relative overflow-hidden rounded-[20px] border border-line bg-card select-none group/ad cursor-grab active:cursor-grabbing"
      style={{ height: 252 }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onPointerDown={(e) => {
        startX.current = e.clientX;
        setPaused(true);
      }}
      onPointerUp={(e) => {
        setPaused(false);
        if (startX.current != null) {
          const dx = e.clientX - startX.current;
          if (Math.abs(dx) > 42) go(dx < 0 ? 1 : -1);
        }
        startX.current = null;
      }}
      onPointerCancel={() => {
        setPaused(false);
        startX.current = null;
      }}
    >
      {slides.map((s, k) => (
        <div
          key={k}
          className={`absolute inset-0 transition-opacity duration-700 ${k === i ? "opacity-100" : "opacity-0 pointer-events-none"}`}
          aria-hidden={k !== i}
        >
          {/* image with Ken Burns breathing on the live slide */}
          <img
            src={s.img}
            alt=""
            draggable={false}
            className={`absolute inset-0 w-full h-full object-cover ${k === i ? "a-kenburns" : ""}`}
            style={{ willChange: "transform" }}
          />
          {/* cinematic scrim so copy stays legible on any image */}
          <div className="absolute inset-0" style={{ background: "linear-gradient(100deg, rgba(5,11,20,0.94) 6%, rgba(5,11,20,0.7) 44%, rgba(5,11,20,0.14) 80%)" }} />
          <div className="absolute inset-x-0 bottom-0 h-24" style={{ background: "linear-gradient(0deg, rgba(5,11,20,0.88), transparent)" }} />
          {/* hue wash tied to the story */}
          <div className="absolute inset-0 opacity-25 mix-blend-overlay" style={{ background: `radial-gradient(70% 90% at 85% 20%, ${s.hue}, transparent 70%)` }} />

          {/* copy */}
          <div className="relative h-full flex flex-col justify-between p-4 pb-3.5">
            <div className={k === i ? "a-rise" : ""}>
              <span
                className="inline-flex items-center gap-1.5 text-[9px] font-bold tracking-[0.18em] px-2 py-1 rounded-md"
                style={{ color: s.hue, background: `${s.hue}1C`, border: `1px solid ${s.hue}44` }}
              >
                <span className="w-1 h-1 rounded-full a-blink" style={{ background: s.hue, boxShadow: `0 0 6px ${s.hue}` }} />
                {s.tag}
              </span>
              <h2 className="font-display font-bold text-[17px] leading-[1.22] mt-2 text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.75)]">
                {s.headline}
              </h2>
              <p className="text-[10.5px] text-white/70 mt-1.5 leading-relaxed max-w-[78%]">{s.sub}</p>
            </div>
            <div className="flex items-end justify-between gap-2">
              <div className="flex gap-1.5 flex-wrap max-w-[58%]">
                {s.chips?.map((c) => (
                  <span key={c} className="text-[8.5px] font-bold px-1.5 py-[3px] rounded bg-white/10 border border-white/20 text-white/80 backdrop-blur-sm">
                    {c}
                  </span>
                ))}
              </div>
              {s.cta && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    s.cta?.onClick();
                  }}
                  className="press shrink-0 text-[10.5px] font-bold px-3 py-2 rounded-lg bg-cyan text-cyanink hover:brightness-110 shadow-[0_10px_26px_-8px_var(--st-glow)]"
                >
                  {s.cta.label} →
                </button>
              )}
            </div>
          </div>
        </div>
      ))}

      {/* arrows */}
      <button
        onClick={() => go(-1)}
        aria-label="Previous advertisement"
        className="press absolute left-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-black/45 border border-white/15 text-white/85 grid place-items-center opacity-0 group-hover/ad:opacity-100 transition-opacity backdrop-blur-sm hover:border-cyan/50"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 6l-6 6 6 6" /></svg>
      </button>
      <button
        onClick={() => go(1)}
        aria-label="Next advertisement"
        className="press absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-black/45 border border-white/15 text-white/85 grid place-items-center opacity-0 group-hover/ad:opacity-100 transition-opacity backdrop-blur-sm hover:border-cyan/50"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
      </button>

      {/* progress meters */}
      <div className="absolute top-3 right-3 flex gap-1.5">
        {slides.map((_, k) => (
          <button
            key={k}
            onClick={() => setI(k)}
            aria-label={`Go to advertisement ${k + 1}`}
            className="press h-[5px] rounded-full overflow-hidden transition-all"
            style={{ width: k === i ? 24 : 9, background: k === i ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.28)" }}
          >
            {k === i && (
              <span
                key={`p${i}`}
                className="block h-full bg-white a-adfill"
                style={{ animationDuration: `${interval}ms`, animationPlayState: paused ? "paused" : "running" }}
              />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
