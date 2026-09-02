import { Navigate, Route, Routes, useParams } from 'react-router'

import { AuthProvider, useAuth } from '@/lib/auth'
import AcceptInvitation from '@/pages/AcceptInvitation'
import Landing from '@/pages/Landing'
import RequestAccount from '@/pages/RequestAccount'
import SignIn from '@/pages/SignIn'
import SignUp from '@/pages/SignUp'

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth()
  if (loading) return null
  if (!session) return <Navigate to="/sign-in" replace />
  return <>{children}</>
}

/** Placeholder until phase 2 builds the project shell. */
function Project() {
  const { id } = useParams()
  return (
    <main className="p-6">
      <p className="text-muted-foreground text-sm">Project {id} — built in phase 2.</p>
    </main>
  )
}

export default function App() {
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
        <Route path="/project/:id" element={<RequireAuth><Project /></RequireAuth>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  )
}
