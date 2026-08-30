import { useMemo, useState } from "react";
import { useStark, money, money0, fmtDate, fmtTime, type Tx } from "../lib/store";
import { Chip, EmptyState, QRBox, SBtn, ScreenHeader, Sheet, StatusBadge, useNav } from "../components/ui";
import { IActivity, ICopy, IDownload, ISearch, IArrowUR, IArrowDL, IcoBolt, IChevR, IHeadset, IChat } from "../components/icons";
import { SERVICES } from "./Home";

const FILTERS = ["All", "Successful", "Failed", "Pending"];

export default function Activity() {
  const nav = useNav();
  const { txs } = useStark();
  const [filter, setFilter] = useState("All");
  const [q, setQ] = useState("");
  const [svc, setSvc] = useState<string | null>(null);

  const list = useMemo(() => {
    const match = (t: Tx) => {
      if (filter === "Successful" && t.status !== "SUCCESSFUL") return false;
      if (filter === "Failed" && t.status !== "FAILED" && t.status !== "REVERSED") return false;
      if (filter === "Pending" && t.status !== "PENDING" && t.status !== "PROCESSING") return false;
      if (svc && t.service !== svc) return false;
      if (q && !`${t.title} ${t.ref} ${t.meta.phone ?? ""}`.toLowerCase().includes(q.toLowerCase())) return false;
      return true;
    };
    return txs.filter(match);
  }, [txs, filter, q, svc]);

  const pending = txs.filter((t) => t.status === "PROCESSING" || t.status === "PENDING").length;

  return (
    <div className="pb-28">
      <div className="px-5 pt-4 pb-3 flex items-center justify-between">
        <div>
          <h1 className="font-display font-bold text-xl">Activity</h1>
          <p className="text-[10px] text-mute font-semibold">{txs.length} transactions • state-machine tracked</p>
        </div>
        {pending > 0 && (
          <span className="flex items-center gap-1.5 text-[10px] font-bold text-info bg-info/10 border border-info/25 px-2.5 py-1.5 rounded-lg">
            <span className="w-1.5 h-1.5 rounded-full bg-info a-blink" /> {pending} PROCESSING
          </span>
        )}
      </div>

      <div className="px-5">
        <div className="relative">
          <ISearch size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-mute" />
          <input className="st-input !pl-10" placeholder="Search title, phone or reference…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="flex gap-2 mt-3 overflow-x-auto no-scrollbar">
          {FILTERS.map((f) => <Chip key={f} active={filter === f} onClick={() => setFilter(f)}>{f}</Chip>)}
        </div>
        <div className="flex gap-2 mt-2 overflow-x-auto no-scrollbar">
          <Chip active={svc === null} onClick={() => setSvc(null)}>Everything</Chip>
          {SERVICES.map((s) => <Chip key={s.id} active={svc === s.id} onClick={() => setSvc(svc === s.id ? null : s.id)}>{s.label}</Chip>)}
        </div>
      </div>

      <div className="px-5 mt-4">
        {list.length === 0 ? (
          <EmptyState icon={<IActivity size={24} />} title="Nothing here" body="No transactions match this filter yet. Your full history will appear here the moment you transact."
            action={<SBtn small onClick={() => nav.setTab("home")}>Start a purchase</SBtn>} />
        ) : (
          <div className="card divide-y divide-line/70 overflow-hidden">
            {list.map((t, i) => {
              const credit = t.service === "funding";
              return (
                <button key={t.id} onClick={() => nav.push({ name: "tx", id: t.id })} className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-raised/60 transition-colors press a-rise" style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}>
                  <span className={`w-10 h-10 rounded-xl grid place-items-center shrink-0 border ${credit ? "bg-ok/10 text-ok border-ok/25" : t.status === "FAILED" ? "bg-bad/10 text-bad border-bad/25" : "bg-well text-sub border-line"}`}>
                    {credit ? <IArrowDL size={18} /> : <IArrowUR size={18} />}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[13px] font-semibold truncate">{t.title}</span>
                    <span className="block text-[10px] text-mute font-semibold mt-0.5">{fmtDate(t.createdAt)} {fmtTime(t.createdAt)} • <span className="font-mono">{t.ref.slice(-8)}</span></span>
                  </span>
                  <span className="text-right shrink-0">
                    <span className={`block font-display font-bold text-[13px] tnum ${credit ? "text-ok" : ""}`}>{credit ? "+" : "−"}{money0(t.total)}</span>
                    <StatusBadge status={t.status} />
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* ================= transaction detail ================= */
export function TxDetail({ id }: { id: string }) {
  const nav = useNav();
  const { txs, addTicket, toast } = useStark();
  const tx = txs.find((t) => t.id === id);
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [dSubject, setDSubject] = useState("");
  const [dBody, setDBody] = useState("");
  if (!tx) return null;
  const ok = tx.status === "SUCCESSFUL";

  const download = () => {
    const lines = ["STARK TELECOMMUNICATION — RECEIPT", "=".repeat(33), `Status: ${tx.status}`, `Service: ${tx.title}`, `Amount: ${money(tx.amount)}`, `Fee: ${money(tx.fee)}`, `Total: ${money(tx.total)}`, `Date: ${fmtDate(tx.createdAt)} ${fmtTime(tx.createdAt)}`, `Stark reference: ${tx.ref}`, `Provider ref: ${tx.providerRef ?? "—"}`, tx.meta.token ? `Power token: ${tx.meta.token}` : "", "=".repeat(33), "Verify at stark.app/verify"].filter(Boolean).join("\n");
    const blob = new Blob([lines], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${tx.ref}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast("Receipt downloaded", "ok");
  };
  const copy = (v: string, l: string) => { navigator.clipboard?.writeText(v); toast(`${l} copied`, "ok"); };

  return (
    <div className="h-full flex flex-col">
      <ScreenHeader title="Transaction" sub={tx.ref} onBack={nav.pop} />
      <div className="flex-1 overflow-y-auto no-scrollbar px-5 pb-28">
        <div className="flex flex-col items-center pt-2 pb-5">
          <div className={`w-16 h-16 rounded-full grid place-items-center border-2 mb-3 ${ok ? "border-ok text-ok bg-ok/10" : tx.status === "FAILED" ? "border-bad text-bad bg-bad/10" : "border-info text-info bg-info/10"}`}>
            <IcoBolt size={26} />
          </div>
          <p className="font-display font-bold text-[26px] tnum">{money(tx.total)}</p>
          <p className="text-xs text-sub font-semibold mt-1 text-center">{tx.title}</p>
          <div className="mt-2"><StatusBadge status={tx.status} /></div>
        </div>

        <div className="card overflow-hidden">
          <div className="px-5 py-3.5 bg-raised/60 border-b border-line flex items-center justify-between">
            <p className="text-[10px] font-bold tracking-widest text-mute">RECEIPT</p>
            <QRBox seed={tx.ref} size={52} />
          </div>
          <div className="px-5 py-4 space-y-2.5 text-[12px]">
            <R k="Status" v={<StatusBadge status={tx.status} />} />
            <R k="Service" v={tx.title} />
            {tx.meta.network && <R k="Network" v={tx.meta.network} />}
            {(tx.meta.phone || tx.meta.iuc || tx.meta.meter || tx.meta.betId) && <R k="Account" v={tx.meta.phone ?? tx.meta.iuc ?? tx.meta.meter ?? tx.meta.betId ?? ""} />}
            {tx.meta.customer && <R k="Customer" v={tx.meta.customer} />}
            {tx.meta.bank && <R k="Bank" v={`${tx.meta.bank} ••${tx.meta.account?.slice(-4)}`} />}
            {tx.meta.token && <R k="Token" v={tx.meta.token} />}
            <div className="border-t border-dashed border-line my-1" />
            <R k="Amount" v={money(tx.amount)} />
            <R k="Fee" v={tx.fee ? money(tx.fee) : "Free"} />
            <div className="flex justify-between"><span className="font-bold">Total</span><span className="font-display font-bold text-cyan tnum">{money(tx.total)}</span></div>
            <div className="border-t border-dashed border-line my-1" />
            <R k="Created" v={`${fmtDate(tx.createdAt)} ${fmtTime(tx.createdAt)}`} />
            {tx.completedAt && <R k="Completed" v={`${fmtDate(tx.completedAt)} ${fmtTime(tx.completedAt)}`} />}
            <R k="Provider" v={tx.provider} />
            <div className="flex justify-between gap-3 items-center">
              <span className="text-mute font-semibold">Stark ref</span>
              <button className="press font-mono font-bold text-[11px] text-cyan inline-flex items-center gap-1" onClick={() => copy(tx.ref, "Reference")}>{tx.ref} <ICopy size={11} /></button>
            </div>
            {tx.providerRef && <R k="Provider ref" v={tx.providerRef} />}
            {tx.failReason && <p className="text-[11px] text-bad bg-bad/8 border border-bad/25 rounded-lg px-3 py-2 leading-relaxed">{tx.failReason}</p>}
          </div>
        </div>

        {tx.meta.pins && (
          <div className="mt-3 space-y-2">
            {tx.meta.pins.map((p, i) => (
              <div key={i} className="rounded-xl border border-ok/30 bg-ok/8 px-4 py-3 flex items-center justify-between">
                <div>
                  <p className="text-[9px] font-bold tracking-widest text-ok">PIN {i + 1} • SERIAL {p.serial}</p>
                  <p className="font-display font-bold text-lg tracking-wider tnum">{p.pin}</p>
                </div>
                <button className="press text-ok" onClick={() => copy(p.pin, "PIN")}><ICopy size={16} /></button>
              </div>
            ))}
          </div>
        )}

        <div className={`grid gap-2.5 mt-5 ${["funding", "withdraw"].includes(tx.service) ? "grid-cols-1" : "grid-cols-2"}`}>
          <SBtn variant="ghost" onClick={download}><IDownload size={15} /> Download</SBtn>
          {!["funding", "withdraw"].includes(tx.service) && (
            <SBtn variant="ghost" onClick={() => nav.push({ name: "buy", service: tx.service })}><IChevR size={15} /> Buy again</SBtn>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2.5 mt-2.5">
          <SBtn variant="danger" onClick={() => setDisputeOpen(true)}><IHeadset size={15} /> Report a problem</SBtn>
          <SBtn variant="ghost" onClick={() => nav.push({ name: "help", txId: tx.id })}><IChat size={15} /> WhatsApp support</SBtn>
        </div>
        <p className="text-[10px] text-mute text-center mt-3 leading-relaxed px-4">
          Disputes are verified against the provider with the Stark reference. Most are resolved within 24 hours.
        </p>
      </div>

      <Sheet open={disputeOpen} onClose={() => setDisputeOpen(false)} title="Report a problem">
        <div className="space-y-4 mt-3">
          <div className="card px-4 py-3 flex justify-between text-xs">
            <span className="text-mute font-semibold">Transaction</span>
            <span className="font-mono font-bold text-cyan">{tx.ref}</span>
          </div>
          <div>
            <span className="block text-[11px] font-bold tracking-widest text-mute uppercase mb-1.5">What happened?</span>
            <select className="st-input" value={dSubject} onChange={(e) => setDSubject(e.target.value)}>
              <option value="">Select a reason…</option>
              <option>Value not delivered</option>
              <option>Wrong amount charged</option>
              <option>Duplicate transaction</option>
              <option>Token / PIN not working</option>
              <option>Other</option>
            </select>
          </div>
          <div>
            <span className="block text-[11px] font-bold tracking-widest text-mute uppercase mb-1.5">Describe the issue</span>
            <textarea className="st-input min-h-[90px] resize-none" placeholder="Tell us exactly what went wrong…" value={dBody} onChange={(e) => setDBody(e.target.value)} />
          </div>
          <SBtn className="w-full" disabled={!dSubject || dBody.trim().length < 10} onClick={() => {
            addTicket({ subject: dSubject, category: "Dispute", body: dBody, ref: tx.ref });
            setDisputeOpen(false); setDSubject(""); setDBody("");
          }}>Submit dispute</SBtn>
        </div>
      </Sheet>
    </div>
  );
}

function R({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 items-center">
      <span className="text-mute font-semibold">{k}</span>
      <span className="font-semibold text-right truncate">{v}</span>
    </div>
  );
}
