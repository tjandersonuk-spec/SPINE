import { useCallback, useEffect, useState } from 'react'

import { Empty, ErrorNote } from '@/components/ui/notes'
import { ModuleEditor } from '@/components/platform/ModuleEditor'
import { Button } from '@/components/ui/button'
import { PageHead } from '@/components/ui/panel'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  approveRequest, deleteAccount, fetchAllAccounts, fetchModuleCatalogue, fetchPendingRequests,
  rejectRequest, setAccountModules, setAccountStatus,
  type ModuleEntry, type OwnerAccount, type OwnerRequest,
} from '@/lib/queries'

/**
 * How many of the product's modules this account has switched off.
 *
 * Counted against the CATALOGUE, not against the stored map's own values. A
 * key the catalogue does not know is not a module that is off — it is not a
 * module, and counting one made a core-tier account report "2 switched off"
 * with every checkbox on the editor ticked.
 */
const offCount = (catalogue: ModuleEntry[], modules: Record<string, boolean> | null) =>
  catalogue.filter((m) => modules?.[m.key] === false).length

/** Only keys the catalogue knows. The database refuses the rest, so a draft
 *  seeded from a stored map must not carry them into a save. */
const knownOnly = (catalogue: ModuleEntry[], modules: Record<string, boolean> | null) =>
  Object.fromEntries(
    Object.entries(modules ?? {}).filter(([k]) => catalogue.some((m) => m.key === k)))

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)

/** Review, amend and approve. The form is pre-filled from the request but every
 *  field is editable — correcting a name or a tier before the account exists is
 *  the entire point of the review step. */
function RequestRow({
  req, catalogue, onDone,
}: { req: OwnerRequest; catalogue: ModuleEntry[]; onDone: () => void }) {
  const [name, setName] = useState(req.company_name)
  const [slug, setSlug] = useState(slugify(req.company_name))
  const [tier, setTier] = useState(req.intended_tier === 'undecided' ? 'core' : req.intended_tier ?? 'core')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const run = async (fn: () => Promise<void>) => {
    setError(null)
    setBusy(true)
    try {
      await fn()
      onDone()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  // The tier is a label on the contract; the modules are what is actually
  // sold, named explicitly. Everything on until the owner unticks it.
  const [modules, setModules] = useState<Record<string, boolean>>({})

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{req.company_name}</CardTitle>
        <CardDescription>
          {req.profiles?.name} · {req.profiles?.email}
          {req.company_number && ` · no. ${req.company_number}`}
          {req.note && <span className="mt-1 block italic">“{req.note}”</span>}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor={`n-${req.id}`}>Account name</Label>
            <Input id={`n-${req.id}`} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`s-${req.id}`}>Slug</Label>
            <Input id={`s-${req.id}`} value={slug} onChange={(e) => setSlug(e.target.value)} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`t-${req.id}`}>Tier</Label>
            <select
              id={`t-${req.id}`}
              value={tier}
              onChange={(e) => setTier(e.target.value)}
              className="border-input h-9 rounded-md border bg-transparent px-3 text-sm"
            >
              <option value="core">Core</option>
              <option value="compliance">Core + Compliance</option>
              <option value="complete">Complete</option>
            </select>
          </div>
        </div>
        <div>
          <p className="mb-2 text-sm font-medium">Modules this account is sold</p>
          <ModuleEditor catalogue={catalogue} value={modules} onChange={setModules}
            disabled={busy} />
        </div>
        <ErrorNote message={error} />
        <div className="flex flex-wrap items-end gap-2">
          <Button
            disabled={busy}
            onClick={() => run(() => approveRequest(req.id, name, slug, tier, modules))}
          >
            Approve
          </Button>
          <div className="flex flex-1 items-end gap-2">
            <Input
              placeholder="Reason, shown to the requester"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <Button
              variant="outline"
              disabled={busy || !reason.trim()}
              onClick={() => run(() => rejectRequest(req.id, reason))}
            >
              Decline
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function AccountRow({
  a, catalogue, onDone,
}: { a: OwnerAccount; catalogue: ModuleEntry[]; onDone: () => void }) {
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  // Seeded from the stored map, filtered to keys the catalogue knows: a legacy
  // key carried into a save fails with "No module called compliance", which is
  // a confusing error about something the owner never chose.
  const [draft, setDraft] = useState<Record<string, boolean>>(knownOnly(catalogue, a.modules))
  const off = offCount(catalogue, a.modules)

  const run = async (fn: () => Promise<void>) => {
    setError(null)
    setBusy(true)
    try {
      await fn()
      onDone()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{a.name}</CardTitle>
        <CardDescription>
          {a.status} · {a.subscription_tier ?? 'no tier'}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ErrorNote message={error} />
        <details className="border-rule rounded border px-3 py-2">
          <summary className="cursor-pointer text-sm font-medium">
            Modules — {off === 0
              ? `everything (${catalogue.length})`
              : `${catalogue.length - off} of ${catalogue.length}, ${off} switched off`}
          </summary>
          <div className="pt-3">
            <ModuleEditor catalogue={catalogue} value={draft} onChange={setDraft}
              disabled={busy} />
            <div className="mt-3 flex gap-2">
              <Button size="sm" disabled={busy}
                onClick={() => run(() => setAccountModules(a.id, draft))}>
                Save modules
              </Button>
              <span className="text-graphite self-center text-xs">
                Switching one off hides it on every project in the account and deletes nothing.
              </span>
            </div>
          </div>
        </details>
        <div className="flex flex-wrap gap-2">
          {a.status !== 'active' && (
            <Button size="sm" disabled={busy} onClick={() => run(() => setAccountStatus(a.id, 'active'))}>
              {a.status === 'pending' ? 'Approve' : 'Reinstate'}
            </Button>
          )}
          {a.status === 'active' && (
            <Button size="sm" variant="outline" disabled={busy}
              onClick={() => run(() => setAccountStatus(a.id, 'suspended', 'Locked by the platform owner'))}>
              Lock
            </Button>
          )}
          {a.status !== 'archived' && (
            <Button size="sm" variant="outline" disabled={busy}
              onClick={() => run(() => setAccountStatus(a.id, 'archived'))}>
              Archive
            </Button>
          )}
        </div>
        {/* Deletion is only offered from archived, and only with the name typed
            back — the database enforces both, this just mirrors it. */}
        {a.status === 'archived' && (
          <div className="flex items-end gap-2 border-t pt-3">
            <div className="flex flex-1 flex-col gap-2">
              <Label htmlFor={`d-${a.id}`}>Type “{a.name}” to delete permanently</Label>
              <Input id={`d-${a.id}`} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </div>
            <Button variant="destructive" disabled={busy || confirm !== a.name}
              onClick={() => run(() => deleteAccount(a.id, confirm))}>
              Delete
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export default function PlatformAccounts() {
  const [accounts, setAccounts] = useState<OwnerAccount[]>([])
  const [requests, setRequests] = useState<OwnerRequest[]>([])
  // Fetched once here rather than by every card: it is the same list for all
  // of them, and it is the thing they all render from.
  const [catalogue, setCatalogue] = useState<ModuleEntry[]>([])
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    Promise.all([fetchAllAccounts(), fetchPendingRequests(), fetchModuleCatalogue()])
      .then(([a, r, c]) => {
        setAccounts(a)
        setRequests(r)
        setCatalogue(c)
      })
      .catch((e: Error) => setError(e.message))
  }, [])

  useEffect(load, [load])

  return (
    <>
      <PageHead title="Accounts" />
      <ErrorNote message={error} />
      <Tabs defaultValue="requests">
        <TabsList>
          <TabsTrigger value="requests">Requests ({requests.length})</TabsTrigger>
          <TabsTrigger value="accounts">All accounts ({accounts.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="requests" className="flex flex-col gap-3 pt-4">
          {requests.length === 0 ? (
            <Empty>Nothing waiting for review.</Empty>
          ) : (
            requests.map((r) =>
              <RequestRow key={r.id} req={r} catalogue={catalogue} onDone={load} />)
          )}
        </TabsContent>
        <TabsContent value="accounts" className="flex flex-col gap-3 pt-4">
          {accounts.length === 0 ? (
            <Empty>No accounts yet.</Empty>
          ) : (
            accounts.map((a) =>
              // Keyed on the catalogue too, so the draft seeds from a list that
              // has actually arrived rather than from an empty one.
              <AccountRow key={`${a.id}-${catalogue.length}`} a={a}
                catalogue={catalogue} onDone={load} />)
          )}
        </TabsContent>
      </Tabs>
    </>
  )
}
