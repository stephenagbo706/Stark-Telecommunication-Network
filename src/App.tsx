import { useEffect, useMemo, useState } from "react";
import { useStark } from "./lib/store";
import { NavProvider, Toasts, useFloatLayer, type Overlay, type TabId } from "./components/ui";
import Auth from "./screens/Auth";
import Home from "./screens/Home";
import Wallet from "./screens/Wallet";
import Buy from "./screens/Buy";
import Activity, { TxDetail } from "./screens/Transactions";
import AI from "./screens/AI";
import Profile, { Security } from "./screens/Profile";
import { Analytics, Beneficiaries, Diagnostics, Help, Notifications, Referrals, Rewards, Subscriptions } from "./screens/More";
import GoLive from "./screens/GoLive";
import Splash from "./screens/Splash";
import { IHome, IWallet, ISpark, ISparkSharp, IActivity, IUser, StarkMark } from "./components/icons";

const TABS: { id: TabId; label: string; icon: (p: { size?: number; className?: string }) => React.ReactNode }[] = [
  { id: "home", label: "Home", icon: (p) => <IHome {...p} /> },
  { id: "wallet", label: "Wallet", icon: (p) => <IWallet {...p} /> },
  { id: "ai", label: "Stark AI", icon: (p) => <ISpark {...p} /> },
  { id: "activity", label: "Activity", icon: (p) => <IActivity {...p} /> },
  { id: "profile", label: "Profile", icon: (p) => <IUser {...p} /> },
];

export default function App() {
  const authed = useStark((s) => s.authed);
  const theme = useStark((s) => s.theme);
  const pinPadOpen = useFloatLayer((s) => s.count > 0);
  const [booting, setBooting] = useState(true);
  const [tab, setTab] = useState<TabId>("home");
  const [stack, setStack] = useState<Overlay[]>([]);
  const [clock, setClock] = useState(new Date());

  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => {
    const iv = setInterval(() => setClock(new Date()), 15000);
    return () => clearInterval(iv);
  }, []);
  useEffect(() => { if (!authed) setStack([]); }, [authed]);

  const nav = useMemo(() => ({
    tab,
    setTab: (t: TabId) => { setTab(t); setStack([]); },
    overlay: stack[stack.length - 1] ?? null,
    push: (o: Overlay) => setStack((s) => [...s, o]),
    pop: () => setStack((s) => s.slice(0, -1)),
  }), [tab, stack]);

  return (
    <div className="h-full w-full relative overflow-hidden bg-void text-ink font-body noise scanlines" data-theme={theme}>
      {booting && <Splash onDone={() => setBooting(false)} />}

      {/* ambient backdrop */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute inset-0 grid-bg opacity-25 grid-fade" />
        <div className="absolute -top-32 left-1/4 w-[480px] h-[480px] rounded-full a-float" style={{ background: "radial-gradient(circle, var(--st-glow), transparent 70%)" }} />
        <div className="absolute -bottom-40 -right-24 w-[420px] h-[420px] rounded-full a-float" style={{ background: "radial-gradient(circle, rgba(139,92,246,0.14), transparent 70%)", animationDelay: "1.4s" }} />
      </div>

      {/* desktop rails */}
      <div className="hidden lg:flex flex-col gap-3 fixed left-6 top-1/2 -translate-y-1/2 z-10 font-mono text-[10px] text-dim">
        <RailRow k="LEDGER" v="BALANCED" ok />
        <RailRow k="VTU CORE" v="ONLINE" ok />
        <RailRow k="PAYSTACK" v="WEBHOOK ✓" ok />
        <RailRow k="EDGE" v="LAGOS 14ms" />
      </div>
      <div className="hidden lg:block fixed right-6 top-1/2 -translate-y-1/2 z-10 text-right font-mono text-[10px] text-dim">
        <p className="text-cyan font-bold tracking-widest mb-2 flex items-center gap-2 justify-end"><StarkMark size={14} /> STARK TELECOMMUNICATION</p>
        <p>{clock.toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" })} WAT</p>
        <p className="mt-1">NGN • LAGOS • NG</p>
        <div className="mt-3 flex justify-end"><SignalBars /></div>
      </div>

      {/* phone frame */}
      <div className="relative h-full max-w-[430px] mx-auto lg:my-6 lg:h-[calc(100%-48px)] lg:rounded-[36px] lg:border lg:border-line lg:shadow-2xl overflow-hidden bg-base">
        <NavProvider value={nav}>
          <div className="h-full relative overflow-hidden">
            {!authed ? (
              <Auth />
            ) : (
              <>
                {/* tab content */}
                <div key={tab} className="h-full overflow-y-auto no-scrollbar a-fade relative">
                  {tab === "home" && <Home />}
                  {tab === "wallet" && <Wallet />}
                  {tab === "ai" && <AI />}
                  {tab === "activity" && <Activity />}
                  {tab === "profile" && <Profile />}
                </div>

                {/* overlay stack */}
                {nav.overlay && (
                  <div className="absolute inset-0 z-30 bg-base a-rise overflow-hidden">
                    <OverlayScreen o={nav.overlay} />
                  </div>
                )}

                {/* bottom tab bar — clears out when a sheet / pin pad is open */}
                <div className={`absolute bottom-0 left-0 right-0 z-40 transition-all duration-300 ${pinPadOpen ? "translate-y-full opacity-0 pointer-events-none" : "translate-y-0 opacity-100"}`}>
                  <div className="mx-3 mb-3 rounded-2xl border border-line bg-raised/95 backdrop-blur px-2 py-2 flex items-center justify-between shadow-[0_10px_40px_-10px_rgba(0,0,0,0.6)]">
                    {TABS.map((t) => {
                      const active = tab === t.id && !nav.overlay;
                      if (t.id === "ai") {
                        return (
                          <button key={t.id} onClick={() => nav.setTab("ai")} className="press relative -mt-9 mx-1.5 flex flex-col items-center gap-1 group" aria-label="Stark AI">
                            <span className="relative block w-[58px] h-[58px]">
                              <span className="absolute -inset-2.5 rounded-full a-breathe pointer-events-none" style={{ background: "radial-gradient(circle, rgba(0,229,255,0.4), rgba(139,92,246,0.15) 55%, transparent 72%)" }} />
                              <span className={`absolute inset-0 rounded-full a-spin transition-opacity ${active ? "opacity-100" : "opacity-75 group-hover:opacity-100"}`}
                                style={{ background: "conic-gradient(from 40deg, #00E5FF, #38BDF8, #8B5CF6, #22D3EE, #00E5FF)", animationDuration: active ? "4s" : "9s", boxShadow: active ? "0 10px 34px -6px var(--st-glow)" : "0 10px 28px -8px var(--st-glow)" }} />
                              <span className="absolute inset-[2.5px] rounded-full grid place-items-center" style={{ background: active ? "linear-gradient(150deg,#221247 0%,#31206B 100%)" : "linear-gradient(150deg,#07222F 0%,#0B3247 100%)" }}>
                                <ISparkSharp size={27} />
                              </span>
                            </span>
                            <span className={`text-[8.5px] font-bold tracking-[0.16em] transition-colors ${active ? "text-cyan" : "text-mute group-hover:text-sub"}`} style={active ? { textShadow: "0 0 12px var(--st-glow)" } : undefined}>STARK AI</span>
                          </button>
                        );
                      }
                      return (
                        <button key={t.id} onClick={() => nav.setTab(t.id)} className={`press flex flex-col items-center gap-1 px-3 py-1.5 rounded-xl transition-colors ${active ? "text-cyan" : "text-mute hover:text-sub"}`}>
                          {t.icon({ size: 20 })}
                          <span className="text-[9px] font-bold">{t.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
            <Toasts />
          </div>
        </NavProvider>
      </div>

      <p className="hidden lg:block fixed bottom-4 left-1/2 -translate-x-1/2 text-[10px] font-mono text-mute z-10">
        STARK • ledger-balanced • auto-reversal armed • real Paystack checkout
      </p>
    </div>
  );
}

function OverlayScreen({ o }: { o: Overlay }) {
  switch (o.name) {
    case "buy": return <Buy service={o.service as never} />;
    case "tx": return <TxDetail id={o.id} />;
    case "notifications": return <Notifications />;
    case "security": return <Security />;
    case "referrals": return <Referrals />;
    case "rewards": return <Rewards />;
    case "help": return <Help txId={o.txId} />;
    case "diagnostics": return <Diagnostics />;
    case "analytics": return <Analytics />;
    case "subscriptions": return <Subscriptions />;
    case "beneficiaries": return <Beneficiaries />;
    case "golive": return <GoLive />;
  }
}

function RailRow({ k, v, ok }: { k: string; v: string; ok?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`w-1.5 h-1.5 rounded-full ${ok ? "bg-ok a-blink" : "bg-cyan/60"}`} />
      <span className="text-dim">{k}</span>
      <span className={`ml-auto font-bold ${ok ? "text-ok" : "text-sub"}`}>{v}</span>
    </div>
  );
}

function SignalBars() {
  return (
    <svg width="14" height="10" viewBox="0 0 14 10" fill="currentColor" aria-hidden="true">
      <rect x="0" y="6" width="2.5" height="4" rx="0.6" /><rect x="4" y="4" width="2.5" height="6" rx="0.6" />
      <rect x="8" y="2" width="2.5" height="8" rx="0.6" /><rect x="12" y="0" width="2" height="10" rx="0.6" opacity="0.35" />
    </svg>
  );
}
