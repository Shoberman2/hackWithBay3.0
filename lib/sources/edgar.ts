/**
 * SEC EDGAR Form D full-text search + primary_doc.xml amounts.
 * MANDATORY declared User-Agent on every request; max 10 req/s.
 * Legal-entity names are noisy (SPVs, near-misses) — only unambiguous
 * entity-name matches are returned; SAFEs are invisible here, so this is
 * supplementary evidence, never the sole funding source.
 */

import { isDemoMode } from "@/lib/env";
import type { RawDoc } from "@/lib/types";
import { debugLog, fetchJson, fetchText, truncate } from "./support";

const EDGAR_UA = { "User-Agent": "Rivalry rivalry-hackathon@example.com" };
const EFTS_SEARCH = "https://efts.sec.gov/LATEST/search-index";

interface EftsHit {
  _id?: string;
  _source?: {
    cik?: string | string[];
    display_names?: string[];
    adsh?: string;
    file_date?: string;
    file_type?: string;
  };
}

interface EftsResponse {
  hits?: { hits?: EftsHit[] };
}

/** Normalize a company/legal name for comparison: lowercase, strip punctuation and legal suffixes. */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.,'"()]/g, "")
    .replace(/\b(inc|incorporated|corp|corporation|llc|ltd|co|company|labs|hq|technologies|technology)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** display_names entries look like "Handshake Inc. (CIK 0001234567)". */
function displayNameMatches(displayName: string, company: string): boolean {
  const bare = displayName.replace(/\s*\(CIK[^)]*\)\s*$/i, "");
  return normalizeName(bare) === normalizeName(company);
}

function extractCik(hit: EftsHit): string | undefined {
  const cikField = hit._source?.cik;
  const raw = Array.isArray(cikField) ? cikField[0] : cikField;
  if (raw) return String(raw).replace(/^0+/, "");
  const fromName = hit._source?.display_names?.[0]?.match(/CIK\s*(\d+)/i);
  return fromName ? fromName[1].replace(/^0+/, "") : undefined;
}

function xmlValue(xml: string, tag: string): string | undefined {
  const m = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`, "i"));
  return m ? m[1].trim() : undefined;
}

const DEMO_DOCS: RawDoc[] = [
  {
    url: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=ripplematch",
    source_type: "EDGAR",
    title: "RippleMatch Inc. Form D filing",
    text: "SEC Form D filed by RippleMatch Inc. on 2021-05-01. Total offering amount: $23,500,000. Total amount sold: $23,500,000. Regulation D exempt offering of equity securities.",
    date: "2021-05-01",
  },
];

/**
 * Form D filings for a company legal name. Only returns filings whose
 * filer display name unambiguously matches the queried company; each
 * doc carries the offering amounts parsed from primary_doc.xml.
 */
export async function searchEdgarFormD(
  companyName: string,
  maxFilings = 3,
): Promise<RawDoc[]> {
  try {
    if (isDemoMode()) return DEMO_DOCS;
    const url = `${EFTS_SEARCH}?q=${encodeURIComponent(`"${companyName}"`)}&forms=D`;
    const payload = await fetchJson<EftsResponse>(url, { headers: EDGAR_UA });
    const hits = payload?.hits?.hits ?? [];
    const docs: RawDoc[] = [];

    for (const hit of hits) {
      if (docs.length >= maxFilings) break;
      const displayNames = hit._source?.display_names ?? [];
      if (!displayNames.some((n) => displayNameMatches(n, companyName))) continue;
      const cik = extractCik(hit);
      const adsh = hit._source?.adsh ?? hit._id?.split(":")[0];
      if (!cik || !adsh) continue;

      const adshFlat = adsh.replace(/-/g, "");
      const docUrl = `https://www.sec.gov/Archives/edgar/data/${cik}/${adshFlat}/primary_doc.xml`;
      const xml = await fetchText(docUrl, { headers: EDGAR_UA });
      if (!xml) continue;

      const offering = xmlValue(xml, "totalOfferingAmount");
      const sold = xmlValue(xml, "totalAmountSold");
      const fileDate = hit._source?.file_date;
      const parts = [
        `SEC Form D filed by ${displayNames[0]}${fileDate ? ` on ${fileDate}` : ""}.`,
        offering ? `Total offering amount: $${offering}.` : "",
        sold ? `Total amount sold: $${sold}.` : "",
        "Regulation D exempt offering.",
      ].filter(Boolean);

      docs.push({
        url: `https://www.sec.gov/Archives/edgar/data/${cik}/${adshFlat}/`,
        source_type: "EDGAR",
        title: `${companyName} Form D filing${fileDate ? ` (${fileDate})` : ""}`,
        text: truncate(parts.join(" "), 2000),
        date: fileDate,
      });
    }
    return docs;
  } catch (err) {
    debugLog("edgar failed", companyName, err);
    return [];
  }
}
