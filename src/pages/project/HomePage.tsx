import { useCallback, useEffect, useState } from 'react'
import { Link, useOutletContext, useParams } from 'react-router'

import { ProgressRow } from '@/components/charts/ProgressRow'
import { SegmentBar } from '@/components/charts/SegmentBar'
import { TrendChart } from '@/components/charts/TrendChart'
import { DetailDrawer } from '@/components/dashboard/DetailDrawer'
import { TimelineStrip } from '@/components/dashboard/TimelineStrip'
import { Panel, PageHead } from '@/components/ui/panel'
import { Stat } from '@/components/ui/stat'
import { Code, Pill, Table, TableScroll, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { gbp } from '@/lib/format'
import {
  fetchAppointmentCompanies, fetchAppointmentSummary, fetchCompanyItems, fetchConsultantHealth,
  fetchDashboardMetrics, fetchDecisionQueue, fetchDrmGaps, fetchFeePosition, fetchGoneQuiet,
  fetchMetricItems, fetchMyFront, fetchProjectTrend, fetchTimeline, fetchTrackedProgress,
  TRACKED_LABELS,
  type AppointmentBucket, type DecisionRow, type DrmGap, type FeePosition, type HealthRow,
  fetchRisks,
  type Metric, type MetricItem, type MyFront, type QuietRow, type Risk, type Timeline,
  type TrackedProgress, type TrendPoint,
} from '@/lib/queries'
import type { ProjectContext } from '@/pages/project/ProjectLayout'

/** What the reader is looking at, per key. A drawer that opens with a list and
 *  no statement of what was counted invites the question it was meant to
 *  answer. */
const DETAIL_NOTE: Record<string, string> = {
  documents: 'Anticipated, past their date and not yet issued.',
  issues: 'Everything still open. The late ones are marked and sorted first.',
  changes: 'Raised and not yet closed, rejected, withdrawn or implemented.',
  risks: 'Live risks, worst expected value first. Expected value is cost times '
       + 'likelihood, never the gross.',
  gaps: 'Applicable duties with no company holding the lead discipline.',
  planning: 'Conditions past their date and not discharged.',
  bc: 'Building control items past their date and not closed.',
  checklists: 'Checklist items past their date. Struck-out rows are not counted.',
}

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
  const [metrics, setMetrics] = useState<Metric[]>([])
  const [trend, setTrend] = useState<TrendPoint[]>([])
  const [appts, setAppts] = useState<AppointmentBucket[]>([])
  const [fees, setFees] = useState<FeePosition[]>([])
  const [progress, setProgress] = useState<TrackedProgress[]>([])
  const [gaps, setGaps] = useState<DrmGap[]>([])
  const [risks, setRisks] = useState<Risk[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [drawer, setDrawer] = useState<
    { title: string; note?: string; items: MetricItem[]; loading: boolean } | null>(null)

  /** Open the rows behind a figure. The fetch is whichever function counted
   *  them; nothing is narrowed here, because a list trimmed in the browser is
   *  how a total and its detail start disagreeing. */
  const open = useCallback((
    title: string, fetch: () => Promise<MetricItem[]>, note?: string,
  ) => {
    setDrawer({ title, note, items: [], loading: true })
    fetch()
      .then((items) => setDrawer({ title, note, items, loading: false }))
      .catch((e: Error) => { setError(e.message); setDrawer(null) })
  }, [])

  const load = useCallback(() => {
    // Everything a consultant may not read is asked for anyway and allowed to
    // come back empty: the database is what refuses, and a page that decided
    // for itself which queries to send would be a second permissions model.
    const soft = <T,>(p: Promise<T>, fallback: T) => p.catch(() => fallback)
    Promise.all([
      fetchTimeline(id), fetchDecisionQueue(id), soft(fetchConsultantHealth(id), []),
      soft(fetchGoneQuiet(id), []), fetchMyFront(id), fetchDashboardMetrics(id),
      soft(fetchProjectTrend(id), []), soft(fetchAppointmentSummary(id), []),
      soft(fetchFeePosition(id), []), soft(fetchTrackedProgress(id), []),
      soft(fetchDrmGaps(id), []), soft(fetchRisks(id, 'risk'), []),
    ])
      .then(([t, q, h, gq, f, m, tr, ap, fe, pr, dg, rk]) => {
        setTimeline(t); setQueue(q); setHealth(h); setQuiet(gq); setFront(f)
        setMetrics(m); setTrend(tr); setAppts(ap); setFees(fe); setProgress(pr); setGaps(dg)
        // Live only, worst expected value first. Closed and realised items are
        // not exposure -- expected value is zero once an item is finished.
        setRisks(rk.filter((r) => !r.done)
          .sort((a, b) => Number(b.expected_value) - Number(a.expected_value)))
        setError(null)
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

      {/* The strip first, because it is what somebody opening the page came to
          read. Every tile is the report's own figure — dashboard_metrics()
          delegates to report_metrics() rather than counting anything itself. */}
      {metrics.length > 0 && (
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {metrics.map((m) => (
            <Stat
              key={m.sort_order}
              label={m.label}
              // Currency is formatted here, never in the query: the figure
              // comes back as a number and `unit` says what it is.
              value={m.unit === 'money' ? gbp(Number(m.value)) : m.value}
              tone={m.detail_key === 'gaps' ? 'gap' : m.alert ? 'warn' : 'plain'}
              hint={m.tail && (
                <strong className={m.alert ? 'text-warn-ink' : 'text-graphite'}>{m.tail}</strong>
              )}
              onOpen={m.detail_key
                ? () => open(m.label, () => fetchMetricItems(id, m.detail_key!),
                    DETAIL_NOTE[m.detail_key ?? ''])
                : undefined}
            />
          ))}
        </div>
      )}

      {timeline && (
        <Panel title="Programme">
          <TimelineStrip t={timeline} />
        </Panel>
      )}

      {/* Hi-vis, and the only place on this page that may be. */}
      {isStaff && gaps.length > 0 && (
        <Panel title={`Responsibility matrix gaps (${gaps.length})`}>
          <p className="text-graphite mb-3 max-w-prose text-sm">
            Applicable duties with no company holding the lead discipline. Until somebody
            holds them they fall to the contractor.
          </p>
          <TableScroll>
            <Table>
              <THead>
                <TR>
                  <TH className="w-[80px]">Ref</TH>
                  <TH>Item</TH>
                  <TH className="w-[90px]">Lead</TH>
                  <TH className="w-[220px]">Why</TH>
                </TR>
              </THead>
              <TBody>
                {gaps.slice(0, 8).map((g) => (
                  <TR key={g.drm_item_id} gap>
                    <TD>
                      <RecordLink projectId={id} page="matrix" reference={g.ref}>
                        <Code className="text-xs">{g.ref}</Code>
                      </RecordLink>
                    </TD>
                    <TD>
                      <RecordLink projectId={id} page="matrix" reference={g.ref}>{g.item}</RecordLink>
                    </TD>
                    <TD><Code className="text-xs">{g.lead_discipline ?? '—'}</Code></TD>
                    <TD className="text-graphite text-xs">{g.gap_reason}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableScroll>
          {gaps.length > 8 && (
            <p className="text-graphite mt-2 text-xs">
              The eight worst. The matrix has all {gaps.length}.
            </p>
          )}
        </Panel>
      )}

      {isStaff && trend.length > 0 && (
        <Panel title="Register burn-up">
          <TrendChart
            points={trend as unknown as Record<string, number | string>[]}
            series={[
              { key: 'anticipated', label: 'Anticipated', className: 'stroke-graphite',
                reference: true },
              { key: 'issued', label: 'Issued', className: 'stroke-brand' },
              { key: 'overdue', label: 'Overdue', className: 'stroke-stop' },
            ]}
          />
          <p className="text-graphite mt-2 max-w-prose text-xs">
            How the drawing register has filled up over the last ninety days.
            <strong className="text-foreground"> Anticipated</strong> is every document the
            project expects; <strong className="text-foreground"> issued</strong> is how many
            have arrived; <strong className="text-foreground"> overdue</strong> is those past
            their date and still awaited. Issued closing on anticipated is the project
            finishing its information; overdue rising is it slipping.
          </p>
        </Panel>
      )}

      {isStaff && (appts.length > 0 || fees.length > 0) && (
        <div className="grid gap-4 lg:grid-cols-2">
          {appts.length > 0 && (
            <Panel title="Appointments">
              <SegmentBar
                onOpen={(seg) => open(`Appointments: ${seg.label}`,
                  () => fetchAppointmentCompanies(id, seg.key))}
                segments={[
                  { key: 'complete', label: 'complete', className: 'bg-ok',
                    value: appts.find((a) => a.state === 'complete')?.companies ?? 0 },
                  { key: 'partial', label: 'partly documented', className: 'bg-warn',
                    value: appts.find((a) => a.state === 'partial')?.companies ?? 0 },
                  { key: 'none', label: 'nothing uploaded', className: 'bg-stop',
                    value: appts.find((a) => a.state === 'none')?.companies ?? 0 },
                ]}
                caption="Every company on the project that needs an appointment. The detail
                         is in the directory — a consultant uploads their own, and nobody
                         else can read it."
              />
            </Panel>
          )}
          {fees.length > 0 && <FeeBar fees={fees} />}
        </div>
      )}

      {/* Risk, which the strip only totalled. A total answers nothing somebody
          can act on: the question is which ones, and who is holding them. */}
      {isStaff && risks.length > 0 && (
        <Panel
          title={`Live risks (${risks.length})`}
          actions={
            <Link to={`/project/${id}/risk`} className="text-primary text-xs hover:underline">
              Open the register
            </Link>
          }
        >
          <p className="text-graphite mb-2 max-w-prose text-sm">
            Worst expected value first. Expected value is cost times likelihood, which is the
            only figure the register calls exposure. A risk nobody owns is the finding, not
            the amount.
          </p>
          <TableScroll>
            <Table>
              <THead>
                <TR>
                  <TH className="w-[86px]">Ref</TH>
                  <TH>Risk</TH>
                  <TH className="w-[150px]">Owner</TH>
                  <TH className="w-[110px]">Expected</TH>
                </TR>
              </THead>
              <TBody>
                {risks.slice(0, 6).map((r) => (
                  <TR key={r.id} gap={!r.owner_name}>
                    <TD>
                      <RecordLink projectId={id} page="risk" reference={r.reference}>
                        <Code className="text-xs">{r.reference}</Code>
                      </RecordLink>
                    </TD>
                    <TD>
                      <RecordLink projectId={id} page="risk" reference={r.reference}>
                        {r.title}
                      </RecordLink>
                    </TD>
                    <TD>
                      {r.owner_name
                        ? <span className="text-sm">{r.owner_name}</span>
                        : <Pill tone="gap">Nobody</Pill>}
                    </TD>
                    <TD>
                      <Code className="text-xs font-bold">{gbp(r.expected_value)}</Code>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableScroll>
        </Panel>
      )}

      {isStaff && progress.some((p) => p.total > 0) && (
        <Panel title="Where the checklists stand">
          {progress.filter((p) => p.total > 0).map((p) => (
            <ProgressRow
              key={p.kind}
              label={TRACKED_LABELS[p.kind] ?? p.kind}
              done={p.done}
              total={p.total}
              overdue={p.overdue}
              onOpenOverdue={p.overdue > 0
                ? () => open(`${TRACKED_LABELS[p.kind] ?? p.kind}: past their date`,
                    () => fetchMetricItems(id,
                      p.kind === 'planning' ? 'planning'
                      : p.kind === 'bc' ? 'bc' : 'checklists'))
                : undefined}
            />
          ))}
          <p className="text-graphite mt-2 max-w-prose text-xs">
            Struck-out rows are not counted. Marking something not required drops it from the
            denominator and leaves the decision on the record.
          </p>
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
                    <TD>
                      <RecordLink projectId={id} page={pageFor(q.kind)} reference={q.reference}>
                        <Code className="text-xs">{q.reference}</Code>
                      </RecordLink>
                    </TD>
                    <TD>
                      <RecordLink projectId={id} page={pageFor(q.kind)} reference={q.reference}>
                        {q.title}
                      </RecordLink>
                    </TD>
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
                  {health.map((h) => {
                    const cell = (kind: string, what: string) => () =>
                      open(`${h.company_name}: ${what}`,
                        () => fetchCompanyItems(id, h.company_id, kind))
                    return (
                      <TR key={h.company_id} muted={h.concern_score === 0}>
                        <TD>
                          <Link
                            to={`/project/${id}/directory?ref=${encodeURIComponent(h.company_name)}`}
                            className="hover:underline"
                          >
                            {h.company_name}
                          </Link>
                        </TD>
                        <TD>
                          {h.appointment_gaps > 0
                            ? <CellButton onClick={cell('appointment', 'appointment documents')}>
                                <Pill tone="warn">{h.appointment_gaps} missing</Pill>
                              </CellButton>
                            : <Link to={`/project/${id}/directory`}><Pill tone="ok">complete</Pill></Link>}
                        </TD>
                        <TD>
                          {h.overdue_drawings > 0
                            ? <CellButton onClick={cell('overdue', 'overdue drawings')}>
                                <Pill tone="stop">{h.overdue_drawings}</Pill>
                              </CellButton>
                            : <span className="text-graphite text-xs">—</span>}
                        </TD>
                        <TD>
                          {h.quiet_issues > 0
                            ? <CellButton onClick={cell('quiet', 'items gone quiet')}>
                                <Pill tone="warn">{h.quiet_issues}</Pill>
                              </CellButton>
                            : <span className="text-graphite text-xs">—</span>}
                        </TD>
                        <TD>
                          {h.open_issues > 0
                            ? <CellButton onClick={cell('open', 'open items')}>
                                <Code className="text-xs">{h.open_issues}</Code>
                              </CellButton>
                            : <span className="text-graphite text-xs">—</span>}
                        </TD>
                      </TR>
                    )
                  })}
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
                        <TD>
                          <RecordLink projectId={id} page="issues" reference={q.reference}>
                            <Code className="text-xs">{q.reference}</Code>
                          </RecordLink>
                        </TD>
                        <TD>
                          <RecordLink projectId={id} page="issues" reference={q.reference}>
                            {q.title}
                          </RecordLink>
                        </TD>
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

      {drawer && (
        <DetailDrawer
          projectId={id}
          title={drawer.title}
          note={drawer.note}
          items={drawer.items}
          loading={drawer.loading}
          onClose={() => setDrawer(null)}
        />
      )}
    </>
  )
}

/** A reference on the dashboard is a link to its record, which is the rule
 *  everywhere else in the product and was never applied here. */
function RecordLink({
  projectId, page, reference, children,
}: { projectId: string; page: string; reference: string; children: React.ReactNode }) {
  return (
    <Link
      to={`/project/${projectId}/${page}?ref=${encodeURIComponent(reference)}`}
      className="hover:underline"
    >
      {children}
    </Link>
  )
}

/** A tallied number in a table cell, made openable without turning the cell
 *  into something that looks like a button. */
function CellButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className="focus-visible:ring-primary/40 rounded outline-none hover:brightness-125 focus-visible:ring-2">
      {children}
    </button>
  )
}

/** Which page a decision-queue row lives on. The queue mixes kinds, and each
 *  kind has its own register. */
function pageFor(kind: string): string {
  const k = kind.toLowerCase()
  if (k.includes('drawing') || k.includes('document')) return 'register'
  if (k.includes('change')) return 'changes-requests'
  if (k.includes('risk')) return 'risk'
  if (k.includes('material') || k.includes('sample')) return 'materials'
  if (k.includes('planning')) return 'planning'
  if (k.includes('building control')) return 'bc'
  return 'issues'
}

/**
 * The fee position as one bar.
 *
 * Proposed is a separate segment and is never folded into the total. A fee
 * report that mixes proposed with approved looks overspent and stops being
 * believed, so the only figure here that calls itself a total is the approved
 * one, and what has merely been asked for sits beside it in warn.
 */
function FeeBar({ fees }: { fees: FeePosition[] }) {
  const sum = (k: keyof FeePosition) =>
    fees.reduce((a, f) => a + Number(f[k] ?? 0), 0)
  const approved = sum('approved_total')
  const paid = sum('paid')
  const invoiced = sum('invoiced')
  const proposed = sum('fee_proposed') + sum('variations_proposed')
  if (approved === 0 && proposed === 0) return null

  return (
    <Panel kind="money" title="Fee position">
      <SegmentBar
        total={approved}
        segments={[
          { key: 'paid', label: 'paid', className: 'bg-ok',
            value: paid, display: gbp(paid) },
          { key: 'outstanding', label: 'invoiced, not paid', className: 'bg-primary',
            value: Math.max(0, invoiced - paid), display: gbp(Math.max(0, invoiced - paid)) },
        ]}
        remainder={{
          label: 'left to invoice',
          display: gbp(Math.max(0, approved - invoiced)),
        }}
        caption={
          <>
            {gbp(approved)} approved across {fees.length} appointment
            {fees.length === 1 ? '' : 's'}.
            {proposed > 0 && (
              <> <strong className="text-warn-ink">{gbp(proposed)} proposed and not
                agreed</strong> — outside the total above, because a proposal is not a fee.</>
            )}
          </>
        }
      />
    </Panel>
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
