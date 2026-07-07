/**
 * POST /api/checkout { sessionId } -> { orderId, checkoutUrl, demo }
 *
 * Creates the "Full Landscape Report" product (once) and a purchase for
 * this session via Butterbase billing. In real mode the client redirects
 * to checkoutUrl (Stripe Checkout); in demo mode checkoutUrl is empty,
 * demo is true, and the client polls /api/checkout/status until the fake
 * order settles.
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
