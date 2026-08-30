import React, { useMemo, useState } from "react";
import { useStark, useBalances, money, money0, timeAgo, type Tx } from "../lib/store";
import { Avatar, Chip, Reveal, Spark, StatusBadge, useCountUp, useNav } from "../components/ui";
import { PROMOS, REWARD_TIERS, AD_IMAGES as ADS } from "../lib/data";
import AdShow from "../components/AdShow";
import {
  IData, ITv, IMeter, IcoSignal, IGift, ISms, ITicket, ITarget, IPlus, IBell, IEye, IEyeOff,
  IChevR, ISpark, IUsers, IGauge, IArrowUR, IArrowDL, IStar, IChart, IWallet,
} from "../components/icons";

const SERVICES = [
  { id: "airtime", label: "Airtime", icon: IcoSignal, hue: "#00E5FF" },
  { id: "data", label: "Data", icon: IData, hue: "#38BDF8" },
  { id: "cable", label: "Cable TV", icon: ITv, hue: "#8B5CF6" },
  { id: "electricity", label: "Electricity", icon: IMeter, hue: "#F59E0B" },
  { id: "exam", label: "Exam Pins", icon: ITicket, hue: "#22C55E" },
  { id: "betting", label: "Betting", icon: ITarget, hue: "#EF4444" },
  { id: "sms", label: "Bulk SMS", icon: ISms, hue: "#38BDF8" },
  { id: "gift", label: "Gifts", icon: IGift, hue: "#8B5CF6" },
];

export default function Home() {
  const nav = useNav();
  const { profile, txs, points, notifications } = useStark();
  const b = useBalances();
  const [hide, setHide] = useState(false);
  const unread = notifications.filter((n) => !n.read).length;
  const hour = new Date().getHours();
  const greet = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const bal = useCountUp(b.available);
  const firstName = profile?.name.split(" ")[0] ?? "there";

  /* real reward tier from actual points */
  const tier = [...REWARD_TIERS].reverse().find((t) => points >= t.min) ?? REWARD_TIERS[0];
  const nextTier = REWARD_TIERS[REWARD_TIERS.indexOf(tier) + 1];
  const tierPct = nextTier ? Math.max(0, Math.min(100, Math.round(((points - tier.min) / (nextTier.min - tier.min)) * 100))) : 100;

  const sparkData = useMemo(() => {
    const days = 14;
    const arr = Array(days).fill(0);
    const now = Date.now();
    txs.filter((t) => t.status === "SUCCESSFUL" && t.service !== "funding").forEach((t) => {
      const d = Math.floor((now - t.createdAt) / 86400000);
      if (d >= 0 && d < days) arr[days - 1 - d] += t.total;
    });
    return arr.map((v, i) => v + ((i * 37) % 90));
  }, [txs]);

  const recent = txs.slice(0, 5);

  return (
    <div className="pb-28">
      {/* greeting bar */}
      <div className="flex items-center gap-3 px-5 pt-4 pb-3">
        <button className="press" onClick={() => nav.setTab("profile")}>
          <Avatar name={profile?.name ?? "S"} src={profile?.avatar} size={42} ring />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] text-mute font-semibold">{greet},</p>
          <h1 className="font-display font-bold text-lg leading-tight truncate">{firstName} <span className="text-cyan">⌁</span></h1>
        </div>
        <button onClick={() => nav.push({ name: "diagnostics" })} className="press hidden min-[380px]:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-panel border border-line text-[10px] font-bold text-sub hover:text-cyan">
          <span className="w-1.5 h-1.5 rounded-full bg-ok a-blink" /> TURBO
        </button>
        <button onClick={() => nav.push({ name: "notifications" })} className="press relative w-10 h-10 rounded-xl bg-panel border border-line grid place-items-center text-sub hover:text-cyan hover:border-cyan/40" aria-label="Notifications">
          <IBell size={19} />
          {unread > 0 && <span className="absolute -top-1 -right-1 min-w-[17px] h-[17px] px-1 rounded-full bg-bad text-white text-[9px] font-bold grid place-items-center">{unread}</span>}
        </button>
      </div>

      {/* wallet card */}
      <div className="px-5">
        <Reveal>
          <div className="relative rounded-[20px] border border-cyan/25 overflow-hidden p-5"
            style={{ background: "linear-gradient(135deg, #0A1A2E 0%, #0F2440 55%, #0A1A2E 100%)" }}>
            <div className="absolute inset-0 grid-bg opacity-[0.35] grid-fade" />
            <div className="absolute -right-10 -top-16 w-44 h-44 rounded-full a-float" style={{ background: "radial-gradient(circle, var(--st-glow), transparent 70%)" }} />
            <div className="relative">
              <div className="flex items-center justify-between">
                <p className="text-[10px] tracking-[0.22em] font-bold text-sub">AVAILABLE BALANCE</p>
                <button onClick={() => setHide(!hide)} className="press text-sub hover:text-cyan" aria-label="Toggle balance">
                  {hide ? <IEyeOff size={17} /> : <IEye size={17} />}
                </button>
              </div>
              <div className="flex items-end gap-2 mt-1.5">
                <span className="font-display font-bold text-[34px] leading-none tnum tracking-tight text-ink">
                  {hide ? "₦ ••••••" : money(bal)}
                </span>
              </div>
              <div className="flex items-center gap-2 mt-3 flex-wrap">
                {b.reserved > 0.009 && (
                  <span className="text-[10px] font-bold px-2 py-1 rounded-md bg-info/15 text-info border border-info/30 a-blink">{money0(b.reserved)} processing</span>
                )}
                {b.cashback >= 1 && (
                  <span className="text-[10px] font-bold px-2 py-1 rounded-md bg-vio/15 text-vio border border-vio/30">{money0(b.cashback)} cashback</span>
                )}
                <span className="text-[10px] font-bold px-2 py-1 rounded-md bg-ok/15 text-ok border border-ok/30">{points} pts</span>
              </div>
              <div className="flex gap-2.5 mt-5">
                <button onClick={() => nav.setTab("wallet")} className="press flex-1 flex items-center justify-center gap-1.5 bg-cyan text-cyanink font-bold text-sm py-3 rounded-xl hover:brightness-110 shadow-[0_10px_30px_-10px_var(--st-glow)]">
                  <IPlus size={16} sw={2.4} /> Add money
                </button>
                <button onClick={() => nav.setTab("wallet")} className="press flex-1 flex items-center justify-center gap-1.5 bg-white/5 border border-white/15 text-ink font-semibold text-sm py-3 rounded-xl hover:border-cyan/50">
                  <IArrowUR size={15} /> Withdraw
                </button>
              </div>
            </div>
          </div>
        </Reveal>
      </div>

      {/* ad billboard */}
      <div className="px-5 mt-4">
        <AdShow
          slides={[
            { img: ADS.data, tag: "DATA BUNDLES", hue: "#38BDF8", headline: <>Cheaper data on<br />every network.</>, sub: "MTN, Airtel, Glo & 9mobile plans with 5% cashback.", cta: { label: "Buy data", onClick: () => nav.push({ name: "buy", service: "data" }) } },
            { img: ADS.power, tag: "ELECTRICITY", hue: "#F59E0B", headline: <>Light up in<br />seconds.</>, sub: "Prepaid tokens for every Nigerian DisCo.", cta: { label: "Pay electricity", onClick: () => nav.push({ name: "buy", service: "electricity" }) } },
            { img: ADS.cable, tag: "CABLE TV", hue: "#8B5CF6", headline: <>Never miss<br />the match.</>, sub: "DSTV, GOtv & StarTimes in one tap.", cta: { label: "Renew cable", onClick: () => nav.push({ name: "buy", service: "cable" }) } },
          ]}
        />
      </div>

      {/* newsline billboard */}
      <div className="mt-4">
        <div className="flex items-center justify-between px-5 mb-2">
          <span className="flex items-center gap-1.5 text-[10px] font-bold tracking-[0.22em] text-mute"><span className="w-1.5 h-1.5 rounded-full bg-bad a-blink" /> STARK NEWSLINE</span>
          <span className="text-[9px] font-bold text-mute border border-line rounded-full px-2 py-0.5">LIVE WIRE • {PROMOS.length} TRENDING</span>
        </div>
        <div className="wire-paused overflow-hidden" style={{ maskImage: "linear-gradient(90deg, transparent, black 6%, black 94%, transparent)" }}>
          <div className="flex a-marquee gap-3 px-5" style={{ width: "max-content" }}>
            {[...PROMOS, ...PROMOS].map((p, i) => {
              const dest = p.tag === "REFERRAL" ? () => nav.push({ name: "referrals" }) : p.tag === "POWER" ? () => nav.push({ name: "buy", service: "electricity" }) : p.tag === "CASHBACK" ? () => nav.setTab("wallet") : () => nav.push({ name: "rewards" });
              return (
                <button key={i} onClick={dest} className="press lift relative w-[260px] shrink-0 text-left rounded-2xl border p-4 overflow-hidden"
                  style={{ background: "var(--st-card)", borderColor: `${p.hue}33` }}>
                  <span className="absolute top-0 left-0 right-0 h-[2px]" style={{ background: `linear-gradient(90deg, transparent, ${p.hue}, transparent)` }} />
                  <div className="flex items-center gap-2">
                    <span className="text-[8.5px] font-bold tracking-widest px-1.5 py-0.5 rounded border" style={{ color: p.hue, borderColor: `${p.hue}55`, background: `${p.hue}14` }}>{p.tag}</span>
                    <span className="flex items-center gap-1 text-[8.5px] font-bold text-mute"><span className="w-1 h-1 rounded-full a-blink" style={{ background: p.hue }} /> TRENDING</span>
                    <span className="ml-auto text-[9px] font-bold text-dim tnum">#{(i % PROMOS.length) + 1}</span>
                  </div>
                  <p className="font-display font-bold text-[15px] leading-tight mt-2">{p.title}</p>
                  <p className="text-[10.5px] text-mute font-semibold mt-1">{p.sub}</p>
                  <span className="inline-flex items-center gap-1 text-[9.5px] font-bold mt-2.5" style={{ color: p.hue }}>View offer <IChevR size={11} /></span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* services grid */}
      <div className="px-5 mt-5">
        <SectionHead title="Services" sub="Powered by the Stark provider engine" />
        <div className="grid grid-cols-4 gap-2.5">
          {SERVICES.map((s, i) => (
            <Reveal key={s.id} delay={i * 40}>
              <button onClick={() => nav.push({ name: "buy", service: s.id })}
                className="press lift w-full card p-3 flex flex-col items-center gap-2 hover:border-cyan/40 group">
                <span className="w-11 h-11 rounded-xl grid place-items-center transition-transform group-hover:scale-110" style={{ background: `${s.hue}18`, color: s.hue, border: `1px solid ${s.hue}33` }}>
                  <s.icon size={21} />
                </span>
                <span className="text-[10px] font-bold text-sub group-hover:text-ink leading-none">{s.label}</span>
              </button>
            </Reveal>
          ))}
        </div>
      </div>

      {/* AI + analytics */}
      <div className="px-5 mt-5 grid grid-cols-5 gap-2.5">
        <button onClick={() => nav.setTab("ai")} className="press lift col-span-3 card p-4 text-left relative overflow-hidden border-vio/30 group">
          <div className="absolute -right-4 -bottom-4 text-vio/15 group-hover:text-vio/30 transition-colors"><ISpark size={90} sw={1} /></div>
          <span className="text-[9px] font-bold tracking-[0.2em] text-vio">STARK AI</span>
          <p className="font-display font-bold text-sm mt-1 leading-snug">“Buy ₦1,000 MTN airtime” — and it prepares the rest.</p>
          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-vio mt-2">Ask Stark <IChevR size={12} /></span>
        </button>
        <button onClick={() => nav.push({ name: "analytics" })} className="press lift col-span-2 card p-4 text-left flex flex-col justify-between">
          <span className="flex items-center gap-1.5 text-[9px] font-bold tracking-[0.2em] text-cyan"><IChart size={12} /> SPEND</span>
          <Spark data={sparkData} w={92} h={34} />
          <span className="text-[10px] font-bold text-sub">14-day trend</span>
        </button>
      </div>

      {/* rewards + subscription */}
      <div className="px-5 mt-2.5 grid grid-cols-2 gap-2.5">
        <button onClick={() => nav.push({ name: "rewards" })} className="press lift card p-4 text-left">
          <span className="flex items-center gap-1.5 text-[9px] font-bold tracking-[0.2em] text-warn"><IStar size={12} /> REWARDS</span>
          <p className="font-display font-bold text-xl mt-1 tnum">{points}<span className="text-[11px] text-mute font-body font-semibold"> pts</span></p>
          <p className="text-[10px] text-mute font-semibold mt-0.5">{tier.name}{nextTier ? ` • ${tierPct}% to ${nextTier.name}` : " • top tier"}</p>
          <div className="mt-2 h-1 rounded-full bg-well overflow-hidden">
            <div className="h-full rounded-full transition-all duration-700" style={{ width: `${tierPct}%`, background: `linear-gradient(90deg,${tier.hue},${nextTier ? nextTier.hue : tier.hue})` }} />
          </div>
        </button>
        <button onClick={() => nav.push({ name: "subscriptions" })} className="press lift card p-4 text-left">
          <span className="flex items-center gap-1.5 text-[9px] font-bold tracking-[0.2em] text-ok"><ITv size={12} /> SUBSCRIPTION</span>
          <p className="font-display font-bold text-sm mt-1">{txs.find((t) => t.service === "cable" && t.status === "SUCCESSFUL") ? "Cable active" : "No active plan"}</p>
          <p className="text-[10px] text-mute font-semibold mt-0.5">{txs.find((t) => t.service === "cable" && t.status === "SUCCESSFUL") ? "Auto-renew armed" : "Subscribe to get reminders"}</p>
          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-ok mt-2">Manage <IChevR size={12} /></span>
        </button>
      </div>

      {/* recent activity */}
      <div className="px-5 mt-6">
        <SectionHead title="Recent activity" action={<button onClick={() => nav.setTab("activity")} className="text-[11px] font-bold text-cyan press inline-flex items-center">View all <IChevR size={13} /></button>} />
        <div className="card divide-y divide-line/70 overflow-hidden">
          {recent.length === 0 && (
            <div className="p-6 text-center">
              <p className="text-xs text-mute">No transactions yet. Fund your wallet to get started.</p>
              <button onClick={() => nav.setTab("wallet")} className="text-xs font-bold text-cyan mt-2 press">Add money →</button>
            </div>
          )}
          {recent.map((t, i) => <TxRow key={t.id} t={t} i={i} onClick={() => nav.push({ name: "tx", id: t.id })} />)}
        </div>
      </div>

      {/* referrals + turbo */}
      <div className="px-5 mt-5 space-y-2.5 pb-2">
        <button onClick={() => nav.push({ name: "referrals" })} className="press lift w-full card p-4 flex items-center gap-3 text-left">
          <span className="w-10 h-10 rounded-xl bg-ok/12 text-ok grid place-items-center border border-ok/25"><IUsers size={19} /></span>
          <span className="flex-1">
            <span className="block font-display font-bold text-sm">Refer & earn ₦500</span>
            <span className="block text-[10px] text-mute font-semibold">Per verified active friend</span>
          </span>
          <span className="text-[10px] font-bold px-2.5 py-1.5 rounded-lg bg-ok/12 text-ok border border-ok/25">{profile?.referralCode}</span>
        </button>
        <button onClick={() => nav.push({ name: "diagnostics" })} className="press lift w-full card p-4 flex items-center gap-3 text-left">
          <span className="w-10 h-10 rounded-xl bg-cyan/12 text-cyan grid place-items-center border border-cyan/25"><IGauge size={19} /></span>
          <span className="flex-1">
            <span className="block font-display font-bold text-sm">Stark Turbo diagnostics</span>
            <span className="block text-[10px] text-mute font-semibold">Connection, latency & stability checks</span>
          </span>
          <span className="flex items-center gap-1.5 text-[10px] font-bold text-ok"><span className="w-1.5 h-1.5 rounded-full bg-ok a-blink" /> LIVE</span>
        </button>
      </div>
    </div>
  );
}

export function SectionHead({ title, sub, action }: { title: string; sub?: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-end justify-between mb-3">
      <div>
        <h2 className="font-display font-bold text-[15px] leading-tight">{title}</h2>
        {sub && <p className="text-[10px] text-mute font-semibold">{sub}</p>}
      </div>
      {action}
    </div>
  );
}

export function TxRow({ t, i, onClick }: { t: Tx; i?: number; onClick?: () => void }) {
  const credit = t.service === "funding";
  return (
    <Reveal delay={(i ?? 0) * 50}>
      <button onClick={onClick} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-raised/60 transition-colors press">
        <span className={`w-9 h-9 rounded-xl grid place-items-center shrink-0 ${credit ? "bg-ok/12 text-ok border border-ok/25" : t.status === "FAILED" ? "bg-bad/12 text-bad border border-bad/25" : "bg-well text-sub border border-line"}`}>
          {credit ? <IArrowDL size={17} /> : <IArrowUR size={17} />}
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-[13px] font-semibold truncate">{t.title}</span>
          <span className="block text-[10px] text-mute font-semibold">{timeAgo(t.createdAt)} • {t.ref.slice(4, 12)}</span>
        </span>
        <span className="text-right shrink-0">
          <span className={`block font-display font-bold text-[13px] tnum ${credit ? "text-ok" : "text-ink"}`}>{credit ? "+" : "−"}{money0(t.total)}</span>
          <StatusBadge status={t.status} />
        </span>
      </button>
    </Reveal>
  );
}
export { Chip, IWallet };
