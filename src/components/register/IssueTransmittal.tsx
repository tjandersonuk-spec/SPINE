import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Code, Table, TableScroll, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import {
  fetchDirectoryPeople, issueTransmittal, type Pack, type Recipient,
} from '@/lib/queries'

/**
 * Issue a pack.
 *
 * Distribution follows the same rule as everywhere else in the product: leave
 * it empty and the whole project sees the transmittal; name people and it is
 * those people, plus the host and the raiser either way. So an empty list is a
 * deliberate choice, not an unfinished form, and the dialog says so.
 */
type Person = {
  id: string; company_id: string; name: string
  job_role: string | null; email: string | null; company_name: string
}

const METHODS = ['Email', 'CDE', 'Post', 'Hand delivery']

export function IssueTransmittal({
  projectId, pack, onClose, onIssued,
}: {
  projectId: string
  pack: Pack
  onClose: () => void
  onIssued: (reference: string, count: number) => void
}) {
  const [people, setPeople] = useState<Person[]>([])
  const [picked, setPicked] = useState<Map<string, 'action' | 'information'>>(new Map())
  const [method, setMethod] = useState('Email')
  const [reason, setReason] = useState(pack.name)
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchDirectoryPeople(projectId)
      .then(setPeople)
      .catch((e: Error) => setError(e.message))
  }, [projectId])

  const toggle = (p: Person) => setPicked((prev) => {
    const next = new Map(prev)
    if (next.has(p.id)) next.delete(p.id)
    else next.set(p.id, 'information')
    return next
  })

  const issue = async () => {
    setBusy(true); setError(null)
    try {
      const recipients: Recipient[] = people
        .filter((p) => picked.has(p.id))
        .map((p) => ({
          company_id: p.company_id,
          person_id: p.id,
          distribution: picked.get(p.id) ?? 'information',
        }))
      const out = await issueTransmittal(projectId, {
        method, reason: reason.trim() || null, notes: notes.trim() || null,
        packId: pack.id, drawingIds: null, recipients,
      })
      onIssued(out.reference, out.drawing_count)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  // Grouped by firm, because that is how a distribution list is read.
  const byCompany = people.reduce<Map<string, Person[]>>((m, p) => {
    m.set(p.company_name, [...(m.get(p.company_name) ?? []), p])
    return m
  }, new Map())

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-6 backdrop-blur-sm">
      <div
        className="glass-popover w-full max-w-[720px] rounded-lg"
        role="dialog"
        aria-label={`Issue ${pack.name}`}
      >
        <header className="border-rule flex items-center justify-between border-b px-5 py-4">
          <div>
            <Code className="text-graphite text-xs">{pack.reference}</Code>
            <h2 className="text-base font-semibold">Issue “{pack.name}”</h2>
          </div>
          <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close">✕</Button>
        </header>

        <div className="max-h-[66vh] overflow-y-auto px-5 py-4">
          {error && (
            <p className="border-stop bg-stop-bg text-stop mb-3 rounded border-l-[3px] px-3 py-2 text-sm">
              {error}
            </p>
          )}

          <p className="text-graphite mb-4 max-w-prose text-sm">
            Each drawing is frozen at the revision it stands at right now. Revising one afterwards
            shows on the pack as “revised since issue” — it never changes what this transmittal
            says was sent.
          </p>

          <div className="mb-3 flex flex-wrap gap-2">
            <label className="w-[150px]">
              <span className="mb-1 block text-sm font-medium">Method</span>
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                className="border-rule w-full rounded border px-2 py-2 text-sm"
              >
                {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>
            <label className="flex-1">
              <span className="mb-1 block text-sm font-medium">Reason for issue</span>
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="For construction"
                className="border-rule w-full rounded border px-3 py-2 text-sm"
              />
            </label>
          </div>

          <label className="mb-4 block">
            <span className="mb-1 block text-sm font-medium">Notes</span>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="border-rule w-full rounded border px-3 py-2 text-sm"
            />
          </label>

          <h3 className="mb-1 text-sm font-semibold">Distribution</h3>
          <p className="text-graphite mb-3 max-w-prose text-xs">
            {picked.size === 0
              ? 'Nobody named, so everyone on the project sees this transmittal. That is a valid choice — name people only when it should be narrower.'
              : `${picked.size} named. Only these people see it, plus the contractor and whoever issues it.`}
          </p>

          {people.length === 0 ? (
            <p className="text-graphite text-sm">
              Nobody is in the project directory yet, so this will go out to the whole project.
            </p>
          ) : (
            <TableScroll>
              <Table>
                <THead>
                  <TR>
                    <TH className="w-[38px]" aria-label="Include" />
                    <TH>Person</TH>
                    <TH className="w-[150px]">Role</TH>
                    <TH className="w-[150px]">For</TH>
                  </TR>
                </THead>
                <TBody>
                  {[...byCompany.entries()].map(([company, list]) => (
                    <>
                      <TR key={company} muted>
                        <TD colSpan={4} className="bg-surface-2 text-graphite text-[11px] font-bold tracking-[0.06em] uppercase">
                          {company}
                        </TD>
                      </TR>
                      {list.map((p) => (
                        <TR key={p.id}>
                          <TD>
                            <input
                              type="checkbox"
                              checked={picked.has(p.id)}
                              onChange={() => toggle(p)}
                              aria-label={`Include ${p.name}`}
                            />
                          </TD>
                          <TD>
                            {p.name}
                            {p.email && (
                              <span className="text-graphite ml-1.5 text-xs">{p.email}</span>
                            )}
                          </TD>
                          <TD className="text-graphite text-xs">{p.job_role ?? '—'}</TD>
                          <TD>
                            <select
                              value={picked.get(p.id) ?? 'information'}
                              disabled={!picked.has(p.id)}
                              onChange={(e) => setPicked((prev) => {
                                const next = new Map(prev)
                                next.set(p.id, e.target.value as 'action' | 'information')
                                return next
                              })}
                              className="border-rule w-full rounded border px-2 py-1 text-xs disabled:opacity-40"
                              aria-label={`Distribution for ${p.name}`}
                            >
                              <option value="information">Information</option>
                              <option value="action">Action</option>
                            </select>
                          </TD>
                        </TR>
                      ))}
                    </>
                  ))}
                </TBody>
              </Table>
            </TableScroll>
          )}
        </div>

        <footer className="border-rule flex items-center justify-end gap-2 border-t px-5 py-3">
          <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={busy} onClick={() => void issue()}>
            {busy ? 'Issuing…' : 'Issue'}
          </Button>
        </footer>
      </div>
    </div>
  )
}
