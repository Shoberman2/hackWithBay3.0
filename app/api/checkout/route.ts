/**
 * POST /api/checkout { sessionId } -> { orderId, checkoutUrl, demo }
 *
 * Creates an unlock for this session. Product mode redirects to Butterbase
 * Billing / Stripe Checkout; FREE_REPORT_UNLOCK records a paid unlock in
 * Butterbase Data API with no money movement; demo mode uses memory only.
 */

import { NextRequest, NextResponse } from "next/server";
import { createPurchase } from "@/lib/butterbase";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<NextResponse> {
  let sessionId: string;
  try {
    const body = (await req.json()) as { sessionId?: string };
    sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
  } catch {
    sessionId = "";
  }
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId is required." }, { status: 400 });
  }

  const token = req.cookies.get("rivalry_token")?.value;
  try {
    const purchase = await createPurchase(sessionId, req.nextUrl.origin, token);
    return NextResponse.json(purchase);
  } catch (cause) {
    if (env.DEBUG) {
      console.log("[checkout]", cause);
    }
    return NextResponse.json(
      { error: "Could not start checkout. Try again in a moment." },
      { status: 502 },
    );
  }
}
