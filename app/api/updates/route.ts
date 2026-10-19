import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  getUpdateSubscription,
  setUpdateSubscription,
} from "@/lib/butterbase";
import { currentUser } from "@/lib/auth-server";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  sessionId: z.string().min(1).max(200),
  industry: z.string().min(1).max(500),
  enabled: z.boolean(),
});

export async function GET(req: NextRequest): Promise<NextResponse> {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }
  const sessionId = req.nextUrl.searchParams.get("sessionId")?.trim();
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId is required." }, { status: 400 });
  }

  try {
    const token = req.cookies.get("rivalry_token")?.value;
    const subscription = await getUpdateSubscription(sessionId, token);
    return NextResponse.json({ subscription });
  } catch (error) {
    if (env.DEBUG) console.error("[api/updates]", error);
    return NextResponse.json({ subscription: null });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  try {
    const token = req.cookies.get("rivalry_token")?.value;
    const subscription = await setUpdateSubscription(
      {
        session_id: body.sessionId,
        user_id: user.id,
        email: user.email,
        industry: body.industry,
        cadence: "weekly",
        enabled: body.enabled,
      },
      token,
    );
    return NextResponse.json({ subscription });
  } catch (error) {
    if (env.DEBUG) console.error("[api/updates]", error);
    return NextResponse.json(
      { error: "Could not save update preference." },
      { status: 502 },
    );
  }
}
