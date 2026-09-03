import { useCallback, useEffect, useMemo, useState } from 'react'

import { ErrorNote } from '@/components/ui/notes'
import { Button } from '@/components/ui/button'
import { Code, Pill, Table, TableScroll, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import {
  DRM_CATEGORY_NAMES, addLibraryItem, fetchAccountDisciplines, fetchAccountLibrary,
  forkLibrary, removeLibraryItem, updateLibraryItem, type Discipline, type LibraryItem,
} from '@/lib/queries'

/**
 * The responsibility matrix template this account starts every project from.
 *
 * Until it takes a copy it is reading the published library; taking the copy is
 * what makes it editable. Editing it afterwards never rewrites a project that
 * has already loaded its own copy — a template is a starting point, not a live
 * link, or changing it would silently rewrite finished jobs.
 */
export function DrmLibrary({
  organisationId, canEdit,
}: { organisationId: string; canEdit: boolean }) {
  const [rows, setRows] = useState<LibraryItem[]>([])
  const [disciplines, setDisciplines] = useState<Discipline[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [openCat, setOpenCat] = useState<string | null>(null)
  const [ref, setRef] = useState('')
  const [item, setItem] = useState('')
  const [lead, setLead] = useState('')

  const load = useCallback(() => {
    Promise.all([fetchAccountLibrary(organisationId), fetchAccountDisciplines(organisationId)])
      .then(([l, d]) => { setRows(l); setDisciplines(d) })
      .catch((e: Error) => setError(e.message))
  }, [organisationId])

  useEffect(load, [load])

  const forked = rows.some((r) => r.forked)
  const editable = canEdit && forked
  const guard = (p: Promise<unknown>) =>
    p.then(load).catch((e: Error) => setError(e.message))

  const byCategory = useMemo(() => {
    const m = new Map<string, LibraryItem[]>()
    for (const r of rows) m.set(r.category_code, [...(m.get(r.category_code) ?? []), r])
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [rows])

  return (
    <div className="flex flex-col gap-4">
      <ErrorNote message={error} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground max-w-prose text-sm">
          {forked
            ? `Your own library — ${rows.length} items. Editing it affects projects set up from now on; a project keeps the copy it loaded.`
            : `The published library — ${rows.length} items. Take a copy to make it yours.`}
        </p>
        {canEdit && !forked && (
          <Button
            disabled={busy}
            onClick={() => {
              setBusy(true); setError(null)
              forkLibrary(organisationId)
                .then(load)
                .catch((e: Error) => setError(e.message))
                .finally(() => setBusy(false))
            }}
          >
            Take a copy
          </Button>
        )}
      </div>

      {byCategory.map(([cat, list]) => (
        <section key={cat}>
          <button
            type="button"
            onClick={() => setOpenCat(openCat === cat ? null : cat)}
            className="mb-1 flex w-full items-center gap-2 text-left text-sm font-semibold"
          >
            <span className="text-graphite">{openCat === cat ? '▾' : '▸'}</span>
            <Code>{cat}</Code>
            <span>{DRM_CATEGORY_NAMES[cat] ?? cat}</span>
            <span className="text-graphite text-xs font-normal">{list.length}</span>
          </button>

          {openCat === cat && (
            <>
              <TableScroll>
                <Table>
                  <THead>
                    <TR>
                      <TH className="w-[76px]">Ref</TH>
                      <TH>Item</TH>
                      <TH className="w-[120px]">Default lead</TH>
                      <TH className="w-[60px]">CDP</TH>
                      {editable && <TH className="w-[80px]" />}
                    </TR>
                  </THead>
                  <TBody>
                    {list.map((r) => (
                      <TR key={r.id}>
                        <TD><Code className="text-xs">{r.ref}</Code></TD>
                        <TD>
                          {editable ? (
                            <input
                              defaultValue={r.item}
                              onBlur={(e) => {
                                const v = e.target.value.trim()
                                if (v && v !== r.item) guard(updateLibraryItem(r.id, { item: v }))
                              }}
                              className="border-rule w-full rounded border px-2 py-1 text-sm"
                              aria-label={`Item ${r.ref}`}
                            />
                          ) : r.item}
                        </TD>
                        <TD>
                          {editable ? (
                            <select
                              defaultValue={r.default_lead_discipline ?? ''}
                              onChange={(e) => guard(updateLibraryItem(r.id, {
                                default_lead_discipline: e.target.value || null,
                              }))}
                              className="border-rule w-full rounded border px-1 py-1 text-xs"
                              aria-label={`Default lead for ${r.ref}`}
                            >
                              <option value="">— none —</option>
                              {disciplines.map((d) => (
                                <option key={d.code} value={d.code}>{d.code}</option>
                              ))}
                            </select>
                          ) : (
                            <Code className="text-xs">{r.default_lead_discipline ?? '—'}</Code>
                          )}
                        </TD>
                        <TD>
                          {editable ? (
                            <input
                              type="checkbox"
                              defaultChecked={r.cdp_likely}
                              onChange={(e) =>
                                guard(updateLibraryItem(r.id, { cdp_likely: e.target.checked }))}
                              aria-label={`CDP likely for ${r.ref}`}
                            />
                          ) : r.cdp_likely ? <Pill tone="neutral">CDP</Pill> : null}
                        </TD>
                        {editable && (
                          <TD>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => guard(removeLibraryItem(r.id))}
                            >
                              Remove
                            </Button>
                          </TD>
                        )}
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableScroll>

              {editable && (
                <form
                  className="border-rule mt-2 flex flex-wrap items-end gap-2 rounded-lg border p-3"
                  onSubmit={(e) => {
                    e.preventDefault()
                    if (!ref.trim() || !item.trim()) return
                    guard(addLibraryItem(organisationId, {
                      ref: ref.trim(), category_code: cat, item: item.trim(),
                      default_lead_discipline: lead || null, cdp_likely: false,
                    })).then(() => { setRef(''); setItem(''); setLead('') })
                  }}
                >
                  <label>
                    <span className="mb-1 block text-xs font-medium">Ref</span>
                    <input value={ref} onChange={(e) => setRef(e.target.value)}
                      placeholder={`${cat}.999`}
                      className="border-rule w-24 rounded border px-2 py-1.5 font-mono text-sm" />
                  </label>
                  <label className="min-w-56 flex-1">
                    <span className="mb-1 block text-xs font-medium">Item</span>
                    <input value={item} onChange={(e) => setItem(e.target.value)}
                      className="border-rule w-full rounded border px-2 py-1.5 text-sm" />
                  </label>
                  <label>
                    <span className="mb-1 block text-xs font-medium">Default lead</span>
                    <select value={lead} onChange={(e) => setLead(e.target.value)}
                      className="border-rule rounded border px-2 py-1.5 text-sm">
                      <option value="">— none —</option>
                      {disciplines.map((d) => (
                        <option key={d.code} value={d.code}>{d.code} · {d.name}</option>
                      ))}
                    </select>
                  </label>
                  <Button size="sm" type="submit" disabled={!ref.trim() || !item.trim()}>
                    Add
                  </Button>
                </form>
              )}
            </>
          )}
        </section>
      ))}
    </div>
  )
}
