import { useCallback, useEffect, useMemo, useState } from 'react'

import { DrmItemDetail } from '@/components/DrmItemDetail'
import { ErrorNote } from '@/components/Shell'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select-native'
import { Code, Pill, Table, TableScroll, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import {
  DRM_CATEGORY_NAMES, addBespokeDrmItem, fetchDrmGaps, fetchDrmItems, fetchDrmLeads,
  fetchDrmRoles, fetchProjectDisciplines, loadDrmIntoProject, setDrmApplicable, setDrmLead,
  type DrmGap, type DrmItem, type DrmLead, type DrmRole,
} from '@/lib/queries'

type Disc = { code: string; name: string; required: boolean }

/**
 * The design responsibility matrix.
 *
 * Every row names a lead DISCIPLINE. The company beside it is resolved live
 * through the directory and is never stored here — which is why novating a
 * consultant moves every item they led without this table being touched.
 *
 * A gap is hi-vis, and it is two different failures: an item nobody has been
 * given, and an item given to a discipline nobody has appointed. The row says
 * which, because the fix is different.
 */
export function Matrix({
  projectId,
  canEdit,
}: {
  projectId: string
  canEdit: boolean
}) {
  const [items, setItems] = useState<DrmItem[]>([])
  const [leads, setLeads] = useState<DrmLead[]>([])
  const [gaps, setGaps] = useState<DrmGap[]>([])
  const [disciplines, setDisciplines] = useState<Disc[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [onlyGaps, setOnlyGaps] = useState(false)
  const [roles, setRoles] = useState<DrmRole[]>([])
  const [detail, setDetail] = useState<DrmItem | null>(null)
  const [addingTo, setAddingTo] = useState<string | null>(null)
  const [newRef, setNewRef] = useState('')
  const [newItem, setNewItem] = useState('')
  const [newLead, setNewLead] = useState('')

  const load = useCallback(() => {
    Promise.all([
      fetchDrmItems(projectId),
      fetchDrmLeads(projectId),
      fetchDrmGaps(projectId),
      fetchProjectDisciplines(projectId),
      fetchDrmRoles(projectId),
    ])
      .then(([i, l, g, d, r]) => {
        setItems(i)
        setLeads(l)
        setGaps(g)
        setDisciplines(d.filter((x) => x.required))
        setRoles(r)
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [projectId])

  useEffect(load, [load])

  // How many disciplines sit beside the lead on each item, so the matrix says
  // at a glance which rows have a supporting cast and which are one firm alone.
  const roleCount = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of roles) m.set(r.drm_item_id, (m.get(r.drm_item_id) ?? 0) + 1)
    return m
  }, [roles])

  const act = async (fn: () => Promise<void>) => {
    setError(null)
    try {
      await fn()
      load()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  /** company names per item, from the live lookup */
  const holders = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const l of leads) {
      if (!l.company_name) continue
      m.set(l.drm_item_id, [...(m.get(l.drm_item_id) ?? []), l.company_name])
    }
    return m
  }, [leads])

  const gapById = useMemo(
    () => new Map(gaps.map((g) => [g.drm_item_id, g.gap_reason])),
    [gaps]
  )

  const shown = onlyGaps ? items.filter((i) => gapById.has(i.id)) : items

  const byCategory = useMemo(() => {
    const m = new Map<string, DrmItem[]>()
    for (const i of shown) m.set(i.category_code, [...(m.get(i.category_code) ?? []), i])
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [shown])

  if (loading) return <p className="text-muted-foreground text-sm">Loading…</p>

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-4 py-10">
        <ErrorNote message={error} />
        <p className="text-muted-foreground text-sm">No matrix on this project yet.</p>
        {canEdit && (
          <>
            <Button onClick={() => act(async () => { await loadDrmIntoProject(projectId) })}>
              Load the standard matrix
            </Button>
            <p className="text-muted-foreground max-w-md text-center text-xs">
              Takes a copy of your account's library — a hundred items across nine categories,
              with their default lead disciplines. The copy is yours from then on: editing the
              library later will not change this project.
            </p>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <ErrorNote message={error} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        {gaps.length === 0 ? (
          <p className="text-sm">Every applicable item has a lead who is appointed.</p>
        ) : (
          <div className="border-hivis bg-hivis-bg text-hivis-ink shadow-hivis flex-1 rounded-lg border-l-[3px] p-3">
            <p className="font-semibold">
              {gaps.length === 1 ? '1 gap' : `${gaps.length} gaps`}
            </p>
            <p className="text-sm">
              {gaps.filter((g) => !g.lead_discipline).length} with nobody named,{' '}
              {gaps.filter((g) => g.lead_discipline).length} named to a discipline nobody holds.
            </p>
          </div>
        )}
        <Button variant={onlyGaps ? 'default' : 'outline'} size="sm"
          onClick={() => setOnlyGaps(!onlyGaps)}>
          {onlyGaps ? 'Show all items' : 'Show only gaps'}
        </Button>
      </div>

      {byCategory.map(([code, rows]) => (
        <section key={code} className="flex flex-col gap-1">
          <h3 className="text-graphite-light pt-2 text-[11px] font-bold tracking-[0.08em] uppercase">
            <span className="font-mono">{code}</span> · {DRM_CATEGORY_NAMES[code] ?? code}
          </h3>
          <TableScroll>
            <Table>
              <THead>
                <tr>
                  <TH className="w-20">Ref</TH>
                  <TH>Item</TH>
                  <TH className="w-56">Lead</TH>
                  <TH className="w-64">Who that is</TH>
                </tr>
              </THead>
              <TBody>
                {rows.map((i) => {
                  const gap = gapById.get(i.id)
                  const who = holders.get(i.id) ?? []
                  return (
                    <TR key={i.id} gap={Boolean(gap)} muted={!i.applicable}>
                      <TD>
                        <button
                          type="button"
                          onClick={() => setDetail(i)}
                          className="text-primary cursor-pointer hover:underline"
                          aria-label={`Open ${i.ref}`}
                        >
                          <Code className="font-semibold">{i.ref}</Code>
                        </button>
                        {(roleCount.get(i.id) ?? 0) > 0 && (
                          <span
                            className="text-graphite ml-1.5 text-[10px]"
                            title={`${roleCount.get(i.id)} other disciplines involved`}
                          >
                            +{roleCount.get(i.id)}
                          </span>
                        )}
                      </TD>
                      <TD>
                        {i.item}
                        {i.guidance_note && (
                          <span className="text-graphite-light mt-0.5 block text-xs italic">
                            {i.guidance_note}
                          </span>
                        )}
                      </TD>
                      <TD>
                        {canEdit ? (
                          <Select
                            className="w-full"
                            value={i.lead_discipline ?? ''}
                            onChange={(e) =>
                              act(() => setDrmLead(i.id, e.target.value || null))
                            }
                            aria-label={`Lead discipline for ${i.ref}`}
                          >
                            <option value="">— nobody —</option>
                            {disciplines.map((d) => (
                              <option key={d.code} value={d.code}>
                                {d.code} · {d.name}
                              </option>
                            ))}
                          </Select>
                        ) : (
                          <Code className="font-semibold">{i.lead_discipline ?? '—'}</Code>
                        )}
                      </TD>
                      <TD>
                        {who.length > 0 ? (
                          who.join(', ')
                        ) : gap ? (
                          <Pill tone="gap">
                            {i.lead_discipline ? 'not appointed' : 'nobody named'}
                          </Pill>
                        ) : (
                          <span className="text-graphite-light">—</span>
                        )}
                        {canEdit && (
                          <button
                            type="button"
                            className="text-graphite-light mt-1 block text-xs underline"
                            onClick={() => act(() => setDrmApplicable(i.id, !i.applicable))}
                          >
                            {i.applicable ? 'Not applicable to this job' : 'Applicable again'}
                          </button>
                        )}
                      </TD>
                    </TR>
                  )
                })}
              </TBody>
            </Table>
          </TableScroll>

          {canEdit && (
            addingTo === code ? (
              <form
                className="border-rule mt-1 flex flex-wrap items-end gap-2 rounded-lg border p-3"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (!newRef.trim() || !newItem.trim()) return
                  act(() => addBespokeDrmItem(projectId, {
                    ref: newRef.trim(), category_code: code, item: newItem.trim(),
                    lead_discipline: newLead || null,
                  })).then(() => {
                    setNewRef(''); setNewItem(''); setNewLead(''); setAddingTo(null)
                  })
                }}
              >
                <label>
                  <span className="mb-1 block text-xs font-medium">Ref</span>
                  <input value={newRef} onChange={(e) => setNewRef(e.target.value)}
                    placeholder={`${code}.900`}
                    className="border-rule w-24 rounded border px-2 py-1.5 font-mono text-sm" />
                </label>
                <label className="min-w-56 flex-1">
                  <span className="mb-1 block text-xs font-medium">Item</span>
                  <input value={newItem} onChange={(e) => setNewItem(e.target.value)}
                    className="border-rule w-full rounded border px-2 py-1.5 text-sm" />
                </label>
                <label>
                  <span className="mb-1 block text-xs font-medium">Lead</span>
                  <Select value={newLead} onChange={(e) => setNewLead(e.target.value)}>
                    <option value="">— nobody —</option>
                    {disciplines.map((d) => (
                      <option key={d.code} value={d.code}>{d.code} · {d.name}</option>
                    ))}
                  </Select>
                </label>
                <Button type="submit" disabled={!newRef.trim() || !newItem.trim()}>Add</Button>
                <Button type="button" variant="ghost" onClick={() => setAddingTo(null)}>
                  Cancel
                </Button>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => setAddingTo(code)}
                className="text-graphite-light mt-1 self-start text-xs underline"
              >
                Add an item to this section
              </button>
            )
          )}
        </section>
      ))}

      {detail && (
        <DrmItemDetail
          item={detail}
          disciplines={disciplines}
          leads={leads}
          canEdit={canEdit}
          onClose={() => setDetail(null)}
          onChanged={load}
        />
      )}
    </div>
  )
}
