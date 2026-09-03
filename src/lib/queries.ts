import { supabase } from '@/lib/supabase'

export type Account = {
  id: string
  name: string
  status: string
  role: string
  brand_colour: string
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
 * The My accounts tab: one row per account this person belongs to.
 *
 * Reading organisation_members directly would be wrong, and was. A member may
 * see everyone else in their account, so that query returns a row per member —
 * a five-person account came back five times. my_accounts() is one row per
 * account by construction, so no caller can get it wrong again.
 */
export async function fetchMyAccounts(): Promise<Account[]> {
  const { data, error } = await supabase.rpc('my_accounts')
  if (error) throw error
  return data ?? []
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
  // project_members holds two foreign keys to profiles — profile_id and
  // added_by — so the embed must say which one it means.
  const { data, error } = await supabase
    .from('project_members')
    .select('profile_id, project_role, profiles!project_members_profile_id_fkey(name, email)')
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

// ---------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------

export type MyProfile = { id: string; name: string; email: string; phone: string | null }

export async function fetchMyProfile(): Promise<MyProfile> {
  const { data: auth } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('profiles')
    .select('id, name, email, phone')
    .eq('id', auth.user?.id ?? '')
    .single()
  if (error) throw error
  return data
}

export async function updateMyProfile(input: { name: string; phone: string }) {
  const { data: auth } = await supabase.auth.getUser()
  const { error } = await supabase
    .from('profiles')
    .update({ name: input.name.trim(), phone: input.phone.trim() || null })
    .eq('id', auth.user?.id ?? '')
  if (error) throw error
}

/**
 * Changing an address goes through Auth, never through profiles. The column is
 * not writable by its owner on purpose: accept_invitation() matches on it, so a
 * self-service edit would let anyone redeem an invitation addressed to someone
 * else. Auth emails the new address, and only once that link is followed does
 * the trigger copy it onto the profile.
 */
export async function changeMyEmail(newEmail: string) {
  const { error } = await supabase.auth.updateUser(
    { email: newEmail.trim() },
    { emailRedirectTo: `${window.location.origin}/auth/callback` }
  )
  if (error) throw error
}

export async function updateAccount(id: string, input: { name: string; brandColour: string }) {
  const { error } = await supabase
    .from('organisations')
    .update({ name: input.name.trim(), brand_colour: input.brandColour })
    .eq('id', id)
  if (error) throw error
}

export async function updateProject(id: string, input: { name: string; code: string }) {
  const { error } = await supabase
    .from('projects')
    .update({ name: input.name.trim(), code: input.code.trim() })
    .eq('id', id)
  if (error) throw error
}

// ---------------------------------------------------------------------------
// Membership requests — asking for someone to be added, from below
// ---------------------------------------------------------------------------

export type MembershipRequest = {
  id: string
  organisation_id: string
  account_name: string
  project_name: string | null
  email: string
  person_name: string | null
  proposed_role: string
  proposed_project_role: string | null
  note: string | null
  requested_by_name: string | null
  created_at: string
}

export async function fetchMyMembershipRequests(): Promise<MembershipRequest[]> {
  const { data, error } = await supabase.rpc('my_membership_requests')
  if (error) throw error
  return data ?? []
}

export async function requestMembership(input: {
  projectId: string
  email: string
  role: string
  projectRole: string
  personName?: string
  note?: string
}) {
  const { error } = await supabase.rpc('request_membership', {
    p_project: input.projectId,
    p_email: input.email,
    p_role: input.role,
    p_project_role: input.projectRole,
    p_person_name: input.personName || null,
    p_note: input.note || null,
  })
  if (error) throw error
}

export async function approveMembershipRequest(id: string, role: string, projectRole: string) {
  const { error } = await supabase.rpc('approve_membership_request', {
    p_request: id, p_role: role, p_project_role: projectRole,
  })
  if (error) throw error
}

export async function declineMembershipRequest(id: string, reason: string) {
  const { error } = await supabase.rpc('decline_membership_request', {
    p_request: id, p_reason: reason,
  })
  if (error) throw error
}

export const ACCOUNT_ROLES = [
  { value: 'consultant', label: 'Consultant' },
  { value: 'client', label: 'Client' },
  { value: 'internal', label: 'Internal' },
  { value: 'admin', label: 'Admin' },
] as const

// ---------------------------------------------------------------------------
// Phase 2 — the catalogue, the directory, and the first spine
// ---------------------------------------------------------------------------

export type CatalogueCompany = {
  id: string
  name: string
  address: string | null
  company_type: string | null
  notes: string | null
}

export type Contact = {
  id: string
  catalogue_company_id: string
  name: string
  job_role: string | null
  email: string | null
  phone: string | null
}

export type Discipline = {
  code: string
  name: string
  iso_letter: string | null
  sort_order: number
  forked: boolean
}

export type ProjectCompany = {
  id: string
  name: string
  address: string | null
  originator_code: string
  company_type: string
  catalogue_company_id: string | null
}

export type ProjectPerson = {
  id: string
  company_id: string
  name: string
  job_role: string | null
  email: string | null
  phone: string | null
  is_primary: boolean
  profile_id: string | null
}

export type AppointmentSlot = {
  slot: string
  state: string
  filename: string | null
  uploaded_at: string | null
}

export const SLOT_LABELS: Record<string, string> = {
  competency_statement: 'Competency statement',
  team_cvs: 'Team CVs',
  appointment: 'Appointment',
  scope_of_work: 'Scope of work',
}

export async function fetchCatalogue(organisationId: string): Promise<CatalogueCompany[]> {
  const { data, error } = await supabase
    .from('catalogue_companies')
    .select('id, name, address, company_type, notes')
    .eq('organisation_id', organisationId)
    .order('name')
  if (error) throw error
  return data ?? []
}

export async function addCatalogueCompany(
  organisationId: string,
  input: { name: string; address: string; companyType: string }
) {
  if (!input.name.trim()) throw new Error('A name is required.')
  const { error } = await supabase.from('catalogue_companies').insert({
    organisation_id: organisationId,
    name: input.name.trim(),
    address: input.address.trim() || null,
    company_type: input.companyType,
  })
  if (error) throw error
}

export async function fetchContacts(catalogueCompanyId: string): Promise<Contact[]> {
  const { data, error } = await supabase
    .from('contacts')
    .select('id, catalogue_company_id, name, job_role, email, phone')
    .eq('catalogue_company_id', catalogueCompanyId)
    .order('name')
  if (error) throw error
  return data ?? []
}

export async function addContact(
  catalogueCompanyId: string,
  input: { name: string; jobRole: string; email: string; phone: string }
) {
  if (!input.name.trim()) throw new Error('A name is required.')
  const { error } = await supabase.from('contacts').insert({
    catalogue_company_id: catalogueCompanyId,
    name: input.name.trim(),
    job_role: input.jobRole.trim() || null,
    email: input.email.trim() || null,
    phone: input.phone.trim() || null,
  })
  if (error) throw error
}

export async function fetchAccountDisciplines(organisationId: string): Promise<Discipline[]> {
  const { data, error } = await supabase.rpc('account_disciplines', { p_org: organisationId })
  if (error) throw error
  return data ?? []
}

export async function forkDisciplines(organisationId: string): Promise<number> {
  const { data, error } = await supabase.rpc('fork_disciplines', { p_org: organisationId })
  if (error) throw error
  return data ?? 0
}

export async function fetchProjectDisciplines(projectId: string) {
  const { data, error } = await supabase.rpc('project_disciplines_in_use', { p_project: projectId })
  if (error) throw error
  return (data ?? []) as {
    code: string; name: string; iso_letter: string | null; sort_order: number; required: boolean
  }[]
}

/** The gaps. Hi-vis, and the only thing that colour ever means. */
export async function fetchDisciplineGaps(projectId: string) {
  const { data, error } = await supabase.rpc('project_discipline_gaps', { p_project: projectId })
  if (error) throw error
  return (data ?? []) as { code: string; name: string }[]
}

export async function fetchProjectCompanies(projectId: string): Promise<ProjectCompany[]> {
  const { data, error } = await supabase
    .from('companies')
    .select('id, name, address, originator_code, company_type, catalogue_company_id')
    .eq('project_id', projectId)
    .order('name')
  if (error) throw error
  return data ?? []
}

export async function fetchCompanyDisciplines(projectId: string) {
  const { data, error } = await supabase
    .from('company_disciplines')
    .select('company_id, discipline_code, companies!inner(project_id)')
    .eq('companies.project_id', projectId)
  if (error) throw error
  return (data ?? []) as { company_id: string; discipline_code: string }[]
}

export async function fetchProjectPeople(projectId: string): Promise<ProjectPerson[]> {
  const { data, error } = await supabase
    .from('project_people')
    .select('id, company_id, name, job_role, email, phone, is_primary, profile_id')
    .eq('project_id', projectId)
    .order('name')
  if (error) throw error
  return data ?? []
}

export async function addCompanyToProject(input: {
  projectId: string
  catalogueCompanyId: string
  originatorCode: string
  companyType: string
  disciplines: string[]
}) {
  const { error } = await supabase.rpc('add_company_to_project', {
    p_project: input.projectId,
    p_catalogue_company: input.catalogueCompanyId,
    p_originator_code: input.originatorCode,
    p_company_type: input.companyType,
    p_disciplines: input.disciplines,
  })
  if (error) throw error
}

export async function addPersonToProject(companyId: string, contactId: string, isPrimary: boolean) {
  const { error } = await supabase.rpc('add_person_to_project', {
    p_company: companyId, p_contact: contactId, p_is_primary: isPrimary,
  })
  if (error) throw error
}

export async function setCompanyDiscipline(companyId: string, code: string, held: boolean) {
  const { error } = held
    ? await supabase.from('company_disciplines').insert({ company_id: companyId, discipline_code: code })
    : await supabase.from('company_disciplines').delete()
        .eq('company_id', companyId).eq('discipline_code', code)
  if (error) throw error
}

export async function fetchAppointmentStatus(companyId: string): Promise<AppointmentSlot[]> {
  const { data, error } = await supabase.rpc('company_appointment_status', { p_company: companyId })
  if (error) throw error
  return data ?? []
}

/** Fill an empty project with the prototype's demo directory. Admin only. */
export async function seedSampleProject(projectId: string): Promise<string> {
  const { data, error } = await supabase.rpc('seed_sample_data', { p_project: projectId })
  if (error) throw error
  return data as string
}

// ---------------------------------------------------------------------------
// Phase 3 — the design responsibility matrix
// ---------------------------------------------------------------------------

export type DrmLead = {
  drm_item_id: string
  ref: string
  item: string
  lead_discipline: string | null
  company_id: string | null
  company_name: string | null
}

export type DrmGap = {
  drm_item_id: string
  ref: string
  category_code: string
  item: string
  lead_discipline: string | null
  gap_reason: string
}

export type DrmItem = {
  id: string
  ref: string
  category_code: string
  item: string
  lead_discipline: string | null
  cdp_package: string | null
  transfers_at_stage: string | null
  level_of_information: string | null
  applicable: boolean
  guidance_note: string | null
  notes: string | null
}

/** The disciplines beside the lead. One row per discipline per item, so a
 *  discipline holds exactly one role on an item — it cannot both review and
 *  approve, which is the distinction the codes exist to make. */
export type DrmRole = {
  drm_item_id: string
  discipline_code: string
  role_code: 'S' | 'R' | 'C' | 'A' | 'I'
}

export const DRM_ROLE_NAMES: Record<DrmRole['role_code'], string> = {
  S: 'Supporting',
  R: 'Reviewing',
  C: 'Contributing',
  A: 'Approving',
  I: 'Informed',
}

export async function fetchDrmItems(projectId: string): Promise<DrmItem[]> {
  const { data, error } = await supabase
    .from('drm_items')
    .select('id, ref, category_code, item, lead_discipline, cdp_package, transfers_at_stage, level_of_information, applicable, guidance_note, notes')
    .eq('project_id', projectId)
    .order('ref')
  if (error) throw error
  return data ?? []
}

export async function fetchDrmRoles(projectId: string): Promise<DrmRole[]> {
  const { data, error } = await supabase
    .from('drm_roles')
    .select('drm_item_id, discipline_code, role_code, drm_items!inner(project_id)')
    .eq('drm_items.project_id', projectId)
  if (error) throw error
  return (data ?? []).map((r) => {
    const row = r as unknown as DrmRole
    return {
      drm_item_id: row.drm_item_id,
      discipline_code: row.discipline_code,
      role_code: row.role_code,
    }
  })
}

/** The roles on one item. */
export async function fetchDrmRolesForItem(itemId: string): Promise<DrmRole[]> {
  const { data, error } = await supabase
    .from('drm_roles')
    .select('drm_item_id, discipline_code, role_code')
    .eq('drm_item_id', itemId)
  if (error) throw error
  return (data ?? []) as unknown as DrmRole[]
}

export async function setDrmRole(
  itemId: string, discipline: string, role: DrmRole['role_code'] | null,
) {
  // A discipline holds one role on an item or none, so setting a role replaces
  // whatever it had rather than adding a second.
  const { error } = role === null
    ? await supabase.from('drm_roles').delete()
        .eq('drm_item_id', itemId).eq('discipline_code', discipline)
    : await supabase.from('drm_roles')
        .upsert({ drm_item_id: itemId, discipline_code: discipline, role_code: role },
                { onConflict: 'drm_item_id,discipline_code' })
  if (error) throw error
}

export async function setDrmFields(itemId: string, patch: {
  transfers_at_stage?: string | null
  cdp_package?: string | null
  level_of_information?: string | null
  notes?: string | null
}) {
  const { error } = await supabase.from('drm_items').update(patch).eq('id', itemId)
  if (error) throw error
}

/** Who leads each item, resolved live through the directory. Never cached. */
export async function fetchDrmLeads(projectId: string): Promise<DrmLead[]> {
  const { data, error } = await supabase.rpc('drm_leads', { p_project: projectId })
  if (error) throw error
  return data ?? []
}

export async function fetchDrmGaps(projectId: string): Promise<DrmGap[]> {
  const { data, error } = await supabase.rpc('drm_gaps', { p_project: projectId })
  if (error) throw error
  return data ?? []
}

export async function loadDrmIntoProject(projectId: string): Promise<string> {
  const { data, error } = await supabase.rpc('load_drm_into_project', { p_project: projectId })
  if (error) throw error
  return data as string
}

export async function setDrmLead(itemId: string, discipline: string | null) {
  const { error } = await supabase.rpc('set_drm_lead', {
    p_item: itemId, p_discipline: discipline,
  })
  if (error) throw error
}

export async function setDrmApplicable(itemId: string, applicable: boolean) {
  const { error } = await supabase.from('drm_items').update({ applicable }).eq('id', itemId)
  if (error) throw error
}

export const DRM_CATEGORY_NAMES: Record<string, string> = {
  '01': 'Site, survey and enabling',
  '02': 'Substructure',
  '03': 'Superstructure',
  '04': 'Building envelope',
  '05': 'Internal fabric and fit-out',
  '06': 'Mechanical, electrical and public health',
  '07': 'External works and infrastructure',
  '08': 'Compliance, performance and statutory',
  '09': 'Interfaces and coordination',
}

/* ---------------------------------------------------------------- programme */

export type ProgrammeTask = {
  id: string
  task_uid: string
  description: string
  start_date: string
  finish_date: string
  percent_complete: number
  level: number
  parent_uid: string | null
  task_type: 'Task' | 'Summary' | 'Milestone'
  removed: boolean
}

export type ProgrammeRollup = {
  root_uid: string
  rolled_start: string
  rolled_finish: string
  rolled_percent: number | null
  leaf_count: number
}

export type ProgrammeImport = {
  id: string
  label: string
  imported_at: string
  row_count: number
  summary: ImportReport | Record<string, never>
  imported_by_name: string | null
}

/** What import_programme() hands back. A rejected file carries errors and
 *  nothing else; an applied one carries the diff. */
export type ImportReport = {
  ok: boolean
  row_count?: number
  errors?: { row: number; field: string; message: string }[]
  import_id?: string
  added?: number
  updated?: number
  removed?: number
  restored?: number
  moved?: {
    task_uid: string
    description: string
    was_start: string
    now_start: string
    was_finish: string
    now_finish: string
    finish_slip_days: number
  }[]
}

export async function fetchProgramme(projectId: string) {
  const { data, error } = await supabase
    .from('programme_tasks')
    .select('id, task_uid, description, start_date, finish_date, percent_complete, level, parent_uid, task_type, removed')
    .eq('project_id', projectId)
    .order('task_uid')
  if (error) throw error
  return (data ?? []) as unknown as ProgrammeTask[]
}

export async function fetchProgrammeRollups(projectId: string) {
  const { data, error } = await supabase
    .from('v_programme_rollup')
    .select('root_uid, rolled_start, rolled_finish, rolled_percent, leaf_count')
    .eq('project_id', projectId)
  if (error) throw error
  return (data ?? []) as unknown as ProgrammeRollup[]
}

export async function fetchProgrammeImports(projectId: string) {
  // programme_imports has one foreign key to profiles, but naming it costs
  // nothing and survives the day an audit column adds a second.
  const { data, error } = await supabase
    .from('programme_imports')
    .select('id, label, imported_at, row_count, summary, profiles!programme_imports_imported_by_fkey(name)')
    .eq('project_id', projectId)
    .order('imported_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map((r) => {
    const row = r as unknown as Omit<ProgrammeImport, 'imported_by_name'> &
      { profiles: { name: string } | null }
    const { profiles, ...rest } = row
    return { ...rest, imported_by_name: profiles?.name ?? null }
  })
}

export async function fetchMyWatchedLines(projectId: string) {
  const { data, error } = await supabase
    .from('programme_watch')
    .select('task_uid')
    .eq('project_id', projectId)
  if (error) throw error
  return new Set((data ?? []).map((r) => r.task_uid as string))
}

export async function watchLine(projectId: string, taskUid: string, on: boolean) {
  const { error } = await supabase.rpc(
    on ? 'watch_programme_line' : 'unwatch_programme_line',
    { p_project: projectId, p_task_uid: taskUid })
  if (error) throw error
}

export async function importProgramme(
  projectId: string, label: string, rows: Record<string, unknown>[],
): Promise<ImportReport> {
  const { data, error } = await supabase.rpc('import_programme', {
    p_project: projectId, p_label: label, p_rows: rows,
  })
  if (error) throw error
  return data as ImportReport
}

/** Everything dated from one line. Empty until a module gains anchor columns —
 *  see programme_dependents() in the Phase 4 migration. */
export async function fetchLineDependents(projectId: string, taskUid: string) {
  const { data, error } = await supabase.rpc('programme_dependents', {
    p_project: projectId, p_task_uid: taskUid,
  })
  if (error) throw error
  return (data ?? []) as {
    module: string; record_id: string; ref: string; description: string; due: string
  }[]
}

/* ------------------------------------------------------- drawing register */

export type Drawing = {
  id: string
  document_number: string
  title: string | null
  revision: string | null
  workflow_status: string | null
  cde_url: string | null
  programme_task_uid: string | null
  offset_days: number
  anchor: 'start' | 'finish'
  due_date_override: string | null
  construction_status: string | null
  naming_error: string | null
  due: string | null
  anchor_state: 'ok' | 'missing' | 'removed' | 'unanchored'
  awaited: boolean
  overdue: boolean
  company_id: string | null
  company_name: string | null
  has_dwg: boolean
  sort_number: string
}

export type Pack = {
  id: string
  reference: string
  name: string
  purpose: string | null
  drawing_count: number
  awaited_count: number
  revised_since_issue: number
  never_issued: number
}

export type ReconcileRow = {
  document_number: string
  title: string | null
  revision: string
  workflow_status: string | null
  register_revision: string | null
  change: 'new' | 'first issue' | 'revised' | 'retitled' | 'unchanged'
}

export type Transmittal = {
  id: string
  reference: string
  issue_date: string
  method: string
  reason: string | null
  notes: string | null
  item_count: number
}

export async function fetchRegister(projectId: string) {
  const { data, error } = await supabase
    .from('v_drawing_register')
    .select('*')
    .eq('project_id', projectId)
    .order('document_number')
  if (error) throw error
  return (data ?? []) as unknown as Drawing[]
}

export async function hasBep(projectId: string) {
  const { count, error } = await supabase
    .from('bep')
    .select('project_id', { count: 'exact', head: true })
    .eq('project_id', projectId)
  if (error) throw error
  return (count ?? 0) > 0
}

export async function seedBep(projectId: string) {
  const { data, error } = await supabase.rpc('seed_bep', { p_project: projectId })
  if (error) throw error
  return data as string
}

export async function importDocuments(
  projectId: string, label: string, rows: Record<string, unknown>[],
) {
  const { data, error } = await supabase.rpc('import_documents', {
    p_project: projectId, p_label: label, p_rows: rows,
  })
  if (error) throw error
  return data as { ok: boolean; row_count: number; import_id?: string
    errors?: { row: number; field: string; message: string }[] }
}

export async function fetchReconcile(projectId: string) {
  const { data, error } = await supabase.rpc('reconcile_preview', { p_project: projectId })
  if (error) throw error
  return (data ?? []) as ReconcileRow[]
}

export async function acceptIntoRegister(projectId: string, numbers: string[]) {
  const { data, error } = await supabase.rpc('accept_into_register', {
    p_project: projectId, p_numbers: numbers,
  })
  if (error) throw error
  return data as { ok: boolean; added: number; updated: number }
}

/** A drawing that is expected but has not arrived. Same table as a delivered
 *  one — two lists is how something ends up on neither. */
export async function addPlannedDrawing(projectId: string, row: {
  document_number: string; title: string | null
  programme_task_uid: string | null; offset_days: number; anchor: 'start' | 'finish'
}) {
  const { error } = await supabase.from('drawing_register')
    .insert({ project_id: projectId, ...row })
  if (error) throw error
}

export async function setDrawingAnchor(id: string, anchor: {
  programme_task_uid: string | null; offset_days: number; anchor: 'start' | 'finish'
  due_date_override: string | null
}) {
  const { error } = await supabase.from('drawing_register').update(anchor).eq('id', id)
  if (error) throw error
}

export async function fetchPacks(projectId: string) {
  const { data, error } = await supabase
    .from('v_drawing_packs')
    .select('id, reference, name, purpose, drawing_count, awaited_count, revised_since_issue, never_issued')
    .eq('project_id', projectId)
    .order('reference')
  if (error) throw error
  return (data ?? []) as unknown as Pack[]
}

export async function createPack(projectId: string, name: string, purpose: string | null) {
  const { data, error } = await supabase.rpc('create_pack', {
    p_project: projectId, p_name: name, p_purpose: purpose,
  })
  if (error) throw error
  return data as string
}

export async function fetchPackDrawingIds(packId: string) {
  const { data, error } = await supabase
    .from('drawing_pack_items').select('drawing_id').eq('pack_id', packId)
  if (error) throw error
  return new Set((data ?? []).map((r) => r.drawing_id as string))
}

export async function setPackMembership(packId: string, drawingId: string, inPack: boolean) {
  const { error } = inPack
    ? await supabase.from('drawing_pack_items').insert({ pack_id: packId, drawing_id: drawingId })
    : await supabase.from('drawing_pack_items').delete()
        .eq('pack_id', packId).eq('drawing_id', drawingId)
  if (error) throw error
}

export async function fetchTransmittals(projectId: string) {
  const { data, error } = await supabase
    .from('transmittals')
    .select('id, reference, issue_date, method, reason, notes, transmittal_items(count)')
    .eq('project_id', projectId)
    .order('issue_date', { ascending: false })
  if (error) throw error
  return (data ?? []).map((r) => {
    const row = r as unknown as Omit<Transmittal, 'item_count'> &
      { transmittal_items: { count: number }[] }
    const { transmittal_items, ...rest } = row
    return { ...rest, item_count: transmittal_items?.[0]?.count ?? 0 }
  })
}

export type Recipient = {
  company_id: string
  person_id: string | null
  distribution: 'action' | 'information'
}

export async function issueTransmittal(projectId: string, opts: {
  method: string; reason: string | null; notes: string | null
  packId: string | null; drawingIds: string[] | null
  /** Empty means the whole project sees it; populated means those people, plus
   *  the host and the raiser either way. */
  recipients: Recipient[]
}) {
  const { data, error } = await supabase.rpc('issue_transmittal', {
    p_project: projectId, p_method: opts.method, p_reason: opts.reason,
    p_notes: opts.notes, p_pack: opts.packId, p_drawing_ids: opts.drawingIds,
    p_recipients: opts.recipients.length ? opts.recipients : null,
  })
  if (error) throw error
  return data as { ok: boolean; reference: string; drawing_count: number }
}

/** Everyone in the project directory, grouped by their firm. */
export async function fetchDirectoryPeople(projectId: string) {
  const { data, error } = await supabase
    .from('project_people')
    .select('id, company_id, name, job_role, email, profile_id, companies!inner(project_id, name)')
    .eq('companies.project_id', projectId)
    .order('name')
  if (error) throw error
  return (data ?? []).map((r) => {
    const row = r as unknown as {
      id: string; company_id: string; name: string; job_role: string | null
      email: string | null; profile_id: string | null; companies: { name: string }
    }
    return {
      id: row.id, company_id: row.company_id, name: row.name,
      job_role: row.job_role, email: row.email,
      // The login behind this directory row, if there is one. A visibility list
      // holds profile ids because can_see() compares them against auth.uid();
      // a directory row with no login cannot be named in one, and would not be
      // able to see anything anyway.
      profile_id: row.profile_id,
      company_name: row.companies.name,
    }
  })
}

/* --------------------------------------------------------------------- BEP */

export type BepField = {
  id: string
  position: number
  name: string
  min_len: number
  max_len: number
  required: boolean
  source: 'project' | 'directory' | 'standard' | 'free'
}

export type BepValue = { code: string; description: string | null }

export async function fetchBepFields(projectId: string) {
  const { data, error } = await supabase
    .from('bep_fields')
    .select('id, position, name, min_len, max_len, required, source')
    .eq('project_id', projectId)
    .order('position')
  if (error) throw error
  return (data ?? []) as unknown as BepField[]
}

/** The permitted codes for one field. For a `directory` field this is a live
 *  join to the project's companies — there are no stored values to read. */
export async function fetchBepFieldCodes(fieldId: string) {
  const { data, error } = await supabase.rpc('bep_field_codes', { p_field: fieldId })
  if (error) throw error
  return (data ?? []) as BepValue[]
}

export async function addBepValue(fieldId: string, code: string, description: string | null) {
  const { error } = await supabase.from('bep_field_values')
    .insert({ field_id: fieldId, code, description })
  if (error) throw error
}

export async function removeBepValue(fieldId: string, code: string) {
  const { error } = await supabase.from('bep_field_values')
    .delete().eq('field_id', fieldId).eq('code', code)
  if (error) throw error
}

export async function updateBepField(id: string, patch: Partial<Omit<BepField, 'id'>>) {
  const { error } = await supabase.from('bep_fields').update(patch).eq('id', id)
  if (error) throw error
}

export async function fetchRevisionRules(projectId: string) {
  const { data, error } = await supabase
    .from('bep_revision_rules')
    .select('prefix, construction_status')
    .eq('project_id', projectId)
    .order('prefix')
  if (error) throw error
  return (data ?? []) as { prefix: string; construction_status: string }[]
}

export async function addRevisionRule(projectId: string, prefix: string, status: string) {
  const { error } = await supabase.from('bep_revision_rules')
    .insert({ project_id: projectId, prefix, construction_status: status })
  if (error) throw error
}

export async function removeRevisionRule(projectId: string, prefix: string) {
  const { error } = await supabase.from('bep_revision_rules')
    .delete().eq('project_id', projectId).eq('prefix', prefix)
  if (error) throw error
}

export async function fetchSuitabilityCodes(projectId: string) {
  const { data, error } = await supabase
    .from('bep_suitability_codes')
    .select('code, description, in_use')
    .eq('project_id', projectId)
    .order('code')
  if (error) throw error
  return (data ?? []) as { code: string; description: string | null; in_use: boolean }[]
}

export async function setSuitabilityInUse(projectId: string, code: string, inUse: boolean) {
  const { error } = await supabase.from('bep_suitability_codes')
    .update({ in_use: inUse }).eq('project_id', projectId).eq('code', code)
  if (error) throw error
}

/* ------------------------------------------------- editing a forked template */

/** Edit a discipline in the account's own list. Only a fork is editable: the
 *  published default belongs to everyone, and the policies refuse it. */
export async function updateDiscipline(
  organisationId: string, code: string,
  patch: { name?: string; iso_letter?: string | null; sort_order?: number },
) {
  const { error } = await supabase.from('disciplines').update(patch)
    .eq('organisation_id', organisationId).eq('code', code)
  if (error) throw error
}

export async function addDiscipline(organisationId: string, d: {
  code: string; name: string; iso_letter: string | null; sort_order: number
}) {
  const { error } = await supabase.from('disciplines')
    .insert({ organisation_id: organisationId, ...d })
  if (error) throw error
}

export async function removeDiscipline(organisationId: string, code: string) {
  const { error } = await supabase.from('disciplines').delete()
    .eq('organisation_id', organisationId).eq('code', code)
  if (error) throw error
}

/** Pull in disciplines the published set has gained since the fork was taken.
 *  Touches nothing the account has already edited or deliberately removed. */
export async function refreshDisciplineFork(organisationId: string) {
  const { data, error } = await supabase.rpc('refresh_discipline_fork', {
    p_org: organisationId,
  })
  if (error) throw error
  return data as number
}

export type LibraryItem = {
  id: string
  ref: string
  category_code: string
  item: string
  default_lead_discipline: string | null
  cdp_likely: boolean
  guidance_note: string | null
  forked: boolean
}

export async function fetchAccountLibrary(organisationId: string) {
  const { data, error } = await supabase.rpc('account_drm_library', { p_org: organisationId })
  if (error) throw error
  return (data ?? []) as LibraryItem[]
}

export async function forkLibrary(organisationId: string) {
  const { data, error } = await supabase.rpc('fork_drm_library', { p_org: organisationId })
  if (error) throw error
  return data as number
}

export async function updateLibraryItem(id: string, patch: {
  ref?: string; category_code?: string; item?: string
  default_lead_discipline?: string | null; cdp_likely?: boolean; guidance_note?: string | null
}) {
  const { error } = await supabase.from('drm_library_items').update(patch).eq('id', id)
  if (error) throw error
}

export async function addLibraryItem(organisationId: string, row: {
  ref: string; category_code: string; item: string
  default_lead_discipline: string | null; cdp_likely: boolean
}) {
  const { error } = await supabase.from('drm_library_items')
    .insert({ organisation_id: organisationId, ...row })
  if (error) throw error
}

export async function removeLibraryItem(id: string) {
  const { error } = await supabase.from('drm_library_items').delete().eq('id', id)
  if (error) throw error
}

/** A one-off item that exists on this project only — never in the library,
 *  because a job-specific thing does not belong in the template every future
 *  project starts from. */
export async function addBespokeDrmItem(projectId: string, row: {
  ref: string; category_code: string; item: string; lead_discipline: string | null
}) {
  const { error } = await supabase.from('drm_items')
    .insert({ project_id: projectId, ...row, applicable: true })
  if (error) throw error
}

export async function removeDrmItem(id: string) {
  const { error } = await supabase.from('drm_items').delete().eq('id', id)
  if (error) throw error
}

/* ----------------------------------------------- appointment documents */

/** The one bucket. Appointment documents and evidence attachments only — a
 *  drawing is never uploaded anywhere, the register keeps a CDE URL. */
const BUCKET = 'project-files'

/** Path shape the storage policies read: project/company/slot/filename. */
const objectPath = (projectId: string, companyId: string, slot: string, filename: string) =>
  `${projectId}/${companyId}/${slot}/${filename}`

export async function uploadAppointmentDocument(
  projectId: string, companyId: string, slot: string, file: File,
) {
  const path = objectPath(projectId, companyId, slot, file.name)
  const { error: upErr } = await supabase.storage.from(BUCKET)
    .upload(path, file, { upsert: false })
  if (upErr) throw upErr

  const { data: me } = await supabase.auth.getUser()
  // A replacement supersedes rather than overwrites, so what was approved is
  // still readable afterwards.
  const { data: existing } = await supabase.from('appointment_documents')
    .select('id').eq('company_id', companyId).eq('slot', slot).maybeSingle()

  const { data: inserted, error } = await supabase.from('appointment_documents')
    .upsert({
      company_id: companyId, slot, storage_path: path, filename: file.name,
      uploaded_by: me.user?.id ?? null, approved: false, approved_by: null, approved_at: null,
    }, { onConflict: 'company_id,slot' })
    .select('id')
    .single()
  if (error) throw error
  return { id: inserted.id as string, superseded: existing?.id ?? null }
}

/** A time-limited link. The bucket is private, so there is no public URL and
 *  nothing is readable without a policy check first. */
export async function appointmentDocumentUrl(storagePath: string) {
  const { data, error } = await supabase.storage.from(BUCKET)
    .createSignedUrl(storagePath, 60 * 10)
  if (error) throw error
  return data.signedUrl
}

export async function fetchAppointmentDocuments(companyId: string) {
  const { data, error } = await supabase
    .from('appointment_documents')
    .select('id, slot, storage_path, filename, uploaded_at, approved')
    .eq('company_id', companyId)
  if (error) throw error
  return (data ?? []) as {
    id: string; slot: string; storage_path: string; filename: string
    uploaded_at: string; approved: boolean
  }[]
}

export async function approveAppointmentDocument(id: string, approved: boolean) {
  const { data: me } = await supabase.auth.getUser()
  const { error } = await supabase.from('appointment_documents').update({
    approved,
    approved_by: approved ? (me.user?.id ?? null) : null,
    approved_at: approved ? new Date().toISOString() : null,
  }).eq('id', id)
  if (error) throw error
}

/* ------------------------------------------------- issues, RFIs, meetings */

export type Issue = {
  id: string
  reference: string
  title: string
  description: string | null
  category: string | null
  person_id: string | null
  programme_task_uid: string | null
  offset_days: number
  anchor: 'start' | 'finish'
  due_date_override: string | null
  priority: number
  status: 'Open' | 'Closed'
  source_kind: 'irs' | 'comment' | 'rfi' | 'meeting'
  origin_comment_id: string | null
  rfi_question: string | null
  rfi_response: string | null
  rfi_status: 'Open' | 'Answered' | 'Closed' | null
  raised_meeting_id: string | null
  raised_by: string | null
  raised_at: string
  due: string | null
  anchor_state: 'ok' | 'missing' | 'removed' | 'unanchored'
  overdue: boolean
  urgency: number
}

export type Meeting = {
  id: string
  reference: string
  title: string
  meeting_type: string
  meeting_date: string
  location: string | null
  status: string
  notes: string | null
}

export type Comment = {
  id: string
  entity_type: string
  entity_id: string
  author_id: string
  body: string
  parent_id: string | null
  created_at: string
  edited_at: string | null
  author_name: string | null
}

export type EvidenceRow = {
  id: string
  entity_type: string
  entity_id: string
  name: string | null
  drawing_id: string | null
  storage_path: string | null
  revision_at_add: string | null
  revision_at_review: string | null
  added_at: string
  reviewed_at: string | null
  document_number: string | null
  revision_now: string | null
  state: 'Awaiting review' | 'Reviewed' | 'Revised since review'
}

export const ISSUE_KIND_LABELS: Record<Issue['source_kind'], string> = {
  irs: 'Task',
  comment: 'From a discussion',
  rfi: 'RFI',
  meeting: 'From a meeting',
}

export async function fetchIssues(projectId: string) {
  const { data, error } = await supabase
    .from('v_issues')
    .select('*')
    .eq('project_id', projectId)
    .order('urgency', { ascending: false })
  if (error) throw error
  return (data ?? []) as unknown as Issue[]
}

export async function raiseIssue(projectId: string, opts: {
  title: string
  kind: Issue['source_kind']
  description?: string | null
  personId?: string | null
  taskUid?: string | null
  offsetDays?: number
  anchor?: 'start' | 'finish'
  priority?: number
  rfiQuestion?: string | null
  originCommentId?: string | null
  meetingId?: string | null
  visibility?: Record<string, unknown> | null
}) {
  const { data, error } = await supabase.rpc('raise_issue', {
    p_project: projectId,
    p_title: opts.title,
    p_kind: opts.kind,
    p_description: opts.description ?? null,
    p_person: opts.personId ?? null,
    p_task_uid: opts.taskUid ?? null,
    p_offset: opts.offsetDays ?? 0,
    p_anchor: opts.anchor ?? 'finish',
    p_priority: opts.priority ?? 50,
    p_rfi_question: opts.rfiQuestion ?? null,
    p_origin_comment: opts.originCommentId ?? null,
    p_meeting: opts.meetingId ?? null,
    p_agenda_item: null,
    p_visibility: opts.visibility ?? null,
  })
  if (error) throw error
  return data as { ok: boolean; id: string; reference: string }
}

export async function answerRfi(issueId: string, response: string) {
  const { error } = await supabase.rpc('answer_rfi', {
    p_issue: issueId, p_response: response,
  })
  if (error) throw error
}

export async function closeIssue(issueId: string, reopen = false) {
  const { error } = await supabase.rpc('close_issue', {
    p_issue: issueId, p_open: reopen,
  })
  if (error) throw error
}

export async function updateIssue(id: string, patch: {
  title?: string; description?: string | null; category?: string | null
  person_id?: string | null; programme_task_uid?: string | null
  offset_days?: number; anchor?: 'start' | 'finish'
  due_date_override?: string | null; priority?: number
  visibility?: Record<string, unknown>
}) {
  const { error } = await supabase.from('issues').update(patch).eq('id', id)
  if (error) throw error
}

export async function fetchMeetings(projectId: string) {
  const { data, error } = await supabase
    .from('meetings')
    .select('id, reference, title, meeting_type, meeting_date, location, status, notes')
    .eq('project_id', projectId)
    .order('meeting_date', { ascending: false })
  if (error) throw error
  return (data ?? []) as unknown as Meeting[]
}

export async function fetchComments(projectId: string, entityType: string, entityId: string) {
  const { data, error } = await supabase
    .from('comments')
    .select('id, entity_type, entity_id, author_id, body, parent_id, created_at, edited_at, ' +
            'profiles!comments_author_id_fkey(name)')
    .eq('project_id', projectId)
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .order('created_at')
  if (error) throw error
  return (data ?? []).map((r) => {
    const row = r as unknown as Omit<Comment, 'author_name'> & { profiles: { name: string } | null }
    const { profiles, ...rest } = row
    return { ...rest, author_name: profiles?.name ?? null }
  })
}

export async function addComment(
  projectId: string, entityType: string, entityId: string, body: string,
  parentId: string | null = null,
) {
  const { data: me } = await supabase.auth.getUser()
  const { data, error } = await supabase.from('comments')
    .insert({
      project_id: projectId, entity_type: entityType, entity_id: entityId,
      author_id: me.user?.id, body, parent_id: parentId,
    })
    .select('id')
    .single()
  if (error) throw error
  return data.id as string
}

export async function editComment(id: string, body: string) {
  const { error } = await supabase.from('comments')
    .update({ body, edited_at: new Date().toISOString() }).eq('id', id)
  if (error) throw error
}

export async function deleteComment(id: string) {
  const { error } = await supabase.from('comments').delete().eq('id', id)
  if (error) throw error
}

/** Attach a live register link to a comment — never a filename someone typed. */
export async function attachDrawingToComment(commentId: string, drawingId: string) {
  const { data: me } = await supabase.auth.getUser()
  const { error } = await supabase.from('comment_attachments')
    .insert({ comment_id: commentId, drawing_id: drawingId, uploaded_by: me.user?.id })
  if (error) throw error
}

export async function fetchCommentAttachments(commentIds: string[]) {
  if (commentIds.length === 0) return []
  const { data, error } = await supabase
    .from('v_comment_attachments')
    .select('id, comment_id, name, drawing_id, storage_path, document_number, revision_now, cde_url')
    .in('comment_id', commentIds)
  if (error) throw error
  return (data ?? []) as unknown as {
    id: string; comment_id: string; name: string | null; drawing_id: string | null
    storage_path: string | null; document_number: string | null
    revision_now: string | null; cde_url: string | null
  }[]
}

export async function fetchEvidence(projectId: string, entityType: string, entityId: string) {
  const { data, error } = await supabase
    .from('v_evidence')
    .select('*')
    .eq('project_id', projectId)
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .order('added_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as unknown as EvidenceRow[]
}

export async function addEvidence(
  projectId: string, entityType: string, entityId: string,
  target: { drawingId?: string | null; name?: string | null; storagePath?: string | null },
) {
  const { data: me } = await supabase.auth.getUser()
  const { error } = await supabase.from('evidence').insert({
    project_id: projectId, entity_type: entityType, entity_id: entityId,
    drawing_id: target.drawingId ?? null, name: target.name ?? null,
    storage_path: target.storagePath ?? null, added_by: me.user?.id,
  })
  if (error) throw error
}

export async function reviewEvidence(id: string, reviewed = true) {
  const { error } = await supabase.rpc('review_evidence', {
    p_evidence: id, p_reviewed: reviewed,
  })
  if (error) throw error
}

export type AgendaItem = { id: string; position: number; heading: string; notes: string | null }

export async function fetchAgenda(meetingId: string) {
  const { data, error } = await supabase
    .from('meeting_agenda_items')
    .select('id, position, heading, notes')
    .eq('meeting_id', meetingId)
    .order('position')
  if (error) throw error
  return (data ?? []) as unknown as AgendaItem[]
}

export async function addAgendaItem(meetingId: string, position: number, heading: string) {
  const { error } = await supabase.from('meeting_agenda_items')
    .insert({ meeting_id: meetingId, position, heading })
  if (error) throw error
}

export async function fetchMeetingPeople(meetingId: string) {
  const { data, error } = await supabase
    .from('meeting_people')
    .select('person_id, role, project_people!inner(name, companies!inner(name))')
    .eq('meeting_id', meetingId)
  if (error) throw error
  return (data ?? []).map((r) => {
    const row = r as unknown as {
      person_id: string; role: string
      project_people: { name: string; companies: { name: string } }
    }
    return {
      person_id: row.person_id, role: row.role as 'attendee' | 'apology' | 'distribution',
      name: row.project_people.name, company_name: row.project_people.companies.name,
    }
  })
}

export async function setMeetingPerson(
  meetingId: string, personId: string, role: 'attendee' | 'apology' | 'distribution' | null,
) {
  // A person's role is replaced, not edited — there is no update grant.
  await supabase.from('meeting_people')
    .delete().eq('meeting_id', meetingId).eq('person_id', personId)
  if (role) {
    const { error } = await supabase.from('meeting_people')
      .insert({ meeting_id: meetingId, person_id: personId, role })
    if (error) throw error
  }
}

/** Items on this meeting's agenda, whether raised here or carried forward. */
export async function fetchMeetingIssues(meetingId: string) {
  const { data, error } = await supabase
    .from('issue_agenda_refs')
    .select('issue_id, added_at, issues!inner(reference, title, status, source_kind, raised_meeting_id)')
    .eq('meeting_id', meetingId)
    .order('added_at')
  if (error) throw error
  return (data ?? []).map((r) => {
    const row = r as unknown as {
      issue_id: string; added_at: string
      issues: {
        reference: string; title: string; status: string
        source_kind: string; raised_meeting_id: string | null
      }
    }
    return { issue_id: row.issue_id, ...row.issues }
  })
}

export async function carryIssueForward(issueId: string, meetingId: string) {
  const { error } = await supabase.rpc('carry_issue_forward', {
    p_issue: issueId, p_meeting: meetingId, p_agenda_item: null,
  })
  if (error) throw error
}

/* ------------------------------------------------- shell, theming, modules */

export type ProjectShell = {
  project_id: string
  project_name: string
  project_code: string
  organisation_id: string
  account_name: string
  brand_colour: string
  logo_path: string | null
  theme: 'light' | 'dark'
  modules: Record<string, boolean>
}

/** Branding and entitlements for one project — the only account facts a member
 *  who is not an admin of it may read. */
export async function fetchProjectShell(projectId: string) {
  const { data, error } = await supabase.rpc('project_shell', { p_project: projectId })
  if (error) throw error
  return (data ?? null) as ProjectShell | null
}

export async function fetchModuleKeys() {
  const { data, error } = await supabase.rpc('module_keys')
  if (error) throw error
  return (data ?? []) as string[]
}

export async function setAccountModules(orgId: string, modules: Record<string, boolean>) {
  const { error } = await supabase.rpc('set_modules', { p_org: orgId, p_modules: modules })
  if (error) throw error
}

export async function setProjectModules(
  projectId: string, override: Record<string, boolean> | null,
) {
  const { error } = await supabase.rpc('set_project_modules', {
    p_project: projectId, p_override: override,
  })
  if (error) throw error
}

export type ChangeLogRow = {
  id: number
  entity_type: string
  entity_id: string | null
  action: 'insert' | 'update' | 'delete'
  field: string | null
  value_from: string | null
  value_to: string | null
  created_at: string
  actor_name: string | null
}

export async function fetchChangeLog(projectId: string, limit = 200) {
  const { data, error } = await supabase
    .from('v_change_log')
    .select('id, entity_type, entity_id, action, field, value_from, value_to, created_at, actor_name')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as unknown as ChangeLogRow[]
}

/* ------------------------------------------- dashboard and consultant front */

export type MyFront = {
  company_ids: string[]
  due_from_us: { id: string; number: string; title: string | null
    due: string | null; overdue: boolean }[]
  asked_of_us: { id: string; reference: string; title: string
    kind: string; due: string | null; urgency: number }[]
  we_lead: { id: string; ref: string; item: string; discipline: string | null }[]
  appointment_gaps: { company: string; slot: string }[]
  tracked_lines: { uid: string; description: string; start: string; finish: string
    percent: number; removed: boolean }[]
  waiting_on_you: { kind: string; reference: string; title: string
    due: string | null; urgency: number }[]
}

export type Timeline = {
  start: string | null
  finish: string | null
  today: string
  percent_elapsed: number
  percent_complete: number | null
  milestones: { uid: string; description: string; date: string; complete: boolean }[]
}

export type HealthRow = {
  company_id: string
  company_name: string
  appointment_gaps: number
  overdue_drawings: number
  open_issues: number
  quiet_issues: number
  concern_score: number
}

export type QuietRow = {
  reference: string
  title: string
  raised_at: string
  last_touched: string
  days_quiet: number
}

export type DecisionRow = {
  kind: string
  record_id: string
  reference: string
  title: string
  due: string | null
  urgency: number
}

/** Everything this person's firm is answerable for, and nothing else. */
export async function fetchMyFront(projectId: string) {
  const { data, error } = await supabase.rpc('my_front', { p_project: projectId })
  if (error) throw error
  return (data ?? null) as MyFront | null
}

export async function fetchTimeline(projectId: string) {
  const { data, error } = await supabase.rpc('programme_timeline', { p_project: projectId })
  if (error) throw error
  return (data ?? null) as Timeline | null
}

/** What is waiting on the signed-in person. Deliberately personal — Phase 13's
 *  report answers the different question "what is waiting on this audience". */
export async function fetchDecisionQueue(projectId: string) {
  const { data, error } = await supabase.rpc('decision_queue', { p_project: projectId })
  if (error) throw error
  return (data ?? []) as DecisionRow[]
}

/** Empty for anyone who is not the contractor's own staff. */
export async function fetchConsultantHealth(projectId: string) {
  const { data, error } = await supabase.rpc('consultant_health', { p_project: projectId })
  if (error) throw error
  return (data ?? []) as HealthRow[]
}

export async function fetchGoneQuiet(projectId: string, weeks = 3) {
  const { data, error } = await supabase.rpc('gone_quiet', {
    p_project: projectId, p_weeks: weeks,
  })
  if (error) throw error
  return (data ?? []) as QuietRow[]
}

/* ------------------------------------------------------ tracked items */

export type TrackedItem = {
  id: string
  kind: string
  reference: string
  heading: string | null
  title: string
  prompt: string | null
  discipline: string | null
  required: boolean
  status: string
  response: string | null
  response_source: 'person' | 'suggested'
  response_by: string | null
  response_at: string | null
  company_id: string | null
  company_name: string | null
  person_id: string | null
  programme_task_uid: string | null
  offset_days: number
  anchor: 'start' | 'finish'
  due_date_override: string | null
  custom: boolean
  template_name: string | null
  ext: Record<string, unknown>
  due: string | null
  anchor_state: string
  holders: number
  is_done: boolean
  overdue: boolean
  awaiting_acceptance: boolean
}

export type TrackedProgress = {
  kind: string; total: number; done: number; overdue: number; struck_out: number
}

/** The statuses each kind uses. One engine, but a planning condition is not
 *  discharged the way a checklist item is complete. */
export const TRACKED_STATUSES: Record<string, string[]> = {
  planning: ['Not started', 'In progress', 'Submitted', 'Discharged', 'Not required'],
  bc: ['Not started', 'In progress', 'Submitted', 'Approved',
       'Approved with conditions', 'Not required'],
  scope: ['Not started', 'In progress', 'Complete', 'Not required'],
  breeam: ['Not started', 'Targeted', 'Evidence submitted', 'Complete', 'Not required'],
  default: ['Not started', 'In progress', 'Complete', 'Not required'],
}

export const TRACKED_LABELS: Record<string, string> = {
  planning: 'Planning conditions',
  bc: 'Building control',
  scope: 'Scope of service',
  breeam: 'BREEAM',
  'checklist:precon': 'Pre-construction pre-assessment',
  'checklist:client': 'Client requirements',
  'checklist:handover': 'Handover',
  'checklist:highways': 'Highways',
  'checklist:utilities': 'Utilities',
}

export const CHECKLIST_TYPES = [
  'precon', 'client', 'handover', 'highways', 'utilities',
] as const

export async function fetchTrackedItems(projectId: string, kind: string) {
  const { data, error } = await supabase
    .from('v_tracked_items')
    .select('*')
    .eq('project_id', projectId)
    .eq('kind', kind)
    .order('reference')
  if (error) throw error
  return (data ?? []) as unknown as TrackedItem[]
}

export async function fetchTrackedProgress(projectId: string) {
  const { data, error } = await supabase.rpc('tracked_progress', { p_project: projectId })
  if (error) throw error
  return (data ?? []) as TrackedProgress[]
}

export async function loadChecklist(projectId: string, type: string) {
  const { data, error } = await supabase.rpc('load_checklist', {
    p_project: projectId, p_type: type,
  })
  if (error) throw error
  return data as { ok: boolean; added: number; pre_assigned: number }
}

/** Write an answer. A machine suggestion passes 'suggested' so it stays visibly
 *  distinguishable from something a person wrote. */
export async function setResponse(
  itemId: string, response: string, source: 'person' | 'suggested' = 'person',
) {
  const { error } = await supabase.rpc('set_response', {
    p_item: itemId, p_response: response, p_source: source,
  })
  if (error) throw error
}

export async function acceptResponse(itemId: string) {
  const { error } = await supabase.rpc('accept_response', { p_item: itemId })
  if (error) throw error
}

export async function updateTrackedItem(id: string, patch: {
  status?: string; required?: boolean; company_id?: string | null
  person_id?: string | null; discipline?: string | null
  programme_task_uid?: string | null; offset_days?: number
  anchor?: 'start' | 'finish'; due_date_override?: string | null
  ext?: Record<string, unknown>; title?: string; heading?: string | null
}) {
  const { error } = await supabase.from('tracked_items').update(patch).eq('id', id)
  if (error) throw error
}

export async function addTrackedItem(projectId: string, row: {
  kind: string; reference: string; heading: string | null; title: string
  discipline: string | null
}) {
  const { data: me } = await supabase.auth.getUser()
  const { error } = await supabase.from('tracked_items').insert({
    project_id: projectId, ...row, custom: true, created_by: me.user?.id,
  })
  if (error) throw error
}

/** Only a row added on the project. A template row is struck out instead, so
 *  the decision that it was not needed survives. */
export async function deleteTrackedItem(id: string) {
  const { error } = await supabase.from('tracked_items').delete().eq('id', id)
  if (error) throw error
}

export type ScopeTemplate = {
  id: string; name: string; discipline: string | null; is_core: boolean
}

export async function fetchSuggestedScopeTemplates(projectId: string, companyId: string) {
  const { data, error } = await supabase.rpc('suggested_scope_templates', {
    p_project: projectId, p_company: companyId,
  })
  if (error) throw error
  return (data ?? []) as ScopeTemplate[]
}

export async function applyScopeTemplates(
  projectId: string, companyId: string, templateIds: string[],
) {
  const { data, error } = await supabase.rpc('apply_scope_templates', {
    p_project: projectId, p_company: companyId, p_template_ids: templateIds,
  })
  if (error) throw error
  return data as { ok: boolean; added: number }
}

/* ------------------------------------------------- building safety (HRB) */

export type ChangeRequest = {
  id: string
  reference: string
  title: string
  description: string | null
  reason: string | null
  status: string
  from_company_id: string | null
  to_company_id: string | null
  impact_scope: string | null
  impact_weeks: number
  impact_cost: string | null
  decision_task_uid: string | null
  decision_offset_days: number
  decision_anchor: 'start' | 'finish'
  decision_due: string | null
  effective_date: string | null
  bsa_controlled: boolean
  bsa_class: 'Recordable' | 'Notifiable' | 'Major' | null
  bsa_class_by: string | null
  bsa_class_at: string | null
  bsa_class_note: string | null
  bsa_notified_at: string | null
  bsa_objected: boolean
  bsa_app_submitted: string | null
  bsa_app_decided: string | null
  bsa_app_outcome: string | null
  bsa_state: string
  bsa_verdict: 'proceed' | 'warn' | 'stop'
  bsa_detail: string
  headline_status: string
  approved_with_nothing_listed: boolean
  amendments: number
  amendments_outstanding: number
  raised_at: string
}

export type Occurrence = {
  id: string; reference: string; title: string; description: string | null
  kind: string | null; status: string; assessment: string | null
  occurred_at: string | null; discovered_at: string | null; reported_at: string | null
}

export type GoldenThreadRow = {
  drawing_id: string; document_number: string; title: string | null
  g2_revision?: string; revision_now?: string; due?: string | null
}

export async function fetchChangeRequests(projectId: string) {
  const { data, error } = await supabase
    .from('v_change_requests')
    .select('*')
    .eq('project_id', projectId)
    .order('raised_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as unknown as ChangeRequest[]
}

/** Whether the caller holds the statutory duty. The database refuses the act
 *  either way; this only decides whether to offer it. */
export async function canClassify(projectId: string) {
  const { data, error } = await supabase.rpc('can_classify', { p_project: projectId })
  if (error) throw error
  return data === true
}

/** The app never suggests a category. It takes one and records the basis. */
export async function classifyChange(
  changeId: string, bsaClass: 'Recordable' | 'Notifiable' | 'Major' | null, note: string,
) {
  const { error } = await supabase.rpc('classify_change', {
    p_change: changeId, p_class: bsaClass, p_note: note,
  })
  if (error) throw error
}

export async function fetchGoldenThreadMoved(projectId: string) {
  const { data, error } = await supabase.rpc('golden_thread_moved', { p_project: projectId })
  if (error) throw error
  return (data ?? []) as GoldenThreadRow[]
}

export async function fetchGoldenThreadNeverIssued(projectId: string) {
  const { data, error } = await supabase.rpc('golden_thread_never_issued', {
    p_project: projectId,
  })
  if (error) throw error
  return (data ?? []) as GoldenThreadRow[]
}

export async function stampG2Baseline(projectId: string) {
  const { data, error } = await supabase.rpc('stamp_g2_baseline', { p_project: projectId })
  if (error) throw error
  return data as { ok: boolean; baselined: number }
}

export async function fetchOccurrences(projectId: string) {
  const { data, error } = await supabase
    .from('occurrences')
    .select('id, reference, title, description, kind, status, assessment, occurred_at, discovered_at, reported_at')
    .eq('project_id', projectId)
    .order('raised_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as unknown as Occurrence[]
}

export type HrbSettings = {
  hrb: boolean; hrb_reason: string | null
  g2_reference: string | null; g2_approved_date: string | null
  commencement_notified: string | null
  hrb_notify_days: number; hrb_major_weeks: number
}

export async function fetchHrbSettings(projectId: string) {
  const { data, error } = await supabase
    .from('projects')
    .select('hrb, hrb_reason, g2_reference, g2_approved_date, commencement_notified, hrb_notify_days, hrb_major_weeks')
    .eq('id', projectId)
    .single()
  if (error) throw error
  return data as unknown as HrbSettings
}

export async function updateHrbSettings(projectId: string, patch: Partial<HrbSettings>) {
  const { error } = await supabase.from('projects').update(patch).eq('id', projectId)
  if (error) throw error
}
