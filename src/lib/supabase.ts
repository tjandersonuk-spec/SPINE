import { createClient } from '@supabase/supabase-js'

const rawUrl = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

/**
 * The Supabase dashboard shows the project's address in more than one form.
 * Project Settings gives the bare one; the API documentation pages give the
 * REST endpoint, `https://<ref>.supabase.co/rest/v1/`, and that is the one
 * sitting on the screen when somebody is copying values across. Pasting it
 * produced a site that refused to start with an error about the URL not
 * looking like a URL, which is true and unhelpful.
 *
 * So the endpoint suffixes are trimmed rather than rejected. Anything else
 * still fails the check below: this fixes one specific, predictable mistake
 * and does not start guessing at what somebody might have meant.
 */
export function normaliseProjectUrl(v: string | undefined): string | undefined {
  if (!v) return v
  return v
    .trim()
    .replace(/\/(rest|auth|storage|realtime|functions)\/v\d+\/?$/, '')
    .replace(/\/+$/, '')
}

const url = normaliseProjectUrl(rawUrl)

/**
 * Why this does not throw.
 *
 * Throwing here happens while the module graph is still loading, before React
 * has mounted anything — so the browser shows a blank white page and the reason
 * is only visible in the console. Someone setting the project up for the first
 * time has no way to know that is where to look. Instead the problem is
 * reported as a value, and App renders a page that explains it.
 */
function describeConfigProblem(): string | null {
  const missing = [
    !url && 'VITE_SUPABASE_URL',
    !anonKey && 'VITE_SUPABASE_ANON_KEY',
  ].filter(Boolean) as string[]

  if (missing.length > 0) return `${missing.join(' and ')} ${missing.length > 1 ? 'are' : 'is'} not set.`

  if (!/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/.test(url!)) {
    return `VITE_SUPABASE_URL does not look like a Supabase project URL. It should be `
      + `https://<your-ref>.supabase.co, but it is "${rawUrl}".`
  }

  // A service_role key here would ship full database access to every visitor.
  try {
    const claims = JSON.parse(atob(anonKey.split('.')[1] ?? ''))
    if (claims.role === 'service_role') {
      return 'VITE_SUPABASE_ANON_KEY is the service_role key. That key bypasses every security policy and must never reach the browser. Use the key labelled anon / public instead.'
    }
  } catch {
    // Newer projects issue sb_publishable_… keys, which are not JWTs. Nothing
    // to check in that case, and an unparseable key is not itself an error.
  }

  return null
}

export const supabaseConfigProblem = describeConfigProblem()

// Placeholders keep the import graph loadable when configuration is missing;
// App shows the explanation instead of ever using this client.
export const supabase = createClient(
  url || 'https://placeholder.supabase.co',
  anonKey || 'placeholder',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // Needed for the email-link flows: invitation acceptance and password
      // reset both return to the site with the session in the URL.
      detectSessionInUrl: true,
    },
  }
)
