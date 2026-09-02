import { useCallback, useEffect, useState } from 'react'

import { Empty, ErrorNote } from '@/components/Shell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select-native'
import {
  addCatalogueCompany, addContact, fetchCatalogue, fetchContacts,
  type CatalogueCompany, type Contact,
} from '@/lib/queries'

/**
 * The account's master catalogue: every firm it works with, and the people at
 * them. A project takes a copy from here on selection and is independent from
 * then on, so editing anything here is safe — it cannot reach a live job.
 */
export function Catalogue({
  organisationId,
  canEdit,
}: {
  organisationId: string
  canEdit: boolean
}) {
  const [companies, setCompanies] = useState<CatalogueCompany[]>([])
  const [contacts, setContacts] = useState<Record<string, Contact[]>>({})
  const [open, setOpen] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [type, setType] = useState('consultant')

  const load = useCallback(() => {
    fetchCatalogue(organisationId).then(setCompanies).catch((e: Error) => setError(e.message))
  }, [organisationId])

  useEffect(load, [load])

  const openCompany = (id: string) => {
    setOpen(open === id ? null : id)
    if (!contacts[id]) {
      fetchContacts(id)
        .then((list) => setContacts((prev) => ({ ...prev, [id]: list })))
        .catch((e: Error) => setError(e.message))
    }
  }

  const act = async (fn: () => Promise<void>, after: () => void) => {
    setError(null)
    try {
      await fn()
      after()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <ErrorNote message={error} />
      <p className="text-muted-foreground text-sm">
        Firms and people this account works with. A project takes a copy when it selects one, so
        corrections made here never rewrite a job already under way.
      </p>

      {canEdit && (
        <form
          className="flex flex-wrap items-end gap-2 rounded-lg border p-4"
          onSubmit={(e) => {
            e.preventDefault()
            act(
              () => addCatalogueCompany(organisationId, { name, address, companyType: type }),
              () => {
                setName('')
                setAddress('')
                load()
              }
            )
          }}
        >
          <div className="flex min-w-48 flex-1 flex-col gap-2">
            <Label htmlFor="cat-name">Firm</Label>
            <Input id="cat-name" required value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="flex min-w-48 flex-1 flex-col gap-2">
            <Label htmlFor="cat-addr">Address</Label>
            <Input id="cat-addr" value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="cat-type">Type</Label>
            <Select id="cat-type" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="consultant">Consultant</option>
              <option value="subcontractor">Subcontractor</option>
              <option value="contractor">Contractor</option>
              <option value="client">Client</option>
            </Select>
          </div>
          <Button type="submit">Add firm</Button>
        </form>
      )}

      {companies.length === 0 ? (
        <Empty>No firms yet.</Empty>
      ) : (
        <ul className="flex flex-col gap-2">
          {companies.map((c) => (
            <li key={c.id} className="rounded-lg border">
              <button
                type="button"
                onClick={() => openCompany(c.id)}
                className="hover:bg-accent flex w-full items-center justify-between px-4 py-3 text-left"
              >
                <span>
                  <span className="font-medium">{c.name}</span>
                  {c.address && <span className="text-muted-foreground text-sm"> · {c.address}</span>}
                </span>
                <span className="text-muted-foreground text-sm">
                  {c.company_type ?? '—'} {open === c.id ? '▾' : '▸'}
                </span>
              </button>

              {open === c.id && (
                <div className="flex flex-col gap-2 border-t px-4 py-3">
                  {(contacts[c.id] ?? []).length === 0 ? (
                    <p className="text-muted-foreground text-sm">Nobody listed.</p>
                  ) : (
                    (contacts[c.id] ?? []).map((p) => (
                      <p key={p.id} className="text-sm">
                        <span className="font-medium">{p.name}</span>
                        {p.job_role && <span className="text-muted-foreground"> · {p.job_role}</span>}
                        {p.email && <span className="text-muted-foreground"> · {p.email}</span>}
                        {p.phone && <span className="text-muted-foreground"> · {p.phone}</span>}
                      </p>
                    ))
                  )}
                  {canEdit && (
                    <AddContact
                      catalogueCompanyId={c.id}
                      onAdded={() =>
                        fetchContacts(c.id).then((list) =>
                          setContacts((prev) => ({ ...prev, [c.id]: list }))
                        )
                      }
                      onError={setError}
                    />
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function AddContact({
  catalogueCompanyId, onAdded, onError,
}: {
  catalogueCompanyId: string
  onAdded: () => void
  onError: (m: string) => void
}) {
  const [name, setName] = useState('')
  const [jobRole, setJobRole] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')

  return (
    <form
      className="flex flex-wrap items-end gap-2 border-t pt-3"
      onSubmit={(e) => {
        e.preventDefault()
        addContact(catalogueCompanyId, { name, jobRole, email, phone })
          .then(() => {
            setName('')
            setJobRole('')
            setEmail('')
            setPhone('')
            onAdded()
          })
          .catch((err: Error) => onError(err.message))
      }}
    >
      <Input required placeholder="Name" value={name} onChange={(e) => setName(e.target.value)}
        className="w-40" aria-label="Name" />
      <Input placeholder="Job role" value={jobRole} onChange={(e) => setJobRole(e.target.value)}
        className="w-40" aria-label="Job role" />
      <Input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)}
        className="w-52" aria-label="Email" />
      <Input placeholder="Phone" value={phone} onChange={(e) => setPhone(e.target.value)}
        className="w-36" aria-label="Phone" />
      <Button type="submit" size="sm">Add person</Button>
    </form>
  )
}
