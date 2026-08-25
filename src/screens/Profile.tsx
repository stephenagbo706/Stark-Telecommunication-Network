import { useRef, useState } from "react";
import { useStark, timeAgo, fmtDate, money0 } from "../lib/store";
import { Avatar, Field, PinPad, Progress, SBtn, ScreenHeader, Sheet, StatusBadge, Toggle, useNav } from "../components/ui";
import { IBank, IBell, ICamera, ICheck, IChevR, ICopy, IDoc, IEdit, IFinger, IGauge, IHeadset, IInfo, ILock, IOut, ISnow, IStar, ITrash, IUser, IUsers, IMoon, ISun, IShield, IX } from "../components/icons";

export default function Profile() {
  const nav = useNav();
  const store = useStark();
  const p = store.profile!;
  const [avatarSheet, setAvatarSheet] = useState(false);
  const [editSheet, setEditSheet] = useState(false);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const [edit, setEdit] = useState({ name: p.name, email: p.email });

  const pick = (file?: File) => {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) { store.toast("Only JPEG, PNG or WEBP images are allowed", "bad"); return; }
    if (file.size > 8 * 1024 * 1024) { store.toast("Image is too large (max 8MB)", "bad"); return; }
    setAvatarSheet(false);
    setUploadPct(0);
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const s = Math.min(320, Math.max(img.width, img.height));
        canvas.width = 320; canvas.height = 320;
        const ctx = canvas.getContext("2d")!;
        const scale = s / Math.min(img.width, img.height) * (320 / s) * (s / 320);
        const ratio = Math.max(320 / img.width, 320 / img.height);
        ctx.drawImage(img, (320 - img.width * ratio) / 2, (320 - img.height * ratio) / 2, img.width * ratio, img.height * ratio);
        void scale;
        const out = canvas.toDataURL("image/jpeg", 0.82);
        let pct = 0;
        const iv = setInterval(() => {
          pct += 14 + Math.random() * 18;
          if (pct >= 100) {
            clearInterval(iv);
            setUploadPct(null);
            store.setAvatar(out);
            store.toast("Profile photo updated", "ok");
          } else setUploadPct(pct);
        }, 120);
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const rows: { icon: React.ReactNode; label: string; sub: string; onClick: () => void; danger?: boolean }[] = [
    { icon: <IShield size={18} />, label: "Security Centre", sub: "PIN, biometrics, freeze, sessions", onClick: () => nav.push({ name: "security" }) },
    { icon: <IStar size={18} />, label: "STARK Rewards", sub: `${store.points} points • Silver`, onClick: () => nav.push({ name: "rewards" }) },
    { icon: <IUsers size={18} />, label: "Referrals", sub: `${p.referralCode} • ${money0(p.refEarned)} earned`, onClick: () => nav.push({ name: "referrals" }) },
    { icon: <IGauge size={18} />, label: "Stark Turbo", sub: "Connection diagnostics", onClick: () => nav.push({ name: "diagnostics" }) },
    { icon: <IBell size={18} />, label: "Notifications", sub: `${store.notifications.filter((n) => !n.read).length} unread`, onClick: () => nav.push({ name: "notifications" }) },
    { icon: <IHeadset size={18} />, label: "Help Centre", sub: "FAQs, tickets & disputes", onClick: () => nav.push({ name: "help" }) },
  ];

  return (
    <div className="pb-28">
      <div className="px-5 pt-4 pb-2 flex items-center justify-between">
        <h1 className="font-display font-bold text-xl">Profile</h1>
        <button onClick={() => store.setTheme(store.theme === "dark" ? "light" : "dark")} className="press w-10 h-10 rounded-xl bg-panel border border-line grid place-items-center text-sub hover:text-cyan" aria-label="Toggle theme">
          {store.theme === "dark" ? <ISun size={18} /> : <IMoon size={18} />}
        </button>
      </div>

      {p.frozen && (
        <div className="px-5 mt-2">
          <div className="a-pop card border-bad/40 bg-bad/8 px-4 py-3 flex items-center gap-3">
            <ISnow size={18} className="text-bad" />
            <div className="flex-1">
              <p className="text-[13px] font-bold text-bad">Account frozen</p>
              <p className="text-[10px] text-sub font-semibold">Purchases and wallet movement are blocked.</p>
            </div>
            <SBtn small variant="danger" onClick={() => store.toggleFreeze()}>Unfreeze</SBtn>
          </div>
        </div>
      )}

      {/* identity card */}
      <div className="px-5 mt-3">
        <div className="card p-5 relative overflow-hidden">
          <div className="absolute inset-0 grid-bg opacity-20 grid-fade" />
          <div className="relative flex items-center gap-4">
            <button className="press relative group" onClick={() => setAvatarSheet(true)}>
              <Avatar name={p.name} src={p.avatar} size={72} ring />
              <span className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-cyan text-cyanink grid place-items-center border-2 border-void group-hover:scale-110 transition-transform"><ICamera size={13} /></span>
              {uploadPct !== null && (
                <span className="absolute inset-0 rounded-full bg-black/70 grid place-items-center text-[11px] font-bold text-cyan tnum">{Math.round(uploadPct)}%</span>
              )}
            </button>
            <div className="flex-1 min-w-0">
              <h2 className="font-display font-bold text-lg leading-tight truncate">{p.name}</h2>
              <p className="text-[11px] text-mute font-semibold">{p.phone} • since {fmtDate(p.joinedAt)}</p>
              <div className="flex gap-1.5 mt-2 flex-wrap">
                <VChip ok={p.phoneVerified} label="Phone" />
                <VChip ok={p.emailVerified} label="Email" />
                <VChip ok label="PIN" />
                <VChip ok={p.biometric} label="Biometrics" />
              </div>
            </div>
          </div>
          <button onClick={() => { setEdit({ name: p.name, email: p.email }); setEditSheet(true); }} className="press relative mt-4 w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-line text-xs font-bold text-sub hover:text-cyan hover:border-cyan/40">
            <IEdit size={14} /> Change photo or edit details
          </button>
        </div>
      </div>

      {/* menu */}
      <div className="px-5 mt-4">
        <div className="card divide-y divide-line/70 overflow-hidden">
          {rows.map((r) => (
            <button key={r.label} onClick={r.onClick} className="w-full flex items-center gap-3.5 px-4 py-3.5 text-left hover:bg-raised/60 transition-colors press">
              <span className="w-9 h-9 rounded-xl bg-well border border-line text-cyan grid place-items-center">{r.icon}</span>
              <span className="flex-1">
                <span className="block text-[13px] font-bold">{r.label}</span>
                <span className="block text-[10px] text-mute font-semibold">{r.sub}</span>
              </span>
              <IChevR size={15} className="text-mute" />
            </button>
          ))}
        </div>
      </div>

      <div className="px-5 mt-4">
        <button onClick={() => { store.logout(); store.toast("Signed out securely", "info"); }} className="press w-full card border-bad/30 px-4 py-3.5 flex items-center gap-3.5 text-left hover:bg-bad/8">
          <span className="w-9 h-9 rounded-xl bg-bad/10 border border-bad/25 text-bad grid place-items-center"><IOut size={17} /></span>
          <span className="flex-1 text-[13px] font-bold text-bad">Sign out</span>
          <ILock size={14} className="text-mute" />
        </button>
        <p className="text-[10px] text-mute text-center mt-4 flex items-center justify-center gap-1"><IInfo size={11} /> STARK v2.4.1 • Ledger Core v3 • Lagos edge</p>
      </div>

      {/* avatar sheet */}
      <Sheet open={avatarSheet} onClose={() => setAvatarSheet(false)} title="Profile photo">
        <div className="space-y-2.5 mt-3">
          <input ref={camRef} type="file" accept="image/*" capture="user" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
          <button onClick={() => camRef.current?.click()} className="press w-full flex items-center gap-3 card px-4 py-3.5 hover:border-cyan/40">
            <span className="w-9 h-9 rounded-xl bg-cyan/10 text-cyan grid place-items-center border border-cyan/25"><ICamera size={17} /></span>
            <span className="text-[13px] font-bold">Take photo</span>
          </button>
          <button onClick={() => fileRef.current?.click()} className="press w-full flex items-center gap-3 card px-4 py-3.5 hover:border-cyan/40">
            <span className="w-9 h-9 rounded-xl bg-info/10 text-info grid place-items-center border border-info/25"><IDoc size={17} /></span>
            <span className="text-[13px] font-bold">Choose from gallery</span>
          </button>
          {p.avatar && (
            <button onClick={() => { store.setAvatar(undefined); setAvatarSheet(false); store.toast("Photo removed", "info"); }} className="press w-full flex items-center gap-3 card border-bad/30 px-4 py-3.5 hover:bg-bad/8">
              <span className="w-9 h-9 rounded-xl bg-bad/10 text-bad grid place-items-center border border-bad/25"><ITrash size={16} /></span>
              <span className="text-[13px] font-bold text-bad">Remove photo</span>
            </button>
          )}
          <p className="text-[10px] text-mute leading-relaxed px-1 pt-1">JPEG, PNG or WEBP up to 8MB. Photos are compressed on-device, validated server-side and stored in object storage — never inside the database.</p>
        </div>
      </Sheet>

      {/* edit sheet */}
      <Sheet open={editSheet} onClose={() => setEditSheet(false)} title="Personal information">
        <div className="space-y-4 mt-3">
          <Field label="Full name" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
          <Field label="Email" type="email" value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} />
          <div className="flex items-center justify-between card px-4 py-3">
            <span className="text-xs font-bold text-sub">Phone • {p.phone}</span>
            <span className="text-[10px] font-bold text-ok flex items-center gap-1"><ICheck size={12} /> VERIFIED</span>
          </div>
          {!p.emailVerified && (
            <SBtn variant="ghost" className="w-full" onClick={() => { store.updateProfile({ emailVerified: true }); store.toast("Email verified", "ok"); }}>
              Verify email now
            </SBtn>
          )}
          <SBtn className="w-full" disabled={edit.name.trim().length < 2} onClick={() => { store.updateProfile({ name: edit.name.trim(), email: edit.email.trim() }); setEditSheet(false); store.toast("Profile updated", "ok"); }}>
            Save changes
          </SBtn>
        </div>
      </Sheet>
    </div>
  );
}

function VChip({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded border ${ok ? "text-ok bg-ok/10 border-ok/25" : "text-warn bg-warn/10 border-warn/25"}`}>
      {ok ? <ICheck size={9} sw={3} /> : <IX size={9} sw={3} />} {label.toUpperCase()}
    </span>
  );
}

/* ================= security centre ================= */
export function Security() {
  const nav = useNav();
  const store = useStark();
  const p = store.profile!;
  const [pinSheet, setPinSheet] = useState(false);
  const [freezePin, setFreezePin] = useState(false);
  const [oldPin, setOldPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [pinErr, setPinErr] = useState<string | null>(null);

  const score = [p.phoneVerified, p.emailVerified, p.pin.length === 4, p.biometric, p.twoFA].filter(Boolean).length * 20;

  return (
    <div className="h-full flex flex-col">
      <ScreenHeader title="Security Centre" sub="Fraud-scored • audit-logged" onBack={nav.pop} />
      <div className="flex-1 overflow-y-auto no-scrollbar px-5 pb-28 space-y-4">
        <div className="card p-5">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-bold tracking-widest text-mute">SECURITY SCORE</p>
            <span className={`font-display font-bold text-xl ${score >= 80 ? "text-ok" : score >= 60 ? "text-warn" : "text-bad"}`}>{score}%</span>
          </div>
          <Progress value={score} hue={score >= 80 ? "var(--st-ok)" : "var(--st-warn)"} />
          <p className="text-[10px] text-mute mt-2.5 leading-relaxed">{score >= 80 ? "Strong. Every sensitive action is protected." : "Enable 2FA and biometrics to harden your account."}</p>
        </div>

        <div className="card divide-y divide-line/70 overflow-hidden">
          <ToggleRow icon={<IFinger size={17} />} label="Biometric unlock" sub="Fingerprint / Face for app & purchases" on={p.biometric} onToggle={() => { store.updateProfile({ biometric: !p.biometric }); store.toast(p.biometric ? "Biometrics disabled" : "Biometrics enabled", "ok"); }} />
          <ToggleRow icon={<IShield size={17} />} label="Two-factor authentication" sub="OTP on new device sign-ins" on={p.twoFA} onToggle={() => { store.updateProfile({ twoFA: !p.twoFA }); store.notify({ kind: "security", title: p.twoFA ? "2FA disabled" : "2FA enabled", body: p.twoFA ? "New devices can sign in with PIN only." : "New devices now require a one-time code." }); }} />
          <button onClick={() => { setPinErr(null); setOldPin(""); setNewPin(""); setPinSheet(true); }} className="w-full flex items-center gap-3.5 px-4 py-3.5 text-left hover:bg-raised/60 press">
            <span className="w-9 h-9 rounded-xl bg-well border border-line text-cyan grid place-items-center"><ILock size={16} /></span>
            <span className="flex-1"><span className="block text-[13px] font-bold">Change transaction PIN</span><span className="block text-[10px] text-mute font-semibold">Hashed with Argon2id</span></span>
            <IChevR size={15} className="text-mute" />
          </button>
          <button onClick={() => { setPinErr(null); setFreezePin(true); }} className="w-full flex items-center gap-3.5 px-4 py-3.5 text-left hover:bg-bad/8 press">
            <span className="w-9 h-9 rounded-xl bg-bad/10 border border-bad/25 text-bad grid place-items-center"><ISnow size={16} /></span>
            <span className="flex-1"><span className="block text-[13px] font-bold text-bad">{p.frozen ? "Unfreeze account" : "Freeze account"}</span><span className="block text-[10px] text-mute font-semibold">{p.frozen ? "Restore full access" : "Instantly block all money movement"}</span></span>
          </button>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2.5">
            <h3 className="font-display font-bold text-[15px]">Devices & sessions</h3>
            {!p.frozen && <button onClick={() => store.logoutOthers()} className="press text-[11px] font-bold text-bad">Sign out others</button>}
          </div>
          <div className="card divide-y divide-line/70 overflow-hidden">
            {(store.sessions.length ? store.sessions : store.devices.map((d) => ({ id: d.id, device: d.name, platform: d.platform, ip: "", location: "", createdAt: d.lastActive, lastUsedAt: d.lastActive, current: d.current, trusted: false }))).map((s) => (
              <div key={s.id} className="flex items-center gap-3 px-4 py-3.5">
                <span className={`w-9 h-9 rounded-xl grid place-items-center border ${s.current ? "bg-cyan/12 text-cyan border-cyan/25" : "bg-well text-sub border-line"}`}><IUser size={16} /></span>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-bold truncate">
                    {s.device}
                    {s.current && <span className="text-[9px] font-bold text-ok bg-ok/10 border border-ok/25 px-1.5 py-0.5 rounded ml-1">CURRENT</span>}
                    {!s.current && !s.trusted && <span className="text-[9px] font-bold text-warn bg-warn/10 border border-warn/25 px-1.5 py-0.5 rounded ml-1">UNTRUSTED</span>}
                  </p>
                  <p className="text-[10px] text-mute font-semibold truncate">{s.platform}{s.location ? ` • ${s.location}` : ""} • active {timeAgo(s.lastUsedAt)}</p>
                </div>
                {!s.current && (
                  <button onClick={() => store.revokeSession(s.id)} className="press shrink-0 text-[10px] font-bold text-bad border border-bad/30 rounded-lg px-2.5 py-1.5 hover:bg-bad/10">
                    Revoke
                  </button>
                )}
              </div>
            ))}
          </div>
          {store.audit.length > 0 && (
            <div className="mt-3 card px-4 py-3.5">
              <p className="text-[10px] font-bold tracking-widest text-mute mb-2.5">RECENT SECURITY EVENTS</p>
              <div className="space-y-2">
                {store.audit.slice(0, 4).map((a) => (
                  <div key={a.id} className="flex items-center gap-2.5 text-[11px]">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${a.kind.includes("failed") ? "bg-bad" : a.kind.includes("new_device") ? "bg-warn" : "bg-ok"}`} />
                    <span className="flex-1 text-sub font-semibold truncate">{a.detail}</span>
                    <span className="text-[9px] text-mute font-mono shrink-0">{a.kind}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div>
          <h3 className="font-display font-bold text-[15px] mb-2.5">Login history</h3>
          <div className="card divide-y divide-line/70 overflow-hidden">
            {store.logins.slice(0, 5).map((l, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3">
                <span className={`w-2 h-2 rounded-full shrink-0 ${l.status === "success" ? "bg-ok" : "bg-bad"}`} />
                <div className="flex-1">
                  <p className="text-[12px] font-bold">{l.device} <span className="text-mute font-semibold">• {l.location}</span></p>
                  <p className="text-[10px] text-mute font-semibold font-mono">{l.ip} • {timeAgo(l.ts)}</p>
                </div>
                <StatusBadge status={l.status === "success" ? "SUCCESSFUL" : "FAILED"} />
              </div>
            ))}
          </div>
        </div>

        <p className="text-[10px] text-mute leading-relaxed flex items-start gap-1.5 px-1">
          <IBank size={12} className="shrink-0 mt-0.5 text-cyan" /> Suspicious sign-ins trigger automatic step-up verification and a security alert. Biometric data never leaves this device.
        </p>
      </div>

      <Sheet open={pinSheet} onClose={() => setPinSheet(false)} title="Change transaction PIN">
        <div className="space-y-4 mt-3">
          <Field label="Current PIN" type="password" inputMode="numeric" maxLength={4} value={oldPin} onChange={(e) => setOldPin(e.target.value.replace(/\D/g, ""))} />
          <Field label="New PIN (4 digits)" type="password" inputMode="numeric" maxLength={4} value={newPin} onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ""))} hint="Avoid birthdays and repeated digits." />
          {pinErr && <p className="text-xs text-bad font-semibold bg-bad/10 border border-bad/30 rounded-lg px-3 py-2">{pinErr}</p>}
          <SBtn className="w-full" disabled={oldPin.length !== 4 || newPin.length !== 4} onClick={() => {
            const e = store.changePin(oldPin, newPin);
            if (e) setPinErr(e);
            else { setPinSheet(false); store.toast("Transaction PIN updated", "ok"); }
          }}>Update PIN</SBtn>
        </div>
      </Sheet>

      <PinPad open={freezePin} onClose={() => setFreezePin(false)} error={pinErr}
        title={p.frozen ? "Confirm unfreeze" : "Confirm freeze"}
        subtitle={p.frozen ? "Restore wallet and purchase access" : "Blocks purchases, funding and withdrawals"}
        onSubmit={(pin) => {
          if (pin !== p.pin) { setPinErr("Incorrect PIN."); return; }
          store.toggleFreeze();
          setFreezePin(false);
          store.toast(p.frozen ? "Account unfrozen" : "Account frozen — money movement blocked", p.frozen ? "ok" : "info");
        }} />
    </div>
  );
}

function ToggleRow({ icon, label, sub, on, onToggle }: { icon: React.ReactNode; label: string; sub: string; on: boolean; onToggle: () => void }) {
  return (
    <div className="flex items-center gap-3.5 px-4 py-3.5">
      <span className="w-9 h-9 rounded-xl bg-well border border-line text-cyan grid place-items-center">{icon}</span>
      <div className="flex-1">
        <p className="text-[13px] font-bold">{label}</p>
        <p className="text-[10px] text-mute font-semibold">{sub}</p>
      </div>
      <Toggle on={on} onChange={onToggle} />
    </div>
  );
}
