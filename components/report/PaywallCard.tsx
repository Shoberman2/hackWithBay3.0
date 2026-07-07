"use client";

/**
 * Quiet paywall panel for the full landscape report ($9 one-time).
 * Starts checkout via /api/checkout; real mode redirects to Stripe
 * Checkout and confirms on return, demo mode polls the fake order until
 * it settles. Calls onUnlocked once the purchase is paid.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export interface PaywallCardProps {
  sessionId: string;
  onUnlocked: () => void;
}

type Phase = "idle" | "starting" | "redirecting" | "confirming";

const POLL_INTERVAL_MS = 1200;
const POLL_TIMEOUT_MS = 90_000;

function orderStorageKey(sessionId: string): string {
  return `rivalry_order_${sessionId}`;
}

export default function PaywallCard({ sessionId, onUnlocked }: PaywallCardProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const stopped = useRef(false);

  useEffect(() => {
    stopped.current = false;
    return () => {
      stopped.current = true;
    };
  }, []);

  const pollOrder = useCallback(
    async (orderId: string) => {
      setPhase("confirming");
      setError(null);
      const startedAt = Date.now();
      while (!stopped.current && Date.now() - startedAt < POLL_TIMEOUT_MS) {
        try {
          const res = await fetch(
            `/api/checkout/status?orderId=${encodeURIComponent(orderId)}&sessionId=${encodeURIComponent(sessionId)}`,
          );
          const body = (await res.json()) as { status?: string; error?: string };
          if (body.status === "paid") {
            sessionStorage.removeItem(orderStorageKey(sessionId));
            onUnlocked();
            return;
          }
          if (body.status === "failed" || body.status === "refunded") {
            setPhase("idle");
            setError("The payment did not go through. You have not been charged.");
            return;
          }
        } catch {
          // transient; keep polling until the timeout
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }
      if (!stopped.current) {
        setPhase("idle");
        setError("Payment confirmation timed out. If you paid, refresh this page.");
      }
    },
    [sessionId, onUnlocked],
  );

  // Returning from Stripe Checkout: resume confirmation for the stored order.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("checkout") === "return") {
      const orderId = sessionStorage.getItem(orderStorageKey(sessionId));
      if (orderId) void pollOrder(orderId);
    }
  }, [sessionId, pollOrder]);

  const buy = useCallback(async () => {
    setPhase("starting");
    setError(null);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      const body = (await res.json()) as {
        orderId?: string;
        checkoutUrl?: string;
        demo?: boolean;
        error?: string;
        message?: string;
      };
      if (!res.ok || !body.orderId) {
        setPhase("idle");
        setError(body.message ?? body.error ?? "Could not start checkout. Try again.");
        return;
      }
      if (body.demo || !body.checkoutUrl) {
        await pollOrder(body.orderId);
        return;
      }
      sessionStorage.setItem(orderStorageKey(sessionId), body.orderId);
      setPhase("redirecting");
      window.location.assign(body.checkoutUrl);
    } catch {
      setPhase("idle");
      setError("Could not start checkout. Check your connection and try again.");
    }
  }, [sessionId, pollOrder]);

  const busy = phase !== "idle";

  return (
    <div className="fade-up mx-auto max-w-md rounded-[10px] border border-line bg-canvas p-8">
      <div className="flex items-baseline justify-between">
        <h3 className="text-base font-semibold tracking-tight text-ink">
          Full landscape report
        </h3>
        <span className="font-mono text-sm text-ink">$9</span>
      </div>
      <p className="mt-3 text-sm leading-6 text-ink-2">
        The complete written analysis of your graph: competitive clusters,
        white space, founder patterns, moat comparison, and a positioning
        recommendation. One-time purchase, plus unlimited agent questions for
        this session.
      </p>
      <button
        type="button"
        onClick={buy}
        disabled={busy}
        className="mt-6 w-full rounded-[6px] bg-ink px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#333333] active:scale-[0.98] disabled:cursor-default disabled:opacity-60"
      >
        {phase === "idle" && "Unlock the report"}
        {phase === "starting" && "Starting checkout"}
        {phase === "redirecting" && "Opening checkout"}
        {phase === "confirming" && "Confirming payment"}
      </button>
      {phase === "confirming" && (
        <p className="mt-3 text-center font-mono text-xs text-ink-2">
          Waiting for the order to settle
        </p>
      )}
      {error && <p className="mt-3 text-sm text-[#B42318]">{error}</p>}
    </div>
  );
}
