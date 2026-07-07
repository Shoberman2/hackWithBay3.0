/**
 * Typed environment accessor. Single source of truth for configuration.
 *
 * Every module reads env through this file, never process.env directly.
 * DEMO_MODE (or missing keys for a service) means: fall back to fixtures,
 * mocks, and canned responses so the app runs end-to-end with zero
 * credentials. Treat that as a first-class code path.
 */

function read(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

function readBool(name: string, fallback = false): boolean {
  const value = read(name);
  if (value === undefined) return fallback;
  return value === "1" || value.toLowerCase() === "true";
}

export const env = {
  // Neo4j Aura
  NEO4J_URI: read("NEO4J_URI"),
  NEO4J_USERNAME: read("NEO4J_USERNAME"),
  NEO4J_PASSWORD: read("NEO4J_PASSWORD"),

  // Butterbase
  BUTTERBASE_APP_ID: read("BUTTERBASE_APP_ID"),
  BUTTERBASE_ANON_KEY: read("BUTTERBASE_ANON_KEY"),
  BUTTERBASE_AI_KEY: read("BUTTERBASE_AI_KEY"),
  BUTTERBASE_API_URL: read("BUTTERBASE_API_URL") ?? "https://api.butterbase.ai",

  // RocketRide
  ROCKETRIDE_APIKEY: read("ROCKETRIDE_APIKEY"),
  ROCKETRIDE_URI: read("ROCKETRIDE_URI") ?? "https://cloud.rocketride.ai",
  // The deployed pipeline's HTTP webhook trigger URL (from a one-click deploy
  // to cloud.rocketride.ai). When set, this is the managed production endpoint
  // the app POSTs to — no local .pipe upload. URL includes ?auth=<public token>.
  ROCKETRIDE_ENDPOINT: read("ROCKETRIDE_ENDPOINT"),

  // Data sources
  GITHUB_TOKEN: read("GITHUB_TOKEN"),
  PRODUCTHUNT_TOKEN: read("PRODUCTHUNT_TOKEN"),

  // Behavior flags
  DEMO_MODE: readBool("DEMO_MODE", true),
  DEBUG: readBool("DEBUG", false),
} as const;

export type Env = typeof env;

/** True when a Neo4j connection can actually be opened. */
export function hasNeo4j(): boolean {
  return Boolean(env.NEO4J_URI && env.NEO4J_USERNAME && env.NEO4J_PASSWORD);
}

/** True when Butterbase auth/DB calls can be made. */
export function hasButterbase(): boolean {
  return Boolean(env.BUTTERBASE_APP_ID && env.BUTTERBASE_ANON_KEY);
}

/** True when LLM calls through the Butterbase gateway can be made. */
export function hasGateway(): boolean {
  return Boolean(env.BUTTERBASE_AI_KEY);
}

/** True when RocketRide cloud pipelines can be invoked. */
export function hasRocketRide(): boolean {
  return Boolean(env.ROCKETRIDE_APIKEY || env.ROCKETRIDE_ENDPOINT);
}

/**
 * True when a deployed/managed RocketRide pipeline endpoint (HTTP webhook
 * trigger URL) is configured. This is the preferred production path: the app
 * POSTs to a pipeline already deployed on cloud.rocketride.ai instead of
 * uploading the local .pipe over the SDK on every call.
 */
export function hasRocketRideEndpoint(): boolean {
  return Boolean(env.ROCKETRIDE_ENDPOINT);
}

export function hasGitHub(): boolean {
  return Boolean(env.GITHUB_TOKEN);
}

export function hasProductHunt(): boolean {
  return Boolean(env.PRODUCTHUNT_TOKEN);
}

/**
 * The effective demo switch: explicit DEMO_MODE, or any core service
 * unconfigured. Modules should check the specific has* helper for their
 * own service, but this is the global "run on fixtures" signal.
 */
export function isDemoMode(): boolean {
  return env.DEMO_MODE || !hasNeo4j() || !hasGateway();
}
