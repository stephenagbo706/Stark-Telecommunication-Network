import { useEffect, useMemo, useState } from "react";
import { useStark } from "../lib/store";
import { normalizeEmail, normalizePhone, isValidEmail, checkIdentity, type IdentityCode } from "../lib/identity";
import { Field, PinPad, SBtn, Scramble, BrandLockup } from "../components/ui";
import { IChevR, ICheck, IShield, IX } from "../components/icons";
import AdShow from "../components/AdShow";
import { AD_IMAGES as ADS } from "../lib/data";

type Mode = "welcome" | "login" | "unlock" | "register" | "pin" | "otp" | "reset" | "newpin";

export default function Auth() {
  const { login, register, profile, toast, updateProfile, notify, accounts } = useStark();
  const [mode, setMode] = useState<Mode>("welcome");
  const [form, setForm] = useState({ name: "", phone: "", email: "" });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pinDraft, setPinDraft] = useState("");
  const [otpInput, setOtpInput] = useState("");
  const [resendIn, setResendIn] = useState(0);
  const [dupCode, setDupCode] = useState<IdentityCode | null>(null);

  const otpCode = useMemo(() => String(Math.floor(100000 + Math.random() * 900000)), [mode]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn(resendIn - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  /* live normalization + identity pre-check */
  const emailN = normalizeEmail(form.email);
  const phoneN = normalizePhone(form.phone);
  const identityCheck = useMemo(
    () => (isValidEmail(form.email) && phoneN ? checkIdentity(emailN, phoneN, accounts) : null),
    [form.email, form.phone, accounts, emailN, phoneN]
  );
  const dupExists = identityCheck !== null && !identityCheck.ok;

  const doLogin = (pin: string) => {
    setBusy(true);
    setTimeout(() => {
      const res = login(form.phone || profile?.phone || "", pin);
      setBusy(false);
      if (res) { setErr(res); }
      else { setErr(null); toast(`Welcome back${profile ? `, ${profile.name.split(" ")[0]}` : ""}`, "ok"); }
    }, 650);
  };

  const submitRegister = () => {
    setErr(null);
    if (form.name.trim().length < 2) return setErr("Enter your full name.");
    if (!isValidEmail(form.email)) return setErr("Enter a valid email address.");
    if (!phoneN) return setErr("Enter a valid Nigerian phone number — e.g. 0803 000 0000.");
    if (identityCheck && !identityCheck.ok) { setErr(identityCheck.message); setDupCode(identityCheck.code); return; }
    setDupCode(null);
    setMode("pin");
  };

  const verifyOtp = () => {
    setBusy(true);
    setTimeout(() => {
      if (otpInput !== otpCode) { setErr("That OTP doesn't match the code sent to your phone."); setBusy(false); return; }
      const res = register({ ...form, pin: pinDraft });
      if (!res.ok) {
        setErr(res.message);
        setDupCode(res.code);
        setMode("register");
        setBusy(false);
        return;
      }
      toast("Account created — welcome to STARK", "ok");
    }, 900);
  };

  const goToSignIn = () => {
    setErr(null);
    setForm((f) => ({ ...f, phone: f.phone || profile?.phone || "" }));
    setMode(profile ? "unlock" : "login");
  };

  return (
    <div className="h-full flex flex-col overflow-y-auto no-scrollbar relative">
      <div className="relative px-6 pt-12 pb-6">
        <div className="absolute inset-0 pointer-events-none" style={{ background: "radial-gradient(70% 60% at 20% 0%, var(--st-glow), transparent 70%)" }} />
        <div className="flex items-center gap-3 relative">
          <BrandLockup size={44} />
          <div>
            <h1 className="font-display font-bold text-[26px] tracking-tight leading-none"><Scramble text="STARK" /></h1>
            <p className="text-[10px] tracking-[0.28em] text-mute font-semibold mt-1">TELECOMMUNICATION</p>
          </div>
        </div>
        <div className="mt-5 flex items-center gap-2 text-[10px] text-mute font-semibold">
          <span className="w-1.5 h-1.5 rounded-full bg-ok a-blink" />
          VTU CORE ONLINE
          <span className="text-line">•</span> LAGOS EDGE 14ms
          <span className="text-line">•</span> 99.98% UPTIME
        </div>
      </div>

      <div className="flex-1 px-6 pb-6">
        {mode === "welcome" && (
          <div className="a-rise space-y-5">
            <AdShow
              slides={[
                { img: ADS.appHero, tag: "STARK TELECOM", hue: "#00E5FF", headline: <>Airtime, data, power<br />and payments — <span className="text-cyan">one ledger.</span></>, sub: "Every kobo moves through an immutable double-entry ledger. If a provider fails, your money reverses automatically.", chips: ["Airtime", "Data", "Cable", "Electricity", "Bulk SMS", "Exam Pins"], cta: { label: "Create an account", onClick: () => { setErr(null); setMode("register"); } } },
                { img: ADS.data, tag: "DATA BUNDLES", hue: "#38BDF8", headline: <>Cheaper data on<br />every network.</>, sub: "Live plans for MTN, Airtel, Glo & 9mobile — plus 5% cashback every Friday.", cta: { label: "Join Stark", onClick: () => { setErr(null); setMode("register"); } } },
                { img: ADS.power, tag: "ELECTRICITY", hue: "#F59E0B", headline: <>Light up in<br />seconds.</>, sub: "Prepaid tokens for every Nigerian DisCo. ₦0 fees on IKEDC & EKEDC this week.", cta: { label: "Join Stark", onClick: () => { setErr(null); setMode("register"); } } },
                { img: ADS.cable, tag: "CABLE TV", hue: "#8B5CF6", headline: <>Never miss<br />the match.</>, sub: "DSTV, GOtv & StarTimes renewals with one tap — reminders before expiry.", cta: { label: "Join Stark", onClick: () => { setErr(null); setMode("register"); } } },
              ]}
            />

            <div className="space-y-2.5">
              <SBtn className="w-full" onClick={goToSignIn}>Sign in{profile ? ` as ${profile.name.split(" ")[0]}` : ""} <IChevR size={16} /></SBtn>
              <SBtn variant="ghost" className="w-full" onClick={() => { setErr(null); setMode("register"); }}>Create an account</SBtn>
            </div>

            <div className="flex items-center gap-3 text-[10px] text-mute px-1 leading-relaxed">
              <IShield size={14} className="text-cyan shrink-0" />
              <p>Argon2id-hashed credentials • JWT rotation • fraud scoring on every transaction. Sign in or create an account to get started.</p>
            </div>
          </div>
        )}

        {(mode === "login" || mode === "unlock") && (
          <div className="a-rise space-y-4">
            <div>
              <h2 className="font-display font-bold text-xl">{profile ? `Welcome back, ${profile.name.split(" ")[0]}` : "Sign in"}</h2>
              <p className="text-xs text-mute mt-1">Enter your registered phone number, then your transaction PIN.</p>
            </div>
            {!profile && <Field label="Phone number" inputMode="tel" placeholder="0803 000 0000" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} hint={phoneN ? `Normalized to ${phoneN}` : undefined} />}
            {err && <p className="text-xs text-bad font-semibold bg-bad/10 border border-bad/30 rounded-lg px-3 py-2">{err}</p>}
            <SBtn className="w-full" onClick={() => { setErr(null); setMode("unlock"); }} disabled={!profile && !phoneN}>Continue to PIN <IChevR size={16} /></SBtn>
            <button className="text-xs text-cyan font-semibold mx-auto block press" onClick={() => setMode("welcome")}>← Back</button>
          </div>
        )}

        {mode === "unlock" && (
          <div>
            <div className="relative h-[470px]">
              <PinPad open onClose={() => setMode(profile ? "welcome" : "login")} onSubmit={doLogin} busy={busy} error={err}
                title="Enter transaction PIN" subtitle={`Unlock ${profile?.name ?? "your account"}`} showBio={profile?.biometric} />
            </div>
          </div>
        )}

        {mode === "register" && (
          <div className="a-rise space-y-4">
            <div>
              <h2 className="font-display font-bold text-xl">Create your account</h2>
              <p className="text-xs text-mute mt-1">One account per email and phone. Your wallet starts at ₦0.00.</p>
            </div>
            <Field label="Full name" placeholder="Adaeze Okafor" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <Field label="Email" type="email" placeholder="you@example.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
              hint={emailN && isValidEmail(form.email) ? `Will be stored as ${emailN}` : undefined}
              error={dupCode === "ACCOUNT_EXISTS" && dupExists ? "Already registered — sign in instead." : undefined} />
            <Field label="Phone number" inputMode="tel" placeholder="0803 000 0000" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
              hint={phoneN ? `Normalized to ${phoneN}` : undefined}
              error={dupCode === "PHONE_ALREADY_REGISTERED" && dupExists ? "Already registered — sign in instead." : undefined} />
            {dupExists && (
              <div className="a-rise bg-warn/10 border border-warn/30 rounded-xl px-3.5 py-3">
                <p className="text-[11.5px] font-semibold text-warn flex items-start gap-2"><IX size={13} className="shrink-0 mt-0.5" /> {identityCheck && !identityCheck.ok ? identityCheck.message : ""}</p>
                {(dupCode === "ACCOUNT_EXISTS" || dupCode === "PHONE_ALREADY_REGISTERED") && (
                  <button onClick={goToSignIn} className="press mt-2 text-[11px] font-bold text-cyan inline-flex items-center gap-1">Sign in to the existing account <IChevR size={12} /></button>
                )}
              </div>
            )}
            {err && !dupExists && <p className="text-xs text-bad font-semibold bg-bad/10 border border-bad/30 rounded-lg px-3 py-2">{err}</p>}
            <SBtn className="w-full" onClick={submitRegister} disabled={dupExists}>Continue <IChevR size={16} /></SBtn>
            <button className="text-xs text-cyan font-semibold mx-auto block press" onClick={() => setMode("welcome")}>← Back</button>
          </div>
        )}

        {mode === "pin" && (
          <div className="relative h-[470px]">
            <PinPad open onClose={() => setMode("register")} onSubmit={(pin) => { setPinDraft(pin); setErr(null); setOtpInput(""); setResendIn(30); setMode("otp"); }}
              title="Set a transaction PIN" subtitle="4 digits — used to authorize every payment" />
          </div>
        )}

        {mode === "otp" && (
          <div className="a-rise space-y-4">
            <div>
              <h2 className="font-display font-bold text-xl">Verify your phone</h2>
              <p className="text-xs text-mute mt-1">We sent a 6-digit code to <span className="text-ink font-semibold">{phoneN}</span>.</p>
            </div>
            <div className="card p-4 border-cyan/30 bg-cyan/5">
              <p className="text-[10px] font-bold tracking-widest text-cyan mb-1">SMS CODE • STARK-OTP</p>
              <p className="font-display text-2xl font-bold tracking-[0.35em] tnum">{otpCode}</p>
            </div>
            <input value={otpInput} onChange={(e) => setOtpInput(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric"
              className="st-input text-center font-display text-2xl tracking-[0.5em] tnum" placeholder="••••••" />
            {err && <p className="text-xs text-bad font-semibold bg-bad/10 border border-bad/30 rounded-lg px-3 py-2">{err}</p>}
            <SBtn className="w-full" loading={busy} disabled={otpInput.length !== 6} onClick={verifyOtp}>Verify & create account <ICheck size={16} /></SBtn>
            <div className="flex items-center justify-between">
              <button className="text-xs text-mute press" onClick={() => setMode("pin")}>← Back</button>
              <button className="text-xs text-cyan font-semibold press disabled:opacity-40" disabled={resendIn > 0} onClick={() => { setResendIn(30); toast("New verification code sent", "info"); }}>
                {resendIn > 0 ? `Resend in ${resendIn}s` : "Resend code"}
              </button>
            </div>
          </div>
        )}
      </div>

    </div>
  );
}
