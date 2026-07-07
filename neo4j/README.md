# Neo4j Setup

Startup Radar uses Neo4j for the ecosystem graph:

- `Company`
- `Person`
- `Investor`
- `Website`
- `Segment`
- `Trend`
- `Opportunity`
- `Scan`

After creating a Neo4j AuraDB instance, add credentials to `.env.local`:

```bash
NEO4J_URI=neo4j+s://your-instance.databases.neo4j.io
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=
NEO4J_DATABASE=neo4j
VITE_NEO4J_GRAPH_ENDPOINT=neo4j-aura
```

Then seed the graph:

```bash
npm run neo4j:seed
```

The script applies `schema.cypher` first, then `seed.cypher`.
