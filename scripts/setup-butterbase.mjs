import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@butterbase/sdk'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const FUNCTION_NAME = 'rivalry-free-brief'

const requiredEnv = ['VITE_BUTTERBASE_APP_ID', 'VITE_BUTTERBASE_API_URL', 'BUTTERBASE_API_KEY']
const missingEnv = requiredEnv.filter((key) => !process.env[key])

if (missingEnv.length > 0) {
  console.error(`Missing required Butterbase env values: ${missingEnv.join(', ')}`)
  process.exit(1)
}

const client = createClient({
  appId: process.env.VITE_BUTTERBASE_APP_ID,
  apiUrl: process.env.VITE_BUTTERBASE_API_URL,
  anonKey: process.env.BUTTERBASE_API_KEY,
  persistSession: false,
  detectSessionFromUrl: false,
})

const responseMessage = (error) => error?.remediation ?? error?.message ?? 'request failed'

const assertOk = (response, label) => {
  if (response.error) {
    throw new Error(`${label}: ${responseMessage(response.error)}`)
  }

  return response.data
}

const isAlreadyThere = (error) => /already|duplicate|exists/i.test(responseMessage(error))

const warnOrThrow = (response, label, allowExisting = false) => {
  if (!response.error) return response.data
  if (allowExisting && isAlreadyThere(response.error)) {
    console.log(`${label}: already configured`)
    return null
  }

  throw new Error(`${label}: ${responseMessage(response.error)}`)
}

const readJson = async (path) => JSON.parse(await readFile(resolve(root, path), 'utf8'))

const schemaDoc = await readJson('butterbase/schema.json')
const schema = schemaDoc.schema ?? schemaDoc
const rlsDoc = await readJson('butterbase/rls.json')
const policies = rlsDoc.policies ?? []

console.log('Butterbase setup: dry-running schema')
const dryRun = assertOk(await client.admin.schema.dryRun(schema), 'Schema dry run')
console.log(`Schema dry run ok with ${dryRun.statements?.length ?? 0} statements`)

console.log('Butterbase setup: applying schema')
const migration = assertOk(
  await client.admin.schema.apply(schema, { name: 'rivalry_free_mode_schema' }),
  'Schema apply',
)
console.log(`Schema applied: ${migration.applied ?? 0} statements`)

console.log('Butterbase setup: enabling RLS policies')
for (const policy of policies) {
  warnOrThrow(await client.admin.rls.enable(policy.table_name), `RLS enable ${policy.table_name}`, true)
  warnOrThrow(
    await client.admin.rls.createUserIsolation(policy.table_name, policy.user_column ?? 'user_id'),
    `RLS policy ${policy.table_name}`,
    true,
  )
}

console.log('Butterbase setup: configuring realtime tables')
const realtimeTables = policies.map((policy) => policy.table_name)
assertOk(await client.admin.realtime.configure(realtimeTables), 'Realtime configure')
console.log(`Realtime configured for ${realtimeTables.length} tables`)

console.log('Butterbase setup: hardening app settings')
warnOrThrow(
  await client.admin.config.updateCors({
    allowed_origins: ['http://localhost:5173', 'http://localhost:4173'],
  }),
  'CORS update',
)
warnOrThrow(
  await client.admin.config.updateStorage({
    publicReadEnabled: false,
    maxFileSizeMb: 5,
    allowedContentTypes: ['application/json', 'text/plain', 'text/markdown'],
  }),
  'Storage update',
)
warnOrThrow(await client.admin.config.updateAccessMode('authenticated'), 'Access mode update')

const googleClientId = process.env.GOOGLE_OAUTH_CLIENT_ID
const googleClientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET

if (googleClientId && googleClientSecret) {
  console.log('Butterbase setup: configuring Google OAuth provider')
  const redirectUris = (process.env.BUTTERBASE_OAUTH_REDIRECT_URIS ?? 'http://localhost:5173,http://localhost:5173/')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)

  const existing = await client.admin.oauth.get('google')
  const payload = {
    provider: 'google',
    client_id: googleClientId,
    client_secret: googleClientSecret,
    redirect_uris: redirectUris,
    scopes: ['openid', 'email', 'profile'],
  }

  if (existing.data) {
    warnOrThrow(await client.admin.oauth.update('google', payload), 'Google OAuth update')
  } else {
    warnOrThrow(await client.admin.oauth.create(payload), 'Google OAuth create')
  }
} else {
  console.log('Google OAuth provider skipped: set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET to configure it.')
}

const functionCode = `
export default async function handler(req) {
  const body = await req.json().catch(() => ({}));
  const prompt = String(body.prompt || 'this market').slice(0, 160);
  const opportunities = Array.isArray(body.opportunities) ? body.opportunities.slice(0, 3) : [];
  const focus = opportunities[0] || 'the strongest white-space node';

  return new Response(JSON.stringify({
    free_mode: true,
    scan_id: body.scan_id || null,
    next_questions: [
      'Which buyer segment around ' + prompt + ' should be validated first?',
      'What evidence would prove that ' + focus + ' is a real opening?',
      'Which graph path should the founder inspect before choosing positioning?'
    ],
    suggested_events: ['function.brief.generated', 'report.free_draft.ready']
  }), {
    headers: { 'content-type': 'application/json' }
  });
}
`

console.log('Butterbase setup: deploying free brief function')
const functionDeploy = await client.admin.functions.deploy({
  name: FUNCTION_NAME,
  code: functionCode,
  description: 'Generates free follow-up questions for a saved Rivalry scan.',
  timeoutMs: 10000,
  memoryLimitMb: 128,
  trigger: { type: 'http' },
  agent_tool: true,
  agent_tool_description: 'Generate follow-up questions for a Rivalry competitive landscape scan.',
  agent_tool_mode: 'read_only',
  agent_tool_exposed_to: 'developer_only',
})

if (functionDeploy.error) {
  console.log(`Free brief function skipped: ${responseMessage(functionDeploy.error)}`)
} else {
  console.log(`Function deployed: ${FUNCTION_NAME}`)
}

console.log('Butterbase setup complete')
