"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import {
  signInWithEmail,
  signUpWithEmail,
  startGoogleSignIn,
  verifySignUpEmail,
} from "@/app/actions/auth";

type AuthFormProps = {
  mode: "sign-in" | "sign-up";
  authError?: string;
};

export function AuthForm({ mode, authError }: AuthFormProps) {
  const [error, setError] = useState(authError ?? "");
  const [busy, setBusy] = useState(false);
  const [verification, setVerification] = useState<{ email: string } | null>(null);
  const isSignUp = mode === "sign-up";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);

    try {
      const formData = new FormData(event.currentTarget);
      const result = isSignUp
        ? await signUpWithEmail(formData)
        : await signInWithEmail(formData);

      if (result?.verificationRequired) {
        setVerification({
          email: String(formData.get("email") ?? "").trim(),
        });
        return;
      }

      if (result?.error) setError(result.error);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleVerification(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!verification) return;

    setError("");
    setBusy(true);
    try {
      const formData = new FormData(event.currentTarget);
      formData.set("email", verification.email);
      const result = await verifySignUpEmail(formData);

      if (result?.error) setError(result.error);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell">
      <div className="auth-glow auth-glow-one" />
      <div className="auth-glow auth-glow-two" />
      <Link href="/" className="auth-brand" aria-label="SOTO home">
        <span className="auth-brand-mark">S</span>
        <span>SOTO</span>
      </Link>

      <section className="auth-card" aria-labelledby="auth-title">
        {verification ? (
          <>
            <span className="auth-eyebrow">One last step</span>
            <h1 id="auth-title">Check your inbox</h1>
            <p className="auth-description">
              Enter the six-digit verification code we sent to <strong>{verification.email}</strong>.
            </p>
            <form className="auth-fields" onSubmit={handleVerification}>
              <label htmlFor="otp">Verification code</label>
              <input
                id="otp"
                name="otp"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                placeholder="000000"
                required
                autoFocus
              />
              {error && <p className="auth-error" role="alert">{error}</p>}
              <button className="auth-submit" type="submit" disabled={busy}>
                {busy ? "Verifying…" : "Verify email"}
              </button>
              <button
                className="auth-text-button"
                type="button"
                onClick={() => {
                  setVerification(null);
                  setError("");
                }}
              >
                Back to sign up
              </button>
            </form>
          </>
        ) : (
          <>
            <span className="auth-eyebrow">{isSignUp ? "Get started" : "Welcome back"}</span>
            <h1 id="auth-title">{isSignUp ? "Create your account" : "Sign in to SOTO"}</h1>
            <p className="auth-description">
              {isSignUp
                ? "Create an account to continue to your SOTO dashboard."
                : "Enter your details to continue to your dashboard."}
            </p>

            <form action={startGoogleSignIn}>
              <button className="auth-google" type="submit" disabled={busy}>
                <GoogleMark />
                Continue with Google
              </button>
            </form>

            <div className="auth-divider"><span>or continue with email</span></div>

            <form className="auth-fields" onSubmit={handleSubmit}>
              {isSignUp && (
                <>
                  <label htmlFor="name">Full name</label>
                  <input id="name" name="name" type="text" autoComplete="name" placeholder="Your name" required />
                </>
              )}

              <label htmlFor="email">Email address</label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                required
              />

              <label htmlFor="password">Password</label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete={isSignUp ? "new-password" : "current-password"}
                placeholder={isSignUp ? "At least 6 characters" : "Your password"}
                minLength={isSignUp ? 6 : undefined}
                required
              />

              {error && <p className="auth-error" role="alert">{error}</p>}
              <button className="auth-submit" type="submit" disabled={busy}>
                {busy ? "Please wait…" : isSignUp ? "Create account" : "Sign in"}
              </button>
            </form>

            <p className="auth-switch">
              {isSignUp ? "Already have an account? " : "New to SOTO? "}
              <Link href={isSignUp ? "/sign-in" : "/sign-up"}>
                {isSignUp ? "Sign in" : "Create an account"}
              </Link>
            </p>
          </>
        )}
      </section>

      <p className="auth-footer">Secure sign-in powered by InsForge</p>
    </main>
  );
}

function GoogleMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="google-mark">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.75 3.27-8.1Z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.65l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.15v2.84A11 11 0 0 0 12 23Z" />
      <path fill="#FBBC05" d="M5.84 14.11A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.44.34-2.11V7.05H2.15A11 11 0 0 0 1 12c0 1.78.43 3.46 1.15 4.95l3.69-2.84Z" />
      <path fill="#EA4335" d="M12 5.36c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.03 14.97 1 12 1a11 11 0 0 0-9.85 6.05l3.69 2.84C6.71 7.29 9.14 5.36 12 5.36Z" />
    </svg>
  );
}
