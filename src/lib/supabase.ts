import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  // Fail loudly at startup rather than at the first query. A Netlify deploy
  // whose environment variables were never set otherwise looks fine until
  // someone tries to sign in.
  throw new Error(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Copy .env.example to ' +
      '.env.local for local work, or set them in Netlify under Site configuration ' +
      '> Environment variables and redeploy.'
  )
}

export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    // Needed for the email-link flows: invitation acceptance and password reset
    // both return to the site with the session in the URL.
    detectSessionInUrl: true,
  },
})
