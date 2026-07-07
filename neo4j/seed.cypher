MERGE (scan:Scan {id: "demo-ai-insurance-brokers"})
SET scan.prompt = "AI tools for independent insurance brokers",
    scan.mode = "idea",
    scan.depth = "deep",
    scan.createdAt = datetime();

MERGE (segment:Segment:Entity {id: "segment-independent-insurance-brokers"})
SET segment.name = "Independent Insurance Brokers",
    segment.summary = "Primary buyer group for the demo scan.";

MERGE (trend:Trend:Entity {id: "trend-ai-workflow-automation"})
SET trend.name = "AI workflow automation",
    trend.summary = "Rising category narrative around automating broker operations.";

MERGE (companyA:Company:Entity {id: "company-aitoolsos"})
SET companyA.name = "AIToolsOS",
    companyA.url = "https://aitoolsos.com",
    companyA.signal = "Product velocity";

MERGE (companyB:Company:Entity {id: "company-independentflow"})
SET companyB.name = "IndependentFlow",
    companyB.url = "https://independentflow.com",
    companyB.signal = "Hiring signal";

MERGE (companyC:Company:Entity {id: "company-aitoolsworks"})
SET companyC.name = "AIToolsWorks",
    companyC.url = "https://aitoolsworks.ai",
    companyC.signal = "New entrant";

MERGE (personA:Person:Entity {id: "person-leo-fischer"})
SET personA.name = "Leo Fischer",
    personA.signal = "Founder / operator";

MERGE (personB:Person:Entity {id: "person-priya-shah"})
SET personB.name = "Priya Shah",
    personB.signal = "Market voice";

MERGE (investor:Investor:Entity {id: "investor-northstar-ventures"})
SET investor.name = "Northstar Ventures",
    investor.signal = "Capital cluster";

MERGE (website:Website:Entity {id: "website-independent-insurance-jobs"})
SET website.name = "Independent Insurance Brokers jobs",
    website.url = "https://independent-insurance-brokers-jobs.com",
    website.signal = "Hiring taxonomy";

MERGE (opportunity:Opportunity:Entity {id: "opportunity-trust-layer"})
SET opportunity.name = "Trust layer",
    opportunity.summary = "Make each recommendation explainable through source-linked graph paths.";

MERGE (scan)-[:SCANNED_SEGMENT]->(segment)
MERGE (scan)-[:FOUND_TREND]->(trend)
MERGE (companyA)-[:SERVES]->(segment)
MERGE (companyB)-[:SERVES]->(segment)
MERGE (companyC)-[:VALIDATES]->(opportunity)
MERGE (companyA)-[:FOUNDED_BY]->(personA)
MERGE (companyB)-[:LED_BY]->(personB)
MERGE (companyB)-[:FUNDED_BY]->(investor)
MERGE (website)-[:HIRING_FOR]->(companyB)
MERGE (trend)-[:SUGGESTS]->(opportunity)
MERGE (opportunity)-[:UNLOCKS]->(segment);
