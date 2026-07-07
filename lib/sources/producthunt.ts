/**
 * Product Hunt GraphQL API v2. There is NO free-text search argument —
 * posts are pulled by topic slug + postedAfter and keyword-filtered
 * client-side. Requires PRODUCTHUNT_TOKEN; skips cleanly without it.
 */

import { env, hasProductHunt, isDemoMode } from "@/lib/env";
import type { RawDoc } from "@/lib/types";
import { debugLog, matchesAnyTerm, safeFetch, truncate } from "./support";

const PH_GRAPHQL = "https://api.producthunt.com/v2/api/graphql";

const POSTS_QUERY = `
query TopicPosts($topic: String!, $postedAfter: DateTime, $first: Int!) {
  posts(first: $first, order: NEWEST, topic: $topic, postedAfter: $postedAfter) {
    edges {
      node {
        name
        tagline
        description
        url
        votesCount
        createdAt
        makers { name username headline }
      }
    }
  }
}`;

interface PhMaker {
  name?: string | null;
  username?: string | null;
  headline?: string | null;
}

interface PhPost {
  name: string;
  tagline?: string | null;
  description?: string | null;
  url: string;
  votesCount?: number | null;
  createdAt?: string | null;
  makers?: PhMaker[] | null;
}

interface PhResponse {
  data?: {
    posts?: { edges?: { node: PhPost }[] };
  };
  errors?: unknown[];
}

/** Turn a phrase into a plausible PH topic slug ("AI meeting notes" -> "ai-meeting-notes"). */
export function toTopicSlug(term: string): string {
  return term
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function postToDoc(post: PhPost): RawDoc {
  const makers = (post.makers ?? [])
    .map((m) => (m.name ? `${m.name}${m.headline ? ` (${m.headline})` : ""}` : m.username))
    .filter(Boolean)
    .join(", ");
  const text = [
    `${post.name}: ${post.tagline ?? ""}`,
    post.description ?? "",
    makers ? `Makers: ${makers}.` : "",
    typeof post.votesCount === "number" ? `${post.votesCount} votes on Product Hunt.` : "",
  ]
    .filter(Boolean)
    .join(" ");
  return {
    url: post.url,
    source_type: "PH",
    title: post.name,
    text: truncate(text, 4000),
    date: post.createdAt ?? undefined,
  };
}

const DEMO_DOCS: RawDoc[] = [
  {
    url: "https://www.producthunt.com/posts/simplify-copilot",
    source_type: "PH",
    title: "Simplify Copilot",
    text: "Simplify Copilot: Autofill job and internship applications in one click. Makers: Michael Yan. 890 votes on Product Hunt.",
    date: "2022-08-15T16:00:00.000Z",
  },
  {
    url: "https://www.producthunt.com/posts/careerfairy",
    source_type: "PH",
    title: "CareerFairy",
    text: "CareerFairy: Live streams connecting students with their future employers. Makers: demo maker. 310 votes on Product Hunt.",
    date: "2021-03-04T10:00:00.000Z",
  },
];

/**
 * Pull recent posts for each topic slug and keyword-filter name +
 * tagline + description against the search terms client-side.
 */
export async function searchProductHunt(
  topicSlugs: string[],
  keywords: string[],
  postedAfter?: string,
  firstPerTopic = 20,
): Promise<RawDoc[]> {
  try {
    if (isDemoMode()) return DEMO_DOCS;
    if (!hasProductHunt()) {
      debugLog("producthunt skipped: no token");
      return [];
    }
    const after =
      postedAfter ??
      new Date(Date.now() - 2 * 365 * 24 * 3600 * 1000).toISOString();
    const seen = new Set<string>();
    const docs: RawDoc[] = [];
    for (const slug of topicSlugs) {
      const res = await safeFetch(PH_GRAPHQL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.PRODUCTHUNT_TOKEN}`,
        },
        body: JSON.stringify({
          query: POSTS_QUERY,
          variables: { topic: slug, postedAfter: after, first: firstPerTopic },
        }),
      });
      if (!res) continue;
      const payload = (await res.json().catch(() => undefined)) as PhResponse | undefined;
      if (!payload?.data?.posts?.edges) {
        debugLog("producthunt empty/error payload", slug, payload?.errors);
        continue;
      }
      for (const edge of payload.data.posts.edges) {
        const post = edge.node;
        if (seen.has(post.url)) continue;
        const haystack = `${post.name} ${post.tagline ?? ""} ${post.description ?? ""}`;
        if (keywords.length > 0 && !matchesAnyTerm(haystack, keywords)) continue;
        seen.add(post.url);
        docs.push(postToDoc(post));
      }
    }
    return docs;
  } catch (err) {
    debugLog("producthunt failed", err);
    return [];
  }
}
