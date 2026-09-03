import { useCallback, useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Panel } from '@/components/ui/panel'
import { Code, Pill, Table, TableScroll, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import {
  TRACKED_STATUSES, acceptResponse, addTrackedItem, deleteTrackedItem, fetchProjectCompanies,
  fetchTrackedItems, loadChecklist, setResponse, updateTrackedItem,
  type ProjectCompany, type TrackedItem,
} from '@/lib/queries'

/**
 * One list, every kind.
 *
 * Planning conditions, building control items, scope lines and all five
 * checklists are the same record with a different `kind`, so they are the same
 * screen. The only thing that varies is the vocabulary — a planning condition
 * is discharged, a checklist item is complete — and that is a lookup, not a
 * second component.
 */
const fmt = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })
    : '—'

export function TrackedList({
  projectId, kind, canEdit, checklistType,
}: {
  projectId: string
  kind: string
  canEdit: boolean
  /** Set for a checklist kind, so the list can offer to load its template. */
  checklistType?: string
}) {
  const [rows, setRows] = useState<TrackedItem[]>([])
  const [companies, setCompanies] = useState<ProjectCompany[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [showStruck, setShowStruck] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [adding, setAdding] = useState(false)

  const statuses = TRACKED_STATUSES[kind.split(':')[0]] ?? TRACKED_STATUSES.default

  const load = useCallback(() => {
    Promise.all([fetchTrackedItems(projectId, kind), fetchProjectCompanies(projectId)])
      .then(([r, c]) => { setRows(r); setCompanies(c); setError(null) })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [projectId, kind])

  useEffect(load, [load])

  const guard = (p: Promise<unknown>) =>
    p.then(load).catch((e: Error) => setError(e.message))

  const visible = useMemo(
    () => (showStruck ? rows : rows.filter((r) => r.required)), [rows, showStruck])
  const struck = rows.filter((r) => !r.required).length
  const total = rows.filter((r) => r.required).length
  const done = rows.filter((r) => r.required && r.is_done).length

  if (loading) return <div className="text-graphite p-6 text-sm">Loading…</div>

  return (
    <>
      {error && (
        <Panel kind="comply" className="mb-4">
          <p className="text-stop text-sm">{error}</p>
        </Panel>
      )}
      {note && (
        <Panel kind="evidence" className="mb-4"><p className="text-sm">{note}</p></Panel>
      )}

      {rows.length === 0 ? (
        <Panel title="Nothing loaded yet">
          <p className="text-graphite mb-3 max-w-prose text-sm">
            {checklistType
              ? 'Load the template to start. The project takes a copy — editing the template afterwards never rewrites a project that has already loaded from it.'
              : 'Nothing here yet. Items can be added one at a time, or imported.'}
          </p>
          {canEdit && checklistType && (
            <Button
              size="sm"
              onClick={() => guard(loadChecklist(projectId, checklistType).then((o) => {
                setNote(`${o.added} items loaded, ${o.pre_assigned} pre-assigned to the only ` +
                  'company holding their discipline. The rest are blank on purpose — two ' +
                  'holders means somebody has to decide.')
              }))}
            >
              Load the template
            </Button>
          )}
        </Panel>
      ) : (
        <Panel
          title={`${done} of ${total} done`}
          actions={
            <div className="flex gap-1">
              {struck > 0 && (
                <Button
                  size="sm"
                  variant={showStruck ? 'secondary' : 'ghost'}
                  onClick={() => setShowStruck((v) => !v)}
                >
                  {showStruck ? 'Hide' : 'Show'} {struck} struck out
                </Button>
              )}
              {canEdit && (
                <Button size="sm" variant="ghost" onClick={() => setAdding(true)}>
                  Add an item
                </Button>
              )}
            </div>
          }
        >
          <TableScroll>
            <Table>
              <THead>
                <TR>
                  <TH className="w-[92px]">Ref</TH>
                  <TH>Item</TH>
                  <TH className="w-[150px]">Who</TH>
                  <TH className="w-[96px]">Due</TH>
                  <TH className="w-[150px]">Status</TH>
                  <TH className="w-[70px]" />
                </TR>
              </THead>
              <TBody>
                {visible.map((r) => (
                  <TR key={r.id} muted={!r.required}>
                    <TD>
                      <Code className={!r.required ? 'text-xs line-through' : 'text-xs'}>
                        {r.ext?.template_reference as string ?? r.reference}
                      </Code>
                    </TD>
                    <TD>
                      <div className={!r.required ? 'line-through' : undefined}>
                        {r.heading && (
                          <span className="text-graphite mr-1.5 text-xs">{r.heading} ·</span>
                        )}
                        {r.title}
                      </div>
                      {r.prompt && (
                        <div className="text-graphite-light mt-0.5 text-xs italic">{r.prompt}</div>
                      )}

                      {editing === r.id ? (
                        <form
                          className="mt-1.5 flex flex-col gap-1.5"
                          onSubmit={(e) => {
                            e.preventDefault()
                            guard(setResponse(r.id, draft)).then(() => setEditing(null))
                          }}
                        >
                          <textarea
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            rows={2}
                            className="border-rule w-full rounded border px-2 py-1 text-sm"
                          />
                          <div className="flex gap-1.5">
                            <Button size="sm" type="submit">Save the answer</Button>
                            <Button size="sm" variant="ghost" type="button"
                              onClick={() => setEditing(null)}>Cancel</Button>
                          </div>
                        </form>
                      ) : r.response ? (
                        <div className="border-rule bg-surface-2 mt-1.5 rounded border-l-[3px] px-2 py-1">
                          <p className="text-sm">{r.response}</p>
                          {r.awaiting_acceptance && (
                            <div className="mt-1 flex items-center gap-2">
                              <Pill tone="warn">Suggested — not yet accepted</Pill>
                              {canEdit && (
                                <button
                                  type="button"
                                  onClick={() => guard(acceptResponse(r.id))}
                                  className="text-graphite text-xs underline"
                                >
                                  Accept as the answer
                                </button>
                              )}
                            </div>
                          )}
                          <button
                            type="button"
                            onClick={() => { setEditing(r.id); setDraft(r.response ?? '') }}
                            className="text-graphite mt-1 text-xs underline"
                          >
                            Edit
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => { setEditing(r.id); setDraft('') }}
                          className="text-graphite mt-1 text-xs underline"
                        >
                          Answer this
                        </button>
                      )}
                    </TD>
                    <TD>
                      {canEdit ? (
                        <select
                          value={r.company_id ?? ''}
                          onChange={(e) =>
                            guard(updateTrackedItem(r.id, { company_id: e.target.value || null }))}
                          className="border-rule w-full rounded border px-1 py-1 text-xs"
                          aria-label={`Who owns ${r.reference}`}
                        >
                          <option value="">— nobody —</option>
                          {companies.map((c) => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </select>
                      ) : (
                        r.company_name ?? <span className="text-graphite text-xs">—</span>
                      )}
                      {r.discipline && r.holders !== 1 && (
                        <div className="text-graphite mt-0.5 text-[11px]">
                          {r.holders === 0
                            ? `nobody holds ${r.discipline}`
                            : `${r.holders} hold ${r.discipline}`}
                        </div>
                      )}
                    </TD>
                    <TD>
                      <Code className="text-graphite text-xs">{fmt(r.due)}</Code>
                      {r.overdue && <Pill tone="stop" className="mt-0.5">Overdue</Pill>}
                    </TD>
                    <TD>
                      {canEdit ? (
                        <select
                          value={r.status}
                          onChange={(e) =>
                            guard(updateTrackedItem(r.id, { status: e.target.value }))}
                          className="border-rule w-full rounded border px-1 py-1 text-xs"
                          aria-label={`Status of ${r.reference}`}
                        >
                          {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      ) : r.is_done ? (
                        <Pill tone="ok">{r.status}</Pill>
                      ) : (
                        <Pill tone="neutral">{r.status}</Pill>
                      )}
                    </TD>
                    <TD>
                      {canEdit && (
                        r.custom ? (
                          <button
                            type="button"
                            onClick={() => guard(deleteTrackedItem(r.id))}
                            className="text-graphite text-xs underline"
                            title="Added on this project, so it can be removed"
                          >
                            Delete
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => guard(updateTrackedItem(r.id, { required: !r.required }))}
                            className="text-graphite text-xs underline"
                            title={r.required
                              ? 'Strike it out: drops from the total but stays on the page, so the decision survives'
                              : 'Put it back in the total'}
                          >
                            {r.required ? 'Strike out' : 'Restore'}
                          </button>
                        )
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableScroll>

          <p className="text-graphite mt-3 max-w-prose text-xs">
            A struck-out template row leaves the total but stays on the page — deleting it would
            lose the decision that it was not needed, which is precisely what gets asked about
            later. Only a row added on this project can be deleted.
          </p>
        </Panel>
      )}

      {adding && (
        <AddItem
          kind={kind}
          onClose={() => setAdding(false)}
          onAdd={(row) => guard(addTrackedItem(projectId, { kind, ...row }))
            .then(() => setAdding(false))}
        />
      )}
    </>
  )
}

function AddItem({
  kind, onClose, onAdd,
}: {
  kind: string
  onClose: () => void
  onAdd: (row: { reference: string; heading: string | null
    title: string; discipline: string | null }) => void
}) {
  const [reference, setReference] = useState('')
  const [heading, setHeading] = useState('')
  const [title, setTitle] = useState('')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6 backdrop-blur-sm">
      <form
        className="glass-popover w-full max-w-[480px] rounded-lg p-5"
        onSubmit={(e) => {
          e.preventDefault()
          // Refuses empty input rather than creating a blank row.
          if (!reference.trim() || !title.trim()) return
          onAdd({
            reference: reference.trim(),
            heading: heading.trim() || null,
            title: title.trim(),
            discipline: null,
          })
        }}
      >
        <h2 className="mb-1 text-base font-semibold">Add an item</h2>
        <p className="text-graphite mb-3 text-xs">
          Added on this project only. It never enters the template every future project starts
          from, and unlike a template row it can be deleted.
        </p>

        <div className="mb-3 flex gap-2">
          <label className="w-[120px]">
            <span className="mb-1 block text-sm font-medium">Reference</span>
            <input value={reference} onChange={(e) => setReference(e.target.value)}
              placeholder={`${kind.slice(0, 2).toUpperCase()}-900`}
              className="border-rule w-full rounded border px-2 py-2 font-mono text-sm" />
          </label>
          <label className="flex-1">
            <span className="mb-1 block text-sm font-medium">Heading</span>
            <input value={heading} onChange={(e) => setHeading(e.target.value)}
              className="border-rule w-full rounded border px-3 py-2 text-sm" />
          </label>
        </div>

        <label className="mb-4 block">
          <span className="mb-1 block text-sm font-medium">Item</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)}
            className="border-rule w-full rounded border px-3 py-2 text-sm" />
        </label>

        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" type="button" onClick={onClose}>Cancel</Button>
          <Button size="sm" type="submit" disabled={!reference.trim() || !title.trim()}>
            Add
          </Button>
        </div>
      </form>
    </div>
  )
}
