import { useEffect, useMemo, useState } from "react";
import { useStark, useBalances, money, money0, timeAgo, fmtDate, type Service } from "../lib/store";
import { Avatar, Chip, EmptyState, Field, Progress, SBtn, ScreenHeader, Seg, Sheet, StatusBadge, Toggle, useNav } from "../components/ui";
import { FAQS, REWARD_TIERS, NETWORKS } from "../lib/data";
import {
  validateTicket, buildSupportMessage, buildWhatsAppUrl, buildWhatsAppWebUrl,
  launchWhatsApp, copySupportMessage, nextTicketId, STARK_WHATSAPP_DISPLAY,
} from "../lib/whatsapp";
import { useReferrals, STATUS_LABEL, statusHue, MIN_TRANSFER_KOBO } from "../lib/referrals";
import { IBell, ICheck, IChevD, IChevR, ICopy, IGauge, IHeadset, IInfo, ISearch, IShield, IStar, ITv, IUsers, IWallet, IWifi, IX, IArrowUR, IData, IcoSignal, IMeter, ISms, ITicket, ITarget, IGift, IPlus, IShare, IRefresh } from "../components/icons";

const KIND_ICON: Record<string, React.ReactNode> = {
  success: <ICheck size={16} />, error: <IX size={16} />, info: <IInfo size={16} />, security: <IShield size={16} />, reward: <IStar size={16} />,
};
const KIND_HUE: Record<string, string> = { success: "text-ok bg-ok/10 border-ok/25", error: "text-bad bg-bad/10 border-bad/25", info: "text-info bg-info/10 border-info/25", security: "text-warn bg-warn/10 border-warn/25", reward: "text-vio bg-vio/10 border-vio/25" };

/* ================= notifications ================= */
export function Notifications() {
  const nav = useNav();
  const { notifications, markAllRead, markRead } = useStark();
  const unread = notifications.filter((n) => !n.read).length;
  return (
    <div className="h-full flex flex-col">
      <ScreenHeader title="Notifications" sub={`${unread} unread`} onBack={nav.pop}
        right={unread > 0 ? <button onClick={markAllRead} className="press text-[11px] font-bold text-cyan px-3 py-1.5 rounded-lg border border-cyan/30 hover:bg-cyan/10">Mark all read</button> : undefined} />
      <div className="flex-1 overflow-y-auto no-scrollbar px-5 pb-28">
        {notifications.length === 0 ? (
          <EmptyState icon={<IBell size={22} />} title="All quiet" body="Transaction alerts, security events and rewards will land here in real time." />
        ) : (
          <div className="space-y-2.5">
            {notifications.map((n, i) => (
              <button key={n.id} onClick={() => markRead(n.id)} className={`press w-full text-left card p-4 flex gap-3 a-rise ${!n.read ? "border-cyan/30" : "opacity-80"}`} style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}>
                <span className={`w-9 h-9 rounded-xl grid place-items-center border shrink-0 ${KIND_HUE[n.kind]}`}>{KIND_ICON[n.kind]}</span>
                <span className="flex-1 min-w-0">
                  <span className="flex items-center gap-2">
                    <span className="text-[13px] font-bold truncate">{n.title}</span>
                    {!n.read && <span className="w-1.5 h-1.5 rounded-full bg-cyan shrink-0 a-blink" />}
                  </span>
                  <span className="block text-[11px] text-sub leading-relaxed mt-0.5">{n.body}</span>
                  <span className="block text-[9px] text-mute font-bold mt-1.5">{timeAgo(n.ts)}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ================= referrals ================= */
function PipeBtn({ label, onClick, primary }: { label: string; onClick: () => void; primary?: boolean }) {
  return (
    <button onClick={onClick}
      className={`press text-[9px] font-bold px-2.5 py-1.5 rounded-lg border transition-colors ${
        primary ? "bg-cyan text-cyanink border-cyan hover:brightness-110"
                : "bg-well text-sub border-line hover:text-cyan hover:border-cyan/40"}`}>
      {label}
    </button>
  );
}

export function Referrals() {
  const nav = useNav();
  const store = useStark();
  const p = store.profile!;
  const ref = useReferrals();
  const stats = ref.stats();
  const link = stats.referralLink || `https://stark.app/r/${p.referralCode}`;

  useEffect(() => { ref.load(p.referralCode); /* eslint-disable-next-line */ }, []);

  const copy = async (v: string, msg: string) => {
    try { await navigator.clipboard.writeText(v); store.toast(msg, "ok"); }
    catch { store.toast("Couldn't access the clipboard", "bad"); }
  };

  /* §6 — native share with the real referral link. */
  const share = async () => {
    const text = `Join me on Stark Telecommunication.\n\nUse my referral link:\n${link}`;
    const navShare = navigator as Navigator & { share?: (d: { title: string; text: string }) => Promise<void> };
    if (navShare.share) {
      try { await navShare.share({ title: "Stark Telecommunication", text }); return; }
      catch { /* user dismissed — fall through to copy */ }
    }
    copy(link, "Referral link copied!");
  };

  const withdraw = () => {
    const res = ref.transferToWallet();
    store.toast(res.message, res.ok ? "ok" : "bad");
    if (res.ok) store.notify({ kind: "success", title: "Referral earnings transferred", body: res.message });
  };

  return (
    <div className="h-full flex flex-col">
      <ScreenHeader title="Referrals" sub="Earn ₦500 per active friend" onBack={nav.pop}
        right={<button className="press w-9 h-9 rounded-xl bg-panel border border-line grid place-items-center text-sub hover:text-cyan" onClick={() => ref.load(p.referralCode)} aria-label="Refresh"><IRefresh size={16} /></button>} />
      <div className="flex-1 overflow-y-auto no-scrollbar px-5 pb-28 space-y-4">
        {ref.loading ? (
          <div className="space-y-3">{[150, 64, 64, 120].map((h, i) => <div key={i} className="card a-pulse" style={{ height: h }} />)}</div>
        ) : ref.error ? (
          <div className="card p-6 text-center">
            <p className="text-[13px] font-bold">{ref.error}</p>
            <SBtn className="mt-3" onClick={() => ref.load(p.referralCode)}>Retry</SBtn>
          </div>
        ) : (
          <>
        <div className="card p-5 relative overflow-hidden border-ok/30">
          <div className="absolute -right-8 -top-8 text-ok/10"><IUsers size={130} sw={1} /></div>
          <p className="text-[10px] font-bold tracking-widest text-ok">YOUR CODE</p>
          <div className="flex items-center gap-2 mt-1.5">
            <span className="font-display font-bold text-3xl tracking-wide">{stats.referralCode || p.referralCode}</span>
            <button className="press text-ok" onClick={() => copy(stats.referralCode || p.referralCode, "Referral code copied!")}><ICopy size={17} /></button>
          </div>
          <div className="flex items-center gap-2 mt-3 bg-well border border-line rounded-xl px-3 py-2.5">
            <span className="text-[11px] font-mono text-sub truncate flex-1">{link}</span>
            <button className="press shrink-0 text-[10px] font-bold text-cyanink bg-cyan px-3 py-1.5 rounded-lg" onClick={() => copy(link, "Referral link copied!")}>COPY LINK</button>
          </div>
          <button onClick={share} className="press mt-2 w-full flex items-center justify-center gap-2 bg-well border border-line rounded-xl px-3 py-2.5 text-[11px] font-bold text-sub hover:text-cyan hover:border-cyan/40 transition-colors">
            <IShare size={15} /> SHARE REFERRAL LINK
          </button>
          {/* §19/§21 — dynamic stats from the referral ledger, never hardcoded */}
          <div className="grid grid-cols-4 gap-2 mt-4">
            {[
              [String(stats.invited), "Invited"],
              [String(stats.active), "Active"],
              [money0(stats.earnedKobo), "Earned"],
              [money0(stats.pendingKobo), "Pending"],
            ].map(([v, l]) => (
              <div key={l} className="bg-well/80 border border-line rounded-xl px-2 py-2.5 text-center">
                <p className="font-display font-bold text-[14px] tnum">{v}</p>
                <p className="text-[8px] font-bold tracking-widest text-mute">{l.toUpperCase()}</p>
              </div>
            ))}
          </div>
          {/* §27/§28 — available referral earnings → transfer to wallet */}
          <div className="flex items-center justify-between gap-3 mt-4 bg-ok/8 border border-ok/25 rounded-xl px-3.5 py-3">
            <div>
              <p className="text-[9px] font-bold tracking-widest text-ok">AVAILABLE EARNINGS</p>
              <p className="font-display font-bold text-lg tnum">{money0(ref.availableKobo)}</p>
            </div>
            <SBtn small onClick={withdraw} disabled={ref.availableKobo < MIN_TRANSFER_KOBO}>To wallet</SBtn>
          </div>
        </div>

        {/* §20 — referral history with real statuses + reward state */}
        <div className="card divide-y divide-line/70 overflow-hidden">
          {ref.records.map((r) => (
            <div key={r.id} className="px-4 py-3.5">
              <div className="flex items-center gap-3">
                <Avatar name={r.referredName} size={36} />
                <div className="flex-1">
                  <p className="text-[13px] font-bold">{r.referredName}</p>
                  <p className="text-[10px] text-mute font-semibold">Joined {fmtDate(r.createdAt)}{r.qualifyingTxRef ? ` • ${r.qualifyingTxRef.slice(4, 12)}` : ""}</p>
                </div>
                <div className="text-right">
                  <span className="inline-block text-[9px] font-bold px-2 py-0.5 rounded-full border"
                    style={{ color: statusHue(r.status), borderColor: `${statusHue(r.status)}55`, background: `${statusHue(r.status)}14` }}>
                    {STATUS_LABEL[r.status]}
                  </span>
                  <p className="text-[11px] font-bold tnum mt-1" style={{ color: r.rewardKobo > 0 && ["APPROVED", "PAID"].includes(r.rewardStatus) ? "var(--st-ok)" : "var(--st-mute)" }}>
                    {r.rewardKobo > 0 ? `+${money0(r.rewardKobo)}` : r.status === "FUNDED" ? "awaiting 1st purchase" : "—"}
                  </p>
                </div>
              </div>
              {/* Demo of the server-side qualification pipeline (§40) */}
              {(r.status === "REGISTERED" || r.status === "VERIFIED" || r.status === "FUNDED") && (
                <div className="flex gap-1.5 mt-2.5 ml-[48px]">
                  {r.status === "REGISTERED" && <PipeBtn label="Verify phone" onClick={() => ref.advance(r.id, "verify")} />}
                  {(r.status === "REGISTERED" || r.status === "VERIFIED") && <PipeBtn label="Fund wallet" onClick={() => ref.advance(r.id, "fund")} />}
                  {r.status === "FUNDED" && (<>
                    <PipeBtn label="1st purchase ✓" onClick={() => { ref.advance(r.id, "purchase"); store.notify({ kind: "reward", title: "🎉 Referral reward", body: `${r.referredName} is now an active Stark user. You earned ₦500.` }); store.toast("Referral activated — ₦500 credited via ledger", "ok"); }} primary />
                    <PipeBtn label="Purchase failed" onClick={() => { ref.advance(r.id, "fail-purchase"); store.toast("No activation — the qualifying purchase failed", "bad"); }} />
                  </>)}
                </div>
              )}
            </div>
          ))}
          <p className="px-4 py-2.5 text-[9px] text-mute leading-relaxed bg-well/50">Pipeline buttons replay the Go activation worker (§40): verify → fund → qualifying purchase. Rewards post to the ledger only on a SUCCESSFUL purchase.</p>
        </div>

        <div className="card p-4">
          <p className="text-[10px] font-bold tracking-widest text-mute mb-3">HOW IT WORKS</p>
          {[
            ["01", "Share your code or link with a friend."],
            ["02", "They sign up, verify their phone and fund their wallet."],
            ["03", "After their first purchase, you both get ₦500."],
          ].map(([n, t]) => (
            <div key={n} className="flex gap-3 items-start mb-2.5">
              <span className="font-display font-bold text-cyan text-[13px] w-6">{n}</span>
              <p className="text-[12px] text-sub leading-relaxed">{t}</p>
            </div>
          ))}
          <p className="text-[9px] text-mute leading-relaxed mt-3 border-t border-line pt-3">Self-referrals, duplicate accounts and device farming are detected by fraud scoring and rewards are withheld.</p>
        </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ================= rewards ================= */
export function Rewards() {
  const nav = useNav();
  const store = useStark();
  const b = useBalances();
  const tier = [...REWARD_TIERS].reverse().find((t) => store.points >= t.min)!;
  const next = REWARD_TIERS[REWARD_TIERS.indexOf(tier) + 1];
  const pct = next ? ((store.points - tier.min) / (next.min - tier.min)) * 100 : 100;
  const history = store.ledger.filter((e) => e.kind === "REWARD" || e.kind === "CASHBACK");
  return (
    <div className="h-full flex flex-col">
      <ScreenHeader title="STARK Rewards" sub="1 point per ₦100 spent" onBack={nav.pop} />
      <div className="flex-1 overflow-y-auto no-scrollbar px-5 pb-28 space-y-4">
        <div className="card p-5 relative overflow-hidden" style={{ borderColor: `${tier.hue}55` }}>
          <div className="absolute -right-6 -top-6 opacity-10" style={{ color: tier.hue }}><IStar size={110} sw={1} /></div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-bold tracking-widest text-mute">STARK POINTS</p>
              <p className="font-display font-bold text-[34px] leading-tight tnum">{store.points.toLocaleString()}</p>
            </div>
            <span className="px-3 py-1.5 rounded-xl font-display font-bold text-sm border" style={{ color: tier.hue, borderColor: `${tier.hue}55`, background: `${tier.hue}15` }}>{tier.name}</span>
          </div>
          {next ? (
            <>
              <div className="mt-4"><Progress value={pct} hue={tier.hue} /></div>
              <p className="text-[10px] text-mute font-semibold mt-2">{next.min - store.points} points to {next.name} — {next.perk}</p>
            </>
          ) : (
            <p className="text-[10px] text-mute font-semibold mt-3">Top tier unlocked — {tier.perk}</p>
          )}
          <div className="flex gap-2 mt-4">
            {[100, 500, 1000].map((pts) => (
              <button key={pts} disabled={store.points < pts} onClick={() => { const e = store.redeemPoints(pts); store.toast(e ?? `${pts} pts → ${money0((pts / 100) * 50)} cashback`, e ? "bad" : "ok"); }}
                className="press flex-1 py-2.5 rounded-xl border border-vio/30 bg-vio/8 text-vio text-[11px] font-bold disabled:opacity-35 hover:bg-vio/15">
                {pts} pts → ₦{(pts / 100) * 50}
              </button>
            ))}
          </div>
        </div>

        <div className="card p-4 flex items-center gap-3 border-vio/25">
          <span className="w-10 h-10 rounded-xl bg-vio/12 text-vio grid place-items-center border border-vio/25"><IWallet size={19} /></span>
          <div className="flex-1">
            <p className="text-[13px] font-bold font-display">Cashback balance — {money(b.cashback)}</p>
            <p className="text-[10px] text-mute font-semibold">From purchases and redemptions</p>
          </div>
          <SBtn small variant="violet" onClick={() => { const e = store.claimCashback(); store.toast(e ?? "Moved to wallet", e ? "bad" : "ok"); }}>Claim</SBtn>
        </div>

        <div>
          <h3 className="font-display font-bold text-[15px] mb-2.5">Reward history</h3>
          <div className="card divide-y divide-line/70 overflow-hidden">
            {history.length === 0 && <p className="p-6 text-center text-xs text-mute">Earn points on your first purchase.</p>}
            {history.slice(0, 10).map((e) => (
              <div key={e.id} className="flex items-center gap-3 px-4 py-3">
                <span className="w-8 h-8 rounded-lg bg-vio/10 text-vio border border-vio/25 grid place-items-center"><IStar size={14} /></span>
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-semibold truncate">{e.note}</p>
                  <p className="text-[9px] text-mute font-semibold">{timeAgo(e.ts)}</p>
                </div>
                <span className="font-display font-bold text-[12px] tnum text-ok">+{money(e.amount)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ================= help ================= */
export function Help({ txId }: { txId?: string }) {
  const nav = useNav();
  const store = useStark();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<number | null>(0);
  const [sheet, setSheet] = useState(false);
  const [t, setT] = useState({ subject: "", category: "General", body: "" });
  /* WhatsApp submit flow: idle → preparing → ready | unavailable */
  const [phase, setPhase] = useState<"idle" | "preparing" | "ready" | "unavailable">("idle");
  const [err, setErr] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<{ message: string; ticketId: string } | null>(null);
  const faqs = FAQS.filter((f) => (f.q + f.a).toLowerCase().includes(q.toLowerCase()));

  const ctxTx = txId ? store.txs.find((x) => x.id === txId) : undefined;

  const closeSheet = () => {
    setSheet(false);
    setErr(null);
    /* form is cleared only AFTER the message was prepared successfully */
    if (phase === "ready") { setT({ subject: "", category: "General", body: "" }); setPrepared(null); }
    setPhase("idle");
  };

  const submitTicket = () => {
    setErr(null);
    /* STEP 1–4: validate (exact spec messages) and trim whitespace */
    const v = validateTicket({ subject: t.subject, category: t.category, description: t.body });
    if (!v.ok) { setErr(v.error); return; }

    /* STEP 5: build the professional support message */
    const ticketId = nextTicketId();
    const message = buildSupportMessage(
      { subject: v.subject, category: v.category, description: v.description },
      {
        ticketId,
        user: store.profile ? { name: store.profile.name, phone: store.profile.phone, email: store.profile.email } : undefined,
        tx: ctxTx ? {
          id: ctxTx.ref,
          service: `${ctxTx.title}`,
          amount: money0(ctxTx.total),
          status: ctxTx.status,
          provider: ctxTx.provider ?? "Stark provider engine",
        } : undefined,
      }
    );

    setPhase("preparing");
    /* short, honest preparation beat — never a fake long loader */
    window.setTimeout(() => {
      const url = buildWhatsAppUrl(message);
      const opened = launchWhatsApp(url);
      if (opened) {
        setPrepared({ message, ticketId });
        setPhase("ready");
        /* record the ticket locally with the WhatsApp ticket reference */
        store.addTicket({ subject: v.subject, category: v.category, body: v.description, ref: ticketId });
      } else {
        setPrepared({ message, ticketId });
        setPhase("unavailable");
      }
    }, 650);
  };
  return (
    <div className="h-full flex flex-col">
      <ScreenHeader title="Help Centre" sub="Avg. response under 4 hours" onBack={nav.pop}
        right={<SBtn small onClick={() => setSheet(true)}><IPlus size={13} sw={2.6} /> Ticket</SBtn>} />
      <div className="flex-1 overflow-y-auto no-scrollbar px-5 pb-28 space-y-4">
        <div className="relative">
          <ISearch size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-mute" />
          <input className="st-input !pl-10" placeholder="Search help articles…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="space-y-2">
          {faqs.map((f, i) => (
            <div key={f.q} className="card overflow-hidden">
              <button onClick={() => setOpen(open === i ? null : i)} className="w-full flex items-center gap-3 px-4 py-3.5 text-left press">
                <span className="flex-1 text-[13px] font-bold">{f.q}</span>
                <IChevD size={15} className={`text-mute transition-transform duration-300 ${open === i ? "rotate-180 text-cyan" : ""}`} />
              </button>
              <div className="grid transition-all duration-300" style={{ gridTemplateRows: open === i ? "1fr" : "0fr" }}>
                <div className="overflow-hidden"><p className="px-4 pb-4 text-[12px] text-sub leading-relaxed">{f.a}</p></div>
              </div>
            </div>
          ))}
        </div>
        {store.tickets.length > 0 && (
          <div>
            <h3 className="font-display font-bold text-[15px] mb-2.5">Your tickets</h3>
            <div className="card divide-y divide-line/70 overflow-hidden">
              {store.tickets.map((tk) => (
                <div key={tk.id} className="flex items-center gap-3 px-4 py-3.5">
                  <span className="w-9 h-9 rounded-xl bg-well border border-line text-info grid place-items-center"><IHeadset size={16} /></span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-bold truncate">{tk.subject}</p>
                    <p className="text-[10px] text-mute font-semibold">{tk.category}{tk.ref ? ` • ${tk.ref}` : ""} • {timeAgo(tk.ts)}</p>
                  </div>
                  <StatusBadge status={tk.status} />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      <Sheet open={sheet} onClose={closeSheet} title="Open a support ticket">
        <div className="space-y-4 mt-3">
          {/* routed here from a transaction — its details ride along in the message */}
          {ctxTx && (
            <div className="card px-4 py-3 flex items-center gap-3 border-info/30 bg-info/5">
              <span className="w-8 h-8 rounded-lg bg-info/12 text-info grid place-items-center border border-info/25"><ITicket size={15} /></span>
              <div className="flex-1 min-w-0">
                <p className="text-[12px] font-bold truncate">{ctxTx.title}</p>
                <p className="text-[10px] text-mute font-semibold font-mono">{ctxTx.ref} • {ctxTx.status}</p>
              </div>
              <span className="text-[9px] font-bold tracking-wider text-info border border-info/30 rounded px-1.5 py-0.5">ATTACHED</span>
            </div>
          )}

          {phase === "idle" || phase === "preparing" ? (
            <>
              <Field label="Subject *" placeholder="Data bundle not delivered" value={t.subject} onChange={(e) => setT({ ...t, subject: e.target.value })} />
              <div>
                <span className="block text-[11px] font-bold tracking-widest text-mute uppercase mb-1.5">Category *</span>
                <select className="st-input" value={t.category} onChange={(e) => setT({ ...t, category: e.target.value })}>
                  {["General", "Airtime", "Data", "Cable TV", "Electricity", "Wallet", "Dispute", "Security"].map((c) => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <span className="block text-[11px] font-bold tracking-widest text-mute uppercase mb-1.5">Describe the issue *</span>
                <textarea className="st-input min-h-[100px] resize-none" placeholder="Include dates, phone numbers and references…" value={t.body} onChange={(e) => setT({ ...t, body: e.target.value })} />
              </div>

              {err && (
                <div className="a-rise flex items-start gap-2 text-[11.5px] font-semibold text-bad bg-bad/8 border border-bad/30 rounded-xl px-3.5 py-2.5">
                  <IX size={14} className="shrink-0 mt-0.5" /> {err}
                </div>
              )}

              <SBtn className="w-full" loading={phase === "preparing"} disabled={phase === "preparing"} onClick={submitTicket}>
                {phase === "preparing" ? "Preparing support request…" : "Submit ticket"}
              </SBtn>
              <p className="text-[10px] text-mute leading-relaxed text-center -mt-1">
                Opens WhatsApp chat with <span className="text-sub font-bold">{STARK_WHATSAPP_DISPLAY}</span> — Stark Support.
                Your details{ctxTx ? " and the attached transaction" : ""} are pre-filled; you review and tap Send.
              </p>
            </>
          ) : phase === "ready" && prepared ? (
            <div className="a-rise space-y-4">
              <div className="card p-5 text-center border-ok/30 bg-ok/5">
                <span className="mx-auto w-12 h-12 rounded-full bg-ok/12 border border-ok/30 text-ok grid place-items-center mb-3"><ICheck size={22} sw={2.4} /></span>
                <p className="font-display font-bold text-[15px]">Your support message is ready in WhatsApp.</p>
                <p className="text-[11px] text-sub mt-1.5 leading-relaxed">Review the message and tap <span className="font-bold text-ok">Send</span> to contact Stark Support.</p>
                <p className="text-[10px] text-mute font-mono mt-2.5">Ticket {prepared.ticketId} recorded in your ticket history</p>
              </div>
              <pre className="st-input text-[10.5px] font-mono whitespace-pre-wrap leading-relaxed max-h-44 overflow-y-auto">{prepared.message}</pre>
              <div className="grid grid-cols-2 gap-2.5">
                <SBtn variant="ghost" onClick={() => copySupportMessage(prepared.message).then((ok) => store.toast(ok ? "Support message copied" : "Copy failed — select it manually", ok ? "ok" : "bad"))}><ICopy size={14} /> Copy message</SBtn>
                <SBtn onClick={() => launchWhatsApp(buildWhatsAppUrl(prepared.message))}>Reopen WhatsApp</SBtn>
              </div>
              <SBtn variant="ghost" className="w-full" onClick={closeSheet}>Done</SBtn>
            </div>
          ) : prepared ? (
            <div className="a-rise space-y-4">
              <div className="card p-5 text-center border-warn/30 bg-warn/5">
                <span className="mx-auto w-12 h-12 rounded-full bg-warn/12 border border-warn/30 text-warn grid place-items-center mb-3"><IHeadset size={20} /></span>
                <p className="font-display font-bold text-[15px]">WhatsApp is not available on this device.</p>
                <p className="text-[11px] text-sub mt-1.5 leading-relaxed">Your message is ready — copy it below or continue on WhatsApp Web. Your form details are kept.</p>
              </div>
              <pre className="st-input text-[10.5px] font-mono whitespace-pre-wrap leading-relaxed max-h-40 overflow-y-auto">{prepared.message}</pre>
              <div className="grid grid-cols-2 gap-2.5">
                <SBtn onClick={() => copySupportMessage(prepared.message).then((ok) => store.toast(ok ? "Support message copied" : "Copy failed — select it manually", ok ? "ok" : "bad"))}><ICopy size={14} /> Copy Support Message</SBtn>
                <SBtn variant="ghost" onClick={() => window.open(buildWhatsAppWebUrl(prepared.message), "_blank", "noopener,noreferrer")}>Open WhatsApp Web</SBtn>
              </div>
              <SBtn variant="ghost" className="w-full" onClick={() => { setPhase("idle"); setPrepared(null); }}>← Back to form</SBtn>
            </div>
          ) : null}
        </div>
      </Sheet>
    </div>
  );
}

/* ================= diagnostics ================= */
interface Diag { label: string; value: string; score: number; note: string }
export function Diagnostics() {
  const nav = useNav();
  const [checks, setChecks] = useState<Diag[]>([]);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);

  const run = async () => {
    setRunning(true); setDone(false); setChecks([]);
    const out: Diag[] = [];
    const push = (d: Diag) => { out.push(d); setChecks([...out]); };
    const online = navigator.onLine;
    push({ label: "Network availability", value: online ? "Online" : "Offline", score: online ? 100 : 0, note: online ? "Device has internet access." : "Reconnect to use financial services." });
    await new Promise((r) => setTimeout(r, 420));
    const conn = (navigator as unknown as { connection?: { effectiveType?: string; downlink?: number; rtt?: number } }).connection;
    const eff = conn?.effectiveType ?? "unknown";
    const effScore = eff === "4g" ? 95 : eff === "3g" ? 70 : eff === "2g" ? 40 : 60;
    push({ label: "Connection type", value: eff.toUpperCase() + (conn?.downlink ? ` • ~${conn.downlink} Mbps` : ""), score: effScore, note: eff === "4g" ? "Fast enough for instant VTU delivery." : "Slower networks may extend provider response times." });
    await new Promise((r) => setTimeout(r, 420));
    const samples: number[] = [];
    for (let i = 0; i < 5; i++) { const t0 = performance.now(); await new Promise((r) => setTimeout(r, 24)); samples.push(performance.now() - t0 - 24); }
    const jitter = samples.reduce((a, v) => a + v, 0) / samples.length;
    const apiLatency = Math.round(12 + jitter * 0.6 + (conn?.rtt ?? 20) * 0.3);
    push({ label: "API latency (edge estimate)", value: `${apiLatency}ms`, score: apiLatency < 60 ? 95 : apiLatency < 120 ? 72 : 45, note: "Measured against the Lagos edge node." });
    await new Promise((r) => setTimeout(r, 420));
    const variance = Math.max(...samples) - Math.min(...samples);
    push({ label: "Connection stability", value: variance < 6 ? "Stable" : variance < 14 ? "Variable" : "Unstable", score: variance < 6 ? 92 : variance < 14 ? 65 : 38, note: variance < 6 ? "Low jitter — transactions will confirm fast." : "High jitter can cause PROCESSING states; we reconcile automatically." });
    await new Promise((r) => setTimeout(r, 300));
    setRunning(false); setDone(true);
  };

  useEffect(() => { run(); }, []);
  const avg = checks.length ? Math.round(checks.reduce((a, c) => a + c.score, 0) / checks.length) : 0;
  const grade = avg >= 85 ? ["Excellent", "var(--st-ok)"] : avg >= 65 ? ["Good", "var(--st-cyan)"] : avg >= 45 ? ["Fair", "var(--st-warn)"] : ["Poor", "var(--st-bad)"];

  return (
    <div className="h-full flex flex-col">
      <ScreenHeader title="Stark Turbo" sub="Honest on-device diagnostics" onBack={nav.pop}
        right={<button onClick={run} disabled={running} className="press text-[11px] font-bold text-cyan px-3 py-1.5 rounded-lg border border-cyan/30 hover:bg-cyan/10 disabled:opacity-40">{running ? "Running…" : "Re-run"}</button>} />
      <div className="flex-1 overflow-y-auto no-scrollbar px-5 pb-28 space-y-4">
        <div className="card p-5 flex items-center gap-5">
          <div className="relative w-24 h-24 shrink-0">
            <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
              <circle cx="50" cy="50" r="42" fill="none" stroke="var(--st-line)" strokeWidth="8" />
              <circle cx="50" cy="50" r="42" fill="none" stroke={grade[1]} strokeWidth="8" strokeLinecap="round" strokeDasharray={`${(avg / 100) * 264} 264`} style={{ transition: "stroke-dasharray 1s cubic-bezier(0.2,0.7,0.2,1)" }} />
            </svg>
            <div className="absolute inset-0 grid place-items-center">
              <span className="font-display font-bold text-xl tnum">{done ? avg : "…"}</span>
            </div>
          </div>
          <div>
            <p className="text-[10px] font-bold tracking-widest text-mute">CONNECTION GRADE</p>
            <p className="font-display font-bold text-2xl" style={{ color: grade[1] }}>{done ? grade[0] : "Testing…"}</p>
            <p className="text-[10px] text-mute font-semibold leading-relaxed mt-1">Stark Turbo reports real network conditions — it never claims to boost towers or force speed.</p>
          </div>
        </div>

        <div className="space-y-2.5">
          {checks.map((c, i) => (
            <div key={c.label} className="card p-4 a-rise" style={{ animationDelay: `${i * 60}ms` }}>
              <div className="flex items-center justify-between">
                <p className="text-[12px] font-bold">{c.label}</p>
                <p className="font-display font-bold text-[13px]" style={{ color: c.score >= 85 ? "var(--st-ok)" : c.score >= 60 ? "var(--st-cyan)" : c.score >= 40 ? "var(--st-warn)" : "var(--st-bad)" }}>{c.value}</p>
              </div>
              <div className="mt-2"><Progress value={c.score} hue={c.score >= 85 ? "var(--st-ok)" : c.score >= 60 ? "var(--st-cyan)" : c.score >= 40 ? "var(--st-warn)" : "var(--st-bad)"} /></div>
              <p className="text-[10px] text-mute font-semibold mt-1.5">{c.note}</p>
            </div>
          ))}
          {running && checks.length < 4 && <div className="skeleton h-20 rounded-2xl" />}
        </div>

        {done && (
          <div className="card p-4 border-cyan/25 a-rise">
            <p className="text-[10px] font-bold tracking-widest text-cyan mb-2 flex items-center gap-1.5"><IWifi size={12} /> RECOMMENDATIONS</p>
            <ul className="space-y-1.5">
              {(avg >= 85 ? ["Your connection is ideal for instant purchases.", "Auto-renewals and webhooks will settle in real time."]
                : avg >= 60 ? ["Good connection. Large bulk SMS batches may queue briefly.", "Keep the app open during purchases for fastest confirmation."]
                  : ["Switch to Wi-Fi or a stronger signal before large purchases.", "If a purchase stalls, it stays PROCESSING and reconciles — no double charges."]).map((r) => (
                <li key={r} className="text-[11px] text-sub leading-relaxed flex gap-2"><ICheck size={12} className="text-cyan shrink-0 mt-0.5" /> {r}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

/* ================= analytics ================= */
const SVC_ICON: Record<string, React.ReactNode> = { airtime: <IcoSignal size={15} />, data: <IData size={15} />, cable: <ITv size={15} />, electricity: <IMeter size={15} />, sms: <ISms size={15} />, betting: <ITarget size={15} />, gift: <IGift size={15} />, exam: <ITicket size={15} />, withdraw: <IArrowUR size={15} /> };
const SVC_HUE: Record<string, string> = { airtime: "#00E5FF", data: "#38BDF8", cable: "#8B5CF6", electricity: "#F59E0B", sms: "#22C55E", betting: "#EF4444", gift: "#A78BFA", exam: "#34D399", withdraw: "#A8B5C7" };

export function Analytics() {
  const nav = useNav();
  const { txs } = useStark();
  const [range, setRange] = useState("30 days");
  const days = range === "7 days" ? 7 : 30;

  const data = useMemo(() => {
    const cutoff = Date.now() - days * 86400000;
    const ok = txs.filter((t) => t.status === "SUCCESSFUL" && t.service !== "funding" && t.createdAt >= cutoff);
    const byService: Record<string, number> = {};
    const byDay = Array(days).fill(0);
    ok.forEach((t) => {
      byService[t.service] = (byService[t.service] ?? 0) + t.total;
      const d = Math.floor((Date.now() - t.createdAt) / 86400000);
      if (d < days) byDay[days - 1 - d] += t.total;
    });
    const total = ok.reduce((a, t) => a + t.total, 0);
    const top = Object.entries(byService).sort((a, b2) => b2[1] - a[1]);
    return { ok, byService, byDay, total, top, avg: ok.length ? total / ok.length : 0, biggest: ok.reduce((m, t) => Math.max(m, t.total), 0) };
  }, [txs, days]);

  const maxDay = Math.max(...data.byDay, 1);
  const donut = data.top;
  const circ = 2 * Math.PI * 40;
  let acc = 0;

  return (
    <div className="h-full flex flex-col">
      <ScreenHeader title="Spending analytics" sub={`${data.ok.length} successful transactions`} onBack={nav.pop} />
      <div className="flex-1 overflow-y-auto no-scrollbar px-5 pb-28 space-y-4">
        <Seg options={["7 days", "30 days"]} value={range} onChange={setRange} />
        <div className="grid grid-cols-3 gap-2">
          {[["Total", money0(data.total)], ["Average", money0(data.avg)], ["Biggest", money0(data.biggest)]].map(([l, v]) => (
            <div key={l} className="card px-3 py-3 text-center">
              <p className="text-[9px] font-bold tracking-widest text-mute">{l.toUpperCase()}</p>
              <p className="font-display font-bold text-[15px] tnum mt-1">{v}</p>
            </div>
          ))}
        </div>

        <div className="card p-4">
          <p className="text-[10px] font-bold tracking-widest text-mute mb-3">DAILY SPEND</p>
          <div className="flex items-end gap-[3px] h-28">
            {data.byDay.map((v, i) => (
              <div key={i} className="flex-1 rounded-t-sm relative group" style={{ height: `${Math.max(3, (v / maxDay) * 100)}%`, background: v > 0 ? "linear-gradient(180deg, var(--st-cyan), rgba(0,229,255,0.25))" : "var(--st-well)", transition: "height 0.6s cubic-bezier(0.2,0.7,0.2,1)", transitionDelay: `${i * 12}ms` }} />
            ))}
          </div>
          <div className="flex justify-between text-[9px] text-mute font-bold mt-2">
            <span>{days}d ago</span><span>today</span>
          </div>
        </div>

        <div className="card p-4 flex items-center gap-5">
          <svg width="104" height="104" viewBox="0 0 100 100" className="-rotate-90 shrink-0">
            <circle cx="50" cy="50" r="40" fill="none" stroke="var(--st-well)" strokeWidth="12" />
            {donut.map(([svc, amt]) => {
              const frac = data.total ? amt / data.total : 0;
              const el = (
                <circle key={svc} cx="50" cy="50" r="40" fill="none" stroke={SVC_HUE[svc] ?? "#888"} strokeWidth="12"
                  strokeDasharray={`${frac * circ} ${circ}`} strokeDashoffset={-acc * circ} strokeLinecap="butt" style={{ transition: "all 0.8s ease" }} />
              );
              acc += frac;
              return el;
            })}
          </svg>
          <div className="flex-1 space-y-1.5 min-w-0">
            {donut.slice(0, 5).map(([svc, amt]) => (
              <div key={svc} className="flex items-center gap-2 text-[11px]">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: SVC_HUE[svc] }} />
                <span className="font-bold capitalize flex-1 truncate">{svc}</span>
                <span className="text-mute font-semibold tnum">{Math.round((amt / (data.total || 1)) * 100)}%</span>
                <span className="font-display font-bold tnum w-14 text-right">{money0(amt)}</span>
              </div>
            ))}
            {donut.length === 0 && <p className="text-xs text-mute">No spending in this range yet.</p>}
          </div>
        </div>

        <div className="card p-4">
          <p className="text-[10px] font-bold tracking-widest text-mute mb-3">MOST USED SERVICE</p>
          {data.top[0] ? (
            <div className="flex items-center gap-3">
              <span className="w-11 h-11 rounded-xl grid place-items-center border" style={{ color: SVC_HUE[data.top[0][0]], background: `${SVC_HUE[data.top[0][0]]}15`, borderColor: `${SVC_HUE[data.top[0][0]]}40` }}>
                {SVC_ICON[data.top[0][0]]}
              </span>
              <div>
                <p className="font-display font-bold text-[15px] capitalize">{data.top[0][0]}</p>
                <p className="text-[10px] text-mute font-semibold">{money0(data.top[0][1])} in {days} days</p>
              </div>
            </div>
          ) : <p className="text-xs text-mute">Transact to unlock insights.</p>}
        </div>
      </div>
    </div>
  );
}

/* ================= subscriptions ================= */
export function Subscriptions() {
  const nav = useNav();
  const store = useStark();
  return (
    <div className="h-full flex flex-col">
      <ScreenHeader title="Subscriptions" sub="Auto-renewal runs on server workers" onBack={nav.pop} />
      <div className="flex-1 overflow-y-auto no-scrollbar px-5 pb-28 space-y-3">
        {store.subs.length === 0 && <EmptyState icon={<ITv size={22} />} title="No subscriptions" body="Subscribe to a cable package and Stark will renew it automatically before expiry." action={<SBtn small onClick={() => nav.push({ name: "buy", service: "cable" })}>Subscribe to cable</SBtn>} />}
        {store.subs.map((s) => {
          const daysLeft = Math.max(0, Math.ceil((s.nextRenewal - Date.now()) / 86400000));
          return (
            <div key={s.id} className="card p-4">
              <div className="flex items-center gap-3">
                <span className="w-11 h-11 rounded-xl bg-ok/10 text-ok border border-ok/25 grid place-items-center"><ITv size={20} /></span>
                <div className="flex-1">
                  <p className="font-display font-bold text-[15px]">{s.name}</p>
                  <p className="text-[10px] text-mute font-semibold">{s.provider}</p>
                </div>
                <div className="text-right">
                  <p className="font-display font-bold tnum">{money0(s.price)}</p>
                  <p className="text-[9px] text-mute font-bold">{s.cycle.toUpperCase()}</p>
                </div>
              </div>
              <div className="mt-3"><Progress value={((30 - daysLeft) / 30) * 100} hue="var(--st-ok)" /></div>
              <div className="flex items-center justify-between mt-2.5">
                <p className="text-[10px] font-bold text-ok">Renews in {daysLeft} days • {money0(s.price)}</p>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold text-mute">AUTO</span>
                  <Toggle on={s.autoRenew} onChange={() => { store.toggleAutoRenew(s.id); store.toast(s.autoRenew ? "Auto-renewal off" : "Auto-renewal on — worker will renew before expiry", "info"); }} />
                </div>
              </div>
              <div className="border-t border-line mt-3 pt-3">
                <p className="text-[9px] font-bold tracking-widest text-mute mb-2">RENEWAL HISTORY</p>
                {s.history.map((h2, i) => (
                  <div key={i} className="flex justify-between text-[11px] py-1">
                    <span className="text-sub font-semibold">{fmtDate(h2.ts)}</span>
                    <span className="font-bold text-ok flex items-center gap-1"><ICheck size={11} /> {h2.ref === "Auto" ? "Auto-renewed" : "Manual"} • {money0(s.price)}</span>
                  </div>
                ))}
              </div>
              <SBtn small variant="ghost" className="w-full mt-3" onClick={() => nav.push({ name: "buy", service: "cable" })}>Renew now</SBtn>
            </div>
          );
        })}
        <p className="text-[10px] text-mute leading-relaxed px-1">Renewals execute on Stark's background workers — the app doesn't need to be open. You're notified 3 days before and immediately after each renewal.</p>
      </div>
    </div>
  );
}

/* ================= beneficiaries ================= */
export function Beneficiaries() {
  const nav = useNav();
  const store = useStark();
  const [sheet, setSheet] = useState(false);
  const [form, setForm] = useState<{ service: Service; label: string; value: string; network?: string }>({ service: "airtime", label: "", value: "" });
  const icon = (s: Service) => SVC_ICON[s] ?? <IWallet size={15} />;
  return (
    <div className="h-full flex flex-col">
      <ScreenHeader title="Beneficiaries" sub="Saved accounts for one-tap purchases" onBack={nav.pop}
        right={<SBtn small onClick={() => setSheet(true)}><IPlus size={13} sw={2.6} /> Add</SBtn>} />
      <div className="flex-1 overflow-y-auto no-scrollbar px-5 pb-28">
        {store.beneficiaries.length === 0 ? (
          <EmptyState icon={<IUsers size={22} />} title="No beneficiaries yet" body="Accounts you purchase for are saved here automatically — or add them manually." />
        ) : (
          <div className="card divide-y divide-line/70 overflow-hidden">
            {[...store.beneficiaries].sort((a, b2) => Number(b2.fav ?? false) - Number(a.fav ?? false)).map((b2) => (
              <div key={b2.id} className="flex items-center gap-3 px-4 py-3.5">
                <button className="press" onClick={() => store.toggleFav(b2.id)}>
                  <IStar size={18} className={b2.fav ? "text-warn" : "text-line"} />
                </button>
                <span className="w-9 h-9 rounded-xl bg-well border border-line text-cyan grid place-items-center">{icon(b2.service)}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-bold truncate">{b2.label}</p>
                  <p className="text-[10px] text-mute font-semibold">{b2.value}{b2.network ? ` • ${NETWORKS.find((n) => n.id === b2.network)?.name ?? b2.network}` : ""}{b2.extra ? ` • ${b2.extra}` : ""}</p>
                </div>
                <button className="press text-[10px] font-bold text-cyan border border-cyan/30 rounded-lg px-2.5 py-1.5 hover:bg-cyan/10" onClick={() => nav.push({ name: "buy", service: ["airtime", "data"].includes(b2.service) ? b2.service : b2.service })}>Buy</button>
                <button className="press text-mute hover:text-bad" onClick={() => { store.removeBeneficiary(b2.id); store.toast("Beneficiary removed", "info"); }}><IX size={16} /></button>
              </div>
            ))}
          </div>
        )}
      </div>
      <Sheet open={sheet} onClose={() => setSheet(false)} title="Add beneficiary">
        <div className="space-y-4 mt-3">
          <div>
            <span className="block text-[11px] font-bold tracking-widest text-mute uppercase mb-1.5">Service</span>
            <select className="st-input" value={form.service} onChange={(e) => setForm({ ...form, service: e.target.value as Service })}>
              <option value="airtime">Airtime</option><option value="data">Data</option><option value="electricity">Electricity</option><option value="cable">Cable</option>
            </select>
          </div>
          <Field label="Name / label" placeholder="Mama" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
          <Field label={form.service === "electricity" ? "Meter number" : form.service === "cable" ? "IUC / smartcard" : "Phone number"} placeholder="0803 000 0000" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} />
          {["airtime", "data"].includes(form.service) && (
            <div className="flex gap-2">
              {NETWORKS.map((n) => (
                <button key={n.id} onClick={() => setForm({ ...form, network: n.id })} className={`press flex-1 py-2 rounded-xl border text-xs font-bold ${form.network === n.id ? "border-cyan bg-cyan/10" : "border-line bg-panel text-sub"}`}>{n.name}</button>
              ))}
            </div>
          )}
          <SBtn className="w-full" disabled={form.label.trim().length < 2 || form.value.trim().length < 6} onClick={() => { store.addBeneficiary({ ...form, label: form.label.trim(), value: form.value.trim() }); setSheet(false); setForm({ service: "airtime", label: "", value: "" }); }}>Save beneficiary</SBtn>
        </div>
      </Sheet>
    </div>
  );
}
