import { useCallback, useEffect, useState } from 'react'
import { useOutletContext, useParams } from 'react-router'

import { TimelineStrip } from '@/components/dashboard/TimelineStrip'
import { Panel, PageHead } from '@/components/ui/panel'
import { Code, Pill, Table, TableScroll, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import {
  fetchConsultantHealth, fetchDecisionQueue, fetchGoneQuiet, fetchMyFront, fetchTimeline,
  type DecisionRow, type HealthRow, type MyFront, type QuietRow, type Timeline,
} from '@/lib/queries'
import type { ProjectContext } from '@/pages/project/ProjectLayout'

const fmt = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })
    : '—'

/**
 * One route, two pages.
 *
 * The contractor's own staff get the project dashboard; everyone else gets
 * their own front. Not a permissions trick — they are genuinely different
 * questions. "How is this project doing" and "what am I answerable for" have
 * different answers, and showing a consultant a greyed-out version of the
 * first tells them what they are not allowed to see rather than what they need.
 */
export default function HomePage() {
  const { id = '' } = useParams()
  const ctx = useOutletContext<ProjectContext>()
  const isStaff = ctx.accountRole === 'admin' || ctx.accountRole === 'internal'

  const [timeline, setTimeline] = useState<Timeline | null>(null)
  const [queue, setQueue] = useState<DecisionRow[]>([])
  const [health, setHealth] = useState<HealthRow[]>([])
  const [quiet, setQuiet] = useState<QuietRow[]>([])
  const [front, setFront] = useState<MyFront | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    Promise.all([
      fetchTimeline(id), fetchDecisionQueue(id), fetchConsultantHealth(id),
      fetchGoneQuiet(id), fetchMyFront(id),
    ])
      .then(([t, q, h, gq, f]) => {
        setTimeline(t); setQueue(q); setHealth(h); setQuiet(gq); setFront(f); setError(null)
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [id])

  useEffect(load, [load])

  if (loading) return <div className="text-graphite p-6 text-sm">Loading…</div>

  return (
    <>
      <PageHead
        eyebrow="My work"
        title={isStaff ? ctx.project?.name ?? 'Project' : 'Your work on this project'}
        meta={isStaff
          ? 'Where the project is, and what is waiting on you.'
          : 'Everything your firm is answerable for here — and nothing that is not yours.'}
      />

      {error && (
        <Panel kind="comply" className="mb-4">
          <p className="text-stop text-sm">{error}</p>
        </Panel>
      )}

      {timeline && (
        <Panel title="Programme">
          <TimelineStrip t={timeline} />
        </Panel>
      )}

      <Panel
        kind="discuss"
        title={`Waiting on you (${queue.length})`}
      >
        {queue.length === 0 ? (
          <p className="text-graphite text-sm">Nothing is waiting on you.</p>
        ) : (
          <TableScroll>
            <Table>
              <THead>
                <TR>
                  <TH className="w-[170px]">What</TH>
                  <TH className="w-[86px]">Ref</TH>
                  <TH>Item</TH>
                  <TH className="w-[96px]">Due</TH>
                  <TH className="w-[74px]">Urgency</TH>
                </TR>
              </THead>
              <TBody>
                {queue.map((q) => (
                  <TR key={`${q.kind}-${q.record_id}`}>
                    <TD className="text-graphite text-xs">{q.kind}</TD>
                    <TD><Code className="text-xs">{q.reference}</Code></TD>
                    <TD>{q.title}</TD>
                    <TD><Code className="text-graphite text-xs">{fmt(q.due)}</Code></TD>
                    <TD><Code className="text-xs">{q.urgency}</Code></TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableScroll>
        )}
      </Panel>

      {isStaff ? (
        <>
          <Panel title={`Consultant health (${health.length})`}>
            <p className="text-graphite mb-2 max-w-prose text-sm">
              Worst first. The order is the judgement — there is no grade, because a letter
              invites an argument about the mark rather than about the four facts under it.
              Open work is not counted: a busy consultant is not a worrying one, a late or a
              silent one is.
            </p>
            <TableScroll>
              <Table>
                <THead>
                  <TR>
                    <TH>Company</TH>
                    <TH className="w-[110px]">Appointment</TH>
                    <TH className="w-[100px]">Overdue</TH>
                    <TH className="w-[86px]">Quiet</TH>
                    <TH className="w-[86px]">Open</TH>
                  </TR>
                </THead>
                <TBody>
                  {health.map((h) => (
                    <TR key={h.company_id} muted={h.concern_score === 0}>
                      <TD>{h.company_name}</TD>
                      <TD>
                        {h.appointment_gaps > 0
                          ? <Pill tone="warn">{h.appointment_gaps} missing</Pill>
                          : <Pill tone="ok">complete</Pill>}
                      </TD>
                      <TD>
                        {h.overdue_drawings > 0
                          ? <Pill tone="stop">{h.overdue_drawings}</Pill>
                          : <span className="text-graphite text-xs">—</span>}
                      </TD>
                      <TD>
                        {h.quiet_issues > 0
                          ? <Pill tone="warn">{h.quiet_issues}</Pill>
                          : <span className="text-graphite text-xs">—</span>}
                      </TD>
                      <TD><Code className="text-graphite text-xs">{h.open_issues}</Code></TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableScroll>
          </Panel>

          <Panel title={`Gone quiet (${quiet.length})`}>
            <p className="text-graphite mb-2 max-w-prose text-sm">
              Open, and nobody has said anything about it for three weeks. Age is not the
              finding — silence is.
            </p>
            {quiet.length === 0 ? (
              <p className="text-graphite text-sm">Nothing has gone quiet.</p>
            ) : (
              <TableScroll>
                <Table>
                  <THead>
                    <TR>
                      <TH className="w-[86px]">Ref</TH>
                      <TH>Item</TH>
                      <TH className="w-[110px]">Last mentioned</TH>
                      <TH className="w-[90px]">Days</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {quiet.map((q) => (
                      <TR key={q.reference}>
                        <TD><Code className="text-xs">{q.reference}</Code></TD>
                        <TD>{q.title}</TD>
                        <TD>
                          <Code className="text-graphite text-xs">{fmt(q.last_touched)}</Code>
                        </TD>
                        <TD><Code className="text-xs">{q.days_quiet}</Code></TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableScroll>
            )}
          </Panel>
        </>
      ) : (
        front && <ConsultantFront front={front} />
      )}
    </>
  )
}

function ConsultantFront({ front }: { front: MyFront }) {
  return (
    <>
      <Panel title={`Due from us (${front.due_from_us.length})`}>
        {front.due_from_us.length === 0 ? (
          <p className="text-graphite text-sm">Nothing outstanding from your firm.</p>
        ) : (
          <TableScroll>
            <Table>
              <THead>
                <TR>
                  <TH className="w-[210px]">Number</TH>
                  <TH>Title</TH>
                  <TH className="w-[96px]">Due</TH>
                  <TH className="w-[96px]">State</TH>
                </TR>
              </THead>
              <TBody>
                {front.due_from_us.map((d) => (
                  <TR key={d.id}>
                    <TD><Code className="text-xs">{d.number}</Code></TD>
                    <TD>{d.title ?? <span className="text-graphite">—</span>}</TD>
                    <TD><Code className="text-graphite text-xs">{fmt(d.due)}</Code></TD>
                    <TD>
                      {d.overdue
                        ? <Pill tone="stop">Overdue</Pill>
                        : <Pill tone="warn">Awaited</Pill>}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableScroll>
        )}
      </Panel>

      <Panel kind="discuss" title={`Asked of us (${front.asked_of_us.length})`}>
        {front.asked_of_us.length === 0 ? (
          <p className="text-graphite text-sm">Nothing is currently asked of your firm.</p>
        ) : (
          <TableScroll>
            <Table>
              <THead>
                <TR>
                  <TH className="w-[86px]">Ref</TH>
                  <TH>Item</TH>
                  <TH className="w-[96px]">Due</TH>
                  <TH className="w-[74px]">Urgency</TH>
                </TR>
              </THead>
              <TBody>
                {front.asked_of_us.map((i) => (
                  <TR key={i.id}>
                    <TD><Code className="text-xs">{i.reference}</Code></TD>
                    <TD>{i.title}</TD>
                    <TD><Code className="text-graphite text-xs">{fmt(i.due)}</Code></TD>
                    <TD><Code className="text-xs">{i.urgency}</Code></TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableScroll>
        )}
      </Panel>

      <Panel title={`What we lead on the matrix (${front.we_lead.length})`}>
        {front.we_lead.length === 0 ? (
          <p className="text-graphite max-w-prose text-sm">
            Your firm does not currently lead any matrix item. That is either correct or a gap
            worth raising — the matrix names a discipline, and which firm holds it is looked up
            live.
          </p>
        ) : (
          <TableScroll>
            <Table>
              <THead>
                <TR>
                  <TH className="w-[86px]">Ref</TH>
                  <TH>Item</TH>
                  <TH className="w-[110px]">Discipline</TH>
                </TR>
              </THead>
              <TBody>
                {front.we_lead.map((d) => (
                  <TR key={d.id}>
                    <TD><Code className="text-xs">{d.ref}</Code></TD>
                    <TD>{d.item}</TD>
                    <TD><Code className="text-xs">{d.discipline ?? '—'}</Code></TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableScroll>
        )}
      </Panel>

      {front.appointment_gaps.length > 0 && (
        <Panel kind="comply" title={`Appointment documents missing (${front.appointment_gaps.length})`}>
          <p className="text-graphite mb-2 max-w-prose text-sm">
            Yours to upload, on the directory page. Nobody else can see these.
          </p>
          <ul className="flex flex-wrap gap-2">
            {front.appointment_gaps.map((g) => (
              <li key={`${g.company}-${g.slot}`}>
                <Pill tone="warn">{g.company}: {g.slot.replace(/_/g, ' ')}</Pill>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel title={`Programme lines you track (${front.tracked_lines.length})`}>
        {front.tracked_lines.length === 0 ? (
          <p className="text-graphite max-w-prose text-sm">
            You are not tracking any programme lines. Open the programme and star the ones that
            drive your work — nobody else can see what you track.
          </p>
        ) : (
          <TableScroll>
            <Table>
              <THead>
                <TR>
                  <TH className="w-[70px]">ID</TH>
                  <TH>Line</TH>
                  <TH className="w-[96px]">Finish</TH>
                  <TH className="w-[86px]">Progress</TH>
                </TR>
              </THead>
              <TBody>
                {front.tracked_lines.map((t) => (
                  <TR key={t.uid} muted={t.removed}>
                    <TD><Code className="text-xs">{t.uid}</Code></TD>
                    <TD>
                      {t.description}
                      {t.removed && <Pill tone="stop" className="ml-2">Removed</Pill>}
                    </TD>
                    <TD><Code className="text-graphite text-xs">{fmt(t.finish)}</Code></TD>
                    <TD><Code className="text-xs">{t.percent}%</Code></TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableScroll>
        )}
      </Panel>
    </>
  )
}
