/**
 * Same-origin company-logo proxy.
 *
 * The graph view draws company logos with NVL's Node.icon, which loads
 * images with crossOrigin="anonymous". Third-party logo hosts do not send
 * CORS headers, so the canvas loader would fail (and NVL would draw its
 * broken-image placeholder). This route fetches the logo server-side and
 * serves it same-origin instead.
 *
 * Resolution is by DOMAIN, so it works naturally for any company the
 * pipeline discovers -- nothing is hard-coded per company:
 *   1. unavatar.io aggregates real brand logos (Twitter/Clearbit-cache/
 *      favicon/etc.) and returns the best available for a domain.
 *   2. If unavatar has no real logo, fall back to the Google favicon.
 *
 * GET /api/logo?domain=joinhandshake.com[&sz=128]
 */

import type { NextRequest } from "next/server";

const DOMAIN_RE =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

async function fetchImage(url: string): Promise<Response | null> {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      // Logos are effectively static; cache the upstream fetch for a day.
      next: { revalidate: 86400 },
    });
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || !type.startsWith("image/")) return null;
    return res;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest): Promise<Response> {
  const domain = request.nextUrl.searchParams.get("domain") ?? "";
  if (!DOMAIN_RE.test(domain)) {
    return new Response("Invalid domain", { status: 400 });
  }
  const szRaw = Number(request.nextUrl.searchParams.get("sz") ?? "128");
  const sz = Number.isFinite(szRaw) ? Math.min(Math.max(szRaw, 16), 400) : 128;

  const enc = encodeURIComponent(domain);
  // Primary: real brand logo (fallback=false => 404 when only a generic
  // avatar would be synthesized, so we can fall through to the favicon).
  const upstreams = [
    `https://unavatar.io/${enc}?fallback=false`,
    `https://www.google.com/s2/favicons?domain=${enc}&sz=${sz}`,
  ];

  for (const upstream of upstreams) {
    const res = await fetchImage(upstream);
    if (!res) continue;
    const body = await res.arrayBuffer();
    return new Response(body, {
      headers: {
        "Content-Type": res.headers.get("content-type") ?? "image/png",
        "Cache-Control": "public, max-age=86400",
      },
    });
  }
  return new Response(null, { status: 404 });
}
