import { useMemo, useState } from "react";
import { useStark, useBalances, money, money0, fmtDate, fmtTime, type LedgerKind } from "../lib/store";
import { Field, KindBadge, PinPad, SBtn, Seg, Sheet, useCountUp } from "../components/ui";
import { IArrowDL, IArrowUR, IBank, ICard, IPlus, IWallet, IChevR, ICheck, IcoBolt } from "../components/icons";

export default function Wallet() {
  const { ledger, addFunds, withdraw, toast, claimCashback, profile } = useStark();
  const b = useBalances();
  const bal = useCountUp(b.available);
  const [filter, setFilter] = useState("All");
  const [fundOpen, setFundOpen] = useState(false);
  const [wdOpen, setWdOpen] = useState(false);
  const [pinFor, setPinFor] = useState<"fund" | "wd" | null>(null);
  const [fundAmt, setFundAmt] = useState(5000);
  const [wd, setWd] = useState({ amount: "", bank: "GTBank", account: "", name: "" });
  const [pinErr, setPinErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const rows = useMemo(() => {
    const f: Record<string, (k: LedgerKind) => boolean> = {
      All: () => true,
      Credits: (k) => ["CREDIT", "REVERSAL", "REFUND", "CASHBACK", "REWARD", "CLAIM"].includes(k),
      Debits: (k) => ["DEBIT", "RESERVE", "RELEASE", "FEE", "WITHDRAW"].includes(k),
    };
    return ledger.filter((e) => f[filter]?.(e.kind)).slice(0, 60);
  }, [ledger, filter]);

  const runFund = async (pin: string) => {
    if (pin !== profile?.pin) { setPinErr("Incorrect PIN."); return; }
    setPinErr(null); setBusy(true); setPinFor(null);
    try {
      await addFunds(fundAmt);
      setFundOpen(false);
      toast(`${money(fundAmt)} added to your wallet`, "ok");
    } catch (e) {
      toast((e as Error).message, "bad");
    } finally { setBusy(false); }
  };

  const runWd = async (pin: string) => {
    if (pin !== profile?.pin) { setPinErr("Incorrect PIN."); return; }
    setPinErr(null); setBusy(true); setPinFor(null);
    const amt = Number(wd.amount);
    try {
      const tx = await withdraw(amt, wd.bank, wd.account, wd.name.toUpperCase());
      if (tx.status === "SUCCESSFUL") toast(`${money0(amt)} sent to ${wd.bank}`, "ok");
      else toast("Withdrawal failed — funds reversed to wallet", "bad");
      setWdOpen(false);
    } catch (e) {
      toast((e as Error).message, "bad");
    } finally { setBusy(false); }
  };

  const sign = (k: LedgerKind) => (["CREDIT", "REVERSAL", "REFUND", "CASHBACK", "REWARD"].includes(k) ? "+" : "−");
  const hue = (k: LedgerKind) => (["CREDIT", "REVERSAL", "REFUND", "CASHBACK", "REWARD"].includes(k) ? "text-ok" : "text-ink");

  return (
    <div className="pb-28">
      <div className="px-5 pt-4 pb-2 flex items-center justify-between">
        <div>
          <h1 className="font-display font-bold text-xl">Wallet</h1>
          <p className="text-[10px] text-mute font-semibold tracking-wide">DOUBLE-ENTRY LEDGER • IMMUTABLE</p>
        </div>
        <span className="flex items-center gap-1.5 text-[10px] font-bold text-ok bg-ok/10 border border-ok/25 px-2.5 py-1.5 rounded-lg">
          <span className="w-1.5 h-1.5 rounded-full bg-ok a-blink" /> BALANCED
        </span>
      </div>

      {/* balance hero */}
      <div className="px-5 mt-2">
        <div className="rounded-[20px] border border-line p-5 relative overflow-hidden" style={{ background: "linear-gradient(140deg, var(--st-card), var(--st-raised))" }}>
          <div className="absolute inset-0 grid-bg opacity-25 grid-fade" />
          <div className="relative flex items-start justify-between">
            <div>
              <p className="text-[10px] tracking-[0.2em] font-bold text-mute">AVAILABLE</p>
              <p className="font-display font-bold text-[32px] leading-tight tnum tracking-tight">{money(bal)}</p>
            </div>
            <span className="w-11 h-11 rounded-2xl bg-cyan/12 text-cyan grid place-items-center border border-cyan/25"><IWallet size={22} /></span>
          </div>
          <div className="relative grid grid-cols-3 gap-2 mt-4">
            {[
              { l: "Pending", v: money0(b.reserved), c: b.reserved > 0 ? "text-info" : "text-sub" },
              { l: "Ledger", v: money0(b.available + b.reserved), c: "text-sub" },
              { l: "Deposits", v: money0(b.deposits), c: "text-sub" },
            ].map((x) => (
              <div key={x.l} className="bg-well/80 border border-line rounded-xl px-3 py-2.5">
                <p className="text-[9px] font-bold tracking-widest text-mute">{x.l.toUpperCase()}</p>
                <p className={`font-display font-bold text-[13px] tnum ${x.c}`}>{x.v}</p>
              </div>
            ))}
          </div>
          <div className="relative flex gap-2.5 mt-4">
            <SBtn className="flex-1" onClick={() => setFundOpen(true)}><IPlus size={16} sw={2.4} /> Add money</SBtn>
            <SBtn variant="ghost" className="flex-1" onClick={() => setWdOpen(true)}><IArrowUR size={15} /> Withdraw</SBtn>
          </div>
        </div>
      </div>

      {/* cashback strip */}
      {b.cashback >= 1 && (
        <div className="px-5 mt-3">
          <div className="card p-4 flex items-center gap-3 border-vio/30">
            <span className="w-9 h-9 rounded-xl bg-vio/12 text-vio grid place-items-center border border-vio/25"><IcoBolt size={18} /></span>
            <div className="flex-1">
              <p className="text-[13px] font-bold font-display">Cashback balance — {money(b.cashback)}</p>
              <p className="text-[10px] text-mute font-semibold">Earned from purchases & redeemed points</p>
            </div>
            <SBtn small variant="violet" onClick={() => { const e = claimCashback(); toast(e ?? "Cashback moved to wallet", e ? "bad" : "ok"); }}>Move to wallet</SBtn>
          </div>
        </div>
      )}

      {/* ledger */}
      <div className="px-5 mt-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-display font-bold text-[15px]">Ledger entries</h2>
          <span className="text-[10px] text-mute font-semibold tnum">{ledger.length} records</span>
        </div>
        <Seg options={["All", "Credits", "Debits"]} value={filter} onChange={setFilter} />
        <div className="card mt-3 divide-y divide-line/70 overflow-hidden">
          {rows.length === 0 && <p className="p-6 text-center text-xs text-mute">No ledger entries in this view yet.</p>}
          {rows.map((e) => (
            <div key={e.id} className="flex items-center gap-3 px-4 py-3">
              <span className={`w-8 h-8 rounded-lg grid place-items-center shrink-0 border ${sign(e.kind) === "+" ? "bg-ok/10 text-ok border-ok/20" : "bg-well text-sub border-line"}`}>
                {sign(e.kind) === "+" ? <IArrowDL size={15} /> : <IArrowUR size={15} />}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-[12px] font-semibold truncate">{e.note}</p>
                <p className="text-[9px] text-mute font-semibold">{fmtDate(e.ts)} {fmtTime(e.ts)}{e.ref ? ` • ${e.ref}` : ""}</p>
              </div>
              <div className="text-right shrink-0">
                <KindBadge kind={e.kind} />
                <p className={`font-display font-bold text-[12px] tnum ${hue(e.kind)}`}>{sign(e.kind)}{money(e.amount)}</p>
              </div>
            </div>
          ))}
        </div>
        <p className="text-[10px] text-mute leading-relaxed mt-3 px-1">
          Entries are append-only. Corrections happen exclusively through REVERSAL and REFUND entries — a balance is never edited.
        </p>
      </div>

      {/* fund sheet */}
      <Sheet open={fundOpen} onClose={() => setFundOpen(false)} title="Add money">
        <FundForm amount={fundAmt} setAmount={setFundAmt} onSubmit={() => { setPinErr(null); setPinFor("fund"); }} busy={busy} />
      </Sheet>

      {/* withdraw sheet */}
      <Sheet open={wdOpen} onClose={() => setWdOpen(false)} title="Withdraw to bank">
        <div className="space-y-4 mt-3">
          <Field label="Amount (₦)" inputMode="numeric" placeholder="5000" value={wd.amount} onChange={(e) => setWd({ ...wd, amount: e.target.value.replace(/\D/g, "") })} hint={`Available ${money0(b.available)} • transfer fee ₦10`} />
          <div>
            <span className="block text-[11px] font-bold tracking-widest text-mute uppercase mb-1.5">Bank</span>
            <select className="st-input" value={wd.bank} onChange={(e) => setWd({ ...wd, bank: e.target.value })}>
              {["GTBank", "Access Bank", "Zenith Bank", "First Bank", "UBA", "Kuda", "OPay", "Moniepoint"].map((bk) => <option key={bk}>{bk}</option>)}
            </select>
          </div>
          <Field label="Account number" inputMode="numeric" placeholder="0123456789" value={wd.account} onChange={(e) => setWd({ ...wd, account: e.target.value.replace(/\D/g, "").slice(0, 10) })} />
          {wd.account.length === 10 && (
            <div className="a-pop flex items-center gap-2 text-xs font-semibold text-ok bg-ok/10 border border-ok/25 rounded-xl px-3 py-2.5">
              <ICheck size={14} /> Account resolved: {profile?.name.toUpperCase()}
            </div>
          )}
          <SBtn className="w-full" disabled={!(Number(wd.amount) >= 100 && wd.account.length === 10)} onClick={() => { setPinErr(null); setPinFor("wd"); }}>
            Withdraw {wd.amount ? money0(Number(wd.amount)) : ""} <IChevR size={15} />
          </SBtn>
          <p className="text-[10px] text-mute flex items-center gap-1.5"><IBank size={12} className="text-cyan" /> Payouts settle via Paystack Transfer in under 5 minutes.</p>
        </div>
      </Sheet>

      <PinPad
        open={pinFor !== null}
        onClose={() => setPinFor(null)}
        onSubmit={pinFor === "fund" ? runFund : runWd}
        error={pinErr}
        title="Authorize with PIN"
        subtitle={pinFor === "fund" ? `Funding wallet with ${money0(fundAmt)}` : `Sending ${money0(Number(wd.amount) || 0)} to ${wd.bank}`}
        showBio={profile?.biometric}
      />
    </div>
  );
}

function FundForm({ amount, setAmount, onSubmit, busy }: { amount: number; setAmount: (n: number) => void; onSubmit: () => void; busy: boolean }) {
  const [step, setStep] = useState<"amt" | "card">("amt");
  const [card, setCard] = useState({ num: "4084 0840 8408 4081", exp: "12/27", cvv: "408" });
  return (
    <div className="mt-3 space-y-4">
      {step === "amt" ? (
        <>
          <div>
            <span className="block text-[11px] font-bold tracking-widest text-mute uppercase mb-1.5">Amount</span>
            <div className="flex items-center gap-2 bg-well border border-line rounded-xl px-4">
              <span className="font-display font-bold text-xl text-cyan">₦</span>
              <input className="bg-transparent outline-none py-3.5 font-display font-bold text-2xl tnum w-full" inputMode="numeric" value={amount || ""} placeholder="0"
                onChange={(e) => setAmount(Number(e.target.value.replace(/\D/g, "").slice(0, 7)))} />
            </div>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {[1000, 2000, 5000, 10000, 20000, 50000, 100000, 250000].map((v) => (
              <button key={v} onClick={() => setAmount(v)} className={`press py-2.5 rounded-xl border text-xs font-bold tnum transition-colors ${amount === v ? "bg-cyan text-cyanink border-cyan" : "bg-panel border-line text-sub hover:border-cyan/40"}`}>
                {v >= 1000 ? `${v / 1000}k` : v}
              </button>
            ))}
          </div>
          <SBtn className="w-full" disabled={!amount || amount < 100} onClick={() => setStep("card")}>Continue <IChevR size={15} /></SBtn>
          <p className="text-[10px] text-mute flex items-center gap-1.5"><ICard size={12} className="text-cyan" /> Charged securely by Paystack. STARK never sees your full card number.</p>
        </>
      ) : (
        <>
          <div className="card p-4 flex items-center gap-3 border-cyan/30">
            <span className="w-10 h-10 rounded-xl bg-cyan/12 text-cyan grid place-items-center"><ICard size={20} /></span>
            <div className="flex-1">
              <p className="text-[13px] font-bold font-display tnum">{card.num}</p>
              <p className="text-[10px] text-mute font-semibold">VISA •• 4081 • Paystack test card</p>
            </div>
            <span className="text-[10px] font-bold text-ok bg-ok/10 border border-ok/25 px-2 py-1 rounded-md">SAVED</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Expiry" value={card.exp} onChange={(e) => setCard({ ...card, exp: e.target.value })} />
            <Field label="CVV" type="password" value={card.cvv} onChange={(e) => setCard({ ...card, cvv: e.target.value })} />
          </div>
          <div className="bg-well border border-line rounded-xl px-4 py-3 flex justify-between items-center">
            <span className="text-xs font-semibold text-sub">You will be charged</span>
            <span className="font-display font-bold tnum">{money(amount)}</span>
          </div>
          <SBtn className="w-full" loading={busy} onClick={onSubmit}>Pay {money0(amount)} securely</SBtn>
          <button className="text-xs text-mute font-semibold mx-auto block press" onClick={() => setStep("amt")}>← Change amount</button>
        </>
      )}
    </div>
  );
}
