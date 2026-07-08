/**
 * Onboarding interview agent. Asks ONE sharpening question at a time,
 * 6-8 total, along the ambiguity axes from README section 3. The final
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

const MIN_QUESTIONS = 3;
const MAX_QUESTIONS = 4;

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
      "What shape is the product closest to?",
    options: [
      "Two-sided marketplace",
      "Workflow / SaaS tool",
      "API or infrastructure",
      "Community or network",
    ],
  },
  {
    question: "Who is the primary customer?",
    options: ["Consumers", "Small businesses", "Enterprises", "Not sure yet"],
  },
  {
    question: "Who actually pays?",
    options: [
      "The end user",
      "A business buyer",
      "Advertisers or partners",
      "Undecided",
    ],
  },
  {
    question: "Where do you start geographically?",
    options: ["US only", "US first, global later", "Global from day one"],
  },
  {
    question: "How do the first users find it?",
    options: [
      "Search and direct signup",
      "Sales outreach",
      "Partners or institutions",
      "Word of mouth / community",
    ],
  },
  {
    question:
      "Which one thing must be different from what already exists?",
    options: [
      "Better matching or quality",
      "Price or business model",
      "An underserved niche",
      "Speed and experience",
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
      tags: [
        ...meaningful.map(slugify),
        ...idea
          .split(/\s+/)
          .filter((w) => w.length > 3)
          .map(slugify),
      ]
        .filter(Boolean)
        .filter((t, i, a) => a.indexOf(t) === i)
        .slice(0, 10),
      search_terms: [
        idea,
        ...meaningful.map((a) => `${idea} ${a}`),
        `${idea} competitors`,
        `alternatives to ${idea}`,
        `${idea} startups`,
      ].filter((s) => s.length > 0),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Live agent                                                          */
/* ------------------------------------------------------------------ */

const SYSTEM_PROMPT = `You are the onboarding interviewer for Rivalry, a competitive-landscape tool for idea-stage founders. The founder just typed a one-line idea. Your job is to sharpen it with ${MIN_QUESTIONS} to ${MAX_QUESTIONS} short questions, asked ONE at a time. Cover these axes, phrasing every question in the concrete vocabulary of THIS founder's idea (never generic boilerplate):
1. Product shape: marketplace, workflow/SaaS tool, API/infrastructure, or community.
2. The primary customer / target user.
3. Which side pays, and the pricing or business model.
4. Geography (US only, US-first, global).
5. Distribution: how the first users are reached (direct, sales, partners, community).
6. The one thing that must be different from incumbents.
7. Which existing companies or products the founder already sees as competitors.
8. Stage: is anything built or launched yet, and what traction exists.

Rules:
- Ask exactly one question per turn. Never repeat an axis already answered; skip an axis the founder's idea or earlier answers already settle.
- Each question comes with 3-4 short suggested options (2-5 words each), tailored to the idea.
- Do NOT finish before ${MIN_QUESTIONS} answers. After ${MIN_QUESTIONS}-${MAX_QUESTIONS} answers, finish with the result instead of a question.
- Respond ONLY with minified JSON, no markdown, in one of two shapes:
  While asking: {"question": string, "options": string[], "done": false}
  When finished: {"done": true, "result": {"refined_idea": string, "tags": string[], "search_terms": string[]}}
- "refined_idea" is 1-2 sentences capturing the positioning the answers pinned down.
- "tags" are 6-10 short kebab-case labels spanning the category, the segment/audience, the business model, the delivery form-factor, and the key differentiators (e.g. "ai-code-review", "developer-tools", "github-native", "pr-automation", "self-serve", "seed-stage"). Be generous — more tags surface more of the landscape.
- "search_terms" are 6-10 web-search queries for discovering competitors, including any competitor names the founder mentioned plus adjacent-category and "alternatives to X" phrasings.`;

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
