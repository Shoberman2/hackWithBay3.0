CREATE CONSTRAINT startup_radar_scan_id IF NOT EXISTS
FOR (n:Scan) REQUIRE n.id IS UNIQUE;

CREATE CONSTRAINT startup_radar_company_id IF NOT EXISTS
FOR (n:Company) REQUIRE n.id IS UNIQUE;

CREATE CONSTRAINT startup_radar_person_id IF NOT EXISTS
FOR (n:Person) REQUIRE n.id IS UNIQUE;

CREATE CONSTRAINT startup_radar_investor_id IF NOT EXISTS
FOR (n:Investor) REQUIRE n.id IS UNIQUE;

CREATE CONSTRAINT startup_radar_website_id IF NOT EXISTS
FOR (n:Website) REQUIRE n.id IS UNIQUE;

CREATE CONSTRAINT startup_radar_segment_id IF NOT EXISTS
FOR (n:Segment) REQUIRE n.id IS UNIQUE;

CREATE CONSTRAINT startup_radar_trend_id IF NOT EXISTS
FOR (n:Trend) REQUIRE n.id IS UNIQUE;

CREATE CONSTRAINT startup_radar_opportunity_id IF NOT EXISTS
FOR (n:Opportunity) REQUIRE n.id IS UNIQUE;

CREATE INDEX startup_radar_entity_name IF NOT EXISTS
FOR (n:Entity) ON (n.name);

CREATE INDEX startup_radar_scan_created_at IF NOT EXISTS
FOR (n:Scan) ON (n.createdAt);
