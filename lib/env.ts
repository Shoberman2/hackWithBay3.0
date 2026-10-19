/**
 * Typed environment accessor. Single source of truth for configuration.
 *
 * Every module reads env through this file, never process.env directly.
 * DEMO_MODE is the only switch that allows fixtures, mocks, and canned
 * responses. Missing credentials in live mode must fail loudly so judging
 * checks cannot accidentally pass against local-only/demo behavior.
 */

function read(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

function readAny(names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = read(name);
    if (value) return value;
  }
  return undefined;
}

function readBool(name: string, fallback = false): boolean {
  const value = read(name);
  if (value === undefined) return fallback;
  return value === "1" || value.toLowerCase() === "true";
}

const NEO4J_URI_NAMES = [
  "NEO4J_URI",
  "NEO4J_URL",
  "NEO4J_CONNECTION_URI",
  "NEO4J_CONNECTION_URL",
  "AURA_CONNECTION_URI",
  "GRAPH_DATABASE_URL",
] as const;

const NEO4J_USERNAME_NAMES = [
  "NEO4J_USERNAME",
  "NEO4J_USER",
  "AURA_USERNAME",
  "GRAPH_DATABASE_USERNAME",
] as const;

const NEO4J_PASSWORD_NAMES = [
  "NEO4J_PASSWORD",
  "NEO4J_PASS",
  "AURA_PASSWORD",
  "GRAPH_DATABASE_PASSWORD",
] as const;

export const env = {
  // Neo4j Aura
  NEO4J_URI: readAny(NEO4J_URI_NAMES),
  NEO4J_USERNAME: readAny(NEO4J_USERNAME_NAMES),
  NEO4J_PASSWORD: readAny(NEO4J_PASSWORD_NAMES),

  // Butterbase
  BUTTERBASE_APP_ID: read("BUTTERBASE_APP_ID"),
  BUTTERBASE_ANON_KEY: read("BUTTERBASE_ANON_KEY"),
  BUTTERBASE_SERVICE_KEY: read("BUTTERBASE_SERVICE_KEY"),
  BUTTERBASE_AI_KEY: read("BUTTERBASE_AI_KEY"),
  BUTTERBASE_API_URL: read("BUTTERBASE_API_URL") ?? "https://api.butterbase.ai",

  // RocketRide
  ROCKETRIDE_APIKEY: read("ROCKETRIDE_APIKEY"),
  ROCKETRIDE_URI: read("ROCKETRIDE_URI") ?? "https://api.rocketride.ai",

  // Data sources
  GITHUB_TOKEN: read("GITHUB_TOKEN"),
  PRODUCTHUNT_TOKEN: read("PRODUCTHUNT_TOKEN"),

  // Behavior flags
  DEMO_MODE: readBool("DEMO_MODE", process.env.NODE_ENV !== "production"),
  FREE_REPORT_UNLOCK: readBool("FREE_REPORT_UNLOCK", false),
  DEBUG: readBool("DEBUG", false),
} as const;

export type Env = typeof env;

/** True when a Neo4j connection can actually be opened. */
export function hasNeo4j(): boolean {
  return Boolean(env.NEO4J_URI && env.NEO4J_USERNAME && env.NEO4J_PASSWORD);
}

export function missingNeo4jConfig(): string[] {
  const missing: string[] = [];
  if (!env.NEO4J_URI) missing.push(NEO4J_URI_NAMES.join(" or "));
  if (!env.NEO4J_USERNAME) missing.push(NEO4J_USERNAME_NAMES.join(" or "));
  if (!env.NEO4J_PASSWORD) missing.push(NEO4J_PASSWORD_NAMES.join(" or "));
  return missing;
}

export function neo4jConfigErrorMessage(): string {
  return `Neo4j credentials missing. Set ${missingNeo4jConfig().join(", ")} for a live graph.`;
}

/** True when Butterbase auth/DB calls can be made. */
export function hasButterbase(): boolean {
  return Boolean(env.BUTTERBASE_APP_ID && env.BUTTERBASE_ANON_KEY);
}

/** True when Butterbase admin/provisioning calls can be made. */
export function hasButterbaseServiceKey(): boolean {
  return Boolean(env.BUTTERBASE_APP_ID && env.BUTTERBASE_SERVICE_KEY);
}

/** True when LLM calls through the Butterbase gateway can be made. */
export function hasGateway(): boolean {
  return Boolean(env.BUTTERBASE_AI_KEY);
}

/** True when RocketRide cloud pipelines can be invoked. */
export function hasRocketRide(): boolean {
  return Boolean(env.ROCKETRIDE_APIKEY);
}

export function hasGitHub(): boolean {
  return Boolean(env.GITHUB_TOKEN);
}

export function hasProductHunt(): boolean {
  return Boolean(env.PRODUCTHUNT_TOKEN);
}

/**
 * The effective demo switch. Intentionally explicit: missing credentials
 * are reported in live mode instead of silently replaying fixtures.
 */
export function isDemoMode(): boolean {
  return env.DEMO_MODE;
}
