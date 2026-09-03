import { useCallback, useEffect, useState } from 'react'
import { useOutletContext, useParams } from 'react-router'

import { RequireModule } from '@/components/shell/RequireModule'
import { Button } from '@/components/ui/button'
import { Eyebrow, Panel, PageHead } from '@/components/ui/panel'
import { Stat } from '@/components/ui/stat'
import { Code, Pill, Table, TableScroll, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { fmtDate } from '@/lib/format'
import {
  REPORT_AUDIENCE_LABELS,
  fetchMyReportAudiences, fetchProjectCompanies, fetchReportActivity, fetchReportAttention,
  fetchReportComingUp, fetchReportCompliance, fetchReportGoneQuiet, fetchReportHeader,
  fetchReportHealth, fetchReportMetrics, fetchReportPeriod,
  type ProjectCompany, type ReportActivityRow, type ReportAttentionRow, type ReportAudience,
  type ReportComingUpRow, type ReportComplianceRow, type ReportHeader, type ReportHealthRow,
  type ReportMetric, type ReportPeriod, type ReportPeriodKind, type ReportQuietRow,
} from '@/lib/queries'
import type { ProjectContext } from '@/pages/project/ProjectLayout'

/**
 * Period reports.
 *
 * Three audiences, one engine, three pages, nothing stored. Everything on this
 * screen is computed fresh when it is asked for — there is no draft, no saved
 * version and no document to go stale.
 *
 * The audience decides the content in the database, not here. There is
 * deliberately no `audience === 'client'` anywhere in this file except to
 * choose a heading: if a section is missing from a client report it is because
 * the query returned nothing, which is the only way to be sure the rule and
 * what is rendered cannot drift apart.
 *
 * PDF is window.print() against the print stylesheet in index.css. A second
 * rendering path would be a second place for the figures to be wrong.
 */
type Report = {
  header: ReportHeader
  metrics: ReportMetric[]
  compliance: ReportComplianceRow[]
  attention: ReportAttentionRow[]
  quiet: ReportQuietRow[]
  health: ReportHealthRow[]
  comingUp: ReportComingUpRow[]
  activity: ReportActivityRow[]
  period: ReportPeriod
}

export default function ReportsPage() {
  const { id = '' } = useParams()
  const ctx = useOutletContext<ProjectContext>()
  const [audiences, setAudiences] = useState<ReportAudience[]>([])
  const [audience, setAudience] = useState<ReportAudience | null>(null)
  const [kind, setKind] = useState<ReportPeriodKind>('week')
  const [companies, setCompanies] = useState<ProjectCompany[]>([])
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [report, setReport] = useState<Report | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // What this person may generate, and which company a consultant report is
  // about. Both are answered by the database; the picker only offers.
  useEffect(() => {
    Promise.all([fetchMyReportAudiences(id), fetchProjectCompanies(id)])
      .then(([a, co]) => {
        setAudiences(a)
        setCompanies(co)
        setAudience((prev) => prev && a.includes(prev) ? prev : (a[0] ?? null))
        setError(null)
      })
      .catch((e: Error) => setError(e.message))
  }, [id])

  const needsCompany = audience === 'consultant'
  const consultantChoices = companies.filter((c) => c.company_type !== 'client')

  useEffect(() => {
    if (!needsCompany) { setCompanyId(null); return }
    setCompanyId((prev) => prev ?? consultantChoices[0]?.id ?? null)
    // consultantChoices is derived from companies, which is the dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsCompany, companies])

  const load = useCallback(() => {
    if (!audience) return
    // A consultant generating their own report may not know their company id;
    // null lets the database resolve it, and refuses anything else.
    const co = needsCompany ? companyId : null
    if (needsCompany && !co && !ctx.isAccountAdmin && ctx.accountRole !== 'internal') {
      // fall through: the server resolves the caller's own company
    }
    setLoading(true)
    Promise.all([
      fetchReportHeader(id, audience, co),
      fetchReportMetrics(id, audience, co),
      fetchReportCompliance(id, audience, co),
      fetchReportAttention(id, audience, co),
      fetchReportGoneQuiet(id, audience, co),
      fetchReportHealth(id, audience, co),
      fetchReportComingUp(id, audience, co, kind),
      fetchReportActivity(id, audience, co, kind),
      fetchReportPeriod(kind),
    ])
      .then(([header, metrics, compliance, attention, quiet, health, comingUp, activity,
              period]) => {
        setReport({ header, metrics, compliance, attention, quiet, health, comingUp,
                    activity, period })
        setError(null)
      })
      .catch((e: Error) => { setReport(null); setError(e.message) })
      .finally(() => setLoading(false))
  }, [id, audience, companyId, kind, needsCompany, ctx.isAccountAdmin, ctx.accountRole])

  useEffect(load, [load])

  if (!audience && !error) {
    return <div className="text-graphite p-6 text-sm">Loading…</div>
  }

  return (
    <RequireModule module="reports">
      <div className="noprint">
        <PageHead
          eyebrow="Reports"
          title="Period report"
          meta="Three pages: today's state of play, what needs attention, then the period. Computed fresh — nothing is drafted or stored."
        />
      </div>

      {error && (
        <Panel kind="comply" className="noprint mb-4">
          <p className="text-stop text-sm">{error}</p>
        </Panel>
      )}

      <div className="noprint mb-4 flex flex-wrap items-end gap-2">
        {audiences.length > 1 && (
          <label>
            <span className="mb-1 block text-xs font-medium">Audience</span>
            <select
              value={audience ?? ''}
              onChange={(e) => setAudience(e.target.value as ReportAudience)}
              className="border-rule rounded border px-2 py-1.5 text-sm"
            >
              {audiences.map((a) => (
                <option key={a} value={a}>{REPORT_AUDIENCE_LABELS[a]}</option>
              ))}
            </select>
          </label>
        )}
        <label>
          <span className="mb-1 block text-xs font-medium">Period</span>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as ReportPeriodKind)}
            className="border-rule rounded border px-2 py-1.5 text-sm"
          >
            <option value="week">Weekly</option>
            <option value="month">Monthly</option>
          </select>
        </label>
        {needsCompany && consultantChoices.length > 0 && (
          <label>
            <span className="mb-1 block text-xs font-medium">Company</span>
            <select
              value={companyId ?? ''}
              onChange={(e) => setCompanyId(e.target.value || null)}
              className="border-rule min-w-[200px] rounded border px-2 py-1.5 text-sm"
            >
              {consultantChoices.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
        )}
        <Button size="sm" onClick={() => window.print()} disabled={!report}>
          Print / Save as PDF
        </Button>
        {report && (
          <span className="text-graphite text-xs">{report.period.label}</span>
        )}
      </div>

      {loading && <div className="text-graphite noprint p-6 text-sm">Building the report…</div>}

      {report && !loading && (
        <div className="print-root">
          <SheetOne report={report} />
          <SheetTwo report={report} />
          <SheetThree report={report} />
        </div>
      )}
    </RequireModule>
  )
}

/** The header strip repeated at the top of each sheet, so a page that gets
 *  separated from the others still says what it is and who it is about. */
function SheetHeader({
  header, page, subtitle,
}: { header: ReportHeader; page: number; subtitle: string }) {
  return (
    // The title block, as a drawing office draws one: a strip of readouts with
    // hairline dividers, each under its own eyebrow. Same content as before;
    // the rules are 1px and the readouts are the brand and the ink, not black
    // boxes.
    <div className="border-glass-line mb-3 grid grid-cols-[auto_1fr_auto] divide-x divide-glass-line border-y">
      <div className="py-2 pr-4">
        <Eyebrow>Project</Eyebrow>
        <Code className="text-primary text-base font-semibold">{header.project_code}</Code>
      </div>
      <div className="px-4 py-2">
        <Eyebrow>{header.title}</Eyebrow>
        <p className="text-sm font-semibold">{header.project_name}</p>
        <p className="text-graphite text-xs">{subtitle}</p>
      </div>
      <div className="py-2 pl-4 text-right">
        {page === 1 ? (
          <>
            <Eyebrow>Generated</Eyebrow>
            <p className="font-mono text-sm">{fmtDate(header.generated_on)}</p>
            {header.generated_by && <p className="text-graphite text-xs">by {header.generated_by}</p>}
          </>
        ) : (
          <>
            <Eyebrow>Sheet</Eyebrow>
            <p className="font-mono text-sm">{page} of 3</p>
          </>
        )}
      </div>
    </div>
  )
}

function SheetOne({ report }: { report: Report }) {
  const { header, metrics, compliance } = report
  return (
    <section className="report-sheet glass mb-4 rounded-lg p-5">
      <SheetHeader header={header} page={1} subtitle={report.period.label} />
      <h2 className="mb-3 text-base font-bold">State of play</h2>

      <div className="report-block mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {metrics.map((m) => (
          <Stat
            key={m.sort_order}
            label={m.label}
            value={m.value}
            tone={m.alert ? 'warn' : 'plain'}
            hint={m.tail && <strong className="text-warn-ink">{m.tail}</strong>}
          />
        ))}
      </div>

      {compliance.length > 0 && (
        <div className="report-block mb-4">
          <h3 className="mb-2 text-sm font-semibold">Compliance and checklists, by type</h3>
          <TableScroll>
            <Table>
              <THead>
                <TR>
                  <TH>Type</TH>
                  <TH className="w-[80px]">Done</TH>
                  <TH className="w-[130px]">State</TH>
                </TR>
              </THead>
              <TBody>
                {compliance.map((r) => (
                  <TR key={r.kind}>
                    <TD>{r.label}</TD>
                    <TD><Code className="text-xs">{r.done}/{r.total}</Code></TD>
                    <TD>
                      {r.overdue > 0
                        ? <Pill tone="stop">{r.overdue} overdue</Pill>
                        : r.done === r.total
                          ? <Pill tone="ok">Complete</Pill>
                          : <Pill tone="neutral">On course</Pill>}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableScroll>
          <p className="text-graphite mt-2 max-w-prose text-xs">
            Every type carries its own row. A merged total cannot answer "which one is
            behind?", which is the first question anyone asks of this section.
          </p>
        </div>
      )}

      {/* The stated omissions, on the document itself. */}
      <p className="text-graphite border-rule mt-4 border-t pt-2 text-xs">
        {header.exclusions}
      </p>
    </section>
  )
}

function SheetTwo({ report }: { report: Report }) {
  const { header, attention, quiet, health, comingUp } = report
  const heading = header.audience === 'internal' ? 'Open decisions'
    : header.audience === 'client' ? 'Awaiting your decision'
      : 'Awaiting our decision'

  return (
    <section className="report-sheet glass mb-4 rounded-lg p-5">
      <SheetHeader header={header} page={2} subtitle="Needs attention" />

      <div className="report-block mb-4">
        <h3 className="mb-2 text-sm font-semibold">{heading}</h3>
        {attention.length === 0 ? (
          <p className="text-graphite text-sm">Nothing outstanding.</p>
        ) : (
          <TableScroll>
            <Table>
              <THead>
                <TR>
                  <TH className="w-[210px]">What</TH>
                  <TH className="w-[90px]">Ref</TH>
                  <TH>Item</TH>
                  <TH className="w-[92px]">Due</TH>
                </TR>
              </THead>
              <TBody>
                {attention.slice(0, 12).map((a, i) => (
                  <TR key={`${a.reference}-${i}`}>
                    <TD><Pill tone={a.tone}>{a.kind}</Pill></TD>
                    <TD><Code className="text-xs">{a.reference}</Code></TD>
                    <TD>{a.title}</TD>
                    <TD><Code className="text-graphite text-xs">{fmtDate(a.due)}</Code></TD>
                  </TR>
                ))}
                {attention.length > 12 && (
                  <TR>
                    <TD colSpan={4} className="text-graphite text-xs">
                      and {attention.length - 12} more
                    </TD>
                  </TR>
                )}
              </TBody>
            </Table>
          </TableScroll>
        )}
      </div>

      {/* Withheld from the client by the query, not by a condition here. */}
      {quiet.length > 0 && (
        <div className="report-block mb-4">
          <h3 className="mb-2 text-sm font-semibold">Gone quiet</h3>
          <TableScroll>
            <Table>
              <THead>
                <TR>
                  <TH className="w-[90px]">Ref</TH>
                  <TH>Item</TH>
                  <TH className="w-[110px]">Last touched</TH>
                </TR>
              </THead>
              <TBody>
                {quiet.slice(0, 8).map((q) => (
                  <TR key={q.reference}>
                    <TD><Code className="text-xs">{q.reference}</Code></TD>
                    <TD>{q.title}</TD>
                    <TD>
                      <Code className="text-graphite text-xs">{q.days_quiet}d ago</Code>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableScroll>
          <p className="text-graphite mt-2 max-w-prose text-xs">
            Open, and nobody has said anything about it for three weeks. Silence, not age —
            an item being old is not the finding.
          </p>
        </div>
      )}

      {health.length > 0 && (
        <div className="report-block mb-4">
          <h3 className="mb-2 text-sm font-semibold">Consultant health</h3>
          <TableScroll>
            <Table>
              <THead>
                <TR>
                  <TH>Company</TH>
                  <TH className="w-[100px]">Appt gaps</TH>
                  <TH className="w-[110px]">Overdue dwgs</TH>
                  <TH className="w-[92px]">Open</TH>
                  <TH className="w-[92px]">Quiet</TH>
                </TR>
              </THead>
              <TBody>
                {health.slice(0, 6).map((h) => (
                  <TR key={h.company_id}>
                    <TD>{h.company_name}</TD>
                    <TD><Code className="text-xs">{h.appointment_gaps}</Code></TD>
                    <TD><Code className="text-xs">{h.overdue_drawings}</Code></TD>
                    <TD><Code className="text-graphite text-xs">{h.open_issues}</Code></TD>
                    <TD><Code className="text-xs">{h.quiet_issues}</Code></TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableScroll>
          <p className="text-graphite mt-2 max-w-prose text-xs">
            Worst first. An order, never a grade — a letter would invite an argument about the
            mark rather than about the facts under it. Open items are not in the order: a busy
            consultant is not a worrying one.
          </p>
        </div>
      )}

      <div className="report-block">
        <h3 className="mb-2 text-sm font-semibold">Coming up</h3>
        {comingUp.length === 0 ? (
          <p className="text-graphite text-sm">Nothing falls due in the next period.</p>
        ) : (
          <TableScroll>
            <Table>
              <THead>
                <TR>
                  <TH className="w-[80px]">Line</TH>
                  <TH>Description</TH>
                  <TH className="w-[100px]">Finishes</TH>
                </TR>
              </THead>
              <TBody>
                {comingUp.slice(0, 8).map((c) => (
                  <TR key={c.task_uid}>
                    <TD><Code className="text-xs">{c.task_uid}</Code></TD>
                    <TD>
                      {c.description}
                      {c.is_milestone && <Pill tone="neutral" className="ml-1.5">Milestone</Pill>}
                    </TD>
                    <TD><Code className="text-xs">{fmtDate(c.finish_date)}</Code></TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableScroll>
        )}
        <p className="text-graphite mt-2 max-w-prose text-xs">
          The same for every audience. A date is not commercially sensitive, and knowing what
          is coming is what a report like this is for.
        </p>
      </div>
    </section>
  )
}

function SheetThree({ report }: { report: Report }) {
  const { header, activity } = report
  return (
    <section className="report-sheet glass mb-4 rounded-lg p-5">
      <SheetHeader header={header} page={3} subtitle={`The period — ${report.period.label}`} />
      <h2 className="mb-3 text-base font-bold">What happened</h2>

      {activity.length === 0 ? (
        <p className="text-graphite text-sm">Nothing recorded in this period.</p>
      ) : (
        <div className="grid gap-3">
          {activity.map((a) => (
            <div key={a.sort_order} className="report-block border-l-primary/40 border-l-2 pl-3">
              <h3 className="text-sm font-semibold">{a.section}</h3>
              <p className="text-sm">{a.headline}</p>
              {a.detail.length > 0 && (
                <ul className="text-graphite mt-1 text-xs">
                  {a.detail.map((d, i) => (
                    <li key={i} className="py-px">{d}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}

      <p className="text-graphite border-rule mt-4 border-t pt-2 text-xs">
        {header.exclusions}
      </p>
    </section>
  )
}
