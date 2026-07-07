/**
 * Agents barrel. The three LLM behaviors (onboarding interview, Q&A via
 * text2Cypher, insight/report generation) plus the moat pass — every model
 * call routed through lib/gateway.ts, every module demo-safe.
 */

export {
  runOnboarding,
  onboardingNext,
  type OnboardingTurn,
} from "./onboarding";

export { answerQuestion, sanitizeCypher } from "./text2cypher";

export { buildInsightCards, type AlgoResult } from "./insights";

export { analyzeCompanyMoat, type MoatPassResult } from "./moat";

export {
  buildDigest,
  buildReportPrompt,
  generateReport,
  type ReportDigest,
} from "./report";

export {
  getSessionGraph,
  getFixtureGraph,
  type SessionGraph,
} from "./graph-facts";
