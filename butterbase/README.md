# Butterbase Setup

Use this folder after creating the Butterbase app in the dashboard.

1. Create an app named `rivalry`.
2. Save the returned app id and API URL in `.env.local`.
3. Run `npm run setup:butterbase` to dry-run and apply `schema.json`.
4. The setup command enables RLS, configures realtime, locks storage to private files, sets authenticated access mode, and deploys the free brief function.
5. To enable Google sign-in, add a free Google OAuth client id and secret to `.env.local`, then rerun `npm run setup:butterbase`.

Required local environment:

```bash
VITE_BUTTERBASE_APP_ID=app_...
VITE_BUTTERBASE_API_URL=https://api.butterbase.ai
VITE_BUTTERBASE_OAUTH_REDIRECT=http://localhost:5173
BUTTERBASE_API_KEY=your-service-key
GOOGLE_OAUTH_CLIENT_ID=optional-google-client-id
GOOGLE_OAUTH_CLIENT_SECRET=optional-google-client-secret
```

All core features are free. Do not add checkout, billing, or paid report gates.

Do not commit service keys or user JWTs.
