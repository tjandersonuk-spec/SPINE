import { useCallback, useEffect, useState } from 'react'
import { Link, useOutletContext, useParams } from 'react-router'

import { ErrorNote } from '@/components/ui/notes'
import { Eyebrow, Panel, PageHead } from '@/components/ui/panel'
import { Stat } from '@/components/ui/stat'
import { Code, Pill, Table, TableScroll, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { fmtDate } from '@/lib/format'
import {
  fetchChangeLog, fetchDecisionQueue, fetchGoneQuiet, fetchIssues, fetchOverdueTracked,
  fetchRegister, type ChangeLogRow, type DecisionRow, type QuietRow,
} from '@/lib/queries'
import type { ProjectContext } from '@/pages/project/ProjectLayout'

/**
 * The Monday summary: what a design manager reads before the week starts.
 *
 * Deliberately not a dashboard. A dashboard answers "how is the project", which
 * is a question you ask standing back; this answers "what do I have to do
 * something about before Friday", which is the question you ask sitting down.
 * So it is ordered by what it costs to ignore, not by module.
 *
 * Every figure is one another page already computes. The one thing this page
 * decides for itself is the window, which is seven days back and fourteen
 * forward -- back far enough to catch what happened while you were not looking,
 * forward far enough that something can still be done about it.
 *
 * "Waiting on you" is decision_queue(), which is keyed on auth.uid(): this page
 * is read by the person looking at it, and a summary that showed somebody
 * else's queue would be worse than no summary.
 */
const BACK_DAYS = 7
const FORWARD_DAYS = 14

const daysFromNow = (d: string | null) => {
  if (!d) return null
  const ms = new Date(d).getTime() - new Date().setHours(0, 0, 0, 0)
  return Math.round(ms / 86_400_000)
}

type Due = {
  key: string; ref: string; title: string; due: string | null; where: string; to: string
}

export default function SummaryPage() {
  const { id = '' } = useParams()
  const ctx = useOutletContext<ProjectContext>()
  const isStaff = ctx.accountRole === 'admin' || ctx.accountRole === 'internal'

  const [queue, setQueue] = useState<DecisionRow[]>([])
  const [quiet, setQuiet] = useState<QuietRow[]>([])
  const [log, setLog] = useState<ChangeLogRow[]>([])
  const [due, setDue] = useState<Due[]>([])
  const [late, setLate] = useState<Due[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    // Gone-quiet is a tone judgement about somebody else's silence and never
    // leaves the contractor's own staff, so it is not even asked for otherwise.
    Promise.all([
      fetchDecisionQueue(id),
      fetchRegister(id),
      fetchOverdueTracked(id),
      fetchIssues(id),
      fetchChangeLog(id, 400),
      isStaff ? fetchGoneQuiet(id) : Promise.resolve([] as QuietRow[]),
    ])
      .then(([q, register, tracked, issues, entries, gq]) => {
        const p = (to: string) => `/project/${id}/${to}`
        const rows: Due[] = [
          ...register.map((d) => ({
            key: `d${d.id}`, ref: d.document_number, title: d.title ?? '',
            due: d.due, where: 'Drawing', to: p('register'),
            awaited: d.awaited as boolean,
          })).filter((d) => d.awaited),
          ...tracked.map((t) => ({
            key: `t${t.id}`, ref: t.reference, title: t.title, due: t.due,
            where: 'Checklist', to: p(t.kind === 'planning' ? 'planning' : 'bc'),
          })),
          ...issues.filter((i) => i.status === 'Open').map((i) => ({
            key: `i${i.id}`, ref: i.reference, title: i.title, due: i.due,
            where: i.source_kind === 'rfi' ? 'RFI' : 'Task', to: p('issues'),
          })),
        ]

        const withDays = rows
          .map((r) => ({ ...r, d: daysFromNow(r.due) }))
          .filter((r) => r.d !== null) as (Due & { d: number })[]

        setLate(withDays.filter((r) => r.d < 0).sort((a, b) => a.d - b.d))
        setDue(withDays
          .filter((r) => r.d >= 0 && r.d <= FORWARD_DAYS)
          .sort((a, b) => a.d - b.d))

        const since = Date.now() - BACK_DAYS * 86_400_000
        setLog(entries.filter((e) => new Date(e.created_at).getTime() >= since))
        setQueue(q); setQuiet(gq); setError(null)
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [id, isStaff])

  useEffect(load, [load])

  if (loading) return <div className="text-graphite p-6 text-sm">Loading…</div>
  if (error) return <ErrorNote message={error} />

  const monday = new Date()
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))

  return (
    <>
      <PageHead
        eyebrow="My work"
        title="Monday summary"
        meta={`The last ${BACK_DAYS} days and the next ${FORWARD_DAYS}, `
            + `week beginning ${fmtDate(monday.toISOString())}.`}
        actions={
          <button
            type="button"
            onClick={() => window.print()}
            className="noprint text-graphite hover:text-foreground text-xs underline underline-offset-2"
          >
            Print
          </button>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Waiting on you" value={queue.length}
          tone={queue.length > 0 ? 'warn' : 'plain'} />
        <Stat label="Late" value={late.length} tone={late.length > 0 ? 'stop' : 'plain'} />
        <Stat label={`Due in ${FORWARD_DAYS} days`} value={due.length} />
        <Stat label={`Changes in ${BACK_DAYS} days`} value={log.length} />
      </div>

      {/* ---- what is waiting on me ---- */}
      <Panel title="Waiting on you" kind={queue.length > 0 ? 'discuss' : 'plain'}>
        {queue.length === 0 ? (
          <p className="text-graphite text-sm">
            Nothing is waiting on your answer. This is your queue alone, not the project's.
          </p>
        ) : (
          <TableScroll>
            <Table>
              <THead>
                <TR>
                  <TH className="w-[110px]">What</TH>
                  <TH>Item</TH>
                  <TH className="w-[110px]">Due</TH>
                </TR>
              </THead>
              <TBody>
                {queue.map((q, i) => (
                  <TR key={i}>
                    <TD>
                      <Pill tone="neutral">{q.kind}</Pill>
                    </TD>
                    <TD>
                      <Code className="mr-2">{q.reference}</Code>
                      {q.title}
                    </TD>
                    <TD>{fmtDate(q.due ?? null)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableScroll>
        )}
      </Panel>

      {/* ---- late ---- */}
      <Panel title="Late" kind={late.length > 0 ? 'comply' : 'plain'}>
        <DueTable rows={late} empty="Nothing on this project is past its date." showOverdue />
      </Panel>

      {/* ---- coming up ---- */}
      <Panel title={`Due in the next ${FORWARD_DAYS} days`}>
        <DueTable rows={due} empty="Nothing falls due in the next fortnight." />
      </Panel>

      {/* ---- gone quiet, contractor staff only ---- */}
      {isStaff && (
        <Panel title="Gone quiet" kind="evidence">
          <p className="text-graphite mb-3 max-w-prose text-xs">
            Silence, not age. An item is here because nobody has said anything about it,
            which is a different thing from it being old. It never leaves your own staff.
          </p>
          {quiet.length === 0 ? (
            <p className="text-graphite text-sm">Everything open has been touched recently.</p>
          ) : (
            <ul>
              {quiet.map((q) => (
                <li key={q.reference} className="border-glass-line border-b py-1.5 text-sm last:border-0">
                  <Link to={`/project/${id}/issues`} className="underline-offset-2 hover:underline">
                    <Code className="mr-2">{q.reference}</Code>
                  </Link>
                  {q.title}
                  <span className="text-graphite-light ml-2 text-xs">
                    silent {q.days_quiet} days
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}

      {/* ---- what changed ---- */}
      <Panel title={`What changed in the last ${BACK_DAYS} days`}>
        {log.length === 0 ? (
          <p className="text-graphite text-sm">Nothing was recorded this week.</p>
        ) : (
          <>
            <Eyebrow className="mb-2">{log.length} entries</Eyebrow>
            <TableScroll>
              <Table>
                <THead>
                  <TR>
                    <TH className="w-[110px]">When</TH>
                    <TH className="w-[150px]">Who</TH>
                    <TH>What</TH>
                  </TR>
                </THead>
                <TBody>
                  {log.slice(0, 40).map((e) => (
                    <TR key={e.id}>
                      <TD>{fmtDate(e.created_at)}</TD>
                      <TD>{e.actor_name ?? '—'}</TD>
                      <TD>
                        <Code className="mr-2">{e.entity_type}</Code>
                        {e.field
                          ? <>{e.field}: {e.value_from ?? '—'} → {e.value_to ?? '—'}</>
                          : e.action}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableScroll>
            {log.length > 40 && (
              <p className="text-graphite mt-2 text-xs">
                Showing the most recent 40.{' '}
                <Link to={`/project/${id}/changes`} className="underline underline-offset-2">
                  The whole change log
                </Link>{' '}
                is open to every member of the project.
              </p>
            )}
          </>
        )}
      </Panel>
    </>
  )
}

function DueTable({
  rows, empty, showOverdue = false,
}: { rows: Due[]; empty: string; showOverdue?: boolean }) {
  if (rows.length === 0) return <p className="text-graphite text-sm">{empty}</p>
  return (
    <TableScroll>
      <Table>
        <THead>
          <TR>
            <TH className="w-[100px]">Kind</TH>
            <TH className="w-[150px]">Reference</TH>
            <TH>Item</TH>
            <TH className="w-[130px]">Due</TH>
          </TR>
        </THead>
        <TBody>
          {rows.slice(0, 40).map((r) => {
            const d = daysFromNow(r.due)
            return (
              <TR key={r.key}>
                <TD>
                  <Pill tone="neutral">{r.where}</Pill>
                </TD>
                <TD>
                  <Link to={r.to} className="underline-offset-2 hover:underline">
                    <Code>{r.ref}</Code>
                  </Link>
                </TD>
                <TD>{r.title}</TD>
                <TD className={showOverdue ? 'text-stop-ink' : ''}>
                  {fmtDate(r.due)}
                  {d !== null && (
                    <span className="text-graphite-light ml-1.5 text-xs">
                      {d < 0 ? `${-d}d late` : d === 0 ? 'today' : `${d}d`}
                    </span>
                  )}
                </TD>
              </TR>
            )
          })}
        </TBody>
      </Table>
    </TableScroll>
  )
}
