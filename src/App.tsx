import { Navigate, Route, Routes } from 'react-router'

import { AuthProvider, useAuth } from '@/lib/auth'
import { supabaseConfigProblem } from '@/lib/supabase'
import Account from '@/pages/account/Account'
import AcceptInvitation from '@/pages/AcceptInvitation'
import ConfirmEmail from '@/pages/ConfirmEmail'
import AccountsPage from '@/pages/Accounts'
import Home from '@/pages/Home'
import MarketingAbout from '@/pages/marketing/About'
import MarketingContact from '@/pages/marketing/Contact'
import MarketingHome from '@/pages/marketing/Home'
import MarketingLayout from '@/pages/marketing/Layout'
import MarketingPricing from '@/pages/marketing/Pricing'
import MarketingProduct from '@/pages/marketing/Product'
import Portfolio from '@/pages/Portfolio'
import PlatformAccounts from '@/pages/platform/Accounts'
import Profile from '@/pages/Profile'
import PlatformPeople from '@/pages/platform/People'
import AccessPage from '@/pages/project/AccessPage'
import BepPage from '@/pages/project/BepPage'
import BreeamPage from '@/pages/project/BreeamPage'
import ChangeRequestsPage from '@/pages/project/ChangeRequestsPage'
import BuildingSafetyPage from '@/pages/project/BuildingSafetyPage'
import FeesPage from '@/pages/project/FeesPage'
import MaterialsPage from '@/pages/project/MaterialsPage'
import RoomsPage from '@/pages/project/RoomsPage'
import PreconPage from '@/pages/project/PreconPage'
import AuditPage from '@/pages/project/AuditPage'
import GatewaysPage from '@/pages/project/GatewaysPage'
import ReportsPage from '@/pages/project/ReportsPage'
import SummaryPage from '@/pages/project/SummaryPage'
import RiskPage from '@/pages/project/RiskPage'
import WarrantiesPage from '@/pages/project/WarrantiesPage'
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
import WorkspaceLayout from '@/pages/WorkspaceLayout'
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
 * What `/` is.
 *
 * Signed out it is the public site's home page; signed in it is the
 * application's landing decision -- no projects lands on accounts, one goes
 * straight into it, several go to the portfolio. Both live at the same
 * address on purpose: the marketing site is what somebody is sent, and it has
 * to be the thing at the top of the domain, while a signed-in person must
 * never be shown a sales page for a product they have already bought.
 */
function Root() {
  const { session, loading, confirmed } = useAuth()
  if (loading) return null
  if (!session) {
    return (
      <MarketingLayout>
        <MarketingHome />
      </MarketingLayout>
    )
  }
  if (!confirmed) return <ConfirmEmail />
  return (
    <WorkspaceLayout>
      <Home />
    </WorkspaceLayout>
  )
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
        {/* Everything signed-in that is not inside a project shares the one
            shell with the workspace nav. There is no second landing page. */}
        {/* The public site. Signed out, `/` is the marketing home; signed in it
            is where you land in the application, unchanged. One address either
            way, because a marketing page that lives at /welcome is a page
            nobody links to and a customer never sees again. */}
        <Route path="/" element={<Root />} />
        <Route element={<MarketingLayout />}>
          {/* The public home page needs an address of its own as well as `/`.
              `/` answers differently depending on who is asking, so a signed-in
              person had no way to reach the public site at all -- you could not
              look at your own marketing without signing out, and the logo in
              the application had nowhere to send you. */}
          <Route path="/welcome" element={<MarketingHome />} />
          <Route path="/product" element={<MarketingProduct />} />
          <Route path="/pricing" element={<MarketingPricing />} />
          <Route path="/about" element={<MarketingAbout />} />
          <Route path="/contact" element={<MarketingContact />} />
        </Route>
        <Route element={<RequireAuth><WorkspaceLayout /></RequireAuth>}>
          <Route path="/accounts" element={<AccountsPage />} />
          <Route path="/portfolio" element={<Portfolio />} />
          <Route path="/me" element={<Profile />} />
          <Route path="/account/:id" element={<Account />} />
          <Route path="/request-account" element={<RequestAccount />} />
          <Route path="/platform/accounts" element={<PlatformAccounts />} />
          <Route path="/platform/people" element={<PlatformPeople />} />
        </Route>
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
          <Route path="fees" element={<FeesPage />} />
          <Route path="precon" element={<PreconPage />} />
          <Route path="risk" element={<RiskPage />} />
          <Route path="changes-requests" element={<ChangeRequestsPage />} />
          <Route path="warranties" element={<WarrantiesPage />} />
          <Route path="materials" element={<MaterialsPage />} />
          <Route path="rooms" element={<RoomsPage />} />
          <Route path="summary" element={<SummaryPage />} />
          <Route path="gateways" element={<GatewaysPage />} />
          <Route path="audit" element={<AuditPage />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="scope" element={<TrackedPage kind="scope" />} />
          <Route path="preassessment" element={<TrackedPage kind="checklist:precon" />} />
          <Route path="client" element={<TrackedPage kind="checklist:client" />} />
          <Route path="handover" element={<TrackedPage kind="checklist:handover" />} />
          <Route path="highways" element={<TrackedPage kind="checklist:highways" />} />
          <Route path="utilities" element={<TrackedPage kind="checklist:utilities" />} />
          <Route path="access" element={<AccessPage />} />
          <Route path="settings" element={<ProjectSettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  )
}
