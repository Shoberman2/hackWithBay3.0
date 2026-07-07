/**
 * POST /api/agent — routes to the onboarding interview or the Q&A agent.
 *
 * Body shapes:
 *   { mode: "onboarding", history: ChatMessage[], idea?: string }
 *     -> OnboardingTurn { question?, options?, done, result? }
 *   { mode: "ask", question: string, sessionId: string }
 *     -> { paywalled: false, questionsUsed, answer, cypher?, highlight? }
 *     -> { paywalled: true, questionsUsed } after 5 free questions
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { runOnboarding, answerQuestion } from "@/lib/agents";
import type { ChatMessage } from "@/lib/gateway";
import { getQuestionCount, recordQuestion, hasPurchase } from "@/lib/butterbase";
import { currentUser } from "@/lib/auth-server";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const FREE_QUESTION_LIMIT = 5;

const messageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string(),
});

const qaSchema = z.object({
  question: z.string(),
  answer: z.string(),
});

const bodySchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("onboarding"),
    history: z.array(messageSchema).default([]),
    /** Onboarding UI wire shape: prior question/answer pairs. */
    answers: z.array(qaSchema).default([]),
    idea: z.string().optional(),
  }),
  z.object({
    mode: z.literal("ask"),
    question: z.string().min(1).max(2000),
    sessionId: z.string().min(1).max(200),
  }),
]);

/**
 * In-memory metering fallback for demo mode / while lib/butterbase.ts is
 * unimplemented. Module-scoped, so it resets on redeploy — acceptable for
 * the free-tier counter, and the Butterbase DB path takes over as soon as
 * it exists.
 */
const memoryCounts = new Map<string, number>();

async function countQuestions(sessionId: string): Promise<number> {
  try {
    return await getQuestionCount(sessionId);
  } catch {
    return memoryCounts.get(sessionId) ?? 0;
  }
}

async function meterQuestion(
  sessionId: string,
  question: string,
  cypher: string | undefined,
  answer: string,
): Promise<void> {
  try {
    await recordQuestion(sessionId, question, cypher, answer);
  } catch {
    memoryCounts.set(sessionId, (memoryCounts.get(sessionId) ?? 0) + 1);
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!(await currentUser())) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof z.ZodError
            ? "Invalid request body"
            : "Request body must be JSON",
      },
      { status: 400 },
    );
  }

  try {
    if (body.mode === "onboarding") {
      let history: ChatMessage[] = body.history;
      if (history.length === 0 && body.idea) {
        // Onboarding UI wire shape: rebuild the transcript from the idea
        // plus question/answer pairs (first user message = the raw idea).
        history = [{ role: "user", content: body.idea }];
        for (const qa of body.answers) {
          history.push({ role: "assistant", content: qa.question });
          history.push({ role: "user", content: qa.answer });
        }
      }
      const turn = await runOnboarding(history);
      // Response shape expected by components/onboarding/Interview.tsx:
      // { done, question?: { text, options }, result? }.
      return NextResponse.json({
        done: turn.done,
        result: turn.result,
        question: turn.question
          ? { text: turn.question, options: turn.options ?? [] }
          : undefined,
      });
    }

    // mode === "ask": free tier meters at FREE_QUESTION_LIMIT questions;
    // a settled report purchase unlocks unlimited questions.
    const used = await countQuestions(body.sessionId);
    if (used >= FREE_QUESTION_LIMIT) {
      let purchased = false;
      try {
        purchased = await hasPurchase(body.sessionId);
      } catch {
        purchased = false;
      }
      if (!purchased) {
        return NextResponse.json({ paywalled: true, questionsUsed: used });
      }
    }

    const result = await answerQuestion(body.question, body.sessionId);
    await meterQuestion(
      body.sessionId,
      body.question,
      result.cypher,
      result.answer,
    );

    return NextResponse.json({
      paywalled: false,
      questionsUsed: used + 1,
      ...result,
    });
  } catch (error) {
    if (env.DEBUG) {
      console.error("[api/agent]", error);
    }
    return NextResponse.json(
      { error: "The agent could not process that request. Try again." },
      { status: 500 },
    );
  }
}
