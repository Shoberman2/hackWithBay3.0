"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import type { AuthUser } from "@/components/account/AuthProvider";

const spring = { type: "spring", stiffness: 100, damping: 20 } as const;

const PASSWORD_HINT = "8+ characters with upper, lower, number, symbol";

function passwordMeetsPolicy(password: string): boolean {
  return (
    password.length >= 8 &&
    /[A-Z]/.test(password) &&
    /[a-z]/.test(password) &&
    /[0-9]/.test(password) &&
    /[^A-Za-z0-9]/.test(password)
  );
}

interface AuthGateProps {
  /** Why auth is needed right now, e.g. "Sign in to save this session." */
  reason?: string;
  onAuthenticated: (user: AuthUser) => void;
  onDismiss?: () => void;
}

/**
 * Inline auth panel (no modal). Posts to /api/auth/{signin,signup}, which
 * set the httpOnly session cookie server-side (the browser never touches
 * the Butterbase SDK). In demo mode the route resolves a mock user so the
 * flow never dead-ends.
 */
export default function AuthGate({
  reason,
  onAuthenticated,
  onDismiss,
}: AuthGateProps) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setError(null);

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("Enter a valid email address.");
      return;
    }
    if (mode === "signup" && !passwordMeetsPolicy(password)) {
      setError(`Password needs ${PASSWORD_HINT}.`);
      return;
    }
    if (mode === "signin" && password.length === 0) {
      setError("Enter your password.");
      return;
    }

    setPending(true);
    try {
      const res = await fetch(`/api/auth/${mode === "signup" ? "signup" : "signin"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const body = (await res.json()) as { user?: AuthUser; error?: string };
      if (!res.ok || !body.user) {
        setError(body.error ?? "Could not sign you in. Try again.");
        return;
      }
      onAuthenticated(body.user);
    } catch {
      setError("Could not reach the server. Check your connection and retry.");
    } finally {
      setPending(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={spring}
      className="w-full max-w-sm rounded-[10px] border border-line bg-canvas p-6"
    >
      <h3 className="text-base font-semibold tracking-tight">
        {mode === "signin" ? "Sign in" : "Create an account"}
      </h3>
      {reason ? <p className="mt-1 text-sm text-ink-2">{reason}</p> : null}

      <form onSubmit={submit} className="mt-6 space-y-5">
        <div>
          <label
            htmlFor="auth-email"
            className="block text-xs uppercase tracking-wide text-ink-2"
          >
            Email
          </label>
          <input
            id="auth-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-2 w-full rounded-[6px] border border-line bg-canvas px-3 py-2 text-sm outline-none transition-colors focus:border-ink-2"
          />
        </div>

        <div>
          <label
            htmlFor="auth-password"
            className="block text-xs uppercase tracking-wide text-ink-2"
          >
            Password
          </label>
          <input
            id="auth-password"
            type="password"
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-2 w-full rounded-[6px] border border-line bg-canvas px-3 py-2 text-sm outline-none transition-colors focus:border-ink-2"
          />
          {mode === "signup" ? (
            <p className="mt-2 text-xs text-ink-2">{PASSWORD_HINT}</p>
          ) : null}
        </div>

        {error ? <p className="text-sm text-[#B42318]">{error}</p> : null}

        <div className="flex items-center gap-4">
          <button
            type="submit"
            disabled={pending}
            className="rounded-[6px] bg-ink px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#333333] active:scale-[0.98] disabled:opacity-60"
          >
            {pending
              ? mode === "signin"
                ? "Signing in"
                : "Creating account"
              : mode === "signin"
                ? "Sign in"
                : "Create account"}
          </button>
          {onDismiss ? (
            <button
              type="button"
              onClick={onDismiss}
              className="text-sm text-ink-2 transition-colors hover:text-ink"
            >
              Not now
            </button>
          ) : null}
        </div>
      </form>

      <p className="mt-6 text-sm text-ink-2">
        {mode === "signin" ? "No account yet?" : "Already have an account?"}{" "}
        <button
          type="button"
          onClick={() => {
            setMode((m) => (m === "signin" ? "signup" : "signin"));
            setError(null);
          }}
          className="text-ink underline underline-offset-4"
        >
          {mode === "signin" ? "Create one" : "Sign in"}
        </button>
      </p>
    </motion.div>
  );
}
