/**
 * GET /api/checkout/status?orderId=...&sessionId=... -> { status }
 *
 * Polled by the client after starting checkout (and on return from Stripe).
 * When the order settles as paid, the session's purchases row is marked
 * paid, which unlocks the report and unlimited questions.
 */

import { NextRequest, NextResponse } from "next/server";
import { getOrderStatus, markPurchasePaid } from "@/lib/butterbase";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const orderId = req.nextUrl.searchParams.get("orderId")?.trim();
  const sessionId = req.nextUrl.searchParams.get("sessionId")?.trim();
  if (!orderId) {
    return NextResponse.json({ error: "orderId is required." }, { status: 400 });
  }

  try {
    const status = await getOrderStatus(orderId);
    if (status === "paid" && sessionId) {
      await markPurchasePaid(sessionId, orderId);
    }
    return NextResponse.json({ status });
  } catch (cause) {
    if (env.DEBUG) {
      console.log("[checkout/status]", cause);
    }
    return NextResponse.json(
      { error: "Could not check the order status." },
      { status: 502 },
    );
  }
}
