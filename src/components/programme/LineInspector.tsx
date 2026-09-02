import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Code, Pill, Table, TableScroll, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { fetchLineDependents, type ProgrammeTask } from '@/lib/queries'

/**
 * What is dated from this line.
 *
 * The question the inspector answers is "if this slips, what moves?" — which is
 * the only way anyone can judge whether a programme change matters. It reads
 * programme_dependents(), so a module that gains anchor columns without adding
 * its branch there is invisible here, and a test guards exactly that.
 */
export function LineInspector({
  projectId, task, watched, onToggleWatch, onClose,
}: {
  projectId: string
  task: ProgrammeTask
  watched: boolean
  onToggleWatch: () => void
  onClose: () => void
}) {
  const [deps, setDeps] = useState<
    { module: string; record_id: string; ref: string; description: string; due: string }[]
  >([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let live = true
    fetchLineDependents(projectId, task.task_uid)
      .then((d) => { if (live) setDeps(d) })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [projectId, task.task_uid])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/35"
      onClick={onClose}
      role="presentation"
    >
      <aside
        className="bg-card border-rule flex h-full w-full max-w-[520px] flex-col border-l shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={`Programme line ${task.task_uid}`}
      >
        <header className="border-rule flex items-start justify-between gap-3 border-b px-5 py-4">
          <div>
            <Code className="text-graphite text-xs">{task.task_uid}</Code>
            <h2 className="mt-0.5 text-base font-semibold">{task.description}</h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <Pill tone="neutral">{task.task_type}</Pill>
              {task.removed && <Pill tone="stop">Removed from the programme</Pill>}
            </div>
          </div>
          <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close">✕</Button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <dl className="mb-5 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-graphite">Start</dt>
            <dd><Code>{task.start_date}</Code></dd>
            <dt className="text-graphite">Finish</dt>
            <dd><Code>{task.finish_date}</Code></dd>
            <dt className="text-graphite">Progress</dt>
            <dd><Code>{task.task_type === 'Milestone' ? '—' : `${task.percent_complete}%`}</Code></dd>
            <dt className="text-graphite">Level</dt>
            <dd><Code>{task.level}</Code></dd>
            {task.parent_uid && (
              <>
                <dt className="text-graphite">Under</dt>
                <dd><Code>{task.parent_uid}</Code></dd>
              </>
            )}
          </dl>

          {task.removed && (
            <p className="border-stop bg-stop-bg text-stop mb-5 rounded border-l-[3px] px-3 py-2 text-sm">
              This line was not in the latest revision. Anything dated from it keeps the date it
              last had and is flagged, so nothing silently loses its deadline — but it will not
              move again until it is re-anchored.
            </p>
          )}

          <h3 className="mb-2 text-sm font-semibold">
            Dated from this line{loading ? '' : ` (${deps.length})`}
          </h3>
          {loading ? (
            <p className="text-graphite text-sm">Looking…</p>
          ) : deps.length === 0 ? (
            <p className="text-graphite max-w-prose text-sm">
              Nothing is dated from this line yet. Drawings, reviews, conditions and checklist
              items all anchor to the programme as those modules are built — when they do, they
              appear here, and slipping this line moves every one of them.
            </p>
          ) : (
            <TableScroll>
              <Table>
                <THead>
                  <TR>
                    <TH className="w-[92px]">Module</TH>
                    <TH className="w-[110px]">Ref</TH>
                    <TH>Item</TH>
                    <TH className="w-[96px]">Due</TH>
                  </TR>
                </THead>
                <TBody>
                  {deps.map((d) => (
                    <TR key={`${d.module}-${d.record_id}`}>
                      <TD className="text-graphite text-xs">{d.module}</TD>
                      <TD><Code className="text-xs">{d.ref}</Code></TD>
                      <TD>{d.description}</TD>
                      <TD><Code className="text-xs">{d.due}</Code></TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableScroll>
          )}
        </div>

        <footer className="border-rule border-t px-5 py-3">
          <Button size="sm" variant={watched ? 'secondary' : 'default'} onClick={onToggleWatch}>
            {watched ? '★ Tracking — stop' : '☆ Track this line'}
          </Button>
          <p className="text-graphite mt-2 text-xs">
            Tracked lines appear on your own dashboard. Nobody else can see what you track.
          </p>
        </footer>
      </aside>
    </div>
  )
}
