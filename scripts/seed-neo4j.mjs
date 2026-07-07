import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import neo4j from 'neo4j-driver'

const root = process.cwd()
const required = ['NEO4J_URI', 'NEO4J_USERNAME', 'NEO4J_PASSWORD']
const missing = required.filter((key) => !process.env[key])

if (missing.length > 0) {
  console.error(`Missing Neo4j env vars: ${missing.join(', ')}`)
  console.error('Create .env.local from .env.example or export them in your shell.')
  process.exit(1)
}

const database = process.env.NEO4J_DATABASE || 'neo4j'
const driver = neo4j.driver(
  process.env.NEO4J_URI,
  neo4j.auth.basic(process.env.NEO4J_USERNAME, process.env.NEO4J_PASSWORD),
)

const readStatements = async (filePath) => {
  const source = await fs.readFile(filePath, 'utf8')

  return source
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean)
}

const runFile = async (session, label, filePath) => {
  const statements = await readStatements(filePath)

  for (const statement of statements) {
    await session.run(statement)
  }

  console.log(`Applied ${statements.length} ${label} statements`)
}

try {
  const session = driver.session({ database })

  try {
    await runFile(session, 'schema', path.join(root, 'neo4j/schema.cypher'))
    await runFile(session, 'seed', path.join(root, 'neo4j/seed.cypher'))
  } finally {
    await session.close()
  }

  console.log('Neo4j startup graph is ready')
} finally {
  await driver.close()
}
