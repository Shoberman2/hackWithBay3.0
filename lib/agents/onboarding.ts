/**
 * Onboarding interview agent. Asks ONE sharpening question at a time,
 * 4-6 total, along the ambiguity axes from README section 3. The final
 * turn returns an OnboardingResult (zod-parsed JSON).
 *
 * Convention for `history`: a full chat transcript where the FIRST user
 * message is the raw idea and each later user message answers the
 * preceding assistant question.
 */

import { z } from "zod";
import { chat, type ChatMessage } from "@/lib/gateway";
import { isDemoMode } from "@/lib/env";
import type { OnboardingResult } from "@/lib/types";

export interface OnboardingTurn {
  /** Next question to ask, when the interview is still running. */
  question?: string;
  /** 3-4 suggested option chips for the question. */
  options?: string[];
  /** Final result, when the interview is complete. */
  result?: OnboardingResult;
  done: boolean;
}

const MIN_QUESTIONS = 4;
const MAX_QUESTIONS = 6;

const resultSchema = z.object({
  refined_idea: z.string().min(1),
  tags: z.array(z.string()).min(1),
  search_terms: z.array(z.string()).min(1),
});

const turnSchema = z.object({
  question: z.string().nullish(),
  options: z.array(z.string()).nullish(),
  done: z.boolean(),
  result: resultSchema.nullish(),
});

/* ------------------------------------------------------------------ */
/* Demo script (also the fallback when the gateway misbehaves)         */
/* ------------------------------------------------------------------ */

const SCRIPT: Array<{ question: string; options: string[] }> = [
  {
    question:
      "Is this a marketplace connecting both sides, or software that one side buys?",
    options: [
      "Two-sided marketplace",
      "Employer software (ATS)",
      "University career-center tool",
      "Not sure yet",
    ],
  },
  {
    question: "Who pays?",
    options: ["Employers", "Students", "Universities", "Undecided"],
  },
  {
    question: "Where do you start geographically?",
    options: ["US only", "US first, global later", "Global from day one"],
  },
  {
    question:
      "Do you reach students through university partnerships or directly?",
    options: ["University-partnered", "Direct to students", "Both"],
  },
  {
    question:
      "Which one thing must be different from what already exists?",
    options: [
      "Matching quality",
      "International / visa support",
      "Employer tooling",
      "Community and peers",
    ],
  },
];

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function splitHistory(history: ChatMessage[]): {
  idea: string;
  answers: string[];
} {
  const userMessages = history.filter((m) => m.role === "user");
  return {
    idea: userMessages[0]?.content.trim() ?? "",
    answers: userMessages.slice(1).map((m) => m.content.trim()),
  };
}

function scriptedTurn(history: ChatMessage[]): OnboardingTurn {
  const { idea, answers } = splitHistory(history);
  if (answers.length < SCRIPT.length) {
    const step = SCRIPT[answers.length];
    return { question: step.question, options: step.options, done: false };
  }
  const meaningful = answers.filter(
    (a) => a.length > 0 && !/^(not sure|undecided|skip)/i.test(a),
  );
  return {
    done: true,
    result: {
      refined_idea:
        meaningful.length > 0
          ? `${idea} - ${meaningful.join(", ")}`
          : idea,
      tags: meaningful.map(slugify),
      search_terms: [
        idea,
        ...meaningful.slice(0, 3).map((a) => `${idea} ${a}`),
      ].filter((s) => s.length > 0),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Live agent                                                          */
/* ------------------------------------------------------------------ */

const SYSTEM_PROMPT = `You are the onboarding interviewer for Rivalry, a competitive-landscape tool for idea-stage founders. The founder just typed a one-line idea. Your job is to sharpen it with ${MIN_QUESTIONS} to ${MAX_QUESTIONS} short questions, asked ONE at a time, covering these axes:
1. Marketplace vs software one side buys (e.g. ATS).
2. Which side pays.
3. Geography (US only, US-first, global).
4. Distribution: university-partnered vs direct.
5. The one feature that must be different from incumbents.

Rules:
- Ask exactly one question per turn. Never repeat an axis already answered.
- Each question comes with 3-4 short suggested options (2-5 words each).
- After the final answer, finish with the result instead of a question.
- Respond ONLY with minified JSON, no markdown, in one of two shapes:
  While asking: {"question": string, "options": string[], "done": false}
  When finished: {"done": true, "result": {"refined_idea": string, "tags": string[], "search_terms": string[]}}
- "tags" are short kebab-case labels for the chosen positioning; "search_terms" are 3-6 web-search queries for discovering competitors.`;

function stripFences(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
}

function parseTurn(raw: string): OnboardingTurn {
  const parsed = turnSchema.parse(JSON.parse(stripFences(raw)));
  if (parsed.done && parsed.result) {
    return { done: true, result: parsed.result };
  }
  if (!parsed.done && parsed.question) {
    return {
      done: false,
      question: parsed.question,
      options: parsed.options ?? undefined,
    };
  }
  throw new Error("onboarding turn missing question or result");
}

/** Advance the onboarding interview by one turn. */
export async function runOnboarding(
  history: ChatMessage[],
): Promise<OnboardingTurn> {
  const { answers } = splitHistory(history);

  if (isDemoMode()) return scriptedTurn(history);

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history,
  ];
  if (answers.length >= MAX_QUESTIONS) {
    messages.push({
      role: "user",
      content:
        "You have enough information. Finish now: respond with the done:true result JSON.",
    });
  }

  try {
    const first = await chat(messages, { json: true, temperature: 0.4 });
    try {
      return parseTurn(first);
    } catch (parseError) {
      const retry = await chat(
        [
          ...messages,
          { role: "assistant", content: first },
          {
            role: "user",
            content: `Your last response was invalid (${String(
              parseError instanceof Error ? parseError.message : parseError,
            )}). Respond again with ONLY the JSON, exactly matching the required shape.`,
          },
        ],
        { json: true, temperature: 0 },
      );
      return parseTurn(retry);
    }
  } catch {
    // Gateway unavailable or persistently malformed: scripted fallback.
    return scriptedTurn(history);
  }
}

/** Back-compat wrapper for the original scaffold signature. */
export async function onboardingNext(
  idea: string,
  history: ChatMessage[],
): Promise<OnboardingTurn> {
  const hasIdea = history[0]?.role === "user";
  const full: ChatMessage[] = hasIdea
    ? history
    : [{ role: "user", content: idea }, ...history];
  return runOnboarding(full);
}
