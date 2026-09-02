import { useCallback, useEffect, useMemo, useState } from 'react'

import { ErrorNote } from '@/components/Shell'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select-native'
import {
  DRM_CATEGORY_NAMES, fetchDrmGaps, fetchDrmItems, fetchDrmLeads, fetchProjectDisciplines,
  loadDrmIntoProject, setDrmApplicable, setDrmLead,
  type DrmGap, type DrmItem, type DrmLead,
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

  const load = useCallback(() => {
    Promise.all([
      fetchDrmItems(projectId),
      fetchDrmLeads(projectId),
      fetchDrmGaps(projectId),
      fetchProjectDisciplines(projectId),
    ])
      .then(([i, l, g, d]) => {
        setItems(i)
        setLeads(l)
        setGaps(g)
        setDisciplines(d.filter((x) => x.required))
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [projectId])

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
          <div className="border-hivis bg-hivis-bg text-hivis-ink flex-1 rounded-lg border-l-4 p-3">
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
          <h3 className="text-muted-foreground pt-2 text-sm font-semibold">
            {code} · {DRM_CATEGORY_NAMES[code] ?? code}
          </h3>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-muted-foreground text-left">
                <tr>
                  <th className="px-3 py-2 font-medium">Ref</th>
                  <th className="px-3 py-2 font-medium">Item</th>
                  <th className="px-3 py-2 font-medium">Lead</th>
                  <th className="px-3 py-2 font-medium">Who that is</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((i) => {
                  const gap = gapById.get(i.id)
                  const who = holders.get(i.id) ?? []
                  return (
                    <tr
                      key={i.id}
                      className={
                        'border-t align-top ' +
                        (gap ? 'bg-hivis-bg text-hivis-ink border-l-hivis border-l-4' : '') +
                        (i.applicable ? '' : ' opacity-50')
                      }
                    >
                      <td className="px-3 py-2 font-mono whitespace-nowrap">{i.ref}</td>
                      <td className="px-3 py-2">
                        {i.item}
                        {i.guidance_note && (
                          <span className="text-muted-foreground block text-xs italic">
                            {i.guidance_note}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {canEdit ? (
                          <Select
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
                          <span className="font-mono">{i.lead_discipline ?? '—'}</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {who.length > 0 ? (
                          who.join(', ')
                        ) : (
                          <span className="text-xs">{gap ?? '—'}</span>
                        )}
                        {canEdit && (
                          <button
                            type="button"
                            className="text-muted-foreground mt-1 block text-xs underline"
                            onClick={() => act(() => setDrmApplicable(i.id, !i.applicable))}
                          >
                            {i.applicable ? 'Not applicable to this job' : 'Applicable again'}
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  )
}
