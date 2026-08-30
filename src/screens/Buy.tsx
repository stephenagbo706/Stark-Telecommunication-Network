import { useMemo, useState } from "react";
import { useStark, useBalances, money, money0, fmtDate, fmtTime, type Tx, type TxMeta, type Service } from "../lib/store";
import { Field, PinPad, QRBox, SBtn, ScreenHeader, Seg, StatusBadge, useNav } from "../components/ui";
import { AIRTIME_PRESETS, BETTING_PLATFORMS, CABLE_PROVIDERS, DATA_PLANS, DISCOS, EXAM_PINS, FEES, CASHBACK_RATE, NETWORKS, type NetworkId } from "../lib/data";
import { ICheck, IChevR, ICopy, IDownload, IMeter, IRefresh, IX, IcoSignal, StarkMark, IInfo, IGift, ISms, ITicket, ITarget, IData, ITv } from "../components/icons";

type Step = "form" | "confirm" | "processing" | "done";
interface Payload { title: string; amount: number; meta: TxMeta }

const HEAD: Record<string, { label: string; sub: string; icon: (p: { size?: number }) => React.ReactNode }> = {
  airtime: { label: "Buy Airtime", sub: "MTN • Airtel • Glo • 9mobile", icon: (p) => <IcoSignal {...p} /> },
  data: { label: "Buy Data", sub: "Live plans from provider engine", icon: (p) => <IData {...p} /> },
  cable: { label: "Cable TV", sub: "DSTV • GOtv • StarTimes", icon: (p) => <ITv {...p} /> },
  electricity: { label: "Electricity", sub: "All major Nigerian DisCos", icon: (p) => <IMeter {...p} /> },
  exam: { label: "Exam Pins", sub: "WAEC • NECO • NABTEB", icon: (p) => <ITicket {...p} /> },
  betting: { label: "Betting Top-up", sub: "Instant wallet funding", icon: (p) => <ITarget {...p} /> },
  sms: { label: "Bulk SMS", sub: "₦4 per unit • DND filtering", icon: (p) => <ISms {...p} /> },
  gift: { label: "Send a Gift", sub: "Airtime or data with a note", icon: (p) => <IGift {...p} /> },
};

export default function Buy({ service }: { service: Service }) {
  const nav = useNav();
  const { purchase, toast, profile, beneficiaries } = useStark();
  const b = useBalances();
  const [step, setStep] = useState<Step>("form");
  const [payload, setPayload] = useState<Payload | null>(null);
  const [pinOpen, setPinOpen] = useState(false);
  const [pinErr, setPinErr] = useState<string | null>(null);
  const [procStep, setProcStep] = useState(0);
  const [tx, setTx] = useState<Tx | null>(null);

  const fee = FEES[service] ?? 0;

  const startConfirm = (p: Payload) => {
    if (p.amount + fee > b.available) { toast(`Insufficient balance — you need ${money0(p.amount + fee)}, you have ${money0(b.available)}.`, "bad"); return; }
    if (profile?.frozen) { toast("Account frozen — unfreeze from Security Centre.", "bad"); return; }
    setPayload(p); setStep("confirm");
  };

  const authorize = (pin: string) => {
    if (!payload) return;
    if (pin !== profile?.pin) { setPinErr("Incorrect PIN. Try again."); return; }
    setPinErr(null); setPinOpen(false); setStep("processing"); setProcStep(0);
    const t1 = setTimeout(() => setProcStep(1), 800);
    const t2 = setTimeout(() => setProcStep(2), 1700);
    (async () => {
      try {
        const result = await purchase({ service, title: payload.title, amount: payload.amount, meta: payload.meta });
        clearTimeout(t1); clearTimeout(t2);
        setProcStep(3);
        setTimeout(() => { setTx(result); setStep("done"); }, 500);
      } catch (e) {
        clearTimeout(t1); clearTimeout(t2);
        toast((e as Error).message, "bad");
        setStep("form");
      }
    })();
  };

  const h = HEAD[service];
  const relevantBens = beneficiaries.filter((x) => (service === "gift" ? ["airtime", "data"].includes(x.service) : x.service === service)).slice(0, 6);

  return (
    <div className="h-full flex flex-col">
      <ScreenHeader title={h.label} sub={h.sub} onBack={step === "form" ? nav.pop : step === "done" ? nav.pop : undefined}
        right={<span className="text-[10px] font-bold text-mute tnum bg-well border border-line px-2 py-1 rounded-lg">{money0(b.available)} avail.</span>} />
      <div className="flex-1 overflow-y-auto no-scrollbar px-5 pb-32">
        {step === "form" && (
          <ServiceForm service={service} bens={relevantBens.map((x) => ({ label: x.label, value: x.value, network: x.network }))} onSubmit={startConfirm} />
        )}
        {step === "confirm" && payload && <ConfirmCard payload={payload} fee={fee} service={service} onEdit={() => setStep("form")} onPay={() => { setPinErr(null); setPinOpen(true); }} />}
        {step === "processing" && <Processing step={procStep} payload={payload!} />}
        {step === "done" && tx && <Result tx={tx} onAgain={() => { setTx(null); setPayload(null); setStep("form"); }} onDone={nav.pop} />}
      </div>

      <PinPad open={pinOpen} onClose={() => setPinOpen(false)} onSubmit={authorize} error={pinErr}
        title="Authorize purchase" subtitle={payload ? `${payload.title} — ${money0(payload.amount + fee)}` : undefined} showBio={profile?.biometric} />
    </div>
  );
}

/* ================= forms ================= */
function ServiceForm({ service, bens, onSubmit }: { service: Service; bens: { label: string; value: string; network?: string }[]; onSubmit: (p: Payload) => void }) {
  const [network, setNetwork] = useState<NetworkId>("MTN");
  const [phone, setPhone] = useState("");
  const [amount, setAmount] = useState<number>(0);
  const [custom, setCustom] = useState("");
  const [planId, setPlanId] = useState("");
  const [cableId, setCableId] = useState("GOTV");
  const [iuc, setIuc] = useState("");
  const [customer, setCustomer] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  const [disco, setDisco] = useState("IKEDC");
  const [meter, setMeter] = useState("");
  const [meterType, setMeterType] = useState("Prepaid");
  const [examId, setExamId] = useState("waec");
  const [qty, setQty] = useState(1);
  const [platform, setPlatform] = useState("Bet9ja");
  const [betId, setBetId] = useState("");
  const [senderId, setSenderId] = useState("STARKNG");
  const [msg, setMsg] = useState("");
  const [recips, setRecips] = useState("");
  const [giftType, setGiftType] = useState<"airtime" | "data">("airtime");
  const [giftMsg, setGiftMsg] = useState("");
  const [err, setErr] = useState("");

  const cleanPhone = phone.replace(/\D/g, "");
  const amt = amount || Number(custom) || 0;
  const plans = DATA_PLANS[network];
  const cable = CABLE_PROVIDERS.find((c) => c.id === cableId)!;
  const exam = EXAM_PINS.find((e) => e.id === examId)!;
  const recipList = recips.split(/[,\n]/).map((r) => r.trim()).filter((r) => r.replace(/\D/g, "").length >= 10);
  const parts = Math.max(1, Math.ceil(msg.length / 160));
  const units = recipList.length * parts;
  const smsPrice = units * 4;
  const giftPlans = DATA_PLANS[network].slice(0, 4);

  const validateIuc = () => {
    if (iuc.replace(/\D/g, "").length < 9) { setErr("Enter a valid smartcard / IUC number."); return; }
    setErr(""); setValidating(true); setCustomer(null);
    setTimeout(() => {
      const names = ["CHIDERA EZE", "TUNDE BALOGUN", "AMINA BELLO", "EMEKA OBI", "SEUN ADEYEMI"];
      setCustomer(names[iuc.replace(/\D/g, "").length % names.length]);
      setValidating(false);
    }, 900);
  };
  const validateMeter = () => {
    if (meter.replace(/\D/g, "").length < 10) { setErr("Enter a valid 10–13 digit meter number."); return; }
    setErr(""); setValidating(true); setCustomer(null);
    setTimeout(() => { setCustomer("ADAEZE OKAFOR"); setValidating(false); }, 900);
  };

  const submit = () => {
    setErr("");
    const needPhone = () => { if (cleanPhone.length < 10) { setErr("Enter a valid 10-digit phone number."); return false; } return true; };
    switch (service) {
      case "airtime": {
        if (!needPhone()) return;
        if (amt < 50) { setErr("Minimum airtime purchase is ₦50."); return; }
        if (amt > 50000) { setErr("Maximum airtime purchase is ₦50,000."); return; }
        onSubmit({ title: `${networkName(network)} Airtime • ${fmtPhone(cleanPhone)}`, amount: amt, meta: { network, phone: fmtPhone(cleanPhone) } });
        return;
      }
      case "data": {
        if (!needPhone()) return;
        const plan = plans.find((p) => p.id === planId);
        if (!plan) { setErr("Choose a data bundle."); return; }
        onSubmit({ title: `${networkName(network)} ${plan.size} • ${fmtPhone(cleanPhone)}`, amount: plan.price, meta: { network, phone: fmtPhone(cleanPhone), plan: plan.size, size: plan.size } });
        return;
      }
      case "cable": {
        if (!customer) { setErr("Validate the smartcard first."); return; }
        const pkg = cable.packages.find((p) => p.id === planId);
        if (!pkg) { setErr("Choose a package."); return; }
        onSubmit({ title: `${pkg.name} • ${iuc}`, amount: pkg.price, meta: { providerName: cable.name, iuc, customer: customer!, plan: pkg.name } });
        return;
      }
      case "electricity": {
        if (!customer) { setErr("Validate the meter number first."); return; }
        if (amt < 1000) { setErr("Minimum electricity purchase is ₦1,000."); return; }
        onSubmit({ title: `${disco} ${meterType} • ${meter}`, amount: amt, meta: { disco, meter, meterType, customer: customer! } });
        return;
      }
      case "exam": {
        onSubmit({ title: `${exam.body} ${exam.item.split(" ")[0]} ×${qty}`, amount: exam.price * qty, meta: { examBody: exam.body, item: exam.item, qty } });
        return;
      }
      case "betting": {
        if (betId.replace(/\D/g, "").length < 6) { setErr("Enter your betting user ID."); return; }
        if (amt < 100) { setErr("Minimum top-up is ₦100."); return; }
        onSubmit({ title: `${platform} top-up • ${betId}`, amount: amt, meta: { platform, betId } });
        return;
      }
      case "sms": {
        if (!/^[A-Za-z0-9 ]{2,11}$/.test(senderId.trim())) { setErr("Sender ID must be 2–11 letters/numbers."); return; }
        if (msg.trim().length < 2) { setErr("Type your SMS message."); return; }
        if (recipList.length === 0) { setErr("Add at least one valid recipient number."); return; }
        onSubmit({ title: `Bulk SMS • ${recipList.length} recipient${recipList.length > 1 ? "s" : ""}`, amount: smsPrice, meta: { senderId: senderId.trim().toUpperCase(), message: msg.trim(), recipients: recipList, units } });
        return;
      }
      case "gift": {
        if (!needPhone()) return;
        if (giftType === "airtime") {
          if (amt < 50) { setErr("Minimum gift amount is ₦50."); return; }
          onSubmit({ title: `Gift — ${networkName(network)} airtime to ${fmtPhone(cleanPhone)}`, amount: amt, meta: { network, phone: fmtPhone(cleanPhone), giftType: "airtime", message: giftMsg } });
        } else {
          const gp = giftPlans.find((p) => p.id === planId);
          if (!gp) { setErr("Choose a data bundle to gift."); return; }
          onSubmit({ title: `Gift — ${networkName(network)} ${gp.size} to ${fmtPhone(cleanPhone)}`, amount: gp.price, meta: { network, phone: fmtPhone(cleanPhone), giftType: "data", plan: gp.size, message: giftMsg } });
        }
        return;
      }
    }
  };

  const PhoneField = (
    <>
      <BeneficiaryChips bens={bens} onPick={(v, n) => { setPhone(v); if (n) setNetwork(n as NetworkId); }} />
      <Field label="Phone number" inputMode="tel" placeholder="0803 000 0000" value={phone} onChange={(e) => setPhone(e.target.value)} />
    </>
  );
  const NetPicker = (
    <div>
      <span className="block text-[11px] font-bold tracking-widest text-mute uppercase mb-1.5">Network</span>
      <div className="grid grid-cols-4 gap-2">
        {NETWORKS.map((n) => (
          <button key={n.id} onClick={() => { setNetwork(n.id); setPlanId(""); }} className={`press py-2.5 rounded-xl border text-xs font-bold transition-all ${network === n.id ? "border-cyan bg-cyan/10 text-ink" : "border-line bg-panel text-sub hover:border-cyan/30"}`}>
            <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: n.color }} />{n.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
  const AmtPicker = (
    <div>
      <span className="block text-[11px] font-bold tracking-widest text-mute uppercase mb-1.5">Amount</span>
      <div className="grid grid-cols-3 gap-2">
        {AIRTIME_PRESETS.map((v) => (
          <button key={v} onClick={() => { setAmount(v); setCustom(""); }} className={`press py-2.5 rounded-xl border text-xs font-bold tnum ${amt === v && !custom ? "bg-cyan text-cyanink border-cyan" : "bg-panel border-line text-sub hover:border-cyan/30"}`}>{money0(v)}</button>
        ))}
      </div>
      <input className="st-input mt-2 font-display font-bold tnum" inputMode="numeric" placeholder="Or enter custom amount" value={custom} onChange={(e) => { setCustom(e.target.value.replace(/\D/g, "")); setAmount(0); }} />
    </div>
  );

  return (
    <div className="space-y-4 a-rise">
      {service === "airtime" && (<>{NetPicker}{PhoneField}{AmtPicker}</>)}
      {service === "data" && (
        <>
          {NetPicker}{PhoneField}
          <div>
            <span className="block text-[11px] font-bold tracking-widest text-mute uppercase mb-1.5">Bundle • fetched live</span>
            <div className="space-y-2">
              {plans.map((p) => (
                <button key={p.id} onClick={() => setPlanId(p.id)} className={`press w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-all ${planId === p.id ? "border-cyan bg-cyan/8" : "border-line bg-panel hover:border-cyan/30"}`}>
                  <span className={`w-4 h-4 rounded-full border-2 grid place-items-center ${planId === p.id ? "border-cyan" : "border-line"}`}>{planId === p.id && <span className="w-2 h-2 rounded-full bg-cyan" />}</span>
                  <span className="flex-1">
                    <span className="block text-[13px] font-bold font-display">{p.size}</span>
                    <span className="block text-[10px] text-mute font-semibold">{p.validity} validity</span>
                  </span>
                  {p.tag && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-vio/15 text-vio border border-vio/30">{p.tag}</span>}
                  <span className="font-display font-bold text-[13px] tnum">{money0(p.price)}</span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
      {service === "cable" && (
        <>
          <div>
            <span className="block text-[11px] font-bold tracking-widest text-mute uppercase mb-1.5">Provider</span>
            <div className="grid grid-cols-3 gap-2">
              {CABLE_PROVIDERS.map((c) => (
                <button key={c.id} onClick={() => { setCableId(c.id); setPlanId(""); setCustomer(null); }} className={`press py-2.5 rounded-xl border text-xs font-bold ${cableId === c.id ? "border-cyan bg-cyan/10" : "border-line bg-panel text-sub"}`}>
                  <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: c.color }} />{c.name}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-2 items-end">
            <div className="flex-1"><Field label={cable.field} inputMode="numeric" placeholder="5093117722" value={iuc} onChange={(e) => { setIuc(e.target.value); setCustomer(null); }} /></div>
            <SBtn small variant="ghost" className="mb-0.5" loading={validating} onClick={validateIuc}>Validate</SBtn>
          </div>
          {customer && (
            <div className="a-pop flex items-center gap-2 text-xs font-semibold text-ok bg-ok/10 border border-ok/25 rounded-xl px-3 py-2.5">
              <ICheck size={14} /> Verified customer: {customer}
            </div>
          )}
          <div className="space-y-2">
            {cable.packages.map((p) => (
              <button key={p.id} onClick={() => setPlanId(p.id)} className={`press w-full flex items-center justify-between px-4 py-3 rounded-xl border text-left ${planId === p.id ? "border-cyan bg-cyan/8" : "border-line bg-panel hover:border-cyan/30"}`}>
                <span className="text-[13px] font-bold font-display">{p.name}</span>
                <span className="font-display font-bold text-[13px] tnum">{money0(p.price)}</span>
              </button>
            ))}
          </div>
        </>
      )}
      {service === "electricity" && (
        <>
          <div>
            <span className="block text-[11px] font-bold tracking-widest text-mute uppercase mb-1.5">DisCo</span>
            <select className="st-input" value={disco} onChange={(e) => { setDisco(e.target.value); setCustomer(null); }}>
              {DISCOS.map((d) => <option key={d.id} value={d.id}>{d.name} — {d.region}</option>)}
            </select>
          </div>
          <div>
            <span className="block text-[11px] font-bold tracking-widest text-mute uppercase mb-1.5">Meter type</span>
            <Seg options={["Prepaid", "Postpaid"]} value={meterType} onChange={setMeterType} />
          </div>
          <div className="flex gap-2 items-end">
            <div className="flex-1"><Field label="Meter number" inputMode="numeric" placeholder="45030122876" value={meter} onChange={(e) => { setMeter(e.target.value.replace(/\D/g, "")); setCustomer(null); }} /></div>
            <SBtn small variant="ghost" className="mb-0.5" loading={validating} onClick={validateMeter}>Validate</SBtn>
          </div>
          {customer && (
            <div className="a-pop flex items-center gap-2 text-xs font-semibold text-ok bg-ok/10 border border-ok/25 rounded-xl px-3 py-2.5">
              <ICheck size={14} /> Meter belongs to: {customer}
            </div>
          )}
          {AmtPicker}
        </>
      )}
      {service === "exam" && (
        <>
          <div className="space-y-2">
            {EXAM_PINS.map((e) => (
              <button key={e.id} onClick={() => setExamId(e.id)} className={`press w-full flex items-center gap-3 px-4 py-3.5 rounded-xl border text-left ${examId === e.id ? "border-cyan bg-cyan/8" : "border-line bg-panel hover:border-cyan/30"}`}>
                <span className="w-10 h-10 rounded-xl bg-ok/12 text-ok grid place-items-center border border-ok/25 font-display font-bold text-[11px]">{e.body.slice(0, 2)}</span>
                <span className="flex-1">
                  <span className="block text-[13px] font-bold font-display">{e.body}</span>
                  <span className="block text-[10px] text-mute font-semibold">{e.item}</span>
                </span>
                <span className="font-display font-bold tnum">{money0(e.price)}</span>
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between card px-4 py-3">
            <span className="text-xs font-bold text-sub">Quantity</span>
            <div className="flex items-center gap-3">
              <button className="press w-9 h-9 rounded-xl bg-well border border-line font-bold" onClick={() => setQty(Math.max(1, qty - 1))}>−</button>
              <span className="font-display font-bold text-lg tnum w-6 text-center">{qty}</span>
              <button className="press w-9 h-9 rounded-xl bg-well border border-line font-bold" onClick={() => setQty(Math.min(10, qty + 1))}>+</button>
            </div>
          </div>
        </>
      )}
      {service === "betting" && (
        <>
          <div>
            <span className="block text-[11px] font-bold tracking-widest text-mute uppercase mb-1.5">Platform</span>
            <div className="grid grid-cols-3 gap-2">
              {BETTING_PLATFORMS.map((p) => (
                <button key={p.id} onClick={() => setPlatform(p.name)} className={`press py-2.5 rounded-xl border text-xs font-bold ${platform === p.name ? "border-cyan bg-cyan/10" : "border-line bg-panel text-sub"}`}>
                  <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: p.color }} />{p.name}</span>
                </button>
              ))}
            </div>
          </div>
          <Field label="Betting user ID" inputMode="numeric" placeholder="44192837" value={betId} onChange={(e) => setBetId(e.target.value)} />
          {AmtPicker}
        </>
      )}
      {service === "sms" && (
        <>
          <Field label="Sender ID" placeholder="STARKNG" maxLength={11} value={senderId} onChange={(e) => setSenderId(e.target.value)} />
          <div>
            <span className="block text-[11px] font-bold tracking-widest text-mute uppercase mb-1.5">Message</span>
            <textarea className="st-input min-h-[90px] resize-none" placeholder="Type your broadcast message…" value={msg} onChange={(e) => setMsg(e.target.value)} />
            <span className="text-[10px] text-mute font-semibold">{msg.length} chars • {parts} page{parts > 1 ? "s" : ""} per recipient</span>
          </div>
          <div>
            <span className="block text-[11px] font-bold tracking-widest text-mute uppercase mb-1.5">Recipients (comma separated)</span>
            <textarea className="st-input min-h-[70px] resize-none font-mono text-xs" placeholder="08031234567, 08123456789…" value={recips} onChange={(e) => setRecips(e.target.value)} />
            <span className="text-[10px] text-mute font-semibold">{recipList.length} valid number{recipList.length === 1 ? "" : "s"} detected</span>
          </div>
          {units > 0 && (
            <div className="card px-4 py-3 flex justify-between items-center">
              <span className="text-xs font-semibold text-sub">{units} unit{units > 1 ? "s" : ""} × ₦4</span>
              <span className="font-display font-bold tnum">{money0(smsPrice)}</span>
            </div>
          )}
        </>
      )}
      {service === "gift" && (
        <>
          <Seg options={["Airtime", "Data"]} value={giftType === "airtime" ? "Airtime" : "Data"} onChange={(v) => { setGiftType(v === "Airtime" ? "airtime" : "data"); setPlanId(""); }} />
          {NetPicker}{PhoneField}
          {giftType === "airtime" ? AmtPicker : (
            <div className="grid grid-cols-2 gap-2">
              {giftPlans.map((p) => (
                <button key={p.id} onClick={() => setPlanId(p.id)} className={`press px-4 py-3 rounded-xl border text-left ${planId === p.id ? "border-cyan bg-cyan/8" : "border-line bg-panel hover:border-cyan/30"}`}>
                  <span className="block text-[13px] font-bold font-display">{p.size}</span>
                  <span className="block text-[10px] text-mute font-semibold">{money0(p.price)} • {p.validity}</span>
                </button>
              ))}
            </div>
          )}
          <Field label="Gift note (optional)" placeholder="For the exams. — Ada" value={giftMsg} onChange={(e) => setGiftMsg(e.target.value)} />
        </>
      )}

      {err && <p className="a-pop text-xs text-bad font-semibold bg-bad/10 border border-bad/30 rounded-lg px-3 py-2.5">{err}</p>}
      <div className="pt-1">
        <SBtn className="w-full" onClick={submit}>Review purchase <IChevR size={16} /></SBtn>
      </div>
    </div>
  );
}

function BeneficiaryChips({ bens, onPick }: { bens: { label: string; value: string; network?: string }[]; onPick: (v: string, n?: string) => void }) {
  if (bens.length === 0) return null;
  return (
    <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1">
      {bens.map((b2, i) => (
        <button key={i} onClick={() => onPick(b2.value, b2.network)} className="press shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-panel border border-line text-[11px] font-semibold text-sub hover:border-cyan/50 hover:text-ink">
          <span className="w-1.5 h-1.5 rounded-full bg-cyan" /> {b2.label}
        </button>
      ))}
    </div>
  );
}

/* ================= confirm ================= */
function ConfirmCard({ payload, fee, service, onEdit, onPay }: { payload: Payload; fee: number; service: Service; onEdit: () => void; onPay: () => void }) {
  const rows: [string, string][] = Object.entries(payload.meta)
    .filter(([k, v]) => v && !["pins", "recipients", "token"].includes(k) && typeof v === "string")
    .map(([k, v]) => [k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()), String(v)]);
  const cb = Math.round(payload.amount * (CASHBACK_RATE[service] ?? 0) * 100) / 100;
  return (
    <div className="a-pop card overflow-hidden">
      <div className="px-5 py-4 border-b border-line bg-raised/60 flex items-center justify-between">
        <div>
          <p className="text-[10px] font-bold tracking-widest text-mute">CONFIRM PURCHASE</p>
          <p className="font-display font-bold text-[15px] mt-0.5">{payload.title}</p>
        </div>
        <button onClick={onEdit} className="press text-[11px] font-bold text-cyan px-3 py-1.5 rounded-lg border border-cyan/30 hover:bg-cyan/10">Edit</button>
      </div>
      <div className="px-5 py-4 space-y-2.5">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 text-[12px]">
            <span className="text-mute font-semibold">{k}</span>
            <span className="font-semibold text-right truncate">{v}</span>
          </div>
        ))}
        <div className="border-t border-dashed border-line my-2" />
        <div className="flex justify-between text-[12px]"><span className="text-mute font-semibold">Amount</span><span className="font-bold tnum">{money(payload.amount)}</span></div>
        <div className="flex justify-between text-[12px]"><span className="text-mute font-semibold">Service fee</span><span className="font-bold tnum">{fee ? money(fee) : "Free"}</span></div>
        <div className="flex justify-between items-center">
          <span className="text-[13px] font-bold">Total</span>
          <span className="font-display font-bold text-xl tnum text-cyan">{money(payload.amount + fee)}</span>
        </div>
        {cb >= 1 && (
          <div className="flex justify-between text-[11px] font-bold text-vio bg-vio/8 border border-vio/25 rounded-lg px-3 py-2">
            <span>Cashback you'll earn</span><span className="tnum">+{money(cb)}</span>
          </div>
        )}
        <p className="text-[10px] text-mute flex items-start gap-1.5 pt-1 leading-relaxed">
          <IInfo size={12} className="shrink-0 mt-0.5 text-cyan" />
          Funds are reserved, not charged. If the provider fails, the full amount reverses to your wallet automatically.
        </p>
      </div>
      <div className="px-5 pb-5">
        <SBtn className="w-full" onClick={onPay}>Pay {money0(payload.amount + fee)} with PIN</SBtn>
      </div>
    </div>
  );
}

/* ================= processing ================= */
function Processing({ step, payload }: { step: number; payload: Payload }) {
  const steps = ["Reserving funds in ledger", "Contacting provider", "Confirming delivery", "Finalizing"];
  return (
    <div className="a-fade flex flex-col items-center pt-10">
      <div className="relative w-24 h-24 mb-6">
        <span className="absolute inset-0 rounded-full border border-cyan/30" style={{ animation: "kf-ring 1.6s ease-out infinite" }} />
        <span className="absolute inset-0 rounded-full border border-cyan/20" style={{ animation: "kf-ring 1.6s 0.5s ease-out infinite" }} />
        <div className="absolute inset-0 rounded-full border-2 border-line border-t-cyan animate-spin" style={{ animationDuration: "1s" }} />
        <div className="absolute inset-3 rounded-full bg-cyan/10 grid place-items-center text-cyan"><StarkMark size={36} /></div>
      </div>
      <h3 className="font-display font-bold text-lg">{payload.title}</h3>
      <p className="font-display font-bold text-2xl text-cyan tnum mt-1">{money0(payload.amount)}</p>
      <div className="w-full max-w-[280px] mt-8 space-y-3">
        {steps.map((s, i) => (
          <div key={s} className={`flex items-center gap-3 transition-all duration-300 ${i <= step ? "opacity-100" : "opacity-35"}`}>
            <span className={`w-6 h-6 rounded-full grid place-items-center border ${i < step ? "bg-ok border-ok text-white" : i === step ? "border-cyan text-cyan" : "border-line text-mute"}`}>
              {i < step ? <ICheck size={12} sw={2.6} /> : i === step ? <span className="w-2 h-2 rounded-full bg-cyan a-blink" /> : <span className="w-1.5 h-1.5 rounded-full bg-line" />}
            </span>
            <span className={`text-xs font-semibold ${i === step ? "text-ink" : "text-sub"}`}>{s}{i === step && "…"}</span>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-mute mt-8 text-center leading-relaxed max-w-[260px]">
        Do not close the app. If the provider response is uncertain we'll mark this PROCESSING and reconcile — never a silent charge.
      </p>
    </div>
  );
}

/* ================= result / receipt ================= */
function Result({ tx, onAgain, onDone }: { tx: Tx; onAgain: () => void; onDone: () => void }) {
  const ok = tx.status === "SUCCESSFUL";
  const { toast } = useStark();
  const copy = (v: string, label: string) => { navigator.clipboard?.writeText(v); toast(`${label} copied`, "ok"); };
  const download = () => {
    const lines = [
      "STARK TELECOMMUNICATION — RECEIPT",
      "=================================",
      `Status:            ${tx.status}`,
      `Service:           ${tx.title}`,
      `Amount:            ${money(tx.amount)}`,
      `Fee:               ${money(tx.fee)}`,
      `Total:             ${money(tx.total)}`,
      `Date:              ${fmtDate(tx.createdAt)} ${fmtTime(tx.createdAt)}`,
      `Stark reference:   ${tx.ref}`,
      `Provider ref:      ${tx.providerRef ?? "—"}`,
      tx.meta.token ? `Power token:       ${tx.meta.token}` : "",
      ...(tx.meta.pins ?? []).map((p, i) => `Pin ${i + 1}:             ${p.pin} (Serial ${p.serial})`),
      "=================================",
      "Verify at stark.app/verify",
    ].filter(Boolean).join("\n");
    const blob = new Blob([lines], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${tx.ref}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast("Receipt downloaded", "ok");
  };

  return (
    <div className="a-rise">
      <div className="flex flex-col items-center pt-4 pb-5">
        <div className="relative w-20 h-20 mb-4">
          <svg viewBox="0 0 80 80" className="w-full h-full -rotate-90">
            <circle cx="40" cy="40" r="36" fill="none" stroke={ok ? "var(--st-ok)" : "var(--st-bad)"} strokeWidth="3" className="draw-ring" opacity="0.9" />
          </svg>
          <div className={`absolute inset-0 grid place-items-center ${ok ? "text-ok" : "text-bad"}`}>
            {ok ? <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path className="draw-check" d="m4.5 12.5 5 5 10-11" /></svg> : <IX size={32} sw={2.4} />}
          </div>
        </div>
        <h2 className="font-display font-bold text-xl">{ok ? "Transaction successful" : "Transaction failed"}</h2>
        <p className="font-display font-bold text-[26px] tnum mt-1">{money(tx.total)}</p>
        <div className="mt-2"><StatusBadge status={tx.status} /></div>
        {!ok && (
          <p className="text-xs text-sub mt-3 text-center leading-relaxed max-w-[280px] bg-bad/8 border border-bad/25 rounded-xl px-4 py-3">
            {tx.failReason}<br /><span className="text-ok font-semibold">The reserved {money(tx.amount)} was returned to your wallet.</span>
          </p>
        )}
      </div>

      {ok && (
        <div className="card overflow-hidden">
          <div className="px-5 py-4 bg-raised/60 border-b border-line flex items-center gap-3">
            <span className="text-cyan"><StarkMark size={30} /></span>
            <div className="flex-1">
              <p className="font-display font-bold text-sm">STARK RECEIPT</p>
              <p className="text-[9px] text-mute font-bold tracking-widest">VERIFIABLE • {tx.ref}</p>
            </div>
            <QRBox seed={tx.ref} size={56} />
          </div>
          <div className="px-5 py-4 space-y-2.5 text-[12px]">
            <Row k="Service" v={tx.title} />
            {tx.meta.network && <Row k="Network" v={tx.meta.network} />}
            {(tx.meta.phone || tx.meta.iuc || tx.meta.meter || tx.meta.betId) && <Row k="Account" v={tx.meta.phone ?? tx.meta.iuc ?? tx.meta.meter ?? tx.meta.betId ?? ""} />}
            {tx.meta.customer && <Row k="Customer" v={tx.meta.customer} />}
            {tx.meta.size && <Row k="Bundle" v={tx.meta.size} />}
            {tx.meta.plan && tx.meta.providerName && <Row k="Package" v={tx.meta.plan} />}
            {tx.meta.disco && <Row k="DisCo" v={tx.meta.disco} />}
            {tx.meta.platform && <Row k="Platform" v={tx.meta.platform} />}
            {tx.meta.units && <Row k="Units" v={String(tx.meta.units)} />}
            {tx.meta.message && <Row k="Note" v={tx.meta.message} />}
            <div className="border-t border-dashed border-line my-1" />
            <Row k="Amount" v={money(tx.amount)} />
            <Row k="Fee" v={tx.fee ? money(tx.fee) : "Free"} />
            <div className="flex justify-between"><span className="font-bold">Total</span><span className="font-display font-bold text-cyan tnum">{money(tx.total)}</span></div>
            <div className="border-t border-dashed border-line my-1" />
            <Row k="Date" v={`${fmtDate(tx.completedAt ?? tx.createdAt)} • ${fmtTime(tx.completedAt ?? tx.createdAt)}`} />
            <div className="flex justify-between gap-3"><span className="text-mute font-semibold">Stark ref</span>
              <button className="press flex items-center gap-1 font-mono font-bold text-[11px] text-cyan" onClick={() => copy(tx.ref, "Reference")}>{tx.ref} <ICopy size={11} /></button>
            </div>
            {tx.providerRef && <Row k="Provider ref" v={tx.providerRef} mono />}
          </div>

          {tx.meta.token && (
            <div className="mx-5 mb-4 rounded-xl border border-warn/30 bg-warn/8 px-4 py-3.5 text-center">
              <p className="text-[9px] font-bold tracking-widest text-warn mb-1">ELECTRICITY TOKEN</p>
              <p className="font-display font-bold text-xl tracking-wider tnum">{tx.meta.token}</p>
              <button className="press mt-2 text-[10px] font-bold text-warn inline-flex items-center gap-1" onClick={() => copy(tx.meta.token!, "Token")}><ICopy size={11} /> Copy token</button>
            </div>
          )}
          {tx.meta.pins && tx.meta.pins.length > 0 && (
            <div className="mx-5 mb-4 space-y-2">
              {tx.meta.pins.map((p, i) => (
                <div key={i} className="rounded-xl border border-ok/30 bg-ok/8 px-4 py-3 flex items-center justify-between gap-2">
                  <div>
                    <p className="text-[9px] font-bold tracking-widest text-ok">PIN {i + 1} • SERIAL {p.serial}</p>
                    <p className="font-display font-bold text-lg tracking-wider tnum">{p.pin}</p>
                  </div>
                  <button className="press text-ok" onClick={() => copy(p.pin, "PIN")}><ICopy size={16} /></button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex gap-2.5 mt-5">
        {ok ? (
          <>
            <SBtn variant="ghost" className="flex-1" onClick={download}><IDownload size={15} /> Receipt</SBtn>
            <SBtn variant="ghost" className="flex-1" onClick={() => copy(tx.ref, "Reference")}><ICopy size={15} /> Copy ref</SBtn>
          </>
        ) : (
          <SBtn variant="ghost" className="flex-1" onClick={onAgain}><IRefresh size={15} /> Try again</SBtn>
        )}
      </div>
      <SBtn className="w-full mt-2.5" onClick={ok ? onAgain : onDone}>{ok ? "Buy again" : "Back to safety"}</SBtn>
      <button className="press mx-auto block mt-3 text-xs font-bold text-mute hover:text-sub" onClick={onDone}>Done</button>
    </div>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-mute font-semibold">{k}</span>
      <span className={`font-semibold text-right truncate ${mono ? "font-mono text-[11px]" : ""}`}>{v}</span>
    </div>
  );
}

const networkName = (id: string) => NETWORKS.find((n) => n.id === id)?.name ?? id;
const fmtPhone = (d: string) => d.replace(/(\d{4})(\d{3})(\d{4})/, "$1 $2 $3");
