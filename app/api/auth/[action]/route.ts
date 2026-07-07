/**
 * Auth endpoints backed by lib/butterbase.
 *
 *   POST /api/auth/signup  { email, password } -> { user }
 *   POST /api/auth/signin  { email, password } -> { user }
 *   POST /api/auth/signout                     -> { ok }
 *   GET  /api/auth/me                          -> { user | null }
 *
 * The access token lives in an httpOnly cookie; the browser never sees it.
 */

import { NextRequest, NextResponse } from "next/server";
import { signUp, signIn, signOut, getUser } from "@/lib/butterbase";

export const dynamic = "force-dynamic";

const TOKEN_COOKIE = "rivalry_token";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // one week

function setToken(res: NextResponse, token: string): void {
  res.cookies.set(TOKEN_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });
}

interface Credentials {
  email?: string;
  password?: string;
}

async function readCredentials(
  req: NextRequest,
): Promise<{ email: string; password: string } | null> {
  let body: Credentials;
  try {
    body = (await req.json()) as Credentials;
  } catch {
    return null;
  }
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || !password) return null;
  return { email, password };
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ action: string }> },
): Promise<NextResponse> {
  const { action } = await ctx.params;

  if (action === "signup" || action === "signin") {
    const credentials = await readCredentials(req);
    if (!credentials) {
      return NextResponse.json(
        { error: "Email and password are required." },
        { status: 400 },
      );
    }
    const result =
      action === "signup"
        ? await signUp(credentials.email, credentials.password)
        : await signIn(credentials.email, credentials.password);

    if (result.error || !result.user) {
      return NextResponse.json(
        { error: result.error ?? "Authentication failed." },
        { status: 401 },
      );
    }
    const res = NextResponse.json({ user: result.user });
    if (result.token) {
      setToken(res, result.token);
    }
    return res;
  }

  if (action === "signout") {
    const token = req.cookies.get(TOKEN_COOKIE)?.value;
    await signOut(token);
    const res = NextResponse.json({ ok: true });
    res.cookies.delete(TOKEN_COOKIE);
    return res;
  }

  return NextResponse.json({ error: "Unknown auth action." }, { status: 404 });
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ action: string }> },
): Promise<NextResponse> {
  const { action } = await ctx.params;
  if (action !== "me") {
    return NextResponse.json({ error: "Unknown auth action." }, { status: 404 });
  }
  const token = req.cookies.get(TOKEN_COOKIE)?.value;
  const user = await getUser(token);
  return NextResponse.json({ user });
}
