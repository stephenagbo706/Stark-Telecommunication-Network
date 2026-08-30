import { useEffect, useRef, useState } from "react";
import { useStark, useBalances, money0, availableOf } from "../lib/store";
import { PinPad, SBtn, Spark } from "../components/ui";
import { ISparkSharp, IX } from "../components/icons";

interface Msg { role: "user" | "ai"; text: string; ts: number }
interface PreparedAction { label: string; detail: string; service: "airtime"; amount: number; network: string; phone: string }

const SUGGESTIONS = ["What is my balance?", "How much did I spend this month?", "What's my biggest transaction?", "Buy ₦1,000 MTN airtime to 0803 472 1189"];

function think(input: string, ctx: { available: number; spend: number; biggest: number; count: number }): { text: string; action?: PreparedAction } {
  const q = input.toLowerCase();

  /* prepared purchase — NEVER executed without confirm + PIN */
  const buy = q.match(/(?:buy|purchase|get|top ?up)\s+₦?([\d,]+)\s*(mtn|airtel|glo|9mobile)?\s*airtime(?:\s+(?:to|for)\s+([\d\s+]+))?/);
  if (buy) {
    const amount = Number(buy[1].replace(/,/g, ""));
    const network = (buy[2] ?? "MTN").toUpperCase();
    const phone = (buy[3] ?? "").trim();
    return {
      text: `I've prepared an MTN airtime purchase for you. Review it below — I'll only proceed after you confirm and authorize with your PIN.`,
      action: { label: `${network} Airtime`, detail: phone || "add a phone number at checkout", service: "airtime", amount, network, phone },
    };
  }

  if (/(balance|how much do i have|wallet)/.test(q)) {
    return { text: `Your available balance is ${money0(ctx.available)}. That's derived from your ledger in real time — reserved funds are shown separately.` };
  }
  if (/(spend|spent|this month)/.test(q)) {
    return { text: `You've spent ${money0(ctx.spend)} across ${ctx.count} successful transactions. Every kobo is recorded as an immutable ledger entry.` };
  }
  if (/biggest|largest|highest/.test(q)) {
    return { text: ctx.biggest > 0 ? `Your biggest transaction was ${money0(ctx.biggest)}.` : `You haven't made any purchases yet — your biggest transaction will show up here once you do.` };
  }
  if (/(hi|hello|hey|what can you do|help)/.test(q)) {
    return { text: `I can check your balance, summarise your spending, find your biggest transaction, and prepare purchases for you. I never move money on my own — every action needs your confirmation and PIN.` };
  }
  return { text: `I'm focused on your wallet and purchases right now. Try asking about your balance, your spending, or say "Buy ₦1,000 MTN airtime".` };
}

export default function AI() {
  const store = useStark();
  const b = useBalances();
  const [msgs, setMsgs] = useState<Msg[]>([
    { role: "ai", text: "Hi — I'm Stark AI. Ask me about your balance or spending, or tell me what to buy. I'll always confirm with you (and your PIN) before anything moves.", ts: Date.now() },
  ]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState<PreparedAction | null>(null);
  const [typing, setTyping] = useState(false);
  const [listening, setListening] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [pinErr, setPinErr] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const recRef = useRef<{ stop: () => void } | null>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, typing]);

  const send = (text: string) => {
    if (!text.trim()) return;
    setMsgs((m) => [...m, { role: "user", text, ts: Date.now() }]);
    setInput("");
    setTyping(true);
    const ctx = { available: b.available, spend: b.spend, biggest: store.txs.filter((t) => t.status === "SUCCESSFUL").reduce((m, t) => Math.max(m, t.total), 0), count: store.txs.filter((t) => t.status === "SUCCESSFUL").length };
    setTimeout(() => {
      const { text: reply, action } = think(text, ctx);
      setMsgs((m) => [...m, { role: "ai", text: reply, ts: Date.now() }]);
      setTyping(false);
      if (action) setPending(action);
    }, 750);
  };

  const voice = () => {
    const SR = (window as unknown as { webkitSpeechRecognition?: new () => { lang: string; onresult: (e: { results: { [i: number]: { [j: number]: { transcript: string } } } }) => void; onend: () => void; start: () => void; stop: () => void } }).webkitSpeechRecognition;
    if (!SR) { store.toast("Voice input isn't supported in this browser", "bad"); return; }
    if (listening) { recRef.current?.stop(); setListening(false); return; }
    const rec = new SR();
    rec.lang = "en-NG";
    rec.onresult = (e) => { const t = e.results[0]?.[0]?.transcript ?? ""; if (t) send(t); };
    rec.onend = () => setListening(false);
    recRef.current = rec;
    setListening(true);
    rec.start();
  };

  const confirmAction = () => { setPinErr(null); setPinOpen(true); };
  const execAction = (pin: string) => {
    if (pin !== store.profile?.pin) { setPinErr("Incorrect PIN."); return; }
    setPinErr(null);
    setPinOpen(false);
    const act = pending!;
    setPending(null);
    setTyping(true);
    store.purchase({ service: act.service, title: `${act.network} Airtime • ${act.phone || "your number"}`, amount: act.amount, meta: { network: act.network as never, phone: act.phone } })
      .then((tx) => {
        setMsgs((m) => [...m, { role: "ai", text: tx.status === "SUCCESSFUL" ? `Done — ${money0(act.amount)} ${act.network} airtime was delivered (ref ${tx.ref}).` : `The provider couldn't complete that purchase, so your ${money0(act.amount)} was automatically reversed. Nothing was lost.`, ts: Date.now() }]);
      })
      .catch((e) => setMsgs((m) => [...m, { role: "ai", text: (e as Error).message, ts: Date.now() }]))
      .finally(() => setTyping(false));
  };

  return (
    <div className="h-full flex flex-col">
      <div className="px-5 pt-4 pb-3 flex items-center gap-3">
        <span className="relative">
          <ISparkSharp size={30} />
          <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-ok a-blink border border-void" />
        </span>
        <div>
          <h1 className="font-display font-bold text-lg leading-tight">Stark AI</h1>
          <p className="text-[10px] text-mute font-semibold">PREPARES ACTIONS • NEVER MOVES MONEY ALONE</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto no-scrollbar px-5 pb-4 space-y-3">
        {msgs.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"} a-rise`}>
            <div className={`max-w-[82%] rounded-2xl px-4 py-3 text-[13px] leading-relaxed ${m.role === "user" ? "bg-cyan text-cyanink rounded-br-sm" : "bg-raised border border-line rounded-bl-sm"}`}>
              {m.text}
            </div>
          </div>
        ))}

        {pending && (
          <div className="card p-4 border-vio/40 a-pop">
            <p className="text-[9px] font-bold tracking-[0.22em] text-vio flex items-center gap-1.5"><ISparkSharp size={12} /> PREPARED ACTION • REQUIRES PIN</p>
            <p className="font-display font-bold text-[15px] mt-2">{pending.label} — {money0(pending.amount)}</p>
            <p className="text-[11px] text-mute mt-1">{pending.detail}</p>
            <div className="flex gap-2 mt-3">
              <SBtn small variant="ghost" onClick={() => setPending(null)}><IX size={13} /> Cancel</SBtn>
              <SBtn small variant="violet" onClick={confirmAction}>Confirm purchase</SBtn>
            </div>
          </div>
        )}

        {typing && (
          <div className="flex justify-start a-fade">
            <div className="bg-raised border border-line rounded-2xl rounded-bl-sm px-4 py-3 flex gap-1.5 items-center">
              {[0, 1, 2].map((i) => <span key={i} className="w-1.5 h-1.5 rounded-full bg-cyan a-blink" style={{ animationDelay: `${i * 0.15}s` }} />)}
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="px-5 pb-2 flex gap-2 overflow-x-auto no-scrollbar">
        {SUGGESTIONS.map((s) => (
          <button key={s} onClick={() => send(s)} className="press shrink-0 text-[11px] font-semibold px-3 py-1.5 rounded-full bg-panel border border-line text-sub hover:text-cyan hover:border-cyan/40">{s}</button>
        ))}
      </div>

      <div className="px-5 pb-5 pt-2 flex gap-2 items-center">
        <button onClick={voice} className={`press w-11 h-11 rounded-xl grid place-items-center border shrink-0 ${listening ? "bg-bad/15 text-bad border-bad/40" : "bg-panel border-line text-sub hover:text-cyan"}`} aria-label="Voice input">
          <span className="flex items-end gap-[3px] h-4">
            {[0, 1, 2].map((i) => <span key={i} className={`w-[3px] rounded-full bg-current ${listening ? "a-bar" : ""}`} style={{ height: "100%", animationDelay: `${i * 0.12}s` }} />)}
          </span>
        </button>
        <input className="st-input flex-1" placeholder="Ask Stark AI…" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send(input)} />
        <SBtn small onClick={() => send(input)} disabled={!input.trim()}>Send</SBtn>
      </div>

      <p className="px-5 pb-4 text-center text-[9.5px] text-mute">Stark AI prepares actions — it can never move money without your confirmation and PIN.</p>

      <PinPad open={pinOpen} onClose={() => setPinOpen(false)} onSubmit={execAction} error={pinErr}
        title="Authorize with PIN" subtitle={pending ? `${pending.label} • ${money0(pending.amount)}` : ""} showBio={store.profile?.biometric} />
    </div>
  );
}
export { Spark };
