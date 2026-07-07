/**
 * POST /api/session { idea, answers, result } -> { id }
 *
 * Creates a session for a completed onboarding interview: persists the
 * session row (Butterbase, or the demo store), writes the Idea node to
 * Neo4j (no-op in demo mode), and returns the id the client routes to.
 */

import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { upsertSession } from "@/lib/butterbase";
import { writeIdea } from "@/lib/pipeline/write";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  idea: z.string().min(1).max(500),
  answers: z
    .array(z.object({ question: z.string(), answer: z.string() }))
    .default([]),
  result: z
    .object({
      refined_idea: z.string(),
      tags: z.array(z.string()),
      search_terms: z.array(z.string()),
    })
    .optional(),
});

export async function POST(request: Request): Promise<NextResponse> {
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 },
    );
  }

  const id = randomUUID().slice(0, 8);
  const tags = body.result?.tags ?? [];

  try {
    await upsertSession(id, body.idea, tags);
  } catch (err) {
    if (env.DEBUG) console.error("[api/session] upsertSession", err);
  }

  try {
    await writeIdea({
      id,
      text: body.result?.refined_idea ?? body.idea,
      session_id: id,
      created_at: new Date().toISOString(),
      refined_tags: tags,
    });
  } catch (err) {
    if (env.DEBUG) console.error("[api/session] writeIdea", err);
  }

  return NextResponse.json({ id, sessionId: id });
}
