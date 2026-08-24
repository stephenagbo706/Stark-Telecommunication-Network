import { useEffect, useMemo, useState } from "react";
import { useStark } from "./lib/store";
import { NavProvider, Toasts, type Overlay, type TabId } from "./components/ui";
import Auth from "./screens/Auth";
import Home from "./screens/Home";
import Wallet from "./screens/Wallet";
import Buy from "./screens/Buy";
import Activity, { TxDetail } from "./screens/Transactions";
import Ai from "./screens/AI";
import Profile, { Security } from "./screens/Profile";
import { Analytics, Beneficiaries, Diagnostics, Help, Notifications, Referrals, Rewards, Subscriptions } from "./screens/More";
import Splash from "./screens/Splash";
import { IHome, IWallet, ISpark, IActivity, IUser, IWifi, StarkMark } from "./components/icons";


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
    tab, setTab: (t: TabId) => { setTab(t); setStack([]); },
    overlay: stack[stack.length - 1] ?? null,
    push: (o: Overlay) => setStack((s) => [...s, o]),
    pop: () => setStack((s) => s.slice(0, -1)),
  }), [tab, stack]);

  const ledgerCount = useStark((s) => s.ledger.length);
  const txCount = useStark((s) => s.txs.length);

  return (
    <div className="h-full w-full relative overflow-hidden bg-void text-ink font-body noise scanlines" data-theme={theme}>
      {booting && <Splash onDone={() => setBooting(false)} />}

      {/* ambient backdrop */}
      <div className="absolute inset-0 grid-bg grid-fade opacity-60" />
      <div className="absolute inset-0 pointer-events-none" style={{ background: "radial-gradient(50% 40% at 15% 10%, var(--st-glow), transparent 70%), radial-gradient(45% 40% at 90% 85%, rgba(139,92,246,0.08), transparent 70%)" }} />
      <div className="absolute top-[18%] left-[8%] w-64 h-64 rounded-full a-float pointer-events-none" style={{ background: "radial-gradient(circle, var(--st-glow), transparent 70%)" }} />
      <div className="absolute bottom-[12%] right-[6%] w-72 h-72 rounded-full a-float pointer-events-none" style={{ animationDelay: "2.2s", background: "radial-gradient(circle, rgba(139,92,246,0.1), transparent 70%)" }} />

      {/* desktop side rails */}
      <aside className="hidden xl:flex flex-col justify-between fixed left-10 top-0 bottom-0 w-56 py-12 pointer-events-none z-10">
        <div>
          <span className="text-cyan"><StarkMark size={34} /></span>
          <h2 className="font-display font-bold text-2xl tracking-tight mt-3 leading-none">STARK</h2>
          <p className="text-[10px] tracking-[0.3em] text-mute font-bold mt-1.5">TELECOMMUNICATION</p>
          <p className="text-[11px] text-mute leading-relaxed mt-5">Nigerian VTU, wallet & digital services — running on an immutable double-entry ledger.</p>
        </div>
        <div className="space-y-3 font-mono text-[10px] text-mute">
          <RailRow k="CORE" v="OPERATIONAL" ok />
          <RailRow k="LEDGER" v={`${ledgerCount} ENTRIES`} />
          <RailRow k="TRANSACTIONS" v={String(txCount)} />
          <RailRow k="LAGOS EDGE" v="14ms" ok />
          <RailRow k="LOCAL TIME" v={clock.toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" })} />
        </div>
      </aside>
      <aside className="hidden xl:flex flex-col justify-end fixed right-10 bottom-0 w-44 pb-12 pointer-events-none z-10 text-right">
        <div className="font-mono text-[10px] text-mute space-y-1.5">
          <p>PROVIDER ENGINE • 4 ROUTES</p>
          <p>FAILOVER • CIRCUIT BREAKER</p>
          <p className="text-cyan">AUTO-REVERSAL ARMED</p>
        </div>
      </aside>

      {/* device frame */}
      <div className="h-full flex items-center justify-center relative z-20">
        <div className="relative w-full h-dvh lg:w-[402px] lg:h-[min(880px,94vh)] lg:rounded-[44px] lg:border lg:border-line bg-void overflow-hidden lg:device-shadow">
          {/* status bar */}
          <div className="absolute top-0 left-0 right-0 z-30 flex items-center justify-between px-6 pt-2.5 pb-1 text-[10px] font-bold pointer-events-none">
            <span className="font-display tnum">{clock.toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit", hour12: false })}</span>
            <span className="lg:hidden w-20 h-4 rounded-full bg-black/80 absolute left-1/2 -translate-x-1/2 top-1.5" />
            <span className="hidden lg:block w-24 h-5 rounded-full bg-black absolute left-1/2 -translate-x-1/2 top-2 border border-line/40" />
            <span className="flex items-center gap-1.5 text-sub">
              <SignalBars /><IWifi size={12} /><Battery />
            </span>
          </div>

          <NavProvider value={nav}>
            {!authed ? (
              <div className="absolute inset-0 pt-7"><Auth /></div>
            ) : (
              <>
                <div className="absolute inset-0 pt-7 pb-[76px]">
                  <div key={tab} className="h-full overflow-y-auto no-scrollbar a-fade">
                    {tab === "home" && <Home />}
                    {tab === "wallet" && <Wallet />}
                    {tab === "ai" && <Ai />}
                    {tab === "activity" && <Activity />}
                    {tab === "profile" && <Profile />}
                  </div>
                </div>

                {/* overlay stack */}
                {stack.map((o, i) => (
                  <div key={`${o.name}-${i}`} className={`absolute inset-0 z-40 bg-void pt-7 ${i === stack.length - 1 ? "a-slide" : ""}`}>
                    <OverlayScreen o={o} />
                  </div>
                ))}

                {/* tab bar */}
                <div className="absolute bottom-0 left-0 right-0 z-30">
                  <div className="mx-3 mb-3 rounded-2xl border border-line bg-raised/95 backdrop-blur px-2 py-2 flex items-center shadow-[0_-8px_40px_-12px_rgba(0,0,0,0.6)]">
                    {TABS.map((t) => {
                      const active = tab === t.id && stack.length === 0;
                      if (t.id === "ai") {
                        return (
                          <button key={t.id} onClick={() => nav.setTab("ai")} className="press relative -mt-7 mx-1 w-14 h-14 rounded-2xl grid place-items-center text-cyanink shadow-[0_10px_30px_-8px_var(--st-glow)]"
                            style={{ background: active ? "linear-gradient(135deg,#8B5CF6,#6D28D9)" : "linear-gradient(135deg,#00E5FF,#00B8D4)" }} aria-label="Stark AI">
                            <ISpark size={24} />
                            <span className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 text-[8px] font-bold tracking-wider" style={{ color: "var(--st-mute)" }}>AI</span>
                          </button>
                        );
                      }
                      return (
                        <button key={t.id} onClick={() => nav.setTab(t.id)} className={`press flex-1 flex flex-col items-center gap-1 py-1.5 rounded-xl transition-colors ${active ? "text-cyan" : "text-mute hover:text-sub"}`}>
                          {t.icon({ size: 20 })}
                          <span className="text-[9px] font-bold tracking-wide">{t.label}</span>
                          <span className={`h-0.5 w-5 rounded-full transition-all ${active ? "bg-cyan" : "bg-transparent"}`} />
                        </button>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </NavProvider>
          <Toasts />
        </div>
      </div>

      <p className="hidden lg:block fixed bottom-4 left-1/2 -translate-x-1/2 text-[10px] font-mono text-mute z-10">
        STARK DEMO BUILD • ledger-balanced • auto-reversal armed • no real money moves
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
    case "help": return <Help />;
    case "diagnostics": return <Diagnostics />;
    case "analytics": return <Analytics />;
    case "subscriptions": return <Subscriptions />;
    case "beneficiaries": return <Beneficiaries />;
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
function Battery() {
  return (
    <svg width="22" height="11" viewBox="0 0 22 11" aria-hidden="true">
      <rect x="0.5" y="0.5" width="18" height="10" rx="2.5" fill="none" stroke="currentColor" opacity="0.5" />
      <rect x="2.5" y="2.5" width="12" height="6" rx="1.2" fill="#22C55E" />
      <rect x="20" y="3.5" width="2" height="4" rx="1" fill="currentColor" opacity="0.5" />
    </svg>
  );
}
