import { useCallback, useEffect, useState } from 'react'

import { ErrorNote } from '@/components/ui/notes'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select-native'
import { Code, Pill } from '@/components/ui/table'
import {
  addCompanyToProject, addPersonToProject, fetchAppointmentStatus, fetchCatalogue,
  fetchCompanyDisciplines, fetchContacts, fetchDisciplineGaps, fetchProjectCompanies,
  appointmentDocumentUrl, approveAppointmentDocument, fetchAppointmentDocuments,
  fetchProjectDisciplines, fetchProjectPeople, seedSampleProject, setCompanyDiscipline, SLOT_LABELS,
  uploadAppointmentDocument,
  type AppointmentSlot, type CatalogueCompany, type Contact, type ProjectCompany,
  type ProjectPerson,
} from '@/lib/queries'

type Disc = { code: string; name: string; required: boolean }

function AppointmentDocs({
  projectId, companyId, canApprove,
}: { projectId: string; companyId: string; canApprove: boolean }) {
  const [slots, setSlots] = useState<AppointmentSlot[]>([])
  const [docs, setDocs] = useState<Awaited<ReturnType<typeof fetchAppointmentDocuments>>>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    Promise.all([fetchAppointmentStatus(companyId), fetchAppointmentDocuments(companyId)])
      .then(([s2, d]) => { setSlots(s2); setDocs(d) })
      .catch((e: Error) => setError(e.message))
  }, [companyId])

  useEffect(load, [load])

  const docFor = (slot: string) => docs.find((d) => d.slot === slot)

  const upload = (slot: string, file: File) => {
    setBusy(slot); setError(null)
    uploadAppointmentDocument(projectId, companyId, slot, file)
      .then(load)
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(null))
  }

  const open = (path: string) => {
    // The bucket is private: there is no public URL, only a link that expires.
    appointmentDocumentUrl(path)
      .then((url) => window.open(url, '_blank', 'noreferrer'))
      .catch((e: Error) => setError(e.message))
  }

  return (
    <div className="flex flex-col gap-1.5">
      {error && <p className="text-stop text-xs">{error}</p>}
      <div className="flex flex-wrap gap-1">
        {slots.map((s) => {
          const doc = docFor(s.slot)
          return (
            <span key={s.slot} className="inline-flex items-center gap-1">
              <Pill
                title={s.filename ?? 'Nothing uploaded'}
                tone={s.state === 'approved' ? 'ok' : s.state === 'missing' ? 'neutral' : 'warn'}
              >
                {SLOT_LABELS[s.slot] ?? s.slot}: {s.state}
              </Pill>
              {doc && (
                <button
                  type="button"
                  onClick={() => open(doc.storage_path)}
                  className="text-primary text-xs underline"
                  title={doc.filename}
                >
                  open
                </button>
              )}
              {canApprove && doc && (
                <button
                  type="button"
                  onClick={() => {
                    approveAppointmentDocument(doc.id, !doc.approved)
                      .then(load)
                      .catch((e: Error) => setError(e.message))
                  }}
                  className="text-graphite-light text-xs underline"
                >
                  {doc.approved ? 'unapprove' : 'approve'}
                </button>
              )}
              <label className="text-graphite-light cursor-pointer text-xs underline">
                {busy === s.slot ? 'uploading…' : doc ? 'replace' : 'upload'}
                <input
                  type="file"
                  className="hidden"
                  disabled={busy !== null}
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) upload(s.slot, f)
                    e.target.value = ''
                  }}
                />
              </label>
            </span>
          )
        })}
      </div>
      <p className="text-graphite-light text-[11px]">
        Appointments and scopes only. Drawings are never uploaded — the register keeps a link
        into the CDE.
      </p>
    </div>
  )
}

/**
 * The project directory. Companies hold disciplines; nothing on this page
 * assigns work to a company directly, and the gap list is derived from the same
 * lookup the rest of the application uses.
 */
export function Directory({
  projectId,
  organisationId,
  canEdit,
}: {
  projectId: string
  organisationId: string
  canEdit: boolean
}) {
  const [companies, setCompanies] = useState<ProjectCompany[]>([])
  const [held, setHeld] = useState<{ company_id: string; discipline_code: string }[]>([])
  const [people, setPeople] = useState<ProjectPerson[]>([])
  const [disciplines, setDisciplines] = useState<Disc[]>([])
  const [gaps, setGaps] = useState<{ code: string; name: string }[]>([])
  const [catalogue, setCatalogue] = useState<CatalogueCompany[]>([])
  const [contacts, setContacts] = useState<Record<string, Contact[]>>({})
  const [error, setError] = useState<string | null>(null)

  const [pick, setPick] = useState('')
  const [code, setCode] = useState('')
  const [type, setType] = useState('consultant')

  const load = useCallback(() => {
    Promise.all([
      fetchProjectCompanies(projectId),
      fetchCompanyDisciplines(projectId),
      fetchProjectPeople(projectId),
      fetchProjectDisciplines(projectId),
      fetchDisciplineGaps(projectId),
      fetchCatalogue(organisationId),
    ])
      .then(([c, h, pp, d, g, cat]) => {
        setCompanies(c)
        setHeld(h)
        setPeople(pp)
        setDisciplines(d)
        setGaps(g)
        setCatalogue(cat)
      })
      .catch((e: Error) => setError(e.message))
  }, [projectId, organisationId])

  useEffect(load, [load])

  const act = async (fn: () => Promise<void>) => {
    setError(null)
    try {
      await fn()
      load()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const holdsCode = (companyId: string, c: string) =>
    held.some((h) => h.company_id === companyId && h.discipline_code === c)

  const onProject = new Set(companies.map((c) => c.catalogue_company_id))
  const addable = catalogue.filter((c) => !onProject.has(c.id))

  return (
    <div className="flex flex-col gap-6">
      <ErrorNote message={error} />

      {/* Hi-vis, and this is the only place in the application it appears: a
          discipline this project needs that nobody has been given. */}
      {gaps.length > 0 && (
        <section className="border-hivis bg-hivis-bg text-hivis-ink shadow-hivis rounded-lg border-l-[3px] p-4">
          <h3 className="font-semibold">
            {gaps.length === 1 ? '1 discipline is unallocated' : `${gaps.length} disciplines are unallocated`}
          </h3>
          <p className="mt-1 text-sm">
            Nobody on this project holds{' '}
            {gaps.map((g) => g.name).join(', ')}. Until someone does, it falls to you.
          </p>
        </section>
      )}

      {canEdit && (
        <form
          className="flex flex-wrap items-end gap-2 rounded-lg border p-4"
          onSubmit={(e) => {
            e.preventDefault()
            act(async () => {
              await addCompanyToProject({
                projectId, catalogueCompanyId: pick, originatorCode: code,
                companyType: type, disciplines: [],
              })
              setPick('')
              setCode('')
            })
          }}
        >
          <div className="flex min-w-56 flex-1 flex-col gap-2">
            <Label htmlFor="pick">Add a firm from the catalogue</Label>
            <Select id="pick" required value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">Choose…</option>
              {addable.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </div>
          <div className="flex w-28 flex-col gap-2">
            <Label htmlFor="orig">Code</Label>
            <Input id="orig" required className="font-mono" placeholder="BEL"
              value={code} onChange={(e) => setCode(e.target.value)} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="ctype">Type</Label>
            <Select id="ctype" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="consultant">Consultant</option>
              <option value="subcontractor">Subcontractor</option>
              <option value="contractor">Contractor</option>
              <option value="client">Client</option>
            </Select>
          </div>
          <Button type="submit">Add</Button>
          <p className="text-muted-foreground w-full text-xs">
            The firm's name and address are copied onto this project now. Later edits to the
            catalogue will not change what is recorded here.
          </p>
        </form>
      )}

      {companies.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-4 py-10">
          <p className="text-muted-foreground text-sm">No firms on this project yet.</p>
          {canEdit && (
            <>
              <Button
                variant="outline"
                onClick={() =>
                  act(async () => {
                    await seedSampleProject(projectId)
                  })
                }
              >
                Fill with sample data
              </Button>
              <p className="text-muted-foreground max-w-md text-center text-xs">
                Puts the prototype's demo project in — sixteen firms, twenty-five people, their
                disciplines and appointment documents, with the same deliberate gaps. For trying
                the application out; it only works on an empty project.
              </p>
            </>
          )}
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {companies.map((c) => (
            <li key={c.id} className="flex flex-col gap-3 rounded-lg border p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <p className="font-medium">
                    {c.name}{' '}
                    <Code className="text-graphite-light font-semibold">{c.originator_code}</Code>
                  </p>
                  <p className="text-muted-foreground text-sm">
                    {c.company_type}
                    {c.address && ` · ${c.address}`}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap gap-1">
                {disciplines.filter((d) => d.required).map((d) => {
                  const on = holdsCode(c.id, d.code)
                  return canEdit ? (
                    <button
                      key={d.code}
                      type="button"
                      title={d.name}
                      onClick={() => act(() => setCompanyDiscipline(c.id, d.code, !on))}
                      className={
                        'rounded border px-2 py-0.5 font-mono text-xs transition-colors ' +
                        (on ? 'bg-primary text-primary-foreground border-transparent'
                            : 'text-muted-foreground hover:bg-accent')
                      }
                    >
                      {d.code}
                    </button>
                  ) : (
                    <span key={d.code} title={d.name}
                      className={'rounded border px-2 py-0.5 font-mono text-xs ' +
                        (on ? 'bg-primary text-primary-foreground border-transparent'
                            : 'text-muted-foreground opacity-40')}>
                      {d.code}
                    </span>
                  )
                })}
              </div>

              <AppointmentDocs projectId={projectId} companyId={c.id} canApprove={canEdit} />

              <div className="flex flex-col gap-1 border-t pt-2">
                {people.filter((p) => p.company_id === c.id).length === 0 ? (
                  <p className="text-muted-foreground text-sm">Nobody named yet.</p>
                ) : (
                  people.filter((p) => p.company_id === c.id).map((p) => (
                    <p key={p.id} className="text-sm">
                      <span className="font-medium">{p.name}</span>
                      {p.job_role && <span className="text-muted-foreground"> · {p.job_role}</span>}
                      {p.email && <span className="text-muted-foreground"> · {p.email}</span>}
                      {p.is_primary && (
                        <span className="text-muted-foreground"> · primary contact</span>
                      )}
                    </p>
                  ))
                )}
                {canEdit && c.catalogue_company_id && (
                  <AddPerson
                    companyId={c.id}
                    catalogueCompanyId={c.catalogue_company_id}
                    contacts={contacts[c.catalogue_company_id]}
                    onLoad={(list) =>
                      setContacts((prev) => ({ ...prev, [c.catalogue_company_id!]: list }))
                    }
                    onAdded={load}
                    onError={setError}
                    already={people.filter((p) => p.company_id === c.id).map((p) => p.name)}
                  />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function AddPerson({
  companyId, catalogueCompanyId, contacts, onLoad, onAdded, onError, already,
}: {
  companyId: string
  catalogueCompanyId: string
  contacts: Contact[] | undefined
  onLoad: (c: Contact[]) => void
  onAdded: () => void
  onError: (m: string) => void
  already: string[]
}) {
  const [open, setOpen] = useState(false)
  const [pick, setPick] = useState('')
  const [primary, setPrimary] = useState(false)

  useEffect(() => {
    if (open && !contacts) fetchContacts(catalogueCompanyId).then(onLoad).catch(() => onLoad([]))
  }, [open, contacts, catalogueCompanyId, onLoad])

  if (!open) {
    return (
      <Button variant="ghost" size="sm" className="self-start" onClick={() => setOpen(true)}>
        Add a person
      </Button>
    )
  }

  const choices = (contacts ?? []).filter((c) => !already.includes(c.name))

  return (
    <form
      className="flex flex-wrap items-end gap-2 pt-1"
      onSubmit={(e) => {
        e.preventDefault()
        addPersonToProject(companyId, pick, primary)
          .then(() => {
            setOpen(false)
            setPick('')
            onAdded()
          })
          .catch((err: Error) => onError(err.message))
      }}
    >
      <Select required value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Person">
        <option value="">Choose…</option>
        {choices.map((c) => (
          <option key={c.id} value={c.id}>{c.name}{c.job_role ? ` — ${c.job_role}` : ''}</option>
        ))}
      </Select>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={primary} onChange={(e) => setPrimary(e.target.checked)} />
        Primary contact
      </label>
      <Button type="submit" size="sm">Add</Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      {choices.length === 0 && contacts && (
        <p className="text-muted-foreground w-full text-xs">
          Nobody left to add. People are maintained in the account catalogue.
        </p>
      )}
    </form>
  )
}
