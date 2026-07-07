"use client";

/**
 * Minimal signed-in indicator with sign out. Reads /api/auth/me on mount;
 * renders nothing when signed out (in demo mode the seeded demo user is
 * always present, so the indicator shows).
 */

import { useCallback, useEffect, useState } from "react";

interface MeResponse {
  user: { id: string; email: string } | null;
}

export default function UserMenu() {
  const [user, setUser] = useState<MeResponse["user"]>(null);
  const [loading, setLoading] = useState(true);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me")
      .then((res) => res.json() as Promise<MeResponse>)
      .then((body) => {
        if (!cancelled) setUser(body.user);
      })
      .catch(() => {
        if (!cancelled) setUser(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const signOut = useCallback(async () => {
    setSigningOut(true);
    try {
      await fetch("/api/auth/signout", { method: "POST" });
      setUser(null);
      window.location.assign("/");
    } finally {
      setSigningOut(false);
    }
  }, []);

  if (loading) {
    return <div className="shimmer h-6 w-36 rounded-[6px]" aria-hidden />;
  }

  if (!user) return null;

  return (
    <div className="flex items-center gap-3">
      <span className="font-mono text-xs text-ink-2" title={user.email}>
        {user.email}
      </span>
      <button
        type="button"
        onClick={signOut}
        disabled={signingOut}
        className="rounded-[6px] border border-line px-2.5 py-1 text-xs font-medium text-ink transition-colors hover:bg-surface active:scale-[0.98] disabled:opacity-60"
      >
        {signingOut ? "Signing out" : "Sign out"}
      </button>
    </div>
  );
}
