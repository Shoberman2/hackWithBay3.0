MERGE (idea:Idea:Entity {id: "idea-internship-platform"})
SET idea.name = "Internship platform",
    idea.text = "internship platform",
    idea.sessionId = "demo-rivalry-internships",
    idea.refinedTags = ["marketplace", "early talent", "university partnered"],
    idea.createdAt = datetime();

MERGE (scan:Scan {id: "demo-rivalry-internships"})
SET scan.prompt = "internship platform",
    scan.mode = "idea",
    scan.depth = "deep",
    scan.createdAt = datetime();

MERGE (segmentA:Segment:Entity {id: "segment-university-partnered"})
SET segmentA.name = "University-partnered internships",
    segmentA.summary = "Career-center driven internship discovery and employer matching.";

MERGE (segmentB:Segment:Entity {id: "segment-smb-employers"})
SET segmentB.name = "SMB employers",
    segmentB.summary = "Small and mid-sized employers that need lightweight early talent pipelines.";

MERGE (companyA:Company:Entity {id: "company-handshake"})
SET companyA.name = "Handshake",
    companyA.url = "https://joinhandshake.com",
    companyA.stage = "scaled",
    companyA.signal = "Category anchor";

MERGE (companyB:Company:Entity {id: "company-ripplematch"})
SET companyB.name = "RippleMatch",
    companyB.url = "https://ripplematch.com",
    companyB.stage = "growth",
    companyB.signal = "Matching workflow";

MERGE (companyC:Company:Entity {id: "company-parker-dewey"})
SET companyC.name = "Parker Dewey",
    companyC.url = "https://parkerdewey.com",
    companyC.stage = "growth",
    companyC.signal = "Micro-internship wedge";

MERGE (companyD:Company:Entity {id: "company-symplicity"})
SET companyD.name = "Symplicity",
    companyD.url = "https://symplicity.com",
    companyD.stage = "incumbent",
    companyD.signal = "Career services platform";

MERGE (founderA:Founder:Person:Entity {id: "founder-career-services-operator"})
SET founderA.name = "Career services operator archetype",
    founderA.background_summary = "Operator profile with university partnership and employer relations experience.",
    founderA.signal = "Founder lineage";

MERGE (investorA:Investor:Entity {id: "investor-early-talent-angels"})
SET investorA.name = "Early Talent Angels",
    investorA.type = "angel",
    investorA.signal = "Capital cluster";

MERGE (featureA:Feature:Entity {id: "feature-campus-network"})
SET featureA.name = "Campus network",
    featureA.category = "distribution",
    featureA.description = "University relationships create defensible student and employer access.";

MERGE (featureB:Feature:Entity {id: "feature-skills-matching"})
SET featureB.name = "Skills matching",
    featureB.category = "workflow",
    featureB.description = "Matching candidates to roles using skills, availability, and employer criteria.";

MERGE (featureC:Feature:Entity {id: "feature-micro-internships"})
SET featureC.name = "Micro-internships",
    featureC.category = "wedge",
    featureC.description = "Short projects that let employers trial early talent before larger commitments.";

MERGE (launchA:LaunchEvent:Entity {id: "launch-campus-network-expansion"})
SET launchA.name = "Campus network expansion",
    launchA.title = "Campus network expansion",
    launchA.date = date("2026-07-07"),
    launchA.source = "demo";

MERGE (launchB:LaunchEvent:Entity {id: "launch-matching-workflow"})
SET launchB.name = "Matching workflow refresh",
    launchB.title = "Matching workflow refresh",
    launchB.date = date("2026-07-07"),
    launchB.source = "demo";

MERGE (sourceA:Source:Entity {id: "source-yc-directory"})
SET sourceA.name = "YC company directory",
    sourceA.url = "https://www.ycombinator.com/companies",
    sourceA.type = "company_directory",
    sourceA.fetchedAt = datetime();

MERGE (sourceB:Source:Entity {id: "source-product-hunt"})
SET sourceB.name = "Product Hunt launch archive",
    sourceB.url = "https://www.producthunt.com",
    sourceB.type = "launch_archive",
    sourceB.fetchedAt = datetime();

MERGE (opportunityA:Opportunity:Entity {id: "opportunity-smb-internship-os"})
SET opportunityA.name = "SMB internship OS",
    opportunityA.summary = "A simpler workflow for employers too small for enterprise recruiting platforms.";

MERGE (opportunityB:Opportunity:Entity {id: "opportunity-proof-layer"})
SET opportunityB.name = "Proof-backed candidate layer",
    opportunityB.summary = "Evidence trails for candidate work, employer fit, and recommendation provenance.";

MERGE (idea)-[:TARGETS]->(segmentA)
MERGE (idea)-[:TARGETS]->(segmentB)
MERGE (companyA)-[:COMPETES_IN {confidence: 0.92}]->(segmentA)
MERGE (companyB)-[:COMPETES_IN {confidence: 0.84}]->(segmentA)
MERGE (companyC)-[:COMPETES_IN {confidence: 0.78}]->(segmentB)
MERGE (companyD)-[:COMPETES_IN {confidence: 0.88}]->(segmentA)
MERGE (founderA)-[:WORKED_AT {role: "partnerships"}]->(companyD)
MERGE (founderA)-[:FOUNDED {role: "archetype"}]->(companyC)
MERGE (investorA)-[:INVESTED_IN {round: "seed", lead: false}]->(companyC)
MERGE (companyA)-[:HAS_FEATURE {first_seen: date("2026-07-07")}]->(featureA)
MERGE (companyB)-[:HAS_FEATURE {first_seen: date("2026-07-07")}]->(featureB)
MERGE (companyC)-[:HAS_FEATURE {first_seen: date("2026-07-07")}]->(featureC)
MERGE (companyA)-[:SHIPPED]->(launchA)
MERGE (companyB)-[:SHIPPED]->(launchB)
MERGE (launchB)-[:SHIPPED_AFTER {lag_days: 45}]->(launchA)
MERGE (launchA)-[:CITED_BY]->(sourceA)
MERGE (launchB)-[:CITED_BY]->(sourceB)
MERGE (companyC)-[:VALIDATES]->(opportunityA)
MERGE (featureB)-[:SUGGESTS]->(opportunityB)
MERGE (opportunityA)-[:RELEVANT_TO {relevance_score: 0.89}]->(idea)
MERGE (opportunityB)-[:RELEVANT_TO {relevance_score: 0.82}]->(idea);
