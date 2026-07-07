"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import Interview from "@/components/onboarding/Interview";
import AuthGate from "@/components/onboarding/AuthGate";
import { useAuth } from "@/components/account/AuthProvider";

const spring = { type: "spring", stiffness: 100, damping: 20 } as const;

/**
 * The single centered column on the landing page. Sign-in is required
 * before anything else; once authenticated it holds the idea input, then
 * swaps to the interview in place (no route change).
 */
export default function OnboardingFlow() {
  const { user, loading, refresh } = useAuth();
  const [idea, setIdea] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const canSubmit = idea.trim().length > 2;

  function submit() {
    if (canSubmit) setSubmitted(true);
  }

  if (loading) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center px-6">
        <div className="shimmer h-9 w-44 rounded-[6px]" aria-hidden />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center px-6">
        <div className="mb-8 max-w-sm text-center">
          <h1 className="text-2xl font-semibold tracking-tight">
            Map the landscape around your idea.
          </h1>
          <p className="mt-2 text-sm text-ink-2">
            Sign in to build and save your competitive graph.
          </p>
        </div>
        <AuthGate
          reason="Rivalry keeps your scans private to your account."
          onAuthenticated={() => void refresh()}
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-[100dvh] items-center justify-center px-6">
      <div className="w-full max-w-xl">
        <AnimatePresence mode="wait" initial={false}>
          {!submitted ? (
            <motion.div
              key="idea"
              layout
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={spring}
            >
              <h1 className="fade-up text-3xl font-semibold tracking-tight">
                Map the landscape around your idea.
              </h1>
              <p
                className="fade-up mt-3 text-sm text-ink-2"
                style={{ "--index": 1 } as React.CSSProperties}
              >
                Companies, founders, investors, and features, connected in one
                graph.
              </p>

              <div
                className="fade-up mt-12"
                style={{ "--index": 2 } as React.CSSProperties}
              >
                <label
                  htmlFor="idea"
                  className="block text-xs uppercase tracking-wide text-ink-2"
                >
                  Your idea
                </label>
                <input
                  id="idea"
                  type="text"
                  autoFocus
                  value={idea}
                  onChange={(e) => setIdea(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submit();
                  }}
                  placeholder="Describe your idea in one line"
                  className="mt-3 w-full border-b border-transparent bg-transparent pb-2 text-2xl tracking-tight outline-none transition-colors placeholder:text-ink-2/60 focus:border-line"
                />
                <p className="mt-3 font-mono text-xs text-ink-2">
                  For example: an internship platform for international
                  students
                </p>
              </div>

              <div
                className="fade-up mt-10"
                style={{ "--index": 3 } as React.CSSProperties}
              >
                <button
                  type="button"
                  onClick={submit}
                  disabled={!canSubmit}
                  className="rounded-[6px] bg-ink px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#333333] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Map it
                </button>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="interview"
              layout
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={spring}
            >
              <Interview idea={idea.trim()} onExit={() => setSubmitted(false)} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
