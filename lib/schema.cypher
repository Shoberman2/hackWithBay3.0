// Rivalry graph schema — uniqueness constraints (PLAN.md Phase 2).
// One statement per line-block; scripts/apply-schema.ts runs one
// executeQuery per statement (Aura rejects multi-statement strings).
// Constraints double as MERGE fast-paths.

CREATE CONSTRAINT company_name IF NOT EXISTS FOR (c:Company) REQUIRE c.name IS UNIQUE;

CREATE CONSTRAINT founder_name IF NOT EXISTS FOR (f:Founder) REQUIRE f.name IS UNIQUE;

CREATE CONSTRAINT investor_name IF NOT EXISTS FOR (i:Investor) REQUIRE i.name IS UNIQUE;

CREATE CONSTRAINT feature_name IF NOT EXISTS FOR (f:Feature) REQUIRE f.name IS UNIQUE;

CREATE CONSTRAINT segment_name IF NOT EXISTS FOR (s:Segment) REQUIRE s.name IS UNIQUE;

CREATE CONSTRAINT source_url IF NOT EXISTS FOR (s:Source) REQUIRE s.url IS UNIQUE;

CREATE CONSTRAINT idea_session IF NOT EXISTS FOR (i:Idea) REQUIRE i.session_id IS UNIQUE;

CREATE CONSTRAINT launch_id IF NOT EXISTS FOR (l:LaunchEvent) REQUIRE l.event_id IS UNIQUE;

// round_id = "{company}|{round_type}|{announced_date}"
CREATE CONSTRAINT round_id IF NOT EXISTS FOR (r:FundingRound) REQUIRE r.round_id IS UNIQUE;

// snapshot_id = "{domain}|{timestamp}"
CREATE CONSTRAINT snapshot_id IF NOT EXISTS FOR (w:WebsiteSnapshot) REQUIRE w.snapshot_id IS UNIQUE;

CREATE CONSTRAINT post_url IF NOT EXISTS FOR (p:Post) REQUIRE p.url IS UNIQUE;

// claim_id = "{company}|{moat_type}"
CREATE CONSTRAINT moat_id IF NOT EXISTS FOR (m:MoatClaim) REQUIRE m.claim_id IS UNIQUE;

// signal_id = "{company}|{metric}|{observed_at}"
CREATE CONSTRAINT signal_id IF NOT EXISTS FOR (t:TractionSignal) REQUIRE t.signal_id IS UNIQUE;
