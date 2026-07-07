/**
 * Daytona sandbox wrapper (quantitative analysis over the session graph).
 *
 * When a founder question is computational — rankings, averages,
 * distributions, trends, correlations — a Cypher traversal alone answers
 * it poorly. Instead the agent writes a small Python script and runs it
 * inside a disposable Daytona sandbox with the exported session graph
 * mounted at /home/daytona/graph.json. LLM-generated code never executes
 * in the app process.
 *
 * Fallback ladder (demo insurance):
 * - !hasDaytona() or DEMO_MODE -> null (the agent answers from the graph
 *   traversal alone, no sandbox pass).
 * - Script generation, sandbox creation, or execution fails -> null.
 */

import { Daytona } from "@daytonaio/sdk";
import { env, hasDaytona, hasGateway } from "@/lib/env";
import type { SandboxAnalysis } from "@/lib/types";
import type { SessionGraph } from "@/lib/agents/graph-facts";
import { chat } from "@/lib/gateway";

function debug(...args: unknown[]): void {
  if (env.DEBUG) console.error("[daytona]", ...args);
}

const GRAPH_PATH = "/home/daytona/graph.json";
const RUN_TIMEOUT_S = 60;
const MAX_OUTPUT_CHARS = 4000;

/** True when quantitative questions will get a sandboxed analysis pass. */
export function usesSandboxAnalysis(): boolean {
  return hasDaytona() && hasGateway() && !env.DEMO_MODE;
}

/**
 * Heuristic: does this question call for computation over the graph rather
 * than a pure traversal? Kept deliberately narrow — every hit costs a
 * sandbox spin-up.
 */
export function isQuantitative(question: string): boolean {
  return /\b(average|mean|median|percent|ratio|rank|ranking|top \d+|distribut|correlat|trend|over time|per (company|segment|investor|year)|how many .* (each|per)|compare .* (count|number|amount)|total (funding|raised)|sum of)\b/i.test(
    question,
  );
}

function stripFences(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:python|py)?\s*([\s\S]*?)\s*```$/);
  return fenced ? fenced[1] : trimmed;
}

/** Actual property keys per node label, so the generated script never
 *  guesses field names. Keys are flat on the node object. */
function keysByLabel(graph: SessionGraph): string {
  const byLabel = new Map<string, Set<string>>();
  for (const node of graph.nodes) {
    const keys = byLabel.get(node.label) ?? new Set<string>();
    for (const key of Object.keys(node)) keys.add(key);
    byLabel.set(node.label, keys);
  }
  return [...byLabel.entries()]
    .map(([label, keys]) => `${label}: ${[...keys].join(", ")}`)
    .join("\n");
}

async function generateScript(
  question: string,
  graph: SessionGraph,
): Promise<string> {
  const relTypes = [...new Set(graph.links.map((l) => l.type))];
  const raw = await chat(
    [
      {
        role: "system",
        content:
          "You write a single self-contained Python 3 script (stdlib only) that answers a " +
          `quantitative question about a competitive-landscape graph. The graph is at ${GRAPH_PATH} ` +
          'as JSON: {"nodes": [...], "links": [{"source", "target", "type", "props"}]}. ' +
          "Every node is a FLAT object — all properties sit directly on the node, no nested " +
          '"properties" object. The exact property keys present per node label:\n' +
          `${keysByLabel(graph)}\n` +
          `Relationship types present: ${relTypes.join(", ")}. ` +
          "Properties can still be missing on individual nodes — guard every access. " +
          "The script must print a short human-readable answer (a few lines of names and " +
          "numbers, no JSON dump) and nothing else. " +
          "Respond with ONLY the Python code. No markdown, no explanation.",
      },
      { role: "user", content: question },
    ],
    { temperature: 0 },
  );
  const script = stripFences(raw);
  if (script.length === 0) throw new Error("daytona: empty script from model");
  return script;
}

async function runInSandbox(
  script: string,
  graph: SessionGraph,
): Promise<string> {
  const daytona = new Daytona({
    apiKey: env.DAYTONA_API_KEY,
    apiUrl: env.DAYTONA_API_URL,
    ...(env.DAYTONA_TARGET ? { target: env.DAYTONA_TARGET } : {}),
  });
  const sandbox = await daytona.create({ language: "python" });
  try {
    await sandbox.fs.uploadFile(
      Buffer.from(JSON.stringify({ nodes: graph.nodes, links: graph.links })),
      GRAPH_PATH,
    );
    const response = await sandbox.process.codeRun(
      script,
      undefined,
      RUN_TIMEOUT_S,
    );
    if (response.exitCode !== 0) {
      throw new Error(
        `daytona: script exited ${response.exitCode}: ${response.result.slice(0, 500)}`,
      );
    }
    return response.result.trim().slice(0, MAX_OUTPUT_CHARS);
  } finally {
    try {
      await sandbox.delete();
    } catch (err) {
      debug("sandbox delete failed", err);
    }
  }
}

/**
 * Full analysis pass: generate a script for the question, execute it in a
 * fresh Daytona sandbox over the session graph, return script + output.
 * Returns null whenever the pass is unavailable or fails — callers treat
 * the sandbox as a pure enhancement, never a dependency.
 */
export async function runSandboxAnalysis(
  question: string,
  graph: SessionGraph,
): Promise<SandboxAnalysis | null> {
  if (!usesSandboxAnalysis()) return null;
  if (graph.nodes.length === 0) return null;
  try {
    const script = await generateScript(question, graph);
    const output = await runInSandbox(script, graph);
    if (output.length === 0) return null;
    return { engine: "daytona", script, output };
  } catch (err) {
    debug("sandbox analysis failed, continuing without it:", err);
    return null;
  }
}
