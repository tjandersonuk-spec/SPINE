import { useCallback, useEffect, useState } from 'react'
import { useOutletContext, useParams } from 'react-router'

import { BreeamReport } from '@/components/breeam/BreeamReport'
import { BreeamScheme } from '@/components/breeam/BreeamScheme'
import { BreeamTracker } from '@/components/breeam/BreeamTracker'
import { RequireModule } from '@/components/shell/RequireModule'
import { Button } from '@/components/ui/button'
import { Panel, PageHead } from '@/components/ui/panel'
import {
  fetchActiveBreeamScheme, fetchBreeamSchemes, type BreeamScheme as Scheme,
} from '@/lib/queries'
import type { ProjectContext } from '@/pages/project/ProjectLayout'

/**
 * BREEAM.
 *
 * The scheme framework is loaded per project from whoever holds the licence —
 * usually the AP's own tracker. No BREEAM wording ships with this product. What
 * it adds is the rest of the project around the credits: owners, programme
 * dates, evidence, and a score that is derived rather than typed.
 */
type Tab = 'tracker' | 'report' | 'scheme'

export default function BreeamPage() {
  const { id = '' } = useParams()
  const ctx = useOutletContext<ProjectContext>()
  const [schemes, setSchemes] = useState<Scheme[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('tracker')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Bumped whenever a child changes the data, so the other tabs reload.
  const [version, setVersion] = useState(0)

  const load = useCallback(() => {
    Promise.all([fetchBreeamSchemes(id), fetchActiveBreeamScheme(id)])
      .then(([s, a]) => { setSchemes(s); setActiveId(a); setError(null) })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [id])

  useEffect(load, [load])

  const changed = () => { load(); setVersion((v) => v + 1) }
  const active = schemes.find((s) => s.id === activeId) ?? null

  if (loading) return <div className="text-graphite p-6 text-sm">Loading…</div>

  return (
    <RequireModule module="breeam">
      <PageHead
        eyebrow="Compliance"
        title="BREEAM"
        meta={active
          ? `${active.version}${active.name ? ' — ' + active.name : ''}${active.building_type ? ' · ' + active.building_type : ''}`
          : 'The framework is loaded per project by whoever holds the licence.'}
        actions={
          <div className="flex gap-1">
            {([['tracker', 'Tracker'], ['report', 'Score report'], ['scheme', 'Scheme setup']] as
              [Tab, string][]).map(([k, label]) => (
              <Button
                key={k}
                size="sm"
                variant={tab === k ? 'secondary' : 'ghost'}
                // A tab clicked while active is a no-op.
                onClick={() => { if (tab !== k) setTab(k) }}
              >
                {label}
              </Button>
            ))}
          </div>
        }
      />

      {error && (
        <Panel kind="comply" className="mb-4"><p className="text-stop text-sm">{error}</p></Panel>
      )}

      {!active && tab !== 'scheme' ? (
        <Panel title="No BREEAM scheme set up on this project">
          <p className="text-graphite mb-3 max-w-prose text-sm">
            The tables start empty by design. BREEAM's technical manual is BRE copyright with
            controlled access, so none of its wording, criteria or credit structure ships here.
            Add a scheme and load the assessor's tracker through the three templates.
          </p>
          {ctx.canEdit && (
            <Button size="sm" onClick={() => setTab('scheme')}>Set up a scheme</Button>
          )}
        </Panel>
      ) : tab === 'scheme' ? (
        <BreeamScheme
          projectId={id}
          schemes={schemes}
          activeId={activeId}
          canEdit={ctx.canEdit}
          onChanged={changed}
        />
      ) : tab === 'report' && active ? (
        <BreeamReport key={`${active.id}-${version}`} projectId={id} scheme={active} />
      ) : active ? (
        <BreeamTracker
          key={`${active.id}-${version}`}
          projectId={id}
          schemeId={active.id}
          canEdit={ctx.canEdit}
          onChanged={changed}
        />
      ) : null}
    </RequireModule>
  )
}
