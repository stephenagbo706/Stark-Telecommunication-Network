import { useEffect, useRef, useState } from "react";
import { useStark, useBalances, money, money0, timeAgo, type Tx, type Service } from "../lib/store";
import { PinPad, SBtn, Spark } from "../components/ui";
import { AI_SUGGESTIONS, NETWORKS, type NetworkId } from "../lib/data";
import { IMic, ISend, ISpark, IStop, IShield, ICheck, IX, IWallet } from "../components/icons";

interface Msg { id: string; role: "user" | "ai"; text: string; ts: number; action?: PreparedAction; result?: { ok: boolean; text: string } }
interface PreparedAction { service: Service; title: string; amount: number; meta: Record<string, string>; network?: NetworkId; phone?: string }

export default function Ai() {
  const store = useStark();
  const b = useBalances();
  const [msgs, setMsgs] = useState<Msg[]>([
    { id: "m0", role: "ai", ts: Date.now(), text: `Hi ${store.profile?.name.split(" ")[0] ?? "there"} — I'm Stark. I can check your balance, analyse spending, or prepare purchases for you. Financial actions always need your PIN.` },
  ]);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const [pending, setPending] = useState<{ msgId: string; action: PreparedAction } | null>(null);
  const [pinOpen, setPinOpen] = useState(false);
  const [pinErr, setPinErr] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const recRef = useRef<{ stop: () => void } | null>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [msgs, typing]);

  const spendOn = (svc: Service) => store.txs.filter((t) => t.service === svc && t.status === "SUCCESSFUL" && Date.now() - t.createdAt < 30 * 86400000).reduce((a, t) => a + t.total, 0);

  const think = (raw: string): { text: string; action?: PreparedAction } => {
    const q = raw.toLowerCase();
    if (/\b(balance|wallet|how much (do i )?have|left)\b/.test(q)) {
      return { text: `Your available balance is ${money(b.available)}${b.reserved > 0.009 ? `, with ${money(b.reserved)} reserved in processing transactions` : ""}. Cashback balance: ${money(b.cashback)}.` };
    }
    if (/(recent|last|latest).*(transaction|purchase)|show my transaction|transaction history/.test(q)) {
      const recent = store.txs.slice(0, 3);
      if (recent.length === 0) return { text: "You don't have any transactions yet. Fund your wallet and I'll track everything here." };
      return { text: `Here are your last ${recent.length}:\n${recent.map((t: Tx, i: number) => `${i + 1}. ${t.title} — ${money0(t.total)} (${t.status.toLowerCase()}) ${timeAgo(t.createdAt)}`).join("\n")}` };
    }
    const svcMatch = /(airtime|data|cable|electricity|power|betting|sms|gift)/.exec(q);
    if (/(spent|spend|spending).*(on|for)/.test(q) && svcMatch) {
      const map: Record<string, Service> = { airtime: "airtime", data: "data", cable: "cable", electricity: "electricity", power: "electricity", betting: "betting", sms: "sms", gift: "gift" };
      const svc = map[svcMatch[1]];
      const amt = spendOn(svc);
      const count = store.txs.filter((t) => t.service === svc && t.status === "SUCCESSFUL" && Date.now() - t.createdAt < 30 * 86400000).length;
      return { text: `You've spent ${money(amt)} on ${svc === "electricity" ? "electricity" : svc} in the last 30 days across ${count} transaction${count === 1 ? "" : "s"}.` };
    }
    if (/biggest|largest|highest|most expensive/.test(q)) {
      const top = [...store.txs].filter((t) => t.status !== "FAILED").sort((x, y) => y.total - x.total)[0];
      return top ? { text: `Your biggest transaction is ${top.title} at ${money(top.total)} on ${new Date(top.createdAt).toLocaleDateString("en-NG", { day: "numeric", month: "short" })}. Reference ${top.ref}.` } : { text: "No completed transactions yet — your biggest purchase will show up here." };
    }
    if (/reward|point/.test(q)) {
      return { text: `You have ${store.points} STARK points (Silver tier). 100 points = ₦50 cashback. You earn 1 point per ₦100 spent. Redeem them from the Rewards tab.` };
    }
    const buyAir = /(?:buy|purchase|top ?up|recharge).*?₦?\s?(\d[\d,]*)\s*(k)?\s*(mtn|airtel|glo|9mobile)?.*?(airtime|credit)?/.exec(q) || /(?:buy|purchase|recharge).*?(mtn|airtel|glo|9mobile).*?₦?\s?(\d[\d,]*)/.exec(q);
    if ((/buy|purchase|recharge|top ?up/.test(q)) && /airtime|credit|mtn|airtel|glo|9mobile/.test(q)) {
      const nums = q.replace(/,/g, "").match(/\d+/g)?.map(Number).filter((n) => n >= 50) ?? [];
      const amount = nums.find((n) => n <= 500000) ?? (q.includes("k") ? (nums[0] ?? 1) * 1000 : nums[0]);
      const net = (/(mtn|airtel|glo|9mobile)/.exec(q)?.[1] ?? "mtn").toUpperCase() as NetworkId;
      const network: NetworkId = net === "AIRTEL" ? "AIRTEL" : net === "GLO" ? "GLO" : net === "9MOBILE" ? "9MOBILE" : "MTN";
      const phone = (q.replace(/\D/g, "").match(/0\d{10}/)?.[0]) ?? store.beneficiaries.find((x) => x.service === "airtime")?.value.replace(/\s/g, "") ?? "";
      if (!amount) return { text: "Tell me the amount — for example: “Buy ₦1,000 MTN airtime for 0803 123 4567”." };
      return {
        text: `I've prepared this purchase. Confirm and authorize with your PIN to proceed:`,
        action: { service: "airtime", title: `${NETWORKS.find((n) => n.id === network)?.name} Airtime • ${phone || "no number"}`, amount, meta: {}, network, phone },
      };
    }
    if (/freeze|security|safe/.test(q)) return { text: "You can freeze your account instantly from Profile → Security Centre. It blocks all purchases and wallet movement until you unfreeze it." };
    if (/help|what can you do|who are you/.test(q)) return { text: "I can:\n• Tell you your balance and cashback\n• Summarise recent transactions\n• Calculate spending per service\n• Find your biggest transaction\n• Prepare airtime purchases (you still authorize with PIN)\nTry one of the suggestions below." };
    return { text: "I didn't catch that. Try “What is my balance?”, “How much did I spend on data this month?” or “Buy ₦500 MTN airtime”." };
  };

  const send = (text?: string) => {
    const raw = (text ?? input).trim();
    if (!raw || typing) return;
    setInput("");
    const userMsg: Msg = { id: `u${Date.now()}`, role: "user", text: raw, ts: Date.now() };
    setMsgs((m) => [...m, userMsg]);
    setTyping(true);
    setTimeout(() => {
      const res = think(raw);
      const aiMsg: Msg = { id: `a${Date.now()}`, role: "ai", text: res.text, ts: Date.now(), action: res.action };
      setMsgs((m) => [...m, aiMsg]);
      setTyping(false);
      if (res.action) setPending({ msgId: aiMsg.id, action: res.action });
    }, 800 + Math.random() * 600);
  };

  const confirmAction = () => { setPinErr(null); setPinOpen(true); };
  const declineAction = () => {
    if (!pending) return;
    setMsgs((m) => [...m, { id: `a${Date.now()}`, role: "ai", text: "No problem — I've cancelled that. Nothing was charged.", ts: Date.now() }]);
    setMsgs((m) => m.map((x) => (x.id === pending.msgId ? { ...x, result: { ok: false, text: "Cancelled by user" } } : x)));
    setPending(null);
  };
  const authorize = async (pin: string) => {
    if (!pending) return;
    if (pin !== store.profile?.pin) { setPinErr("Incorrect PIN."); return; }
    setPinErr(null); setPinOpen(false);
    const { action, msgId } = pending;
    setPending(null);
    setMsgs((m) => [...m, { id: `a${Date.now()}`, role: "ai", text: "Authorized. Processing your purchase…", ts: Date.now() }]);
    try {
      const meta: Record<string, string> = { ...action.meta };
      if (action.network) meta.network = action.network;
      if (action.phone) meta.phone = action.phone;
      const tx = await store.purchase({ service: action.service, title: action.title, amount: action.amount, meta });
      const okRes = tx.status === "SUCCESSFUL";
      setMsgs((m) => [
        ...m.map((x) => (x.id === msgId ? { ...x, result: { ok: okRes, text: okRes ? `Completed • ${tx.ref}` : "Failed at provider — reversed" } } : x)),
        { id: `a${Date.now() + 1}`, role: "ai", ts: Date.now(), text: okRes ? `Done ✓ ${action.title} delivered. ${money(tx.total)} debited via the ledger. Reference ${tx.ref}.` : `The provider didn't confirm the purchase, so I reversed the ${money(tx.amount)} reservation back to your wallet. You can try again.` },
      ]);
    } catch (e) {
      setMsgs((m) => [...m, { id: `a${Date.now()}`, role: "ai", text: (e as Error).message, ts: Date.now() }]);
    }
  };

  const toggleVoice = () => {
    const SR = (window as unknown as Record<string, unknown>).SpeechRecognition || (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
    if (listening) { recRef.current?.stop(); setListening(false); return; }
    if (!SR) { store.toast("Voice input isn't supported in this browser", "bad"); return; }
    const rec = new (SR as new () => { lang: string; onresult: (e: { results: { [i: number]: { [j: number]: { transcript: string } } } }) => void; onend: () => void; start: () => void; stop: () => void })();
    rec.lang = "en-NG";
    rec.onresult = (e) => { const t = e.results[0][0].transcript; setInput(t); };
    rec.onend = () => setListening(false);
    recRef.current = rec;
    setListening(true);
    rec.start();
  };

  const weekData = (() => {
    const arr = Array(7).fill(0);
    store.txs.filter((t) => t.status === "SUCCESSFUL" && t.service !== "funding").forEach((t) => {
      const d = Math.floor((Date.now() - t.createdAt) / 86400000);
      if (d < 7) arr[6 - d] += t.total;
    });
    return arr;
  })();

  return (
    <div className="h-full flex flex-col relative">
      {/* header */}
      <div className="px-5 pt-4 pb-3 border-b border-line/60 bg-void/80 backdrop-blur z-10">
        <div className="flex items-center gap-3">
          <span className="relative w-10 h-10 rounded-2xl bg-vio/15 border border-vio/30 text-vio grid place-items-center">
            <ISpark size={20} />
            <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-ok border-2 border-void a-blink" />
          </span>
          <div className="flex-1">
            <h1 className="font-display font-bold text-lg leading-tight">Stark AI</h1>
            <p className="text-[10px] text-mute font-semibold">ONLINE • context: your ledger</p>
          </div>
          <span className="flex items-center gap-1.5 text-[9px] font-bold text-vio bg-vio/10 border border-vio/25 px-2 py-1 rounded-md"><IShield size={11} /> PIN-GATED ACTIONS</span>
        </div>
        <div className="mt-3 flex items-center gap-3 card px-3.5 py-2.5 border-vio/20">
          <span className="text-[9px] font-bold tracking-widest text-mute">7-DAY SPEND</span>
          <Spark data={weekData} w={150} h={26} hue="#8B5CF6" />
          <span className="ml-auto font-display font-bold text-[12px] tnum text-vio">{money0(weekData.reduce((a, v) => a + v, 0))}</span>
        </div>
      </div>

      {/* messages */}
      <div className="flex-1 overflow-y-auto no-scrollbar px-5 py-4 space-y-4">
        {msgs.map((m) => (
          <div key={m.id} className={`a-rise flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] ${m.role === "user" ? "text-right" : ""}`}>
              <div className={`inline-block text-left text-[13px] leading-relaxed px-4 py-3 rounded-2xl whitespace-pre-line ${m.role === "user" ? "bg-cyan text-cyanink rounded-br-md font-semibold" : "bg-panel border border-line rounded-bl-md"}`}>
                {m.text}
              </div>
              {m.action && (
                <div className={`mt-2 card p-4 border-vio/30 text-left ${m.result ? "opacity-70" : ""}`}>
                  <p className="text-[9px] font-bold tracking-widest text-vio mb-1.5">PREPARED ACTION • REQUIRES PIN</p>
                  <div className="flex items-center gap-3">
                    <span className="w-9 h-9 rounded-xl bg-cyan/10 text-cyan grid place-items-center border border-cyan/25"><IWallet size={17} /></span>
                    <div className="flex-1">
                      <p className="text-[13px] font-bold font-display">{m.action.title}</p>
                      <p className="font-display font-bold text-lg text-cyan tnum">{money(m.action.amount)}</p>
                    </div>
                  </div>
                  {m.result ? (
                    <p className={`mt-2.5 text-[11px] font-bold flex items-center gap-1.5 ${m.result.ok ? "text-ok" : "text-warn"}`}>
                      {m.result.ok ? <ICheck size={13} /> : <IX size={13} />} {m.result.text}
                    </p>
                  ) : pending?.msgId === m.id ? (
                    <div className="flex gap-2 mt-3">
                      <button onClick={declineAction} className="press flex-1 py-2 rounded-lg border border-line text-xs font-bold text-sub hover:text-bad hover:border-bad/40">Cancel</button>
                      <button onClick={confirmAction} className="press flex-1 py-2 rounded-lg bg-cyan text-cyanink text-xs font-bold hover:brightness-110">Confirm</button>
                    </div>
                  ) : null}
                </div>
              )}
              <p className="text-[9px] text-mute font-semibold mt-1 px-1">{new Date(m.ts).toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" })}</p>
            </div>
          </div>
        ))}
        {typing && (
          <div className="flex justify-start a-fade">
            <div className="bg-panel border border-line rounded-2xl rounded-bl-md px-4 py-3.5 flex gap-1.5 items-center">
              {[0, 1, 2].map((i) => <span key={i} className="w-1.5 h-1.5 rounded-full bg-vio" style={{ animation: `kf-pulse 1s ${i * 0.18}s ease infinite` }} />)}
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* suggestions + input */}
      <div className="px-5 pb-4 pt-2 border-t border-line/60 bg-void/90 backdrop-blur">
        {msgs.length <= 2 && (
          <div className="flex gap-2 overflow-x-auto no-scrollbar mb-3">
            {AI_SUGGESTIONS.map((s) => (
              <button key={s} onClick={() => send(s)} className="press shrink-0 text-[11px] font-semibold px-3 py-2 rounded-full bg-panel border border-line text-sub hover:border-vio/50 hover:text-ink">{s}</button>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2">
          {listening && (
            <div className="flex items-end gap-[3px] h-8 px-2">
              {[0, 1, 2, 3, 4].map((i) => (
                <span key={i} className="w-[3px] rounded-full bg-vio voice-bar" style={{ height: 22, animationDelay: `${i * 0.12}s` }} />
              ))}
            </div>
          )}
          <button onClick={toggleVoice} className={`press w-11 h-11 rounded-xl grid place-items-center border shrink-0 ${listening ? "bg-vio text-white border-vio" : "bg-panel border-line text-sub hover:text-vio hover:border-vio/40"}`} aria-label="Voice input">
            {listening ? <IStop size={17} /> : <IMic size={17} />}
          </button>
          <input className="st-input !rounded-xl" placeholder="Ask Stark anything…" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} />
          <button onClick={() => send()} disabled={!input.trim()} className="press w-11 h-11 rounded-xl bg-cyan text-cyanink grid place-items-center disabled:opacity-35 shrink-0" aria-label="Send">
            <ISend size={17} />
          </button>
        </div>
        <p className="text-[9px] text-mute font-semibold mt-2 text-center">Stark AI prepares actions — it can never move money without your PIN or biometrics.</p>
      </div>

      <PinPad open={pinOpen} onClose={() => setPinOpen(false)} onSubmit={authorize} error={pinErr}
        title="Authorize Stark AI" subtitle={pending ? `${pending.action.title} — ${money0(pending.action.amount)}` : undefined} showBio={store.profile?.biometric} />
    </div>
  );
}
