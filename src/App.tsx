import { Navigate, Route, Routes } from 'react-router'

import { AuthProvider, useAuth } from '@/lib/auth'
import { supabaseConfigProblem } from '@/lib/supabase'
import Account from '@/pages/account/Account'
import AcceptInvitation from '@/pages/AcceptInvitation'
import ConfirmEmail from '@/pages/ConfirmEmail'
import Landing from '@/pages/Landing'
import PlatformAccounts from '@/pages/platform/Accounts'
import Profile from '@/pages/Profile'
import PlatformPeople from '@/pages/platform/People'
import AccessPage from '@/pages/project/AccessPage'
import BepPage from '@/pages/project/BepPage'
import BreeamPage from '@/pages/project/BreeamPage'
import BuildingSafetyPage from '@/pages/project/BuildingSafetyPage'
import ChangeLogPage from '@/pages/project/ChangeLogPage'
import ExportsPage from '@/pages/project/ExportsPage'
import HomePage from '@/pages/project/HomePage'
import DirectoryPage from '@/pages/project/DirectoryPage'
import MatrixPage from '@/pages/project/MatrixPage'
import IssuesPage from '@/pages/project/IssuesPage'
import MeetingsPage from '@/pages/project/MeetingsPage'
import ProgrammePage from '@/pages/project/ProgrammePage'
import RegisterPage from '@/pages/project/RegisterPage'
import ProjectLayout from '@/pages/project/ProjectLayout'
import ProjectSettingsPage from '@/pages/project/SettingsPage'
import TrackedPage from '@/pages/project/TrackedPage'
import TransmittalsPage from '@/pages/project/TransmittalsPage'
import RequestAccount from '@/pages/RequestAccount'
import SetupNeeded from '@/pages/SetupNeeded'
import SignIn from '@/pages/SignIn'
import SignUp from '@/pages/SignUp'

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { session, loading, confirmed } = useAuth()
  if (loading) return null
  if (!session) return <Navigate to="/sign-in" replace />
  // An unconfirmed address reaches the confirmation screen and nothing else.
  // Enforced here rather than left to the project's Auth settings: a dashboard
  // toggle is not visible from the code, and this gate covers every route.
  if (!confirmed) return <ConfirmEmail />
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
        {/* Everything inside a project renders in the shell; the sidebar is
            the navigator, so each entry is a route rather than a tab. */}
        <Route path="/project/:id" element={<RequireAuth><ProjectLayout /></RequireAuth>}>
          <Route index element={<Navigate to="home" replace />} />
          <Route path="home" element={<HomePage />} />
          <Route path="directory" element={<DirectoryPage />} />
          <Route path="matrix" element={<MatrixPage />} />
          <Route path="programme" element={<ProgrammePage />} />
          <Route path="bep" element={<BepPage />} />
          <Route path="changes" element={<ChangeLogPage />} />
          <Route path="exports" element={<ExportsPage />} />
          <Route path="issues" element={<IssuesPage />} />
          <Route path="meetings" element={<MeetingsPage />} />
          <Route path="register" element={<RegisterPage />} />
          <Route path="transmittals" element={<TransmittalsPage />} />
          <Route path="planning" element={<TrackedPage kind="planning" />} />
          <Route path="bc" element={<TrackedPage kind="bc" />} />
          <Route path="bsa" element={<BuildingSafetyPage />} />
          <Route path="breeam" element={<BreeamPage />} />
          <Route path="scope" element={<TrackedPage kind="scope" />} />
          <Route path="preassessment" element={<TrackedPage kind="checklist:precon" />} />
          <Route path="client" element={<TrackedPage kind="checklist:client" />} />
          <Route path="handover" element={<TrackedPage kind="checklist:handover" />} />
          <Route path="highways" element={<TrackedPage kind="checklist:highways" />} />
          <Route path="utilities" element={<TrackedPage kind="checklist:utilities" />} />
          <Route path="access" element={<AccessPage />} />
          <Route path="settings" element={<ProjectSettingsPage />} />
        </Route>
        <Route path="/platform/accounts" element={<RequireAuth><PlatformAccounts /></RequireAuth>} />
        <Route path="/platform/people" element={<RequireAuth><PlatformPeople /></RequireAuth>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  )
}
