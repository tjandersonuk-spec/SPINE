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
