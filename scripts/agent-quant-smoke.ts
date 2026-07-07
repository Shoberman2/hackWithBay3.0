/** Full-chain smoke: quantitative question -> gateway script-gen -> Daytona sandbox -> answer. */
import { answerQuestion } from "../lib/agents/text2cypher";

async function main() {
  const result = await answerQuestion(
    "What is the average funding round size across these companies, and who raised the largest round?",
    "demo-smoke",
  );
  console.log("=== answer ===");
  console.log(result.answer);
  console.log("=== analysis present:", Boolean(result.analysis), "===");
  if (result.analysis) {
    console.log("engine:", result.analysis.engine);
    console.log("--- sandbox output ---");
    console.log(result.analysis.output);
  }
}
main().catch((e) => { console.error("FAILED:", e?.message ?? e); process.exit(1); });
