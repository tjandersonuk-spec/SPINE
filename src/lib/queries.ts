import { supabase } from '@/lib/supabase'

export type Account = {
  id: string
  name: string
  status: string
  role: string
}

export type ProjectRow = {
  id: string
  name: string
  code: string
  organisation_id: string
  account_name: string
}

export type AccountRequest = {
  id: string
  company_name: string
  status: string
  review_note: string | null
  created_at: string
}

/**
 * The My accounts tab. Returns only accounts this person is a member of, so it
 * can never name an account they are not in.
 */
export async function fetchMyAccounts(): Promise<Account[]> {
  const { data, error } = await supabase
    .from('organisation_members')
    .select('role, organisations(id, name, status)')
  if (error) throw error
  return (data ?? []).map((r) => {
    const o = r.organisations as unknown as { id: string; name: string; status: string }
    return { id: o.id, name: o.name, status: o.status, role: r.role as string }
  })
}

/**
 * The Projects tab. my_projects() spans accounts but only through the caller's
 * own memberships; the account label is resolved from the accounts they hold.
 */
export async function fetchMyProjects(): Promise<ProjectRow[]> {
  const [{ data: projects, error }, accounts] = await Promise.all([
    supabase.rpc('my_projects'),
    fetchMyAccounts(),
  ])
  if (error) throw error
  const names = new Map(accounts.map((a) => [a.id, a.name]))
  return (projects ?? []).map((p: ProjectRow) => ({
    ...p,
    account_name: names.get(p.organisation_id) ?? '',
  }))
}

export async function fetchMyAccountRequests(): Promise<AccountRequest[]> {
  const { data, error } = await supabase
    .from('account_requests')
    .select('id, company_name, status, review_note, created_at')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function requestAccount(input: {
  companyName: string
  companyNumber?: string
  contactPhone?: string
  intendedTier?: string
  note?: string
}) {
  const { error } = await supabase.rpc('request_account', {
    p_company_name: input.companyName,
    p_company_number: input.companyNumber || null,
    p_contact_phone: input.contactPhone || null,
    p_intended_tier: input.intendedTier || 'undecided',
    p_note: input.note || null,
  })
  if (error) throw error
}

export async function acceptInvitation(token: string) {
  const { error } = await supabase.rpc('accept_invitation', { p_token: token })
  if (error) throw error
}

// ---------------------------------------------------------------------------
// Platform owner
// ---------------------------------------------------------------------------

export type OwnerAccount = {
  id: string
  name: string
  slug: string
  status: string
  subscription_tier: string | null
  modules: Record<string, boolean>
  created_at: string
}

export type OwnerRequest = {
  id: string
  company_name: string
  company_number: string | null
  contact_phone: string | null
  intended_tier: string | null
  note: string | null
  status: string
  created_at: string
  profiles: { name: string; email: string } | null
}

export type OwnerPerson = {
  id: string
  name: string
  email: string
  created_at: string
  last_seen_at: string | null
  accounts: string[]
}

export async function isPlatformOwner(): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_platform_owner')
  if (error) return false
  return Boolean(data)
}

export async function fetchAllAccounts(): Promise<OwnerAccount[]> {
  const { data, error } = await supabase
    .from('organisations')
    .select('id, name, slug, status, subscription_tier, modules, created_at')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function fetchPendingRequests(): Promise<OwnerRequest[]> {
  const { data, error } = await supabase
    .from('account_requests')
    .select(
      'id, company_name, company_number, contact_phone, intended_tier, note, status, created_at, profiles!account_requests_requested_by_fkey(name, email)'
    )
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as unknown as OwnerRequest[]
}

/**
 * Every login on the platform, including those holding no membership at all —
 * they appear in no other list in the product, which is why this view exists.
 */
export async function fetchAllPeople(): Promise<OwnerPerson[]> {
  const [{ data: people, error }, { data: members, error: mErr }] = await Promise.all([
    supabase.from('profiles').select('id, name, email, created_at, last_seen_at').order('created_at'),
    supabase.from('organisation_members').select('profile_id, organisations(name)'),
  ])
  if (error) throw error
  if (mErr) throw mErr
  const byPerson = new Map<string, string[]>()
  for (const m of members ?? []) {
    const org = m.organisations as unknown as { name: string } | null
    if (!org) continue
    byPerson.set(m.profile_id, [...(byPerson.get(m.profile_id) ?? []), org.name])
  }
  return (people ?? []).map((p) => ({ ...p, accounts: byPerson.get(p.id) ?? [] }))
}

export async function approveRequest(
  id: string,
  name: string,
  slug: string,
  tier: string,
  modules: Record<string, boolean>
) {
  const { error } = await supabase.rpc('approve_account_request', {
    p_request: id, p_name: name, p_slug: slug, p_tier: tier, p_modules: modules,
  })
  if (error) throw error
}

export async function rejectRequest(id: string, reason: string) {
  const { error } = await supabase.rpc('reject_account_request', { p_request: id, p_reason: reason })
  if (error) throw error
}

export async function setAccountStatus(id: string, status: string, reason?: string) {
  const { error } = await supabase.rpc('set_account_status', {
    p_org: id, p_status: status, p_reason: reason ?? null,
  })
  if (error) throw error
}

export async function deleteAccount(id: string, confirmName: string) {
  const { error } = await supabase.rpc('delete_account', { p_org: id, p_confirm_name: confirmName })
  if (error) throw error
}

// ---------------------------------------------------------------------------
// Account administration
// ---------------------------------------------------------------------------

export type Member = {
  profile_id: string
  role: string
  joined_at: string
  profiles: { name: string; email: string } | null
}

export type Invitation = {
  id: string
  scope: string
  email: string
  role: string | null
  project_role: string | null
  project_id: string | null
  expires_at: string
  accepted_at: string | null
  revoked_at: string | null
}

export async function fetchMembers(organisationId: string): Promise<Member[]> {
  const { data, error } = await supabase
    .from('organisation_members')
    .select('profile_id, role, joined_at, profiles(name, email)')
    .eq('organisation_id', organisationId)
  if (error) throw error
  return (data ?? []) as unknown as Member[]
}

export async function fetchInvitations(organisationId: string): Promise<Invitation[]> {
  const { data, error } = await supabase
    .from('invitations')
    .select('id, scope, email, role, project_role, project_id, expires_at, accepted_at, revoked_at')
    .eq('organisation_id', organisationId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function inviteToAccount(organisationId: string, email: string, role: string) {
  const { error } = await supabase.rpc('invite_to_account', {
    p_org: organisationId, p_email: email, p_role: role,
  })
  if (error) throw error
}

export async function revokeInvitation(id: string) {
  const { data: me } = await supabase.auth.getUser()
  const { error } = await supabase
    .from('invitations')
    .update({ revoked_at: new Date().toISOString(), revoked_by: me.user?.id })
    .eq('id', id)
  if (error) throw error
}

export async function removeMember(organisationId: string, profileId: string) {
  const { error } = await supabase
    .from('organisation_members')
    .delete()
    .eq('organisation_id', organisationId)
    .eq('profile_id', profileId)
  if (error) throw error
}

export async function createProject(organisationId: string, name: string, code: string) {
  const { error } = await supabase.rpc('create_project', {
    p_org: organisationId, p_name: name, p_code: code,
  })
  if (error) throw error
}

export async function fetchAccountProjects(organisationId: string) {
  const { data, error } = await supabase
    .from('projects')
    .select('id, name, code')
    .eq('organisation_id', organisationId)
    .order('name')
  if (error) throw error
  return data ?? []
}

// ---------------------------------------------------------------------------
// Project administration
// ---------------------------------------------------------------------------

export type ProjectMember = {
  profile_id: string
  project_role: string
  profiles: { name: string; email: string } | null
}

export async function fetchProjectMembers(projectId: string): Promise<ProjectMember[]> {
  const { data, error } = await supabase
    .from('project_members')
    .select('profile_id, project_role, profiles(name, email)')
    .eq('project_id', projectId)
  if (error) throw error
  return (data ?? []) as unknown as ProjectMember[]
}

export async function inviteToProject(projectId: string, email: string, projectRole: string) {
  const { error } = await supabase.rpc('invite_to_project', {
    p_project: projectId, p_email: email, p_project_role: projectRole,
  })
  if (error) throw error
}

export async function removeFromProject(projectId: string, profileId: string) {
  const { error } = await supabase.rpc('remove_from_project', {
    p_project: projectId, p_profile: profileId,
  })
  if (error) throw error
}

// ---------------------------------------------------------------------------
// Invitations waiting for the signed-in person
// ---------------------------------------------------------------------------

export type PendingInvitation = {
  id: string
  scope: 'organisation' | 'project'
  token: string
  role: string | null
  project_role: string | null
  account_name: string
  project_name: string | null
  invited_by_name: string | null
  expires_at: string
}

/**
 * Invitations addressed to this person's own address. The account name comes
 * back even though they are not a member yet — an invitation is that account
 * naming them, and consent means nothing without knowing who is asking.
 */
export async function fetchMyInvitations(): Promise<PendingInvitation[]> {
  const { data, error } = await supabase.rpc('my_pending_invitations')
  if (error) throw error
  return data ?? []
}

export async function declineInvitation(token: string) {
  const { error } = await supabase.rpc('decline_invitation', { p_token: token })
  if (error) throw error
}
