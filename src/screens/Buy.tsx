import { useMemo, useState } from "react";
import { useStark, useBalances, money, money0, type Service, type TxMeta } from "../lib/store";
import { Field, PinPad, SBtn, ScreenHeader, Seg, useNav } from "../components/ui";
import { NETWORKS, DATA_PLANS, CABLE_PROVIDERS, DISCOS, EXAM_PINS, BETTING_PLATFORMS, FEES, CASHBACK_RATE, type NetworkId } from "../lib/data";
import { ICheck, IChevR, IcoSignal, IX } from "../components/icons";

type Stage = "form" | "confirm" | "processing" | "done";

export default function Buy({ service }: { service: Service }) {
  const nav = useNav();
  const store = useStark();
  const b = useBalances();
  const [stage, setStage] = useState<Stage>("form");
  const [network, setNetwork] = useState<NetworkId>("MTN");
  const [phone, setPhone] = useState("");
  const [amount, setAmount] = useState(1000);
  const [planId, setPlanId] = useState<string | null>(null);
  const [cableId, setCableId] = useState("GOTV");
  const [iuc, setIuc] = useState("");
  const [disco, setDisco] = useState("IKEDC");
  const [meter, setMeter] = useState("");
  const [meterType, setMeterType] = useState("Prepaid");
  const [examId, setExamId] = useState("waec");
  const [betId, setBetId] = useState("bet9ja");
  const [betAccount, setBetAccount] = useState("");
  const [smsMsg, setSmsMsg] = useState("");
  const [smsUnits, setSmsUnits] = useState(100);
  const [err, setErr] = useState<string | null>(null);
  const [pinOpen, setPinOpen] = useState(false);
  const [pinErr, setPinErr] = useState<string | null>(null);
  const [result, setResult] = useState<Awaited<ReturnType<typeof store.purchase>> | null>(null);
  const [stepLabel, setStepLabel] = useState("");

  const cable = CABLE_PROVIDERS.find((c) => c.id === cableId)!;
  const cablePkg = cable.packages[0];
  const plan = planId ? DATA_PLANS[network].find((p) => p.id === planId) : undefined;
  const exam = EXAM_PINS.find((e) => e.id === examId)!;

  /* compute the payload for this service */
  const payload = useMemo((): { title: string; amount: number; meta: TxMeta } => {
    switch (service) {
      case "airtime": return { title: `${network} Airtime • ${phone}`, amount, meta: { network, phone } };
      case "data": return { title: `${network} ${plan?.size ?? ""} • ${phone}`, amount: plan?.price ?? 0, meta: { network, phone, plan: plan?.size, size: plan?.size } };
      case "cable": return { title: `${cable.name} ${cablePkg.name} • ${iuc}`, amount: cablePkg.price, meta: { providerName: cable.name, iuc, customer: "Verified customer", plan: cablePkg.name } };
      case "electricity": return { title: `${disco} ${meterType} • ${meter}`, amount, meta: { disco, meter, meterType, customer: "Verified meter" } };
      case "exam": return { title: `${exam.body} • ${exam.item}`, amount: exam.price, meta: { examBody: exam.body, item: exam.item, qty: 1 } };
      case "betting": return { title: `${BETTING_PLATFORMS.find((x) => x.id === betId)?.name} top-up • ${betAccount}`, amount, meta: { platform: betId, betId: betAccount } };
      case "sms": return { title: `Bulk SMS • ${smsUnits} recipients`, amount: smsUnits * 4, meta: { senderId: "STARKNG", units: smsUnits, message: smsMsg } };
      case "gift": return { title: `Gift — ${network} ${money0(amount)} to ${phone}`, amount, meta: { network, phone, giftType: "airtime" } };
      default: return { title: "", amount: 0, meta: {} };
    }
  }, [service, network, phone, amount, plan, planId, cable, cablePkg, iuc, disco, meter, meterType, exam, betId, betAccount, smsMsg, smsUnits]);

  const fee = FEES[service] ?? 0;
  const cb = (service === "data" || service === "electricity") ? Math.round(payload.amount * CASHBACK_RATE) : 0;
  const total = payload.amount + fee;

  const valid = useMemo(() => {
    switch (service) {
      case "airtime": case "gift": return phone.replace(/\D/g, "").length >= 10 && amount >= 50;
      case "data": return !!plan && phone.replace(/\D/g, "").length >= 10;
      case "cable": return iuc.replace(/\D/g, "").length >= 8;
      case "electricity": return meter.replace(/\D/g, "").length >= 8 && amount >= 1000;
      case "betting": return betAccount.replace(/\D/g, "").length >= 6 && amount >= 100;
      case "sms": return smsUnits >= 10 && smsMsg.trim().length > 0;
      case "exam": return true;
      default: return false;
    }
  }, [service, phone, amount, plan, iuc, meter, betAccount, smsUnits, smsMsg]);

  const pay = (pin: string) => {
    if (pin !== store.profile?.pin) { setPinErr("Incorrect PIN."); return; }
    setPinErr(null);
    setPinOpen(false);
    setStage("processing");
    setStepLabel("Reserving funds…");
    setTimeout(() => setStepLabel("Contacting provider…"), 800);
    store.purchase({ service, ...payload }).then((tx) => {
      setResult(tx);
      setStage("done");
    }).catch((e) => {
      setErr((e as Error).message);
      setStage("form");
    });
  };

  if (stage === "done" && result) {
    const ok = result.status === "SUCCESSFUL";
    return (
      <div className="h-full flex flex-col">
        <ScreenHeader title={ok ? "Successful" : "Failed"} sub={result.ref} onBack={() => nav.pop()} />
        <div className="flex-1 overflow-y-auto no-scrollbar px-5 pb-28">
          <div className={`card p-6 text-center border ${ok ? "border-ok/30" : "border-bad/30"}`}>
            <div className={`mx-auto w-16 h-16 rounded-full grid place-items-center mb-4 a-pop ${ok ? "bg-ok/12 text-ok border border-ok/30" : "bg-bad/12 text-bad border border-bad/30"}`}>
              {ok ? <ICheck size={30} sw={2.4} /> : <IX size={30} sw={2.4} />}
            </div>
            <p className="font-display font-bold text-xl">{ok ? "Transaction successful" : "Transaction failed"}</p>
            <p className="font-display font-bold text-[26px] tnum mt-2">{money0(result.total)}</p>
            <p className="text-xs text-mute mt-1">{result.title}</p>
            {!ok && result.failReason && (
              <p className="text-[11px] text-bad font-semibold mt-3 bg-bad/10 border border-bad/25 rounded-xl px-3 py-2.5">{result.failReason}</p>
            )}
            {ok && result.meta.token && (
              <div className="mt-4 bg-well border border-line rounded-xl px-3 py-3">
                <p className="text-[9px] font-bold tracking-widest text-mute">ELECTRICITY TOKEN</p>
                <p className="font-mono font-bold text-cyan text-[15px] mt-1">{result.meta.token}</p>
              </div>
            )}
          </div>
          <div className="flex gap-2.5 mt-4">
            {ok ? (
              <>
                <SBtn variant="ghost" className="flex-1" onClick={() => nav.pop()}>Done</SBtn>
                <SBtn className="flex-1" onClick={() => { setStage("form"); setResult(null); }}>Buy again</SBtn>
              </>
            ) : (
              <>
                <SBtn variant="ghost" className="flex-1" onClick={() => nav.pop()}>Close</SBtn>
                <SBtn className="flex-1" onClick={() => { setStage("form"); setResult(null); }}>Retry</SBtn>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (stage === "processing") {
    return (
      <div className="h-full flex flex-col items-center justify-center px-8">
        <div className="relative w-20 h-20 mb-6">
          {[0, 1, 2].map((i) => <span key={i} className="absolute inset-0 rounded-full border-2 border-cyan/40 a-ring" style={{ animationDelay: `${i * 0.4}s` }} />)}
          <div className="absolute inset-3 rounded-full bg-cyan/12 text-cyan grid place-items-center border border-cyan/30"><IcoSignal size={26} /></div>
        </div>
        <p className="font-display font-bold text-lg">{stepLabel}</p>
        <p className="text-xs text-mute text-center mt-2 leading-relaxed">Your funds are reserved, not charged. If the provider fails, the full amount reverses automatically.</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <ScreenHeader title={`Buy ${service === "sms" ? "Bulk SMS" : service}`} sub={`Available ${money0(b.available)}`} onBack={() => nav.pop()} />
      <div className="flex-1 overflow-y-auto no-scrollbar px-5 pb-28">
        {stage === "form" && (
          <div className="space-y-4 a-rise">
            {(service === "airtime" || service === "data" || service === "gift") && (
              <>
                <div>
                  <span className="block text-[11px] font-bold tracking-widest text-mute uppercase mb-2">Network</span>
                  <div className="flex gap-2">
                    {NETWORKS.map((n) => (
                      <button key={n.id} onClick={() => { setNetwork(n.id); setPlanId(null); }}
                        className={`press flex-1 py-2.5 rounded-xl border text-xs font-bold transition-colors ${network === n.id ? "text-cyanink" : "bg-panel border-line text-sub"}`}
                        style={network === n.id ? { background: n.hue, borderColor: n.hue, color: "#0B1220" } : undefined}>{n.name}</button>
                    ))}
                  </div>
                </div>
                <Field label="Phone number" inputMode="tel" placeholder="0803 000 0000" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </>
            )}

            {service === "airtime" && (
              <>
                <div className="grid grid-cols-4 gap-2">
                  {[100, 200, 500, 1000, 2000, 5000].map((v) => (
                    <button key={v} onClick={() => setAmount(v)} className={`press py-2.5 rounded-xl border text-xs font-bold tnum ${amount === v ? "bg-cyan text-cyanink border-cyan" : "bg-panel border-line text-sub"}`}>{v >= 1000 ? `${v / 1000}k` : v}</button>
                  ))}
                </div>
                <Field label="Custom amount (₦)" inputMode="numeric" value={String(amount)} onChange={(e) => setAmount(Number(e.target.value.replace(/\D/g, "")))} />
              </>
            )}

            {service === "data" && (
              <div className="grid grid-cols-2 gap-2.5">
                {DATA_PLANS[network].map((p) => (
                  <button key={p.id} onClick={() => setPlanId(p.id)}
                    className={`press text-left p-3.5 rounded-xl border transition-colors ${planId === p.id ? "border-cyan bg-cyan/8" : "border-line bg-panel hover:border-cyan/40"}`}>
                    <p className="font-display font-bold text-[15px]">{p.size}</p>
                    <p className="text-[10px] text-mute font-semibold mt-0.5">{p.validity}</p>
                    <p className="font-display font-bold text-cyan text-[13px] tnum mt-1.5">{money0(p.price)}</p>
                  </button>
                ))}
              </div>
            )}

            {service === "cable" && (
              <>
                <Seg options={CABLE_PROVIDERS.map((c) => c.id)} value={cableId} onChange={setCableId} />
                <Field label="IUC / Smartcard number" inputMode="numeric" placeholder="5093117722" value={iuc} onChange={(e) => setIuc(e.target.value.replace(/\D/g, ""))} />
                <div className="card p-3.5 flex items-center justify-between">
                  <div>
                    <p className="text-[12px] font-bold">{cablePkg.name}</p>
                    <p className="text-[10px] text-mute font-semibold">Monthly bouquet</p>
                  </div>
                  <p className="font-display font-bold text-cyan tnum">{money0(cablePkg.price)}</p>
                </div>
              </>
            )}

            {service === "electricity" && (
              <>
                <div>
                  <span className="block text-[11px] font-bold tracking-widest text-mute uppercase mb-2">DisCo</span>
                  <select className="st-input" value={disco} onChange={(e) => setDisco(e.target.value)}>
                    {DISCOS.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>
                <Field label="Meter number" inputMode="numeric" placeholder="45030122876" value={meter} onChange={(e) => setMeter(e.target.value.replace(/\D/g, ""))} />
                <Seg options={["Prepaid", "Postpaid"]} value={meterType} onChange={setMeterType} />
                <div className="grid grid-cols-4 gap-2">
                  {[1000, 2000, 5000, 10000, 20000, 50000].map((v) => (
                    <button key={v} onClick={() => setAmount(v)} className={`press py-2.5 rounded-xl border text-xs font-bold tnum ${amount === v ? "bg-cyan text-cyanink border-cyan" : "bg-panel border-line text-sub"}`}>{v / 1000}k</button>
                  ))}
                </div>
                <Field label="Custom amount (₦)" inputMode="numeric" value={String(amount)} onChange={(e) => setAmount(Number(e.target.value.replace(/\D/g, "")))} />
              </>
            )}

            {service === "exam" && (
              <div className="space-y-2.5">
                {EXAM_PINS.map((e) => (
                  <button key={e.id} onClick={() => setExamId(e.id)} className={`press w-full text-left p-3.5 rounded-xl border flex items-center justify-between ${examId === e.id ? "border-cyan bg-cyan/8" : "border-line bg-panel"}`}>
                    <div><p className="text-[13px] font-bold">{e.body} — {e.item}</p></div>
                    <p className="font-display font-bold text-cyan tnum">{money0(e.price)}</p>
                  </button>
                ))}
              </div>
            )}

            {service === "betting" && (
              <>
                <div>
                  <span className="block text-[11px] font-bold tracking-widest text-mute uppercase mb-2">Platform</span>
                  <select className="st-input" value={betId} onChange={(e) => setBetId(e.target.value)}>
                    {BETTING_PLATFORMS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <Field label="Betting account ID" inputMode="numeric" placeholder="44192837" value={betAccount} onChange={(e) => setBetAccount(e.target.value.replace(/\D/g, ""))} />
                <div className="grid grid-cols-4 gap-2">
                  {[500, 1000, 2000, 5000, 10000, 20000].map((v) => (
                    <button key={v} onClick={() => setAmount(v)} className={`press py-2.5 rounded-xl border text-xs font-bold tnum ${amount === v ? "bg-cyan text-cyanink border-cyan" : "bg-panel border-line text-sub"}`}>{v >= 1000 ? `${v / 1000}k` : v}</button>
                  ))}
                </div>
                <Field label="Custom amount (₦)" inputMode="numeric" value={String(amount)} onChange={(e) => setAmount(Number(e.target.value.replace(/\D/g, "")))} />
              </>
            )}

            {service === "sms" && (
              <>
                <Field label="Message" placeholder="Town union meeting Saturday 4pm." value={smsMsg} onChange={(e) => setSmsMsg(e.target.value)} />
                <Field label="Number of recipients" inputMode="numeric" value={String(smsUnits)} onChange={(e) => setSmsUnits(Number(e.target.value.replace(/\D/g, "")))} hint="₦4 per SMS unit" />
              </>
            )}

            {service === "gift" && (
              <Field label="Amount (₦)" inputMode="numeric" value={String(amount)} onChange={(e) => setAmount(Number(e.target.value.replace(/\D/g, "")))} />
            )}

            {err && <p className="text-xs text-bad font-semibold bg-bad/10 border border-bad/30 rounded-lg px-3 py-2.5">{err}</p>}
            <SBtn className="w-full" disabled={!valid} onClick={() => { setErr(null); setStage("confirm"); }}>Review purchase <IChevR size={15} /></SBtn>
          </div>
        )}

        {stage === "confirm" && (
          <div className="space-y-3 a-rise">
            <div className="card p-5 space-y-3">
              <p className="text-[10px] font-bold tracking-widest text-mute">CONFIRM PURCHASE</p>
              <p className="font-display font-bold text-[16px]">{payload.title}</p>
              <div className="space-y-2 text-[12.5px]">
                <div className="flex justify-between"><span className="text-sub">Amount</span><span className="font-semibold tnum">{money0(payload.amount)}</span></div>
                <div className="flex justify-between"><span className="text-sub">Service fee</span><span className="font-semibold tnum">{money0(fee)}</span></div>
                {cb > 0 && <div className="flex justify-between text-vio"><span>Cashback you'll earn</span><span className="font-semibold tnum">+{money0(cb)}</span></div>}
                <div className="flex justify-between border-t border-line pt-2 font-bold"><span>Total</span><span className="font-display text-cyan tnum">{money0(total)}</span></div>
              </div>
              {total > b.available && <p className="text-[11px] text-bad font-semibold bg-bad/10 border border-bad/25 rounded-lg px-3 py-2">Insufficient balance — you need {money0(total - b.available)} more.</p>}
            </div>
            <SBtn className="w-full" disabled={total > b.available} onClick={() => { setPinErr(null); setPinOpen(true); }}>Pay {money0(total)} with PIN</SBtn>
            <button className="text-xs text-mute font-semibold mx-auto block press" onClick={() => setStage("form")}>← Back</button>
          </div>
        )}
      </div>

      <PinPad open={pinOpen} onClose={() => setPinOpen(false)} onSubmit={pay} error={pinErr}
        title="Authorize purchase" subtitle={`${payload.title} • ${money0(total)}`} showBio={store.profile?.biometric} />
    </div>
  );
}
