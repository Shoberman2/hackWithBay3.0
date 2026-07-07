# Butterbase Setup

Use this folder after creating the Butterbase app in the dashboard.

1. Create an app named `rivalry`.
2. Save the returned app id and API URL in `.env.local`.
3. Apply `schema.json` with a dry run first, then apply the schema.
4. Enable row-level security policies from `rls.json`.

Required local environment:

```bash
VITE_BUTTERBASE_APP_ID=app_...
VITE_BUTTERBASE_API_URL=https://api.butterbase.ai
BUTTERBASE_API_KEY=your-service-key
```

Do not commit service keys or user JWTs.
