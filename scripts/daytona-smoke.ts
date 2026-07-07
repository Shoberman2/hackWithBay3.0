/**
 * Live end-to-end test of the Daytona sandbox leg used by lib/daytona.ts:
 * create sandbox -> upload the real fixture graph -> run a Python analysis
 * -> print output -> delete sandbox. Mirrors runInSandbox() exactly.
 */
import { readFileSync } from "node:fs";
import { Daytona } from "@daytonaio/sdk";

const graph = JSON.parse(
  readFileSync("fixtures/demo-graph.json", "utf8"),
);

const SCRIPT = `
import json
with open("/home/daytona/graph.json") as f:
    g = json.load(f)

nodes = g["nodes"]
links = g["links"]
rounds = {n["id"]: n for n in nodes if n.get("label") == "FundingRound"}
companies = {n["id"]: n for n in nodes if n.get("label") == "Company"}

amounts = []
for n in rounds.values():
    amt = n.get("amount_usd")
    if isinstance(amt, (int, float)) and amt > 0:
        amounts.append(amt)

print(f"Companies in graph: {len(companies)}")
print(f"Funding rounds with amounts: {len(amounts)}")
if amounts:
    print(f"Average round: \${sum(amounts)/len(amounts):,.0f}")
    print(f"Largest round: \${max(amounts):,.0f}")
`;

async function main() {
  const daytona = new Daytona({
    apiKey: process.env.DAYTONA_API_KEY,
    apiUrl: process.env.DAYTONA_API_URL ?? "https://app.daytona.io/api",
  });
  console.log("creating sandbox...");
  const sandbox = await daytona.create({ language: "python" });
  console.log("sandbox id:", sandbox.id);
  try {
    await sandbox.fs.uploadFile(
      Buffer.from(JSON.stringify({ nodes: graph.nodes, links: graph.links })),
      "/home/daytona/graph.json",
    );
    console.log("graph uploaded, running analysis...");
    const response = await sandbox.process.codeRun(SCRIPT, undefined, 60);
    console.log("exitCode:", response.exitCode);
    console.log("--- output ---");
    console.log(response.result);
  } finally {
    await sandbox.delete();
    console.log("sandbox deleted");
  }
}

main().catch((err) => {
  console.error("E2E FAILED:", err?.message ?? err);
  process.exit(1);
});
