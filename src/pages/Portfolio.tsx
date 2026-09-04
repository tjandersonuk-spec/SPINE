import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'

import { TrendChart } from '@/components/charts/TrendChart'
import { Button } from '@/components/ui/button'
import { Stat } from '@/components/ui/stat'
import { Panel, PageHead } from '@/components/ui/panel'
import { Code, Pill, Table, TableScroll, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { fmtDate, gbp } from '@/lib/format'
import {
  fetchMyDecisions, fetchPortfolioHealth, fetchPortfolioProjects, fetchPortfolioSummary,
  fetchPortfolioTrend,
  type MyDecision, type PortfolioHealthRow, type PortfolioProject,
  type PortfolioSummary, type PortfolioTrendPoint,
} from '@/lib/queries'

/**
 * The portfolio view: the account above a single project.
 *
 * Every figure is the one the project pages already compute — the only new code
 * is the roll-up, which is what keeps this page and a project page from ever
 * disagreeing in front of somebody who has both open.
 *
 * The exception is the trend, which reads the snapshot table, because a trend
 * needs facts about dates rather than facts about now.
 */
type Tab = 'projects' | 'decisions' | 'companies' | 'trends'

export default function Portfolio() {
  const [tab, setTab] = useState<Tab>('projects')
  const [projects, setProjects] = useState<PortfolioProject[]>([])
  const [summary, setSummary] = useState<PortfolioSummary | null>(null)
  const [decisions, setDecisions] = useState<MyDecision[]>([])
  const [health, setHealth] = useState<PortfolioHealthRow[]>([])
  const [trend, setTrend] = useState<PortfolioTrendPoint[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    Promise.all([
      fetchPortfolioProjects(), fetchPortfolioSummary(), fetchMyDecisions(),
      fetchPortfolioHealth(), fetchPortfolioTrend(),
    ])
      .then(([p, s, d, h, t]) => {
        setProjects(p); setSummary(s); setDecisions(d); setHealth(h); setTrend(t)
        setError(null)
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(load, [load])

  if (loading) {
    return <>
      <PageHead title="Portfolio" /><p className="text-graphite text-sm">Loading…</p></>
  }

  return (
    <>
      <PageHead title="Portfolio" />
      {error && (
        <Panel kind="comply" className="mb-4"><p className="text-stop text-sm">{error}</p></Panel>
      )}

      {projects.length === 0 ? (
        <Panel title="No projects yet">
          <p className="text-graphite max-w-prose text-sm">
            Projects appear here once you are a member of one. A confirmed login with no
            memberships is a normal state, not an error.
          </p>
          <div className="mt-3">
            <Button asChild size="sm" variant="secondary"><Link to="/">Back</Link></Button>
          </div>
        </Panel>
      ) : (
        <>
          {summary && (
            <div className="mb-4 flex flex-wrap gap-5">
              <Figure n={summary.projects} label="Live projects" />
              {summary.stop_works > 0 && (
                <Figure n={summary.stop_works} label="Work must stop" tone="stop" />
              )}
              <Figure n={summary.overdue_documents} label="Documents overdue"
                tone={summary.overdue_documents > 0 ? 'warn' : undefined} />
              <Figure n={summary.drm_gaps} label="Matrix gaps"
                tone={summary.drm_gaps > 0 ? 'gap' : undefined} />
              <Figure n={summary.decisions_waiting} label="Decisions waiting" />
              <Figure n={decisions.length} label="Waiting on you" />
            </div>
          )}

          <div className="mb-4 flex flex-wrap gap-1">
            {([['projects', `Projects (${projects.length})`],
               ['decisions', `Waiting on you (${decisions.length})`],
               ['companies', `Companies (${health.length})`],
               ['trends', 'Trends']] as [Tab, string][]).map(([k, label]) => (
              <Button
                key={k} size="sm"
                variant={tab === k ? 'secondary' : 'ghost'}
                onClick={() => { if (tab !== k) setTab(k) }}
              >
                {label}
              </Button>
            ))}
          </div>

          {tab === 'projects' && <Projects rows={projects} />}
          {tab === 'decisions' && <Decisions rows={decisions} />}
          {tab === 'companies' && <Companies rows={health} />}
          {tab === 'trends' && <Trends points={trend} />}
        </>
      )}
    </>
  )
}

function Figure({
  n, label, tone,
}: { n: number; label: string; tone?: 'stop' | 'warn' | 'gap' }) {
  return <Stat label={label} value={n} tone={tone} className="mb-0 min-w-[140px]" />
}

function Projects({ rows }: { rows: PortfolioProject[] }) {
  return (
    <Panel title="Every project, worst first">
      <TableScroll>
        <Table>
          <THead>
            <TR>
              <TH className="w-[92px]">Code</TH>
              <TH>Project</TH>
              <TH className="w-[64px]">Stage</TH>
              <TH className="w-[130px]">Programme</TH>
              <TH className="w-[86px]">Overdue</TH>
              <TH className="w-[80px]">Gaps</TH>
              <TH className="w-[92px]">Decisions</TH>
              <TH className="w-[110px]">Client reqs</TH>
              <TH className="w-[120px]">Watch</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((p) => (
              <TR key={p.project_id} gap={p.drm_gaps > 0}>
                <TD>
                  <Link to={`/project/${p.project_id}`} className="underline-offset-2 hover:underline">
                    <Code className="text-xs">{p.code}</Code>
                  </Link>
                </TD>
                <TD>
                  <Link to={`/project/${p.project_id}`} className="underline-offset-2 hover:underline">
                    {p.name}
                  </Link>
                  <div className="text-graphite text-xs">{p.account_name}</div>
                </TD>
                <TD><Code className="text-xs">{p.stage ?? '—'}</Code></TD>
                <TD>
                  {/* The same strip the project dashboard draws, from the one
                      timeline function. */}
                  <div className="bg-surface-2 border-rule relative h-3 w-full rounded border">
                    <div className="bg-brand absolute inset-y-0 left-0 rounded-l"
                      style={{ width: `${Math.min(100, p.percent_complete)}%` }} />
                    <div className="bg-graphite absolute inset-y-[-2px] w-px"
                      style={{ left: `${Math.min(100, p.percent_elapsed)}%` }} />
                  </div>
                  <div className="text-graphite mt-0.5 text-[11px]">
                    {p.percent_complete}% done · {p.percent_elapsed}% elapsed
                  </div>
                </TD>
                <TD>
                  <Code className={'text-xs ' + (p.overdue_documents ? 'text-stop' : 'text-graphite')}>
                    {p.overdue_documents}
                  </Code>
                </TD>
                <TD>
                  <Code className={'text-xs ' + (p.drm_gaps ? '' : 'text-graphite')}>
                    {p.drm_gaps}
                  </Code>
                </TD>
                <TD><Code className="text-xs">{p.decisions_waiting}</Code></TD>
                <TD>
                  <Code className="text-xs">
                    {p.client_total ? `${p.client_done}/${p.client_total}` : '—'}
                  </Code>
                </TD>
                <TD>
                  <div className="flex flex-col gap-0.5">
                    {p.stop_works > 0 && <Pill tone="stop">Work must stop</Pill>}
                    {p.hrb && <Pill tone="neutral">Higher-risk</Pill>}
                  </div>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </TableScroll>
      <p className="text-graphite mt-3 max-w-prose text-xs">
        The order is the judgement and the columns are the evidence — a stop-work outranks
        everything, because it is the only entry here that means somebody must put their tools
        down. Every figure is the one the project's own pages compute.
      </p>
    </Panel>
  )
}

function Decisions({ rows }: { rows: MyDecision[] }) {
  if (rows.length === 0) {
    return (
      <Panel title="Nothing waiting on you">
        <p className="text-graphite max-w-prose text-sm">
          Across every project you are on. This is the personal queue — it answers "what is
          waiting on me", which is a different question from what a report asks.
        </p>
      </Panel>
    )
  }
  return (
    <Panel title={`${rows.length} waiting on you, across every project`}>
      <TableScroll>
        <Table>
          <THead>
            <TR>
              <TH className="w-[92px]">Project</TH>
              <TH className="w-[190px]">What</TH>
              <TH className="w-[92px]">Ref</TH>
              <TH>Item</TH>
              <TH className="w-[92px]">Due</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((d) => (
              <TR key={`${d.project_id}-${d.record_id}`}>
                <TD>
                  <Link to={`/project/${d.project_id}`} className="underline-offset-2 hover:underline">
                    <Code className="text-xs">{d.project_code}</Code>
                  </Link>
                </TD>
                <TD className="text-xs">{d.kind}</TD>
                <TD><Code className="text-xs">{d.reference}</Code></TD>
                <TD>{d.title}</TD>
                <TD><Code className="text-graphite text-xs">{fmtDate(d.due)}</Code></TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </TableScroll>
    </Panel>
  )
}

function Companies({ rows }: { rows: PortfolioHealthRow[] }) {
  if (rows.length === 0) {
    return (
      <Panel title="Not available to you">
        <p className="text-graphite max-w-prose text-sm">
          Consultant health never leaves the contractor's own staff. It names firms and ranks
          them, and a consultant reading their own position against a rival's is not what it
          is for.
        </p>
      </Panel>
    )
  }
  return (
    <Panel title="Companies, summed across every project they are on">
      <TableScroll>
        <Table>
          <THead>
            <TR>
              <TH>Company</TH>
              <TH className="w-[80px]">Projects</TH>
              <TH className="w-[100px]">Appt gaps</TH>
              <TH className="w-[110px]">Overdue dwgs</TH>
              <TH className="w-[80px]">Open</TH>
              <TH className="w-[80px]">Quiet</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((h) => (
              <TR key={h.catalogue_company_id}>
                <TD>{h.company_name}</TD>
                <TD><Code className="text-xs">{h.projects}</Code></TD>
                <TD><Code className="text-xs">{h.appointment_gaps}</Code></TD>
                <TD><Code className="text-xs">{h.overdue_drawings}</Code></TD>
                <TD><Code className="text-graphite text-xs">{h.open_issues}</Code></TD>
                <TD><Code className="text-xs">{h.quiet_issues}</Code></TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </TableScroll>
      <p className="text-graphite mt-3 max-w-prose text-xs">
        A consultant who is fine on one job and behind on three is a conversation the
        per-project view cannot start. Worst first, and an order rather than a grade: open
        items are not in it, because a busy consultant is not a worrying one.
      </p>
    </Panel>
  )
}

function Trends({ points }: { points: PortfolioTrendPoint[] }) {
  return (
    <>
      <Panel title="Drawing register burn-up">
        <TrendChart
          points={points as unknown as Record<string, number | string>[]}
          series={[
            { key: 'anticipated', label: 'Anticipated', className: 'stroke-graphite', dashed: true },
            { key: 'issued', label: 'Issued', className: 'stroke-brand' },
            { key: 'overdue', label: 'Overdue', className: 'stroke-stop' },
          ]}
        />
      </Panel>
      <Panel title="Expected risk value over time">
        <TrendChart
          points={points as unknown as Record<string, number | string>[]}
          series={[{ key: 'risk_expected', label: 'Expected value', className: 'stroke-warn' }]}
          format={(v) => gbp(v)}
        />
        <p className="text-graphite mt-3 max-w-prose text-xs">
          Expected value, the same figure the register reports — never the gross total. Both
          charts read the nightly snapshot table, which is the one place a derived value is
          stored: yesterday's overdue count cannot be recomputed, because the register has
          moved since. No live page reads from it.
        </p>
      </Panel>
    </>
  )
}
