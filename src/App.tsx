import { Navigate, Route, Routes } from 'react-router'

import { AuthProvider, useAuth } from '@/lib/auth'
import { supabaseConfigProblem } from '@/lib/supabase'
import Account from '@/pages/account/Account'
import AcceptInvitation from '@/pages/AcceptInvitation'
import Landing from '@/pages/Landing'
import PlatformAccounts from '@/pages/platform/Accounts'
import Profile from '@/pages/Profile'
import PlatformPeople from '@/pages/platform/People'
import ProjectPage from '@/pages/project/Project'
import RequestAccount from '@/pages/RequestAccount'
import SetupNeeded from '@/pages/SetupNeeded'
import SignIn from '@/pages/SignIn'
import SignUp from '@/pages/SignUp'

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth()
  if (loading) return null
  if (!session) return <Navigate to="/sign-in" replace />
  return <>{children}</>
}

/**
 * The platform-owner routes are guarded here only so the nav is coherent. The
 * real guard is is_platform_owner() in every policy and definer function: a
 * person who reaches these pages another way sees nothing and can do nothing.
 */
export default function App() {
  // Before anything else: an unconfigured copy explains itself rather than
  // failing somewhere the user cannot see.
  if (supabaseConfigProblem) return <SetupNeeded problem={supabaseConfigProblem} />

  return (
    <AuthProvider>
      <Routes>
        <Route path="/sign-in" element={<SignIn />} />
        <Route path="/sign-up" element={<SignUp />} />
        {/* Supabase returns here from the confirmation and recovery links. */}
        <Route path="/auth/callback" element={<Navigate to="/" replace />} />
        <Route path="/accept/:token" element={<AcceptInvitation />} />
        <Route path="/" element={<RequireAuth><Landing /></RequireAuth>} />
        <Route path="/request-account" element={<RequireAuth><RequestAccount /></RequireAuth>} />
        <Route path="/me" element={<RequireAuth><Profile /></RequireAuth>} />
        <Route path="/account/:id" element={<RequireAuth><Account /></RequireAuth>} />
        <Route path="/project/:id" element={<RequireAuth><ProjectPage /></RequireAuth>} />
        <Route path="/platform/accounts" element={<RequireAuth><PlatformAccounts /></RequireAuth>} />
        <Route path="/platform/people" element={<RequireAuth><PlatformPeople /></RequireAuth>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  )
}
