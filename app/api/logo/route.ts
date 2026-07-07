/**
 * Same-origin company-logo proxy.
 *
 * The graph view draws company logos with NVL's Node.icon, which loads
 * images with crossOrigin="anonymous". Google's favicon service does not
 * send CORS headers, so the canvas loader would fail (and NVL would draw
 * its broken-image placeholder). This route fetches the favicon server-side
 * and serves it same-origin instead.
 *
 * GET /api/logo?domain=joinhandshake.com[&sz=64]
 */

import type { NextRequest } from "next/server";

const DOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

export async function GET(request: NextRequest): Promise<Response> {
  const domain = request.nextUrl.searchParams.get("domain") ?? "";
  if (!DOMAIN_RE.test(domain)) {
    return new Response("Invalid domain", { status: 400 });
  }
  const szRaw = Number(request.nextUrl.searchParams.get("sz") ?? "64");
  const sz = Number.isFinite(szRaw) ? Math.min(Math.max(szRaw, 16), 256) : 64;

  const upstream = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=${sz}`;
  try {
    const res = await fetch(upstream, {
      redirect: "follow",
      // Cache upstream fetches for a day; logos are effectively static.
      next: { revalidate: 86400 },
    });
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || !type.startsWith("image/")) {
      return new Response(null, { status: 404 });
    }
    const body = await res.arrayBuffer();
    return new Response(body, {
      headers: {
        "Content-Type": type,
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}
