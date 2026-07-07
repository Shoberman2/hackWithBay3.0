/**
 * Server-side auth helper. Resolves the current user from the httpOnly
 * session cookie for route handlers. In demo mode lib/butterbase.getUser
 * returns the seeded demo user, so gated routes still work with zero
 * credentials; with live Butterbase the JWT is validated and anonymous
 * requests resolve to null (the route then answers 401).
 */

import { cookies } from "next/headers";
import { getUser, type ButterbaseUser } from "@/lib/butterbase";

const TOKEN_COOKIE = "rivalry_token";

export async function currentUser(): Promise<ButterbaseUser | null> {
  const token = (await cookies()).get(TOKEN_COOKIE)?.value;
  return getUser(token);
}
