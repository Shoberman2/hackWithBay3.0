"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import type { OnboardingResult } from "@/lib/types";
import { env } from "@/lib/env";

/* ------------------------------------------------------------------ */
/* Agent wire shapes (proposed contract for POST /api/agent)           */
/* ------------------------------------------------------------------ */

interface InterviewQuestion {
  text: string;
  options: string[];
}

interface QA {
  question: string;
  answer: string;
}

/**
 * Expected response from POST /api/agent { mode: "onboarding", idea, answers }.
 * Until the agent team ships the route, any failure or unexpected shape
 * drops the interview to the local fallback flow below.
 */
interface AgentOnboardingResponse {
  done: boolean;
  question?: InterviewQuestion;
  result?: OnboardingResult;
}

/* ------------------------------------------------------------------ */
/* Local fallback flow (7 sharpening questions, works for any idea)    */
/* ------------------------------------------------------------------ */

const FALLBACK_QUESTIONS: InterviewQuestion[] = [
  {
    text: "What shape is it closest to?",
    options: ["Marketplace", "Workflow tool", "API or infrastructure", "Community or network"],
  },
  {
    text: "Who is it for?",
    options: ["Consumers", "Small businesses", "Enterprises", "Developers"],
  },
  {
    text: "Who pays for it?",
    options: ["Consumers", "Small businesses", "Enterprises", "Both sides of a marketplace"],
  },
  {
    text: "How do the first users find it?",
    options: ["Search and direct signup", "Sales outreach", "Partners or institutions", "Word of mouth"],
  },
  {
    text: "Where does it launch first?",
    options: ["United States", "Europe", "Global from day one"],
  },
  {
    text: "What must be different from what exists today?",
    options: ["Better quality or matching", "Price or business model", "An underserved niche", "Speed and experience"],
  },
  {
    text: "Which competitor worries you most?",
    options: ["A big incumbent", "Another startup", "Spreadsheets / DIY", "None that I know of"],
  },
];

const TOTAL_QUESTIONS = FALLBACK_QUESTIONS.length;

const spring = { type: "spring", stiffness: 100, damping: 20 } as const;

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildLocalResult(idea: string, answers: QA[]): OnboardingResult {
  return {
    refined_idea: `${idea} (${answers.map((a) => a.answer.toLowerCase()).join("; ")})`,
    tags: answers.map((a) => slugify(a.answer)),
    search_terms: [idea, `${idea} startups`, `${idea} competitors`],
  };
}

async function postJson<T>(url: string, body: unknown, timeoutMs = 10000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`${url} returned ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

type Phase = "thinking" | "asking" | "starting" | "error";

interface InterviewProps {
  idea: string;
  /** Back from the first question returns to the idea input. */
  onExit: () => void;
}

export default function Interview({ idea, onExit }: InterviewProps) {
  const router = useRouter();

  const [phase, setPhase] = useState<Phase>("thinking");
  const [error, setError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<QA[]>([]);
  // Question history, parallel to answers: history[answers.length] is current.
  const [history, setHistory] = useState<InterviewQuestion[]>([]);
  const [freeText, setFreeText] = useState("");
  // Chip the user just tapped; shows the selected state before advancing.
  const [picked, setPicked] = useState<string | null>(null);
  // Once the agent route fails we stay on the local flow for the session.
  const agentAlive = useRef(true);
  const retryRef = useRef<() => void>(() => {});

  const current: InterviewQuestion | undefined = history[answers.length];

  const startSession = useCallback(
    async (finalAnswers: QA[], result: OnboardingResult | undefined) => {
      setPhase("starting");
      const finalResult = result ?? buildLocalResult(idea, finalAnswers);
      const payload = {
        idea,
        answers: finalAnswers,
        result: finalResult,
      };
      let id = "demo";
      try {
        const res = await postJson<{ id?: string; sessionId?: string }>(
          "/api/session",
          payload,
        );
        id = res.id ?? res.sessionId ?? "demo";
      } catch (err) {
        if (env.DEBUG) console.error("session start failed", err);
        if (agentAlive.current) {
          // A real backend answered the interview; a session failure here
          // is a genuine error, not a demo-mode condition.
          setError("Could not start the session.");
          retryRef.current = () => void startSession(finalAnswers, result);
          setPhase("error");
          return;
        }
        // Demo insurance: no backend, route to the fixture session.
      }
      // Forward the refined idea/tags/terms in the URL: useGraphStream
      // passes them to the pipeline stream so a live run searches the
      // actual idea instead of the default.
      const query = new URLSearchParams();
      query.set("idea", finalResult.refined_idea || idea);
      if (finalResult.tags.length > 0) query.set("tags", finalResult.tags.join(","));
      if (finalResult.search_terms.length > 0) {
        query.set("terms", finalResult.search_terms.join(","));
      }
      router.push(`/session/${id}?${query.toString()}`);
    },
    [idea, router],
  );

  const advance = useCallback(
    async (currentAnswers: QA[]) => {
      setPhase("thinking");
      setError(null);

      // A question we already fetched (user came back, re-answered).
      if (history[currentAnswers.length]) {
        setPhase("asking");
        return;
      }

      if (agentAlive.current) {
        try {
          const res = await postJson<AgentOnboardingResponse>("/api/agent", {
            mode: "onboarding",
            idea,
            answers: currentAnswers,
          });
          if (res.done) {
            void startSession(currentAnswers, res.result);
            return;
          }
          if (res.question && res.question.text) {
            // Guard against duplicate appends (strict-mode double mount
            // fires advance([]) twice) -- same guard as the fallback path.
            setHistory((h) =>
              h.length > currentAnswers.length
                ? h
                : [...h, res.question as InterviewQuestion],
            );
            setPhase("asking");
            return;
          }
          throw new Error("unexpected agent response shape");
        } catch (err) {
          if (env.DEBUG) console.error("onboarding agent unavailable, using local flow", err);
          agentAlive.current = false;
        }
      }

      // Local fallback flow.
      if (currentAnswers.length >= TOTAL_QUESTIONS) {
        void startSession(currentAnswers, undefined);
        return;
      }
      setHistory((h) =>
        h.length > currentAnswers.length
          ? h
          : [...h, FALLBACK_QUESTIONS[currentAnswers.length]],
      );
      setPhase("asking");
    },
    [history, idea, startSession],
  );

  // First question on mount.
  useEffect(() => {
    retryRef.current = () => void advance([]);
    void advance([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function answer(text: string, viaChip = false) {
    const trimmed = text.trim();
    if (!trimmed || !current || phase !== "asking") return;
    const next = [...answers, { question: current.text, answer: trimmed }];
    const go = () => {
      setAnswers(next);
      setFreeText("");
      setPicked(null);
      retryRef.current = () => void advance(next);
      void advance(next);
    };
    if (viaChip) {
      // Show the selected chip state briefly before moving on.
      setPicked(trimmed);
      window.setTimeout(go, 180);
    } else {
      go();
    }
  }

  function back() {
    if (phase === "starting") return;
    if (answers.length === 0) {
      onExit();
      return;
    }
    // Re-show the previous question with its answer pre-selected.
    setPicked(answers[answers.length - 1]?.answer ?? null);
    setAnswers((a) => a.slice(0, -1));
    setFreeText("");
    setError(null);
    setPhase("asking");
  }

  const step = Math.min(answers.length + 1, TOTAL_QUESTIONS);
  const progress = phase === "starting" ? 1 : answers.length / TOTAL_QUESTIONS;

  return (
    <div>
      {/* Context line: the idea being sharpened */}
      <p className="font-mono text-xs text-ink-2">{idea}</p>

      {/* Progress: thin 2px bar + mono counter */}
      <div className="mt-6 flex items-center gap-4">
        <div className="h-[2px] flex-1 overflow-hidden rounded-full bg-line">
          <motion.div
            className="h-full bg-ink"
            initial={false}
            animate={{ scaleX: progress }}
            style={{ originX: 0 }}
            transition={spring}
          />
        </div>
        <span className="font-mono text-xs text-ink-2">
          {phase === "starting" ? "done" : `${step} of ${TOTAL_QUESTIONS}`}
        </span>
      </div>

      <div className="mt-12 min-h-[16rem]">
        <AnimatePresence mode="wait" initial={false}>
          {phase === "starting" ? (
            <motion.div
              key="starting"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={spring}
            >
              <h2 className="text-2xl font-semibold tracking-tight">
                Building your landscape.
              </h2>
              <p className="mt-3 text-sm text-ink-2">
                Starting the pipeline. You will watch the graph assemble.
              </p>
              <div className="mt-8 space-y-3">
                <div className="shimmer h-4 w-3/4 rounded" />
                <div className="shimmer h-4 w-1/2 rounded" />
              </div>
            </motion.div>
          ) : phase === "error" ? (
            <motion.div
              key="error"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={spring}
            >
              <h2 className="text-2xl font-semibold tracking-tight">
                Something went wrong.
              </h2>
              <p className="mt-3 text-sm text-[#B42318]">{error}</p>
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  retryRef.current();
                }}
                className="mt-6 rounded-[6px] bg-ink px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#333333] active:scale-[0.98]"
              >
                Retry
              </button>
            </motion.div>
          ) : phase === "thinking" ? (
            <motion.div
              key="thinking"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={spring}
            >
              <div className="shimmer h-7 w-2/3 rounded" />
              <div className="mt-8 flex flex-wrap gap-2">
                <div className="shimmer h-9 w-28 rounded-full" />
                <div className="shimmer h-9 w-36 rounded-full" />
                <div className="shimmer h-9 w-32 rounded-full" />
              </div>
            </motion.div>
          ) : current ? (
            <motion.div
              key={`q-${answers.length}`}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={spring}
            >
              <h2 className="text-2xl font-semibold tracking-tight">
                {current.text}
              </h2>

              <div className="mt-8 flex flex-wrap gap-2">
                {current.options.map((option, i) => {
                  const selected = picked === option;
                  return (
                    <button
                      key={option}
                      type="button"
                      onClick={() => answer(option, true)}
                      className={`fade-up rounded-full border px-4 py-2 text-sm transition-colors active:scale-[0.98] ${
                        selected
                          ? "border-ink bg-ink text-white"
                          : "border-line bg-canvas hover:bg-surface"
                      }`}
                      style={{ "--index": i } as React.CSSProperties}
                    >
                      {option}
                    </button>
                  );
                })}
              </div>

              <div className="mt-10">
                <label
                  htmlFor="free-answer"
                  className="block text-xs uppercase tracking-wide text-ink-2"
                >
                  Or answer in your own words
                </label>
                <input
                  id="free-answer"
                  type="text"
                  value={freeText}
                  onChange={(e) => setFreeText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") answer(freeText);
                  }}
                  placeholder="Type and press Enter"
                  className="mt-3 w-full border-b border-transparent bg-transparent pb-2 text-base outline-none transition-colors placeholder:text-ink-2/60 focus:border-line"
                />
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>

      <div className="mt-10">
        <button
          type="button"
          onClick={back}
          disabled={phase === "starting"}
          className="text-sm text-ink-2 transition-colors hover:text-ink disabled:opacity-40"
        >
          Back
        </button>
      </div>
    </div>
  );
}
