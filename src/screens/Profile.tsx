import { useRef, useState } from "react";
import { useStark, fmtDate } from "../lib/store";
import { Avatar, Field, PinPad, SBtn, ScreenHeader, Sheet, Toggle, useNav } from "../components/ui";
import { IChevR, IFinger, IShield, IUser } from "../components/icons";

export default function Profile() {
  const nav = useNav();
  const store = useStark();
  const p = store.profile!;
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const onFile = (f: File | undefined) => {
    if (!f) return;
    if (!f.type.startsWith("image/")) { store.toast("Choose an image file (JPEG/PNG/WEBP)", "bad"); return; }
    if (f.size > 2 * 1024 * 1024) { store.toast("Image is over 2 MB — compress it first", "bad"); return; }
    setUploading(true);
    const r = new FileReader();
    r.onload = () => {
      store.setAvatar(r.result as string);
      setUploading(false);
      store.toast("Profile photo updated", "ok");
    };
    r.readAsDataURL(f);
  };

  const rows: { label: string; value?: string; onClick?: () => void; danger?: boolean; right?: React.ReactNode }[] = [
    { label: "Security Centre", onClick: () => nav.push({ name: "security" }), right: <IChevR size={15} className="text-mute" /> },
    { label: "Devices & sessions", onClick: () => nav.push({ name: "security" }), right: <IChevR size={15} className="text-mute" /> },
    { label: "Referrals", value: p.referralCode, onClick: () => nav.push({ name: "referrals" }), right: <IChevR size={15} className="text-mute" /> },
    { label: "Help Centre", onClick: () => nav.push({ name: "help" }), right: <IChevR size={15} className="text-mute" /> },
    { label: "Notifications", onClick: () => nav.push({ name: "notifications" }), right: <IChevR size={15} className="text-mute" /> },
    { label: p.frozen ? "Unfreeze account" : "Freeze account", danger: true, onClick: () => store.toggleFreeze() },
  ];

  return (
    <div className="h-full flex flex-col">
      <div className="px-5 pt-4 pb-3"><h1 className="font-display font-bold text-xl">Profile</h1><p className="text-[10px] text-mute font-semibold tracking-wide">JOINED {fmtDate(p.joinedAt).toUpperCase()}</p></div>
      <div className="flex-1 overflow-y-auto no-scrollbar px-5 pb-28">
        <div className="card p-5 flex flex-col items-center relative overflow-hidden">
          <div className="absolute inset-0 grid-bg opacity-20 grid-fade" />
          <div className="relative">
            <Avatar name={p.name} src={p.avatar} size={84} ring />
            <button onClick={() => fileRef.current?.click()} disabled={uploading}
              className="press absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-cyan text-cyanink grid place-items-center border-2 border-card shadow-lg" aria-label="Change photo">
              {uploading ? <span className="w-3.5 h-3.5 rounded-full border-2 border-current border-t-transparent animate-spin" /> : <IUser size={15} />}
            </button>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
          </div>
          <p className="font-display font-bold text-[17px] mt-3 relative">{p.name}</p>
          <p className="text-[11px] text-mute relative">{p.phone} • {p.email}</p>
          <div className="flex gap-2 mt-3 relative">
            <span className={`text-[9px] font-bold px-2 py-1 rounded-md border ${p.phoneVerified ? "text-ok bg-ok/10 border-ok/25" : "text-warn bg-warn/10 border-warn/25"}`}>{p.phoneVerified ? "PHONE VERIFIED" : "PHONE UNVERIFIED"}</span>
            <span className={`text-[9px] font-bold px-2 py-1 rounded-md border ${p.emailVerified ? "text-ok bg-ok/10 border-ok/25" : "text-warn bg-warn/10 border-warn/25"}`}>{p.emailVerified ? "EMAIL VERIFIED" : "VERIFY EMAIL"}</span>
          </div>
          {p.avatar && <button onClick={() => { store.setAvatar(undefined); store.toast("Photo removed", "info"); }} className="press text-[10px] text-mute font-semibold mt-2 relative hover:text-bad">Remove photo</button>}
        </div>

        <div className="card mt-4 divide-y divide-line/70 overflow-hidden">
          {rows.map((r) => (
            <button key={r.label} onClick={r.onClick} className="w-full flex items-center justify-between px-4 py-3.5 text-left hover:bg-raised/60 transition-colors">
              <span className={`text-[13px] font-semibold ${r.danger ? "text-bad" : ""}`}>{r.label}</span>
              <span className="flex items-center gap-2">{r.value && <span className="text-[10px] font-bold text-cyan">{r.value}</span>}{r.right}</span>
            </button>
          ))}
        </div>

        <div className="card mt-4 p-4 flex items-center justify-between">
          <div><p className="text-[13px] font-bold">Light theme</p><p className="text-[10px] text-mute font-semibold">Stark looks best in dark, but you choose.</p></div>
          <Toggle on={store.theme === "light"} onChange={() => store.setTheme(store.theme === "light" ? "dark" : "light")} />
        </div>

        <SBtn variant="danger" className="w-full mt-4" onClick={() => { store.logout(); store.toast("Signed out — your account and history are safe", "info"); }}>Sign out</SBtn>
      </div>
    </div>
  );
}

export function Security() {
  const nav = useNav();
  const store = useStark();
  const p = store.profile!;
  const [pinSheet, setPinSheet] = useState(false);
  const [oldPin, setOldPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [pinErr, setPinErr] = useState<string | null>(null);

  const score = [p.phoneVerified, p.emailVerified, !!p.pin, p.biometric, p.twoFA].filter(Boolean).length * 20;

  const doChangePin = () => {
    const err = store.changePin(oldPin, newPin);
    if (err) { setPinErr(err); return; }
    setPinErr(null); setPinSheet(false); setOldPin(""); setNewPin("");
    store.toast("Transaction PIN updated", "ok");
  };

  return (
    <div className="h-full flex flex-col">
      <ScreenHeader title="Security Centre" sub="Your account, your rules" onBack={() => nav.pop()} />
      <div className="flex-1 overflow-y-auto no-scrollbar px-5 pb-28 space-y-4">
        <div className="card p-5">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-bold tracking-widest text-mute">SECURITY SCORE</p>
            <p className="font-display font-bold text-xl tnum" style={{ color: score >= 80 ? "var(--st-ok)" : score >= 60 ? "var(--st-cyan)" : "var(--st-warn)" }}>{score}%</p>
          </div>
          <div className="h-2 rounded-full bg-well overflow-hidden mt-3">
            <div className="h-full rounded-full transition-all duration-700" style={{ width: `${score}%`, background: score >= 80 ? "var(--st-ok)" : "var(--st-cyan)" }} />
          </div>
        </div>

        <div className="card divide-y divide-line/70 overflow-hidden">
          {[
            { label: "Phone verified", on: p.phoneVerified },
            { label: "Email verified", on: p.emailVerified },
            { label: "Transaction PIN", on: true },
            { label: "Biometric unlock", on: p.biometric, toggle: () => store.updateProfile({ biometric: !p.biometric }) },
            { label: "Two-factor (2FA)", on: p.twoFA, toggle: () => store.updateProfile({ twoFA: !p.twoFA }) },
          ].map((r) => (
            <div key={r.label} className="flex items-center justify-between px-4 py-3.5">
              <span className="flex items-center gap-2.5 text-[13px] font-semibold">{r.label.startsWith("Biometric") && <IFinger size={16} className="text-cyan" />}{r.label.startsWith("Two-factor") && <IShield size={16} className="text-cyan" />}{r.label}</span>
              {r.toggle ? <Toggle on={!!r.on} onChange={r.toggle} /> : <span className={`text-[9px] font-bold px-2 py-1 rounded-md border ${r.on ? "text-ok bg-ok/10 border-ok/25" : "text-warn bg-warn/10 border-warn/25"}`}>{r.on ? "ACTIVE" : "PENDING"}</span>}
            </div>
          ))}
          <button onClick={() => { setPinErr(null); setPinSheet(true); }} className="w-full flex items-center justify-between px-4 py-3.5 text-left hover:bg-raised/60 transition-colors">
            <span className="text-[13px] font-semibold text-cyan">Change transaction PIN</span><IChevR size={15} className="text-mute" />
          </button>
        </div>

        <div className="card p-4">
          <p className="text-[10px] font-bold tracking-widest text-mute mb-3">ACTIVE SESSIONS</p>
          {store.sessions.map((s) => (
            <div key={s.id} className="flex items-center justify-between py-2.5 border-b border-line/50 last:border-0">
              <div><p className="text-[12.5px] font-semibold">{s.device}{s.current && <span className="text-[9px] font-bold text-ok ml-2">THIS DEVICE</span>}</p><p className="text-[10px] text-mute">{s.ip} • {s.location}</p></div>
              {!s.current && <button onClick={() => store.revokeSession(s.id)} className="press text-[10px] font-bold text-bad border border-bad/30 rounded-lg px-2.5 py-1.5">Revoke</button>}
            </div>
          ))}
          {store.sessions.filter((s) => !s.current).length > 0 && (
            <SBtn small variant="ghost" className="w-full mt-3" onClick={() => store.logoutOthers()}>Sign out other devices</SBtn>
          )}
        </div>

        <div className={`card p-4 border ${p.frozen ? "border-ok/30" : "border-bad/30"}`}>
          <p className="text-[13px] font-bold">{p.frozen ? "Account is frozen" : "Freeze account"}</p>
          <p className="text-[11px] text-mute mt-1 leading-relaxed">{p.frozen ? "All financial functions are blocked. Unfreeze to resume." : "Instantly block all purchases, funding and withdrawals if you suspect fraud."}</p>
          <SBtn small variant={p.frozen ? "primary" : "danger"} className="mt-3" onClick={() => store.toggleFreeze()}>{p.frozen ? "Unfreeze account" : "Freeze now"}</SBtn>
        </div>

        <div className="card p-4">
          <p className="text-[10px] font-bold tracking-widest text-mute mb-3">RECENT SECURITY EVENTS</p>
          {store.audit.slice(0, 6).map((a) => (
            <div key={a.id} className="flex items-center justify-between py-2 border-b border-line/50 last:border-0">
              <span className="text-[11.5px] font-semibold capitalize">{a.kind.replace(/_/g, " ")}</span>
              <span className="text-[9.5px] text-mute">{new Date(a.ts).toLocaleString("en-NG", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
            </div>
          ))}
          {store.audit.length === 0 && <p className="text-[11px] text-mute">No security events yet.</p>}
        </div>
      </div>

      <Sheet open={pinSheet} onClose={() => setPinSheet(false)} title="Change transaction PIN">
        <div className="space-y-4 mt-3">
          <Field label="Current PIN" type="password" inputMode="numeric" maxLength={4} value={oldPin} onChange={(e) => setOldPin(e.target.value.replace(/\D/g, ""))} />
          <Field label="New PIN" type="password" inputMode="numeric" maxLength={4} value={newPin} onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ""))} hint="4 digits — never share it" />
          {pinErr && <p className="text-xs text-bad font-semibold bg-bad/10 border border-bad/30 rounded-lg px-3 py-2">{pinErr}</p>}
          <SBtn className="w-full" disabled={oldPin.length !== 4 || newPin.length !== 4} onClick={doChangePin}>Update PIN</SBtn>
        </div>
      </Sheet>

    </div>
  );
}
