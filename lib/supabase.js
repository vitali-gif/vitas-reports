import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// authHeaders() — headers for calling our API routes with the logged-in user's JWT.
// Works for both admin and client views (both authenticate via Supabase).
export async function authHeaders(extra = {}) {
  let token = ''
  try {
    const { data } = await supabase.auth.getSession()
    token = data?.session?.access_token || ''
  } catch {}
  return { ...extra, ...(token ? { Authorization: 'Bearer ' + token } : {}) }
}
