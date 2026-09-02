import { useCallback, useEffect, useMemo, useState } from 'react'
import { useOutletContext, useParams } from 'react-router'

import { ImportProgramme } from '@/components/programme/ImportProgramme'
import { LineInspector } from '@/components/programme/LineInspector'
import { Button } from '@/components/ui/button'
import { Panel, PageHead } from '@/components/ui/panel'
import { Code, Pill, Table, TableScroll, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import {
  fetchMyWatchedLines, fetchProgramme, fetchProgrammeRollups, watchLine,
  type ProgrammeRollup, type ProgrammeTask,
} from '@/lib/queries'
import type { ProjectContext } from '@/pages/project/ProjectLayout'

/** The prototype's own reference date, so a seeded project reads the same way
 *  here as it does there. */
const TODAY = new Date('2026-08-30')

const fmt = (d: string) =>
  new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })

/** A line's state, said in the words a planner would use. */
function lineState(t: ProgrammeTask): { tone: 'neutral' | 'ok' | 'warn' | 'stop'; label: string } {
  if (t.removed) return { tone: 'stop', label: 'Removed' }
  if (t.percent_complete >= 100) return { tone: 'ok', label: 'Complete' }
  const finish = new Date(t.finish_date)
  const start = new Date(t.start_date)
  if (finish < TODAY) return { tone: 'stop', label: 'Overdue' }
  if (start <= TODAY) return { tone: 'warn', label: 'In progress' }
  const weeks = Math.round((start.getTime() - TODAY.getTime()) / 864e5 / 7)
  return { tone: 'neutral', label: `Starts in ${weeks}w` }
}

export default function ProgrammePage() {
  const { id = '' } = useParams()
  const ctx = useOutletContext<ProjectContext>()
  const [tasks, setTasks] = useState<ProgrammeTask[]>([])
  const [rollups, setRollups] = useState<Map<string, ProgrammeRollup>>(new Map())
  const [watched, setWatched] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [inspecting, setInspecting] = useState<ProgrammeTask | null>(null)
  const [importing, setImporting] = useState(false)
  const [showRemoved, setShowRemoved] = useState(false)

  // A sync callback that starts the fetch, matching ProjectLayout: an async
  // function called straight from an effect reads as a synchronous setState.
  // No setLoading(true) either -- the initial state is already true, and a
  // reload after an import should refresh the table in place, not blank it.
  const load = useCallback(() => {
    Promise.all([fetchProgramme(id), fetchProgrammeRollups(id), fetchMyWatchedLines(id)])
      .then(([t, r, wl]) => {
        setTasks(t)
        setRollups(new Map(r.map((x) => [x.root_uid, x])))
        setWatched(wl)
        setError(null)
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [id])

  useEffect(load, [load])

  const toggleWatch = async (uid: string) => {
    const on = !watched.has(uid)
    // Optimistic: a star that waits for a round trip feels broken.
    setWatched((prev) => {
      const next = new Set(prev)
      if (on) next.add(uid); else next.delete(uid)
      return next
    })
    try {
      await watchLine(id, uid, on)
    } catch (e) {
      setError((e as Error).message)
      load()
    }
  }

  const visible = useMemo(
    () => (showRemoved ? tasks : tasks.filter((t) => !t.removed)),
    [tasks, showRemoved])
  const removedCount = tasks.filter((t) => t.removed).length

  if (loading) return <div className="text-graphite p-6 text-sm">Loading the programme…</div>

  return (
    <>
      <PageHead
        eyebrow="Set up"
        title="Programme"
        meta="Every date in the project is computed from these lines. Nothing is typed."
        actions={
          ctx.canEdit ? (
            <Button size="sm" onClick={() => setImporting(true)}>Import a revision</Button>
          ) : null
        }
      />

      {error && (
        <Panel kind="comply" className="mb-4">
          <p className="text-stop text-sm">{error}</p>
        </Panel>
      )}

      {tasks.length === 0 ? (
        <Panel title="No programme loaded">
          <p className="text-graphite max-w-prose text-sm">
            Until a programme is imported, nothing in this project can be dated — every due
            date, every drawing deadline and every review is computed from a line in here.
            {ctx.canEdit
              ? ' Import a revision to start the spine.'
              : ' Someone on the contractor’s team needs to import one.'}
          </p>
        </Panel>
      ) : (
        <Panel
          title={`${visible.length} line${visible.length === 1 ? '' : 's'}`}
          actions={
            removedCount > 0 ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setShowRemoved((v) => !v)}
              >
                {showRemoved ? 'Hide' : 'Show'} {removedCount} removed
              </Button>
            ) : null
          }
        >
          <TableScroll>
            <Table>
              <THead>
                <TR>
                  <TH className="w-[38px]" aria-label="Tracking" />
                  <TH className="w-[76px]">ID</TH>
                  <TH>Line</TH>
                  <TH className="w-[96px]">Start</TH>
                  <TH className="w-[96px]">Finish</TH>
                  <TH className="w-[78px]">Progress</TH>
                  <TH className="w-[116px]">Status</TH>
                </TR>
              </THead>
              <TBody>
                {visible.map((t) => {
                  const state = lineState(t)
                  const roll = rollups.get(t.task_uid)
                  const isSummary = t.task_type === 'Summary'
                  // A summary shows what its leaves say, never a stored figure.
                  const start = roll ? roll.rolled_start : t.start_date
                  const finish = roll ? roll.rolled_finish : t.finish_date
                  const pct = roll?.rolled_percent ?? t.percent_complete
                  return (
                    <TR key={t.id} muted={t.removed}>
                      <TD>
                        <button
                          type="button"
                          onClick={() => void toggleWatch(t.task_uid)}
                          aria-pressed={watched.has(t.task_uid)}
                          aria-label={
                            watched.has(t.task_uid)
                              ? `Stop tracking ${t.task_uid}`
                              : `Track ${t.task_uid}`
                          }
                          className={
                            'cursor-pointer text-base leading-none transition-opacity ' +
                            (watched.has(t.task_uid)
                              ? 'text-primary opacity-100'
                              : 'text-graphite opacity-35 hover:opacity-80')
                          }
                        >
                          {watched.has(t.task_uid) ? '★' : '☆'}
                        </button>
                      </TD>
                      <TD>
                        <button
                          type="button"
                          onClick={() => setInspecting(t)}
                          className="text-primary cursor-pointer hover:underline"
                        >
                          <Code>{t.task_uid}</Code>
                        </button>
                      </TD>
                      <TD>
                        <span
                          style={{ paddingLeft: `${(t.level - 1) * 14}px` }}
                          className={isSummary ? 'font-semibold' : undefined}
                        >
                          {t.description}
                        </span>
                        {t.task_type === 'Milestone' && (
                          <span className="text-graphite ml-2 text-[11px]">◆ milestone</span>
                        )}
                      </TD>
                      <TD><Code className="text-graphite text-xs">{fmt(start)}</Code></TD>
                      <TD><Code className="text-graphite text-xs">{fmt(finish)}</Code></TD>
                      <TD>
                        <Code className="text-graphite text-xs">
                          {t.task_type === 'Milestone' ? '—' : `${pct ?? 0}%`}
                        </Code>
                      </TD>
                      <TD><Pill tone={state.tone}>{state.label}</Pill></TD>
                    </TR>
                  )
                })}
              </TBody>
            </Table>
          </TableScroll>
        </Panel>
      )}

      {inspecting && (
        <LineInspector
          projectId={id}
          task={inspecting}
          watched={watched.has(inspecting.task_uid)}
          onToggleWatch={() => void toggleWatch(inspecting.task_uid)}
          onClose={() => setInspecting(null)}
        />
      )}

      {importing && (
        <ImportProgramme
          projectId={id}
          onClose={() => setImporting(false)}
          onImported={() => { setImporting(false); load() }}
        />
      )}
    </>
  )
}
