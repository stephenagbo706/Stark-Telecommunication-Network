import { useMemo, useState } from "react";
import { useStark, money0, fmtDate, fmtTime, type Tx } from "../lib/store";
import { Chip, SBtn, ScreenHeader, StatusBadge, useNav } from "../components/ui";
import { TxRow } from "./Home";
import { ICopy, IHeadset } from "../components/icons";

const FILTERS = ["All", "Airtime", "Data", "Cable", "Electricity", "Funding", "Failed"] as const;

export default function Activity() {
  const nav = useNav();
  const { txs } = useStark();
  const [f, setF] = useState<(typeof FILTERS)[number]>("All");
  const [q, setQ] = useState("");

  const rows = useMemo(() => {
    return txs.filter((t) => {
      if (f === "Failed") return t.status === "FAILED" || t.status === "REVERSED";
      if (f !== "All" && t.service.toLowerCase() !== f.toLowerCase()) return false;
      if (q && !(t.title + t.ref).toLowerCase().includes(q.toLowerCase())) return false;
      return true;
    });
  }, [txs, f, q]);

  return (
    <div className="h-full flex flex-col">
      <div className="px-5 pt-4 pb-3">
        <h1 className="font-display font-bold text-xl">Activity</h1>
        <p className="text-[10px] text-mute font-semibold tracking-wide">EVERY KOBO • IMMUTABLE LEDGER</p>
        <input className="st-input mt-3" placeholder="Search transactions…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="px-5 pb-2 flex gap-2 overflow-x-auto no-scrollbar">
        {FILTERS.map((x) => <Chip key={x} active={f === x} onClick={() => setF(x)}>{x}</Chip>)}
      </div>
      <div className="flex-1 overflow-y-auto no-scrollbar px-5 pb-28">
        {rows.length === 0 ? (
          <div className="card p-8 text-center mt-3">
            <p className="font-display font-bold text-[15px]">Nothing here yet</p>
            <p className="text-xs text-mute mt-2">Your purchases and wallet activity will appear here.</p>
            <SBtn small className="mt-4" onClick={() => nav.setTab("wallet")}>Fund your wallet</SBtn>
          </div>
        ) : (
          <div className="card mt-3 divide-y divide-line/70 overflow-hidden">
            {rows.map((t, i) => <TxRow key={t.id} t={t} i={i} onClick={() => nav.push({ name: "tx", id: t.id })} />)}
          </div>
        )}
      </div>
    </div>
  );
}

export function TxDetail({ id }: { id: string }) {
  const nav = useNav();
  const { txs, toast, addTicket } = useStark();
  const tx = txs.find((t) => t.id === id);
  const [reportOpen, setReportOpen] = useState(false);
  const [reason, setReason] = useState("");
  if (!tx) return null;

  const copy = async (v: string, msg: string) => {
    try { await navigator.clipboard.writeText(v); toast(msg, "ok"); } catch { toast("Couldn't copy", "bad"); }
  };

  return (
    <div className="h-full flex flex-col">
      <ScreenHeader title="Transaction" sub={tx.ref} onBack={() => nav.pop()}
        right={<button onClick={() => copy(tx.ref, "Reference copied")} className="press w-9 h-9 rounded-xl bg-panel border border-line grid place-items-center text-sub hover:text-cyan"><ICopy size={16} /></button>} />
      <div className="flex-1 overflow-y-auto no-scrollbar px-5 pb-28">
        <div className={`card p-6 text-center border ${tx.status === "SUCCESSFUL" ? "border-ok/30" : tx.status === "FAILED" ? "border-bad/30" : "border-line"}`}>
          <StatusBadge status={tx.status} />
          <p className="font-display font-bold text-[28px] tnum mt-3">{money0(tx.total)}</p>
          <p className="text-xs text-mute mt-1">{tx.title}</p>
          {tx.failReason && <p className="text-[11px] text-bad font-semibold mt-3 bg-bad/10 border border-bad/25 rounded-xl px-3 py-2.5 text-left">{tx.failReason}</p>}
          {tx.meta.token && (
            <div className="mt-4 bg-well border border-line rounded-xl px-3 py-3">
              <p className="text-[9px] font-bold tracking-widest text-mute">ELECTRICITY TOKEN</p>
              <p className="font-mono font-bold text-cyan text-[15px] mt-1">{tx.meta.token}</p>
              <button onClick={() => copy(tx.meta.token!, "Token copied")} className="press text-[10px] font-bold text-cyan mt-1.5 inline-flex items-center gap-1"><ICopy size={11} /> Copy token</button>
            </div>
          )}
        </div>

        <div className="card mt-3 divide-y divide-line/70">
          {[
            ["Service", tx.service.toUpperCase()],
            ["Provider", tx.provider],
            ["Provider ref", tx.providerRef ?? "—"],
            ["Amount", money0(tx.amount)],
            ["Fee", money0(tx.fee)],
            ["Total", money0(tx.total)],
            ["Date", `${fmtDate(tx.createdAt)} • ${fmtTime(tx.createdAt)}`],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between px-4 py-3 text-[12px]">
              <span className="text-mute font-semibold">{k}</span>
              <span className="font-semibold text-right">{v}</span>
            </div>
          ))}
        </div>

        <div className="flex gap-2.5 mt-4">
          <SBtn variant="ghost" className="flex-1" onClick={() => copy(`${tx.title}\n${tx.ref}\n${money0(tx.total)}\n${tx.status}`, "Receipt copied")}>Copy receipt</SBtn>
          {tx.status === "FAILED" && <SBtn variant="danger" className="flex-1" onClick={() => setReportOpen(true)}><IHeadset size={15} /> Report problem</SBtn>}
        </div>

        {reportOpen && (
          <div className="card mt-4 p-4 border-warn/30 a-rise">
            <p className="text-[12px] font-bold mb-2">Report a problem</p>
            <textarea className="st-input min-h-[90px] resize-none" placeholder="Describe what happened…" value={reason} onChange={(e) => setReason(e.target.value)} />
            <div className="flex gap-2 mt-3">
              <SBtn small variant="ghost" onClick={() => setReportOpen(false)}>Cancel</SBtn>
              <SBtn small disabled={reason.trim().length < 10} onClick={() => { addTicket({ subject: `Dispute — ${tx.ref}`, category: tx.service, body: reason, ref: tx.ref }); setReportOpen(false); toast("Dispute submitted — support will review", "ok"); }}>Submit</SBtn>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
