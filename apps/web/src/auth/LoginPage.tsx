import { useEffect, useRef, useState, type FormEvent } from "react";
import { auth, type Account } from "../api";

type Step =
  | { kind: "email" }
  | { kind: "password"; email: string }
  | { kind: "code"; email: string }
  | { kind: "create-password"; account: Account };

/**
 * Sign in or sign up. New students get an email code, then create a password.
 * Returning students use their password, or an email code if they forgot it.
 */
export function LoginPage({ account, onDone, onSkip }: { account?: Account | null; onDone: (a: Account) => void; onSkip?: () => void }) {
  // Signed in from an email code but no password yet: go straight to creating one.
  const [step, setStep] = useState<Step>(account && !account.hasPassword ? { kind: "create-password", account } : { kind: "email" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const firstInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (account && !account.hasPassword) setStep((s) => (s.kind === "email" ? { kind: "create-password", account } : s));
  }, [account]);

  useEffect(() => {
    setError(null);
    firstInput.current?.focus();
  }, [step.kind]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const sendCode = (to: string) =>
    run(async () => {
      await auth.requestCode(to);
      setCode("");
      setNotice(`We sent a 6-digit code to ${to}.`);
      setStep({ kind: "code", email: to });
    });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    switch (step.kind) {
      case "email":
        return void sendCode(email.trim());
      case "password":
        return void run(async () => onDone((await auth.login(step.email, password)).user));
      case "code":
        return void run(async () => {
          const r = await auth.verifyCode(step.email, code);
          if (r.needsPassword) {
            setPassword("");
            setStep({ kind: "create-password", account: r.user });
          } else onDone(r.user);
        });
      case "create-password":
        return void run(async () => onDone((await auth.setPassword(password)).user));
    }
  };

  return (
    <main className="login">
      <form className="login-card" onSubmit={submit} aria-describedby={error ? "login-error" : undefined}>
        <div className="login-brand">
          <img src="/icons/icon128.png" className="app-logo" alt="" width={36} height={36} />
          <span>Writalin</span>
        </div>

        {step.kind === "email" && (
          <>
            <h1>Sign in or create an account</h1>
            <p className="w-muted">An account lets your notes follow you to any computer. Your notes stay saved on this device too.</p>
            <label className="w-field">
              <span>Email</span>
              <input ref={firstInput} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@school.edu" />
            </label>
            <button className="w-btn w-btn-primary login-submit" disabled={busy || !email.trim()}>
              {busy ? "Sending…" : "Email me a code"}
            </button>
            <button type="button" className="w-btn w-btn-ghost" disabled={!email.trim()} onClick={() => setStep({ kind: "password", email: email.trim().toLowerCase() })}>
              I have a password
            </button>
          </>
        )}

        {step.kind === "password" && (
          <>
            <h1>Welcome back</h1>
            <p className="w-muted">{step.email}</p>
            <input type="email" autoComplete="username" value={step.email} readOnly hidden />
            <label className="w-field">
              <span>Password</span>
              <input ref={firstInput} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
            <button className="w-btn w-btn-primary login-submit" disabled={busy || !password}>
              {busy ? "Signing in…" : "Sign in"}
            </button>
            <button type="button" className="w-btn w-btn-ghost" onClick={() => void sendCode(step.email)}>
              Forgot it? Email me a code
            </button>
          </>
        )}

        {step.kind === "code" && (
          <>
            <h1>Check your email</h1>
            {notice && <p className="w-muted">{notice}</p>}
            <label className="w-field">
              <span>6-digit code</span>
              <input
                ref={firstInput}
                className="login-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9 ]*"
                maxLength={7}
                required
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/[^\d]/g, "").slice(0, 6))}
              />
            </label>
            <button className="w-btn w-btn-primary login-submit" disabled={busy || code.length !== 6}>
              {busy ? "Checking…" : "Continue"}
            </button>
            <button type="button" className="w-btn w-btn-ghost" disabled={busy} onClick={() => void sendCode(step.email)}>
              Send a new code
            </button>
          </>
        )}

        {step.kind === "create-password" && (
          <>
            <h1>Create a password</h1>
            <p className="w-muted">Next time you can sign in with {step.account.email} and this password.</p>
            <input type="email" autoComplete="username" value={step.account.email} readOnly hidden />
            <label className="w-field">
              <span>Password (at least 8 characters)</span>
              <input ref={firstInput} type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
            <button className="w-btn w-btn-primary login-submit" disabled={busy || password.length < 8}>
              {busy ? "Saving…" : "Save password"}
            </button>
            <button type="button" className="w-btn w-btn-ghost" onClick={() => onDone(step.account)}>
              Skip for now
            </button>
          </>
        )}

        {error && (
          <p id="login-error" className="login-error" role="alert">
            {error}
          </p>
        )}

        {step.kind !== "email" && step.kind !== "create-password" && (
          <button type="button" className="login-back" onClick={() => setStep({ kind: "email" })}>
            Use a different email
          </button>
        )}
        {onSkip && step.kind === "email" && (
          <button type="button" className="login-back" onClick={onSkip}>
            Continue without an account
          </button>
        )}
      </form>
    </main>
  );
}
