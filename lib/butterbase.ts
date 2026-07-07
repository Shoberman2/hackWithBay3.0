/**
 * Butterbase client (auth + DB) and payments helpers.
 *
 * - createClient({ appId, apiUrl, anonKey }) from @butterbase/sdk; every SDK
 *   call returns { data, error } — errors are surfaced, never swallowed.
 * - Payments use the SDK BillingClient, whose implementation (verified in
 *   the installed package source) is exactly the REST surface from the plan:
 *   POST /v1/{app_id}/billing/products, POST /v1/{app_id}/billing/purchase,
 *   GET /v1/{app_id}/billing/orders/{id}.
 * - When env.DEMO_MODE or !hasButterbase(): an in-memory store with a seeded
 *   demo user backs the same function surface, and checkout orders flip to
 *   "paid" ~3 seconds after creation. This fake settlement is gated on demo
 *   mode only — the production path always polls the real order.
 */

import {
  createClient,
  type ButterbaseClient,
  type Order,
} from "@butterbase/sdk";
import { env, hasButterbase } from "@/lib/env";

/* ------------------------------------------------------------------ */
/* Shapes                                                              */
/* ------------------------------------------------------------------ */

export interface ButterbaseUser {
  id: string;
  email: string;
}

export interface AuthResult {
  user: ButterbaseUser | null;
  /** Access token for the cookie; null when sign-up needs verification. */
  token: string | null;
  error: string | null;
}

export interface PurchaseSession {
  orderId: string;
  checkoutUrl: string;
  /** True when this is the demo-mode fake checkout (no redirect). */
  demo: boolean;
}

export type OrderStatus = "pending" | "paid" | "failed" | "refunded";

export interface SessionRow {
  session_id: string;
  user_id?: string;
  idea: string;
  tags: string[];
  status: string;
  created_at: string;
}

export interface QuestionRow {
  session_id: string;
  question: string;
  cypher?: string;
  answer: string;
  created_at: string;
}

export interface PurchaseRow {
  session_id: string;
  order_id: string;
  status: OrderStatus;
  created_at: string;
}

export interface ReportRow {
  session_id: string;
  markdown: string;
  created_at: string;
}

const PRODUCT_NAME = "Full Landscape Report";
const PRODUCT_PRICE_CENTS = 900;
const DEMO_SETTLE_MS = 3000;

function debugLog(...args: unknown[]): void {
  if (env.DEBUG) {
    console.log("[butterbase]", ...args);
  }
}

function butterbaseInDemoMode(): boolean {
  return env.DEMO_MODE || !hasButterbase();
}

/* ------------------------------------------------------------------ */
/* Demo-mode in-memory store                                           */
/* ------------------------------------------------------------------ */

interface DemoOrder {
  orderId: string;
  sessionId: string;
  createdAt: number;
  status: OrderStatus;
}

interface DemoStore {
  users: Map<string, { id: string; email: string; password: string }>;
  tokens: Map<string, string>; // token -> user id
  sessions: Map<string, SessionRow>;
  questions: QuestionRow[];
  purchases: Map<string, PurchaseRow>; // session_id -> row
  orders: Map<string, DemoOrder>; // order_id -> order
  reports: Map<string, ReportRow>; // session_id -> row
}

const DEMO_USER: ButterbaseUser = { id: "demo-user", email: "demo@rivalry.app" };

function makeDemoStore(): DemoStore {
  const store: DemoStore = {
    users: new Map(),
    tokens: new Map(),
    sessions: new Map(),
    questions: [],
    purchases: new Map(),
    orders: new Map(),
    reports: new Map(),
  };
  store.users.set(DEMO_USER.email, {
    ...DEMO_USER,
    password: "Rivalry-Demo-1",
  });
  return store;
}

/** Survives Next dev hot reloads via globalThis. */
function demoStore(): DemoStore {
  const holder = globalThis as { __rivalryDemoStore?: DemoStore };
  holder.__rivalryDemoStore ??= makeDemoStore();
  return holder.__rivalryDemoStore;
}

function demoToken(userId: string): string {
  const token = `demo-${userId}-${Math.random().toString(36).slice(2, 10)}`;
  demoStore().tokens.set(token, userId);
  return token;
}

/* ------------------------------------------------------------------ */
/* Client                                                              */
/* ------------------------------------------------------------------ */

/**
 * A fresh SDK client per call. Server routes handle concurrent requests
 * with different users, so the singleton-with-setAccessToken pattern would
 * leak tokens across requests. Throws when Butterbase is unconfigured —
 * demo-mode paths never reach this.
 */
export function getButterbase(accessToken?: string): ButterbaseClient {
  if (!hasButterbase()) {
    throw new Error(
      "Butterbase is not configured (BUTTERBASE_APP_ID / BUTTERBASE_ANON_KEY)",
    );
  }
  const client = createClient({
    appId: env.BUTTERBASE_APP_ID!,
    apiUrl: env.BUTTERBASE_API_URL,
    anonKey: env.BUTTERBASE_ANON_KEY,
    persistSession: false,
    detectSessionFromUrl: false,
  });
  if (accessToken) client.setAccessToken(accessToken);
  return client;
}

/* ------------------------------------------------------------------ */
/* Auth                                                                */
/* ------------------------------------------------------------------ */

export async function signUp(email: string, password: string): Promise<AuthResult> {
  if (butterbaseInDemoMode()) {
    const store = demoStore();
    if (store.users.has(email)) {
      return { user: null, token: null, error: "An account with this email already exists." };
    }
    const user = { id: `user-${store.users.size + 1}`, email, password };
    store.users.set(email, user);
    return { user: { id: user.id, email }, token: demoToken(user.id), error: null };
  }

  const client = getButterbase();
  const { data, error } = await client.auth.signUp({ email, password });
  if (error || !data) {
    return { user: null, token: null, error: error?.message ?? "Sign up failed." };
  }
  // Real sign-up may require email verification; try an immediate sign-in
  // so verified-off apps get a session in one step.
  const signin = await client.auth.signIn({ email, password });
  if (signin.error || !signin.data) {
    return {
      user: { id: data.user.id, email: data.user.email },
      token: null,
      error: null,
    };
  }
  return {
    user: { id: signin.data.user.id, email: signin.data.user.email },
    token: signin.data.access_token,
    error: null,
  };
}

export async function signIn(email: string, password: string): Promise<AuthResult> {
  if (butterbaseInDemoMode()) {
    const store = demoStore();
    let user = store.users.get(email);
    if (!user) {
      // Demo mode accepts any credentials so the flow never dead-ends.
      user = { id: `user-${store.users.size + 1}`, email, password };
      store.users.set(email, user);
    } else if (user.password !== password) {
      return { user: null, token: null, error: "Incorrect email or password." };
    }
    return { user: { id: user.id, email }, token: demoToken(user.id), error: null };
  }

  const { data, error } = await getButterbase().auth.signIn({ email, password });
  if (error || !data) {
    return { user: null, token: null, error: error?.message ?? "Sign in failed." };
  }
  return {
    user: { id: data.user.id, email: data.user.email },
    token: data.access_token,
    error: null,
  };
}

/**
 * Resolve the current user from an access token. In demo mode a missing or
 * unknown token resolves to the seeded demo user so the app is always
 * "signed in" without credentials.
 */
export async function getUser(token?: string): Promise<ButterbaseUser | null> {
  if (butterbaseInDemoMode()) {
    const store = demoStore();
    if (token) {
      const userId = store.tokens.get(token);
      if (userId) {
        for (const u of store.users.values()) {
          if (u.id === userId) return { id: u.id, email: u.email };
        }
      }
    }
    return DEMO_USER;
  }

  if (!token) return null;
  const { data, error } = await getButterbase(token).auth.getUser();
  if (error || !data) {
    debugLog("getUser failed:", error?.message);
    return null;
  }
  return { id: data.id, email: data.email };
}

export async function signOut(token?: string): Promise<void> {
  if (butterbaseInDemoMode()) {
    if (token) demoStore().tokens.delete(token);
    return;
  }
  if (!token) return;
  const { error } = await getButterbase(token).auth.signOut();
  if (error) debugLog("signOut failed:", error.message);
}

/* ------------------------------------------------------------------ */
/* Sessions                                                            */
/* ------------------------------------------------------------------ */

export async function upsertSession(
  sessionId: string,
  idea: string,
  tags: string[],
  status = "active",
  userId?: string,
): Promise<void> {
  if (butterbaseInDemoMode()) {
    demoStore().sessions.set(sessionId, {
      session_id: sessionId,
      user_id: userId,
      idea,
      tags,
      status,
      created_at: new Date().toISOString(),
    });
    return;
  }
  const client = getButterbase();
  const existing = await client
    .from<SessionRow>("sessions")
    .select("session_id")
    .eq("session_id", sessionId);
  if (existing.error) throw existing.error;
  if (existing.data && existing.data.length > 0) {
    const { error } = await client
      .from<SessionRow>("sessions")
      .update({ idea, tags, status })
      .eq("session_id", sessionId);
    if (error) throw error;
  } else {
    const { error } = await client.from<SessionRow>("sessions").insert({
      session_id: sessionId,
      user_id: userId,
      idea,
      tags,
      status,
      created_at: new Date().toISOString(),
    });
    if (error) throw error;
  }
}

export async function getSession(sessionId: string): Promise<SessionRow | null> {
  if (butterbaseInDemoMode()) {
    return demoStore().sessions.get(sessionId) ?? null;
  }
  const { data, error } = await getButterbase()
    .from<SessionRow>("sessions")
    .select("*")
    .eq("session_id", sessionId)
    .limit(1);
  if (error) throw error;
  return data?.[0] ?? null;
}

/* ------------------------------------------------------------------ */
/* Question metering                                                   */
/* ------------------------------------------------------------------ */

/** Count of agent questions asked in a session (free tier meters at 5). */
export async function getQuestionCount(sessionId: string): Promise<number> {
  if (butterbaseInDemoMode()) {
    return demoStore().questions.filter((q) => q.session_id === sessionId).length;
  }
  const { data, error } = await getButterbase()
    .from<QuestionRow>("questions")
    .select("session_id")
    .eq("session_id", sessionId);
  if (error) throw error;
  return data?.length ?? 0;
}

export async function recordQuestion(
  sessionId: string,
  question: string,
  cypher: string | undefined,
  answer: string,
): Promise<void> {
  const row: QuestionRow = {
    session_id: sessionId,
    question,
    cypher,
    answer,
    created_at: new Date().toISOString(),
  };
  if (butterbaseInDemoMode()) {
    demoStore().questions.push(row);
    return;
  }
  const { error } = await getButterbase().from<QuestionRow>("questions").insert(row);
  if (error) throw error;
}

/* ------------------------------------------------------------------ */
/* Payments                                                            */
/* ------------------------------------------------------------------ */

let cachedProductId: string | null = null;

async function ensureProduct(client: ButterbaseClient): Promise<string> {
  if (cachedProductId) return cachedProductId;
  const listed = await client.billing.listProducts();
  if (listed.error) throw listed.error;
  const existing = listed.data?.find((p) => p.name === PRODUCT_NAME && p.active);
  if (existing) {
    cachedProductId = existing.id;
    return existing.id;
  }
  const created = await client.billing.createProduct({
    name: PRODUCT_NAME,
    priceCents: PRODUCT_PRICE_CENTS,
    description:
      "Written competitive landscape report: clusters, white space, founder patterns, moats, positioning.",
  });
  if (created.error || !created.data) {
    throw created.error ?? new Error("Product creation returned no data");
  }
  cachedProductId = created.data.id;
  return created.data.id;
}

/**
 * Start a report purchase for a session. Returns the Stripe Checkout URL
 * (or a marker fake order in demo mode that settles after ~3 seconds).
 */
export async function createPurchase(
  sessionId: string,
  origin?: string,
  accessToken?: string,
): Promise<PurchaseSession> {
  if (butterbaseInDemoMode()) {
    const orderId = `demo-order-${Math.random().toString(36).slice(2, 10)}`;
    demoStore().orders.set(orderId, {
      orderId,
      sessionId,
      createdAt: Date.now(),
      status: "pending",
    });
    debugLog("demo order created", orderId);
    return { orderId, checkoutUrl: "", demo: true };
  }

  const client = getButterbase(accessToken);
  const productId = await ensureProduct(client);
  const returnUrl = origin
    ? `${origin}/session/${encodeURIComponent(sessionId)}?checkout=return`
    : undefined;
  const { data, error } = await client.billing.purchase({
    productId,
    successUrl: returnUrl,
    cancelUrl: returnUrl,
  });
  if (error || !data) {
    throw error ?? new Error("Purchase returned no data");
  }
  const row: PurchaseRow = {
    session_id: sessionId,
    order_id: data.orderId,
    status: "pending",
    created_at: new Date().toISOString(),
  };
  const inserted = await client.from<PurchaseRow>("purchases").insert(row);
  if (inserted.error) throw inserted.error;
  return { orderId: data.orderId, checkoutUrl: data.url, demo: false };
}

function normalizeOrderStatus(status: string): OrderStatus {
  if (status === "paid" || status === "failed" || status === "refunded") return status;
  return "pending";
}

/** Poll an order until it settles (used by the checkout status route). */
export async function getOrderStatus(orderId: string): Promise<OrderStatus> {
  if (butterbaseInDemoMode()) {
    const order = demoStore().orders.get(orderId);
    if (!order) return "failed";
    if (order.status === "pending" && Date.now() - order.createdAt >= DEMO_SETTLE_MS) {
      order.status = "paid";
    }
    return order.status;
  }
  const { data, error } = await getButterbase().billing.getOrder(orderId);
  if (error || !data) throw error ?? new Error("Order lookup returned no data");
  return normalizeOrderStatus((data as Order).status);
}

/** Mark a session's purchase paid (called when the order settles). */
export async function markPurchasePaid(
  sessionId: string,
  orderId: string,
): Promise<void> {
  if (butterbaseInDemoMode()) {
    demoStore().purchases.set(sessionId, {
      session_id: sessionId,
      order_id: orderId,
      status: "paid",
      created_at: new Date().toISOString(),
    });
    return;
  }
  const { error } = await getButterbase()
    .from<PurchaseRow>("purchases")
    .update({ status: "paid" })
    .eq("session_id", sessionId)
    .eq("order_id", orderId);
  if (error) throw error;
}

/** Paywall check: does this session have a settled purchase? */
export async function hasPurchase(sessionId: string): Promise<boolean> {
  if (butterbaseInDemoMode()) {
    return demoStore().purchases.get(sessionId)?.status === "paid";
  }
  const { data, error } = await getButterbase()
    .from<PurchaseRow>("purchases")
    .select("order_id")
    .eq("session_id", sessionId)
    .eq("status", "paid")
    .limit(1);
  if (error) throw error;
  return Boolean(data && data.length > 0);
}

/* ------------------------------------------------------------------ */
/* Reports                                                             */
/* ------------------------------------------------------------------ */

export async function saveReport(sessionId: string, markdown: string): Promise<void> {
  if (butterbaseInDemoMode()) {
    demoStore().reports.set(sessionId, {
      session_id: sessionId,
      markdown,
      created_at: new Date().toISOString(),
    });
    return;
  }
  const { error } = await getButterbase().from<ReportRow>("reports").insert({
    session_id: sessionId,
    markdown,
    created_at: new Date().toISOString(),
  });
  if (error) throw error;
}

export async function getReport(sessionId: string): Promise<string | null> {
  if (butterbaseInDemoMode()) {
    return demoStore().reports.get(sessionId)?.markdown ?? null;
  }
  const { data, error } = await getButterbase()
    .from<ReportRow>("reports")
    .select("*")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  return data?.[0]?.markdown ?? null;
}
