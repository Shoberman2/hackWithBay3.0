import { createClient } from '@butterbase/sdk'

export const butterbaseConfig = {
  appId: import.meta.env.VITE_BUTTERBASE_APP_ID as string | undefined,
  apiUrl: import.meta.env.VITE_BUTTERBASE_API_URL as string | undefined,
}

export const isButterbaseConfigured = Boolean(
  butterbaseConfig.appId && butterbaseConfig.apiUrl,
)

export const butterbase = butterbaseConfig.appId && butterbaseConfig.apiUrl
  ? createClient({
      appId: butterbaseConfig.appId,
      apiUrl: butterbaseConfig.apiUrl,
    })
  : null
