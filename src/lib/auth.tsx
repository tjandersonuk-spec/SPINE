import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'

import { supabase } from '@/lib/supabase'

type AuthState = {
  session: Session | null
  loading: boolean
  /** Supabase only issues a session once the address is confirmed. */
  confirmed: boolean
}

const AuthContext = createContext<AuthState>({ session: null, loading: true, confirmed: false })

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => setSession(next))
    return () => sub.subscription.unsubscribe()
  }, [])

  const confirmed = Boolean(session?.user?.email_confirmed_at ?? session?.user?.confirmed_at)

  return (
    <AuthContext.Provider value={{ session, loading, confirmed }}>{children}</AuthContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  return useContext(AuthContext)
}
