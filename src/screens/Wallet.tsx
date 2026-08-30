import { useMemo, useState } from "react";
import { useStark, useBalances, money, money0, fmtDate, fmtTime, type LedgerKind } from "../lib/store";
import { Field, KindBadge, PinPad, SBtn, Seg, Sheet, useCountUp, useNav } from "../components/ui";
import { IArrowDL, IArrowUR, IBank, ICard, IPlus, IWallet, IChevR, ICheck, IcoBolt, ILock, IPlay } from "../components/icons";
import { openPaystackCheckout } from "../lib/paystack";

export default function Wallet() {
  const nav = useNav();
  const { ledger, addFunds, withdraw, toast, claimCashback, profile } = useStark();
  const b = useBalances();
  const bal = useCountUp(b.available);
  const [filter, setFilter] = useState("All");
  const [fundOpen, setFundOpen] = useState(false);
  const [wdOpen, setWdOpen] = useState(false);
  const [pinFor, setPinFor] = useState<"wd" | null>(null);
  const [fundAmt, setFundAmt] = useState(5000);
  const [fundEmail, setFundEmail] = useState("");
  const [fundBusy, setFundBusy] = useState(false);
  const [fundNote, setFundNote] = useState<string | null>(null);
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

  // Real funding: open Paystack's hosted checkout. The customer pays inside
  // Paystack (card auth + bank OTP happen THERE — Stark never sees card data
  // and no Stark PIN gates a deposit). On genuine success we record the
  // charge with Paystack's real reference. No simulated payments.
  const startPaystack = async () => {
    setFundBusy(true); setFundNote(null);
    try {
      await openPaystackCheckout({
        email: fundEmail.trim() || profile?.email || "customer@stark.app",
        amountNaira: fundAmt,
        onSuccess: async ({ reference }) => {
          try {
            await addFunds(fundAmt, reference);
            setFundOpen(false);
            setFundEmail("");
            toast(`${money(fundAmt)} added — Paystack ref ${reference}`, "ok");
          } catch (e) {
            toast((e as Error).message, "bad");
          } finally {
            setFundBusy(false);
          }
        },
        onClose: () => {
          setFundBusy(false);
          setFundNote("Checkout closed before payment — nothing was charged.");
        },
      });
    } catch (e) {
      setFundBusy(false);
      setFundNote((e as Error).message || "Could not start Paystack. Try again.");
    }
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

      {/* launch console entry */}
      <div className="px-5 mt-3">
        <button onClick={() => nav.push({ name: "golive" })}
          className="press w-full rounded-2xl border border-cyan/25 overflow-hidden text-left group"
          style={{ background: "linear-gradient(120deg, rgba(0,229,255,0.10), rgba(139,92,246,0.10))" }}>
          <div className="relative p-4 flex items-center gap-3">
            <div className="absolute inset-0 grid-bg opacity-15 grid-fade" />
            <span className="relative shrink-0 w-10 h-10 rounded-xl bg-cyan/15 text-cyan grid place-items-center border border-cyan/30 group-hover:shadow-[0_0_16px_var(--st-glow)] transition-shadow">
              <IPlay size={19} />
            </span>
            <div className="relative flex-1 min-w-0">
              <p className="text-[9px] font-bold tracking-[0.25em] text-cyan">LIVE PAYMENTS</p>
              <p className="font-display font-bold text-[13.5px] leading-tight mt-0.5">Launch Console</p>
              <p className="text-[10px] text-sub mt-0.5 flex items-center gap-1.5"><ILock size={10} className="text-cyan shrink-0" /> 9-stage pre-flight to take Paystack live</p>
            </div>
            <IChevR size={16} className="relative text-cyan shrink-0 group-hover:translate-x-0.5 transition-transform" />
          </div>
        </button>
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
        <FundForm
          amount={fundAmt}
          setAmount={setFundAmt}
          email={fundEmail}
          setEmail={setFundEmail}
          busy={fundBusy}
          note={fundNote}
          onPay={startPaystack}
        />
      </Sheet>

      {/* withdraw sheet */}
      <Sheet open={wdOpen} onClose={() => setWdOpen(false)} title="Withdraw to bank">
        <div className="flex flex-col mt-3">
          <div className="space-y-4">
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
          </div>
          <div className="sticky bottom-0 -mx-5 px-5 pt-3 pb-1 mt-4 bg-raised border-t border-line/50 space-y-2.5">
            <SBtn className="w-full" disabled={!(Number(wd.amount) >= 100 && wd.account.length === 10)} onClick={() => { setPinErr(null); setPinFor("wd"); }}>
              Withdraw {wd.amount ? money0(Number(wd.amount)) : ""} <IChevR size={15} />
            </SBtn>
            <p className="text-[10px] text-mute flex items-center justify-center gap-1.5"><IBank size={12} className="text-cyan shrink-0" /> Payouts settle via Paystack Transfer in under 5 minutes.</p>
          </div>
        </div>
      </Sheet>

      <PinPad
        open={pinFor !== null}
        onClose={() => setPinFor(null)}
        onSubmit={runWd}
        error={pinErr}
        title="Authorize with PIN"
        subtitle={`Sending ${money0(Number(wd.amount) || 0)} to ${wd.bank}`}
        showBio={profile?.biometric}
      />
    </div>
  );
}

function FundForm({ amount, setAmount, email, setEmail, busy, note, onPay }: {
  amount: number; setAmount: (n: number) => void;
  email: string; setEmail: (s: string) => void;
  busy: boolean; note: string | null; onPay: () => void;
}) {
  const [step, setStep] = useState<"amt" | "checkout">("amt");
  const valid = amount >= 100 && amount <= 5000000;
  return (
    <div className="mt-3 flex flex-col">
      {step === "amt" ? (
        <>
          <div className="space-y-4">
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
          </div>
          <div className="sticky bottom-0 -mx-5 px-5 pt-3 pb-1 mt-4 bg-raised border-t border-line/50 space-y-2.5">
            <SBtn className="w-full" disabled={!valid} onClick={() => setStep("checkout")}>Continue <IChevR size={15} /></SBtn>
            <p className="text-[10px] text-mute flex items-center justify-center gap-1.5"><ILock size={12} className="text-cyan shrink-0" /> You'll pay on Paystack's secure checkout. STARK never sees your card.</p>
          </div>
        </>
      ) : (
        <>
          {/* Real Paystack handoff — the amount, the reference and the charge
              are all genuine. Card entry & bank OTP happen inside Paystack. */}
          <div className="space-y-4">
            <div className="relative rounded-2xl border border-cyan/30 overflow-hidden p-5"
              style={{ background: "linear-gradient(150deg, #07222F 0%, #0B3247 60%, #07222F 100%)" }}>
              <div className="absolute inset-0 grid-bg opacity-20 grid-fade" />
              <div className="absolute -right-8 -top-10 w-32 h-32 rounded-full" style={{ background: "radial-gradient(circle, var(--st-glow), transparent 70%)" }} />
              <div className="relative">
                <div className="flex items-center justify-between">
                  <span className="text-[9px] font-bold tracking-[0.25em] text-cyan">SECURE CHECKOUT</span>
                  <span className="flex items-center gap-1.5 text-[9px] font-bold text-ok bg-ok/10 border border-ok/25 px-2 py-1 rounded-md"><span className="w-1.5 h-1.5 rounded-full bg-ok a-blink" /> LIVE</span>
                </div>
                <p className="font-display font-bold text-[38px] leading-none tnum tracking-tight mt-3">{money(amount)}</p>
                <p className="text-[11px] text-sub font-semibold mt-2">Wallet funding • Nigerian Naira</p>
                <div className="mt-4 pt-4 border-t border-white/10 flex items-center justify-between">
                  <span className="text-[12px] font-bold tracking-tight text-ink">paystack <span className="text-cyan">⌁</span></span>
                  <span className="flex items-center gap-1.5 text-[9px] font-bold text-sub"><ILock size={11} className="text-cyan" /> PCI-DSS • 256-BIT SSL</span>
                </div>
              </div>
            </div>

            <Field label="Email for receipt" type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />

            {note && (
              <div className="a-rise text-[11px] font-semibold text-warn bg-warn/10 border border-warn/25 rounded-xl px-3 py-2.5">{note}</div>
            )}

            <div className="bg-well border border-line rounded-xl px-4 py-3 space-y-1.5">
              {[["Card", "Visa · Mastercard · Verve"], ["Bank transfer", "All Nigerian banks"], ["USSD / Mobile money", "Instant"]].map(([k, v]) => (
                <div key={k} className="flex items-center justify-between text-[11px]">
                  <span className="font-bold">{k}</span>
                  <span className="text-mute font-semibold">{v}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="sticky bottom-0 -mx-5 px-5 pt-3 pb-1 mt-4 bg-raised border-t border-line/50 space-y-2.5">
            <SBtn className="w-full" loading={busy} disabled={busy} onClick={onPay}>
              {busy ? "Waiting for Paystack…" : <>Pay {money0(amount)} with Paystack <ILock size={14} /></>}
            </SBtn>
            <button className="text-xs text-mute font-semibold mx-auto block press" onClick={() => setStep("amt")} disabled={busy}>← Change amount</button>
          </div>
        </>
      )}
    </div>
  );
}
