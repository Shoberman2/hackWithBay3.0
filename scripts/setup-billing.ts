/**
 * One-time Butterbase billing setup for the "Full Landscape Report" ($9).
 *
 * Idempotently ensures the product exists, then checks Stripe Connect:
 *   - connected + chargesEnabled  -> prints "checkout is live"
 *   - otherwise                   -> prints the one-time Stripe onboarding URL
 *
 * Run: npx tsx scripts/setup-billing.ts
 */

import fs from "node:fs";
import path from "node:path";

/** Minimal .env.local loader (scripts run outside Next's env loading). */
function loadEnvLocal(): void {
  for (const file of [".env.local", ".env"]) {
    const p = path.join(process.cwd(), file);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (process.env[m[1]] === undefined) process.env[m[1]] = v;
    }
  }
}

const PRODUCT_NAME = "Full Landscape Report";
const PRODUCT_PRICE_CENTS = 900;

async function main(): Promise<void> {
  loadEnvLocal();
  // Import after env is loaded (lib/env.ts snapshots process.env on import).
  const { env, hasButterbase } = await import("../lib/env");
  const { getButterbase } = await import("../lib/butterbase");

  if (env.DEMO_MODE || !hasButterbase()) {
    console.log(
      "[setup-billing] DEMO MODE (DEMO_MODE=true or no Butterbase credentials) —",
    );
    console.log(
      "[setup-billing] checkout runs against the in-memory store and settles a fake",
    );
    console.log(
      "[setup-billing] order after ~3s. Nothing to onboard. Set DEMO_MODE=false and",
    );
    console.log(
      "[setup-billing] BUTTERBASE_APP_ID / BUTTERBASE_ANON_KEY to configure live billing.",
    );
    return;
  }

  const client = getButterbase();

  /* 1. Ensure the product exists (list -> create on miss). */
  const listed = await client.billing.listProducts();
  if (listed.error) throw listed.error;
  let product = listed.data?.find((p) => p.name === PRODUCT_NAME && p.active) ?? null;
  if (product) {
    console.log(
      `[setup-billing] product exists: ${product.id} ("${product.name}", $${(product.price_cents / 100).toFixed(2)})`,
    );
  } else {
    const created = await client.billing.createProduct({
      name: PRODUCT_NAME,
      priceCents: PRODUCT_PRICE_CENTS,
      description:
        "Written competitive landscape report: clusters, white space, founder patterns, moats, positioning.",
    });
    if (created.error || !created.data) {
      throw created.error ?? new Error("Product creation returned no data");
    }
    product = created.data;
    console.log(
      `[setup-billing] product created: ${product.id} ("${product.name}", $${(product.price_cents / 100).toFixed(2)})`,
    );
  }

  /* 2. Check Stripe Connect status. */
  const status = await client.billing.connectStatus();
  if (status.error || !status.data) {
    throw status.error ?? new Error("connectStatus returned no data");
  }
  const { connected, chargesEnabled, payoutsEnabled, detailsSubmitted } = status.data;
  console.log(
    `[setup-billing] connect status: connected=${connected} chargesEnabled=${chargesEnabled ?? false} payoutsEnabled=${payoutsEnabled ?? false} detailsSubmitted=${detailsSubmitted ?? false}`,
  );

  if (connected && chargesEnabled) {
    console.log("[setup-billing] checkout is live.");
    return;
  }

  /* 3. Not ready — start onboarding and print the URL. */
  const onboard = await client.billing.connectOnboard();
  if (onboard.error || !onboard.data) {
    throw onboard.error ?? new Error("connectOnboard returned no data");
  }
  console.log("");
  console.log("[setup-billing] Stripe Connect onboarding is incomplete.");
  console.log(`[setup-billing] account: ${onboard.data.accountId}`);
  console.log("[setup-billing] Open this URL once and complete the Stripe form:");
  console.log("");
  console.log(`    ${onboard.data.onboardingUrl}`);
  console.log("");
  console.log(
    "[setup-billing] Then re-run `npx tsx scripts/setup-billing.ts` — it should print",
  );
  console.log('[setup-billing] "checkout is live." once Stripe enables charges.');
}

main().catch((err) => {
  console.error("[setup-billing] failed:", err);
  process.exit(1);
});
