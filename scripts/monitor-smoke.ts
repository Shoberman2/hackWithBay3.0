/**
 * Live smoke of the news monitor: Daytona fetch agent over real platforms
 * (TechCrunch venture RSS, Google News, HN Algolia) -> classification
 * (RocketRide pipe when deployed, gateway otherwise) -> NewsSignals.
 * Run with the env loaded: `set -a; source .env; set +a; npx tsx scripts/monitor-smoke.ts`
 */
import { runMonitor } from "../lib/monitor";

async function main() {
  const report = await runMonitor(
    ["Handshake", "RippleMatch", "WayUp"],
    ["internships", "early-career hiring"],
  );
  console.log("engines:", report.engines);
  console.log("fetched docs:", report.fetched_docs);
  console.log("signals:", report.signals.length);
  for (const s of report.signals.slice(0, 8)) {
    console.log(
      `- [${s.kind}] (${s.relevance.toFixed(2)}) ${s.headline}\n    ${s.url}`,
    );
  }
}

main().catch((e) => {
  console.error("FAILED:", e?.message ?? e);
  process.exit(1);
});
