import { useEffect, useMemo, useState } from "react";
import { useStark } from "../lib/store";
import { Field, PinPad, SBtn, Scramble } from "../components/ui";
import { IcoBolt, IChevR, ICheck, IPlay, IShield, IX, StarkMark } from "../components/icons";
import AdShow from "../components/AdShow";
import { AD_IMAGES as ADS } from "../lib/data";
import { normalizeEmail, normalizePhone, isValidEmail, checkIdentity, formatPhone, IDENTITY_CODES, type IdentityCode } from "../lib/identity";

type Mode = "welcome" | "login" | "unlock" | "register" | "pin" | "otp" | "reset" | "newpin";

export default function Auth() {
  const { login, register, loadDemo, profile, toast, updateProfile, notify, accounts } = useStark();
  const [mode, setMode] = useState<Mode>("welcome");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", phone: "" });
  const [pinDraft, setPinDraft] = useState("");
  const [otpInput, setOtpInput] = useState("");
  const [resendIn, setResendIn] = useState(0);
  const [dupCode, setDupCode] = useState<IdentityCode | null>(null);
  const otpCode = useMemo(() => String(Math.floor(100000 + Math.random() * 900000)), [mode]);

  useEffect(() => {
    if (mode !== "otp" || resendIn === 0) return;
    const iv = setInterval(() => setResendIn((v) => v - 1), 1000);
    return () => clearInterval(iv);
  }, [mode, resendIn]);

  const doLogin = (pin: string) => {
    const e = login(form.phone || profile?.phone || "", pin);
    if (e) setErr(e);
    else toast("Signed in securely", "ok");
  };

  /* §5–§6 — normalize as the user types so the uniqueness check matches the backend. */
  const emailN = normalizeEmail(form.email);
  const phoneN = normalizePhone(form.phone);
  const identityCheck = useMemo(
    () => (isValidEmail(form.email) && phoneN ? checkIdentity(emailN, phoneN, accounts) : null),
    [form.email, form.phone, accounts, emailN, phoneN]
  );
  const dupExists = identityCheck !== null && !identityCheck.ok;

  const submitRegister = () => {
    setErr(null);
    if (form.name.trim().length < 2) return setErr("Enter your full name.");
    if (!isValidEmail(form.email)) return setErr("Enter a valid email address.");
    if (!phoneN) return setErr("Enter a valid Nigerian phone number — e.g. 0803 000 0000.");
    /* §9–§12 — one account per email & phone; PostgreSQL has the final say. */
    if (identityCheck && !identityCheck.ok) { setErr(identityCheck.message); setDupCode(identityCheck.code); return; }
    setDupCode(null);
    setMode("pin");
  };

  const verifyOtp = () => {
    setBusy(true);
    setTimeout(() => {
      if (otpInput !== otpCode) { setErr("That OTP doesn't match the demo SMS above."); setBusy(false); return; }
      const res = register({ ...form, pin: pinDraft });
      if (!res.ok) {
        /* Race-safe: the registry rejected the identity at the last moment. */
        setErr(res.message);
        setDupCode(res.code);
        setMode("register");
        setBusy(false);
        return;
      }
      toast("Account created — welcome to STARK", "ok");
    }, 900);
  };

  return (
    <div className="h-full flex flex-col overflow-y-auto no-scrollbar relative">
      <div className="relative px-6 pt-12 pb-6">
        <div className="absolute inset-0 pointer-events-none" style={{ background: "radial-gradient(70% 60% at 20% 0%, var(--st-glow), transparent 70%)" }} />
        <div className="flex items-center gap-3 relative">
          <span className="text-cyan relative">
            <StarkMark size={44} />
            <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-ok a-blink" />
          </span>
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
                {
                  img: ADS.appHero,
                  tag: "STARK TELECOM",
                  hue: "#00E5FF",
                  headline: <>Airtime, data, power<br />and payments — <span className="text-cyan">one ledger.</span></>,
                  sub: "Every kobo moves through an immutable double-entry ledger. If a provider fails, your money reverses automatically.",
                  chips: ["Airtime", "Data", "Cable", "Electricity", "Bulk SMS", "Exam Pins"],
                  cta: { label: "Create an account", onClick: () => { setErr(null); setMode("register"); } },
                },
                {
                  img: ADS.data,
                  tag: "DATA BUNDLES",
                  hue: "#38BDF8",
                  headline: <>Cheaper data on<br />every network.</>,
                  sub: "Live plans for MTN, Airtel, Glo & 9mobile — plus 5% cashback every Friday.",
                  cta: { label: "Join Stark", onClick: () => { setErr(null); setMode("register"); } },
                },
                {
                  img: ADS.power,
                  tag: "ELECTRICITY",
                  hue: "#F59E0B",
                  headline: <>Light up in<br />seconds.</>,
                  sub: "Prepaid tokens for every Nigerian DisCo. ₦0 fees on IKEDC & EKEDC this week.",
                  cta: { label: "Join Stark", onClick: () => { setErr(null); setMode("register"); } },
                },
                {
                  img: ADS.cable,
                  tag: "CABLE TV",
                  hue: "#8B5CF6",
                  headline: <>Never miss<br />the match.</>,
                  sub: "DSTV, GOtv & StarTimes renewals with one tap — reminders before expiry.",
                  cta: { label: "Join Stark", onClick: () => { setErr(null); setMode("register"); } },
                },
              ]}
            />

            <div className="space-y-2.5">
              <SBtn className="w-full" onClick={() => { setErr(null); setForm((f) => ({ ...f, phone: f.phone || profile?.phone || "" })); setMode(profile ? "unlock" : "login"); }}>
                Sign in{profile ? ` as ${profile.name.split(" ")[0]}` : ""} <IChevR size={16} />
              </SBtn>
              <SBtn variant="ghost" className="w-full" onClick={() => { setErr(null); setMode("register"); }}>Create an account</SBtn>
              <SBtn variant="outline" className="w-full" onClick={() => loadDemo()}>
                <IPlay size={15} /> Explore the live demo account
              </SBtn>
            </div>

            <div className="flex items-center gap-3 text-[10px] text-mute px-1 leading-relaxed">
              <IShield size={14} className="text-cyan shrink-0" />
              <p>Argon2id-hashed credentials • JWT rotation • fraud scoring on every transaction. This demo runs the full product experience in your browser.</p>
            </div>
          </div>
        )}

        {mode === "login" && (
          <div className="a-rise space-y-4">
            <div>
              <h2 className="font-display font-bold text-xl">Welcome back</h2>
              <p className="text-xs text-mute mt-1">Enter the phone number registered on this device.</p>
            </div>
            <Field label="Phone number" placeholder="0803 472 1189" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} inputMode="tel" />
            {err && <p className="text-xs text-bad font-semibold bg-bad/10 border border-bad/30 rounded-lg px-3 py-2">{err}</p>}
            <SBtn className="w-full" disabled={form.phone.replace(/\D/g, "").length < 10} onClick={() => { setErr(null); setMode("unlock"); }}>
              Continue <IChevR size={16} />
            </SBtn>
            <button className="text-xs text-cyan font-semibold mx-auto block press" onClick={() => setMode("welcome")}>← Back</button>
          </div>
        )}

        {mode === "unlock" && (
          <div>
            <div className="relative h-[470px]">
              <PinPad
                open
                onClose={() => setMode(profile ? "welcome" : "login")}
                onSubmit={doLogin}
                error={err}
                title="Enter transaction PIN"
                subtitle={`Unlock ${profile?.name ?? "your account"}`}
                showBio={profile?.biometric}
              />
            </div>
            <button className="press mx-auto block text-xs text-mute font-semibold hover:text-cyan" onClick={() => { setErr(null); setOtpInput(""); setMode("reset"); setResendIn(30); }}>
              Forgot your PIN? Reset via {profile?.email ?? "your verified email"}
            </button>
          </div>
        )}

        {mode === "reset" && (
          <div className="a-rise space-y-4">
            <div>
              <h2 className="font-display font-bold text-xl">Reset transaction PIN</h2>
              <p className="text-xs text-mute mt-1">A one-time code was sent to <span className="text-ink font-semibold">{profile?.email}</span>. A security event was logged.</p>
            </div>
            <div className="card p-4 border-cyan/30 bg-cyan/5">
              <p className="text-[10px] font-bold tracking-widest text-cyan mb-1">DEMO EMAIL • STARK-RESET</p>
              <p className="font-display text-2xl font-bold tracking-[0.35em] tnum">{otpCode}</p>
            </div>
            <input value={otpInput} onChange={(e) => setOtpInput(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric"
              className="st-input text-center font-display text-2xl tracking-[0.5em] tnum" placeholder="••••••" />
            {err && <p className="text-xs text-bad font-semibold bg-bad/10 border border-bad/30 rounded-lg px-3 py-2">{err}</p>}
            <SBtn className="w-full" disabled={otpInput.length !== 6} onClick={() => {
              if (otpInput !== otpCode) { setErr("That code doesn't match the demo email above."); return; }
              setErr(null); setPinDraft(""); setMode("newpin");
            }}>Verify code <IChevR size={16} /></SBtn>
            <button className="text-xs text-cyan font-semibold mx-auto block press" onClick={() => setMode("unlock")}>← Back</button>
          </div>
        )}

        {mode === "newpin" && (
          <div className="a-rise space-y-4">
            <div>
              <h2 className="font-display font-bold text-xl">Choose a new PIN</h2>
              <p className="text-xs text-mute mt-1">Identity verified via email OTP. Set a new 4-digit transaction PIN.</p>
            </div>
            <PinDots value={pinDraft} onChange={setPinDraft} />
            <SBtn className="w-full" disabled={pinDraft.length !== 4} onClick={() => {
              updateProfile({ pin: pinDraft });
              notify({ kind: "security", title: "Transaction PIN reset", body: "Your PIN was reset after email verification. If this wasn't you, freeze your account and contact support." });
              toast("PIN reset — sign in with your new PIN", "ok");
              setMode("unlock");
            }}>Save new PIN <ICheck size={16} /></SBtn>
          </div>
        )}

        {mode === "register" && (
          <div className="a-rise space-y-4">
            <div>
              <h2 className="font-display font-bold text-xl">Create your account</h2>
              <p className="text-xs text-mute mt-1">Your wallet is backed by a double-entry ledger from day one.</p>
            </div>
            <Field label="Full name" placeholder="Adaeze Okafor" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <div>
              <Field label="Email" placeholder="you@example.com" type="email" value={form.email} onChange={(e) => { setDupCode(null); setErr(null); setForm({ ...form, email: e.target.value }); }} />
              {form.email.trim() && isValidEmail(form.email) && emailN !== form.email.trim().toLowerCase() && (
                <p className="text-[10px] text-mute font-semibold mt-1">Stored as <span className="text-sub font-mono">{emailN}</span></p>
              )}
            </div>
            <div>
              <Field label="Phone number" placeholder="0803 000 0000" inputMode="tel" value={form.phone} onChange={(e) => { setDupCode(null); setErr(null); setForm({ ...form, phone: e.target.value }); }} />
              {form.phone.replace(/\d/g, "").length >= 10 && phoneN && (
                <p className="text-[10px] text-mute font-semibold mt-1">Nigerian format detected → <span className="text-sub font-mono">{formatPhone(phoneN)}</span></p>
              )}
            </div>

            {dupExists && identityCheck && !identityCheck.ok && (
              <div className="a-rise rounded-xl border border-warn/40 bg-warn/8 px-3.5 py-3">
                <p className="text-xs font-semibold text-warn flex items-start gap-2"><IX size={14} className="shrink-0 mt-0.5" /> {identityCheck.message}</p>
                {(identityCheck.code === IDENTITY_CODES.ACCOUNT_EXISTS || identityCheck.code === IDENTITY_CODES.PHONE_ALREADY_REGISTERED) && (
                  <button className="press mt-2 text-xs font-bold text-cyanink bg-cyan px-3.5 py-2 rounded-lg"
                    onClick={() => { setErr(null); setDupCode(null); if (phoneN) setForm((f) => ({ ...f, phone: phoneN })); setMode("login"); }}>
                    Sign in to the existing account <IChevR size={13} className="inline -mt-0.5" />
                  </button>
                )}
              </div>
            )}

            {err && !dupExists && <p className="text-xs text-bad font-semibold bg-bad/10 border border-bad/30 rounded-lg px-3 py-2">{err}</p>}
            <SBtn className="w-full" onClick={submitRegister}>Continue <IChevR size={16} /></SBtn>
            <button className="text-xs text-cyan font-semibold mx-auto block press" onClick={() => setMode("welcome")}>← Back</button>
          </div>
        )}

        {mode === "pin" && (
          <div className="a-rise space-y-4">
            <div>
              <h2 className="font-display font-bold text-xl">Set a transaction PIN</h2>
              <p className="text-xs text-mute mt-1">4 digits, used to authorize every purchase. Hashed — never stored in plain text.</p>
            </div>
            <PinDots value={pinDraft} onChange={setPinDraft} />
            <SBtn className="w-full" disabled={pinDraft.length !== 4} onClick={() => { setErr(null); setOtpInput(""); setMode("otp"); setResendIn(30); }}>
              Create account <IChevR size={16} />
            </SBtn>
            <button className="text-xs text-cyan font-semibold mx-auto block press" onClick={() => setMode("register")}>← Back</button>
          </div>
        )}

        {mode === "otp" && (
          <div className="a-rise space-y-4">
            <div>
              <h2 className="font-display font-bold text-xl">Verify your number</h2>
              <p className="text-xs text-mute mt-1">We sent a 6-digit code to <span className="text-ink font-semibold">{form.phone}</span>.</p>
            </div>
            <div className="card p-4 border-cyan/30 bg-cyan/5">
              <p className="text-[10px] font-bold tracking-widest text-cyan mb-1">DEMO SMS • STARK-OTP</p>
              <p className="font-display text-2xl font-bold tracking-[0.35em] tnum">{otpCode}</p>
            </div>
            <input
              value={otpInput}
              onChange={(e) => setOtpInput(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              className="st-input text-center font-display text-2xl tracking-[0.5em] tnum"
              placeholder="••••••"
            />
            {err && <p className="text-xs text-bad font-semibold bg-bad/10 border border-bad/30 rounded-lg px-3 py-2">{err}</p>}
            <SBtn className="w-full" loading={busy} disabled={otpInput.length !== 6} onClick={verifyOtp}>
              {busy ? "Verifying…" : <>Verify & continue <ICheck size={16} /></>}
            </SBtn>
            <div className="flex justify-between items-center">
              <button className="text-xs text-mute press" onClick={() => setMode("pin")}>← Back</button>
              <button className="text-xs text-cyan font-semibold press disabled:opacity-40" disabled={resendIn > 0} onClick={() => { setResendIn(30); toast("New OTP sent (demo)", "info"); }}>
                {resendIn > 0 ? `Resend in ${resendIn}s` : "Resend code"}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="px-6 pb-6 text-center text-[10px] text-mute">
        <IcoBolt size={10} className="inline text-cyan mr-1" /> STARK v2.4.1 • Lagos edge • Secured by Stark Ledger Core
      </div>
    </div>
  );
}

function PinDots({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <div className="flex justify-center gap-3 mb-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={`w-3.5 h-3.5 rounded-full border-2 transition-all ${i < value.length ? "bg-cyan border-cyan shadow-[0_0_12px_var(--st-glow)]" : "border-line"}`} />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2.5 max-w-[260px] mx-auto">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <button key={d} onClick={() => value.length < 4 && onChange(value + d)} className="press rounded-xl bg-well border border-line font-display text-xl font-semibold hover:border-cyan/50" style={{ height: 52 }}>{d}</button>
        ))}
        <span />
        <button onClick={() => value.length < 4 && onChange(value + "0")} className="press rounded-xl bg-well border border-line font-display text-xl font-semibold hover:border-cyan/50" style={{ height: 52 }}>0</button>
        <button onClick={() => onChange(value.slice(0, -1))} className="press rounded-xl bg-well border border-line text-sub font-display text-sm hover:text-bad" style={{ height: 52 }}>⌫</button>
      </div>
    </div>
  );
}
