"use client";

/**
 * Agent Q&A panel. Minimal white, 1px dividers. Asks /api/agent
 * {mode:"ask"} and renders prose answers with a collapsible mono Cypher
 * block. Clicking an answer applies its graph highlight via onHighlight.
 * The paywalled state renders the caller-provided upsell slot.
 */

import { useCallback, useRef, useState, type ReactNode } from "react";

export interface AgentHighlight {
  nodeIds: string[];
  linkKeys: string[];
}

export interface AgentChatProps {
  sessionId: string;
  /** Called with the highlight payload when the user clicks an answer. */
  onHighlight?: (highlight: AgentHighlight) => void;
  /** Rendered when the free-question limit is reached. */
  paywallSlot?: ReactNode;
}

interface Exchange {
  id: number;
  question: string;
  answer?: string;
  cypher?: string;
  highlight?: AgentHighlight;
  error?: string;
  pending: boolean;
}

interface AskResponse {
  paywalled?: boolean;
  questionsUsed?: number;
  answer?: string;
  cypher?: string;
  highlight?: AgentHighlight;
  error?: string;
}

function AnswerSkeleton() {
  return (
    <div className="space-y-2 py-1" aria-hidden="true">
      <div className="shimmer h-3 w-11/12 rounded" />
      <div className="shimmer h-3 w-4/5 rounded" />
      <div className="shimmer h-3 w-2/3 rounded" />
    </div>
  );
}

export default function AgentChat({
  sessionId,
  onHighlight,
  paywallSlot,
}: AgentChatProps) {
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [paywalled, setPaywalled] = useState(false);
  const nextId = useRef(1);

  const ask = useCallback(async () => {
    const question = input.trim();
    if (question.length === 0 || busy || paywalled) return;

    const id = nextId.current++;
    setInput("");
    setBusy(true);
    setExchanges((prev) => [...prev, { id, question, pending: true }]);

    let patch: Partial<Exchange>;
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "ask", question, sessionId }),
      });
      const data = (await res.json()) as AskResponse;
      if (data.paywalled) {
        setPaywalled(true);
        patch = {
          pending: false,
          error: "Free question limit reached.",
        };
      } else if (!res.ok || data.error || !data.answer) {
        patch = {
          pending: false,
          error: data.error ?? "The agent could not answer that. Try again.",
        };
      } else {
        patch = {
          pending: false,
          answer: data.answer,
          cypher: data.cypher,
          highlight: data.highlight,
        };
      }
    } catch {
      patch = {
        pending: false,
        error: "Network error - the agent is unreachable.",
      };
    }
    setExchanges((prev) =>
      prev.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    );
    setBusy(false);
  }, [input, busy, paywalled, sessionId]);

  return (
    <div className="flex h-full flex-col bg-canvas text-ink">
      <div className="flex-1 overflow-y-auto">
        {exchanges.length === 0 && (
          <p className="px-4 py-6 text-sm text-ink-2">
            Ask the landscape a question - shared investors, white space,
            table stakes, founder lineage.
          </p>
        )}

        <ul className="divide-y divide-line">
          {exchanges.map((e) => (
            <li key={e.id} className="px-4 py-4 fade-up">
              <p className="text-sm font-medium">{e.question}</p>

              {e.pending && (
                <div className="mt-3">
                  <AnswerSkeleton />
                </div>
              )}

              {e.error && !e.pending && (
                <p className="mt-3 text-xs text-[#B42318]">{e.error}</p>
              )}

              {e.answer && !e.pending && (
                <div className="mt-3">
                  {e.highlight &&
                  (e.highlight.nodeIds.length > 0 ||
                    e.highlight.linkKeys.length > 0) ? (
                    <button
                      type="button"
                      onClick={() => onHighlight?.(e.highlight as AgentHighlight)}
                      className="w-full cursor-pointer text-left text-sm leading-relaxed text-ink hover:text-accent"
                      title="Highlight this answer in the graph"
                    >
                      {e.answer}
                    </button>
                  ) : (
                    <p className="text-sm leading-relaxed">{e.answer}</p>
                  )}

                  {e.cypher && (
                    <details className="mt-2">
                      <summary className="cursor-pointer select-none text-xs text-ink-2">
                        Cypher
                      </summary>
                      <pre className="mt-1 overflow-x-auto rounded border border-line bg-surface p-3 font-mono text-xs leading-relaxed text-ink">
                        {e.cypher}
                      </pre>
                    </details>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>

        {paywalled && (
          <div className="border-t border-line px-4 py-4">
            {paywallSlot ?? (
              <p className="text-sm text-ink-2">
                You have used your 5 free questions. Purchase the full
                landscape report to unlock unlimited questions.
              </p>
            )}
          </div>
        )}
      </div>

      <form
        className="border-t border-line"
        onSubmit={(event) => {
          event.preventDefault();
          void ask();
        }}
      >
        <input
          type="text"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Ask the landscape..."
          disabled={paywalled}
          aria-label="Ask the landscape a question"
          className="w-full bg-transparent px-4 py-3 text-sm text-ink outline-none placeholder:text-ink-2 disabled:opacity-50"
        />
      </form>
    </div>
  );
}
