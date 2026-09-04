import { useCallback, useEffect, useMemo, useState } from 'react'
import { useOutletContext, useParams } from 'react-router'

import { IssueDetail } from '@/components/issues/IssueDetail'
import { RaiseIssue } from '@/components/issues/RaiseIssue'
import { Button } from '@/components/ui/button'
import { Panel, PageHead } from '@/components/ui/panel'
import { Code, Pill, Table, TableScroll, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { ISSUE_KIND_LABELS, fetchIssues, type Issue } from '@/lib/queries'
import { useDeepLink } from '@/lib/deep-link'
import type { ProjectContext } from '@/pages/project/ProjectLayout'

const fmt = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })
    : '—'

type Filter = 'open' | 'mine' | 'rfi' | 'all'

export default function IssuesPage() {
  const { id = '' } = useParams()
  const ctx = useOutletContext<ProjectContext>()
  const [rows, setRows] = useState<Issue[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('open')
  const [raising, setRaising] = useState<'irs' | 'rfi' | null>(null)
  const [detail, setDetail] = useState<Issue | null>(null)
  // A link from the dashboard names a reference; open it and light its row.
  const link = useDeepLink(rows, (r, ref) => r.reference === ref, setDetail)

  const load = useCallback(() => {
    fetchIssues(id)
      .then((r) => { setRows(r); setError(null) })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [id])

  useEffect(load, [load])

  const mine = useMemo(() => new Set(
    ctx.members.filter((m) => m.profile_id === ctx.me).map((m) => m.profile_id)), [ctx])

  const visible = useMemo(() => rows.filter((r) =>
    // A reference arrived from elsewhere is always shown, whatever the
    // filter: a link that lands on an empty list reads as a broken link.
    link.isTarget(r.reference) ? true :
    filter === 'all' ? true
    : filter === 'open' ? r.status === 'Open'
    : filter === 'rfi' ? r.source_kind === 'rfi'
    : r.raised_by === ctx.me || mine.has(r.raised_by ?? '')),
    [rows, filter, ctx.me, mine, link])

  const counts = {
    open: rows.filter((r) => r.status === 'Open').length,
    overdue: rows.filter((r) => r.overdue).length,
    rfi: rows.filter((r) => r.source_kind === 'rfi' && r.rfi_status === 'Open').length,
  }

  if (loading) return <div className="text-graphite p-6 text-sm">Loading…</div>

  return (
    <>
      <PageHead
        eyebrow="Design"
        title="Tasks and RFIs"
        meta="One store. A task, a question and an action from a meeting are the same record."
        actions={
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => setRaising('rfi')}>
              Raise an RFI
            </Button>
            <Button size="sm" onClick={() => setRaising('irs')}>Raise a task</Button>
          </div>
        }
      />

      {error && (
        <Panel kind="comply" className="mb-4">
          <p className="text-stop text-sm">{error}</p>
        </Panel>
      )}

      {rows.length === 0 ? (
        <Panel title="Nothing raised yet">
          <p className="text-graphite max-w-prose text-sm">
            Tasks, RFIs, actions from a discussion and items from a meeting all live here — one
            store with a column saying where each came from, so nothing falls between two lists.
          </p>
        </Panel>
      ) : (
        <Panel
          title={`${visible.length} of ${rows.length}`}
          actions={
            <div className="flex gap-1">
              {([
                ['open', `Open (${counts.open})`],
                ['rfi', `RFIs awaiting an answer (${counts.rfi})`],
                ['mine', 'Raised by me'],
                ['all', 'All'],
              ] as const).map(([k, label]) => (
                <Button
                  key={k}
                  size="sm"
                  variant={filter === k ? 'secondary' : 'ghost'}
                  onClick={() => setFilter(k)}
                >
                  {label}
                </Button>
              ))}
            </div>
          }
        >
          {counts.overdue > 0 && (
            <p className="text-graphite mb-2 text-xs">
              {counts.overdue} past its date. Urgency below is priority plus time pressure,
              capped at 100 — hover a score to see the sum.
            </p>
          )}
          <TableScroll>
            <Table>
              <THead>
                <TR>
                  <TH className="w-[82px]">Ref</TH>
                  <TH>Title</TH>
                  <TH className="w-[130px]">Kind</TH>
                  <TH className="w-[96px]">Due</TH>
                  <TH className="w-[74px]">Urgency</TH>
                  <TH className="w-[104px]">Status</TH>
                </TR>
              </THead>
              <TBody>
                {visible.map((r) => (
                  <TR key={r.id} data-ref={r.reference}
                    gap={link.isTarget(r.reference)}
                    muted={r.status === 'Closed'}>
                    <TD>
                      <button
                        type="button"
                        onClick={() => setDetail(r)}
                        className="text-primary cursor-pointer hover:underline"
                      >
                        <Code>{r.reference}</Code>
                      </button>
                    </TD>
                    <TD>{r.title}</TD>
                    <TD className="text-graphite text-xs">
                      {ISSUE_KIND_LABELS[r.source_kind]}
                    </TD>
                    <TD>
                      <Code className="text-graphite text-xs">{fmt(r.due)}</Code>
                      {r.anchor_state === 'removed' && (
                        <span
                          className="text-stop ml-1 text-xs"
                          title="The programme line this is dated from has left the programme"
                        >
                          ⚠
                        </span>
                      )}
                    </TD>
                    <TD>
                      <Code
                        className="text-xs"
                        title={`priority ${r.priority} + time pressure = ${r.urgency}`}
                      >
                        {r.urgency}
                      </Code>
                    </TD>
                    <TD>
                      {r.status === 'Closed' ? <Pill tone="ok">Closed</Pill>
                        : r.overdue ? <Pill tone="stop">Overdue</Pill>
                        : r.source_kind === 'rfi' && r.rfi_status === 'Open'
                          ? <Pill tone="warn">Awaiting answer</Pill>
                        : <Pill tone="neutral">Open</Pill>}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableScroll>
        </Panel>
      )}

      {raising && (
        <RaiseIssue
          projectId={id}
          kind={raising}
          onClose={() => setRaising(null)}
          onRaised={() => { setRaising(null); load() }}
        />
      )}

      {detail && (
        <IssueDetail
          projectId={id}
          issue={detail}
          canReview={ctx.canEdit}
          onClose={() => setDetail(null)}
          onChanged={load}
        />
      )}
    </>
  )
}
