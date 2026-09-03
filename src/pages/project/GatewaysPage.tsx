import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'

import { RequireModule } from '@/components/shell/RequireModule'
import { ErrorNote } from '@/components/ui/notes'
import { Eyebrow, Panel, PageHead } from '@/components/ui/panel'
import { Stat } from '@/components/ui/stat'
import { Code, Pill, Table, TableScroll, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { fmtDate } from '@/lib/format'
import {
  fetchChangeRequests, fetchGoldenThreadMoved, fetchGoldenThreadNeverIssued, fetchHrbSettings,
  fetchTrackedItems, type ChangeRequest, type GoldenThreadRow, type TrackedItem,
} from '@/lib/queries'

/**
 * The gateways, end to end.
 *
 * Nothing on this page is a new fact. It is the three statutory hold points of
 * a higher-risk building read off the records that already carry them: the
 * building control checklist, the golden thread derivations, and the change
 * control classification that decides whether work may proceed at all.
 *
 * The page refuses to be vague about the one thing that matters. A gateway is
 * either passed, or it is not, and if it is not then the specific things
 * standing in the way are listed rather than summarised. A count is not an
 * answer to "can we start".
 *
 * For a building that is not higher-risk the page says so plainly instead of
 * showing three empty gateways, because an empty gateway reads as an
 * outstanding one.
 */
type Hrb = Awaited<ReturnType<typeof fetchHrbSettings>>

const PASSED = 'passed'
const OPEN = 'open'

export default function GatewaysPage() {
  const { id = '' } = useParams()
  const [hrb, setHrb] = useState<Hrb | null>(null)
  const [bc, setBc] = useState<TrackedItem[]>([])
  const [planning, setPlanning] = useState<TrackedItem[]>([])
  const [handover, setHandover] = useState<TrackedItem[]>([])
  const [moved, setMoved] = useState<GoldenThreadRow[]>([])
  const [never, setNever] = useState<GoldenThreadRow[]>([])
  const [changes, setChanges] = useState<ChangeRequest[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    Promise.all([
      fetchHrbSettings(id), fetchTrackedItems(id, 'bc'), fetchTrackedItems(id, 'planning'),
      fetchTrackedItems(id, 'checklist:handover'), fetchGoldenThreadMoved(id),
      fetchGoldenThreadNeverIssued(id), fetchChangeRequests(id),
    ])
      .then(([h, b, p, ho, m, n, c]) => {
        setHrb(h); setBc(b); setPlanning(p); setHandover(ho)
        setMoved(m); setNever(n); setChanges(c); setError(null)
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [id])

  useEffect(load, [load])

  if (loading) return <div className="text-graphite p-6 text-sm">Loading…</div>
  if (error) return <ErrorNote message={error} />

  const outstanding = (rows: TrackedItem[], heading?: string) =>
    rows.filter((r) => r.required && !r.is_done && (!heading || r.heading === heading))

  // Gateway 1 is the planning stage. It is passed when the pre-commencement
  // conditions are discharged, which is the same list the planning page shows.
  const g1Open = outstanding(planning).filter((r) => r.heading === 'Pre-commencement')
  const g1 = g1Open.length === 0 ? PASSED : OPEN

  // Gateway 2 is a fact rather than a derivation: the regulator either approved
  // it or did not, and the reference and date are stamped once.
  const g2 = hrb?.g2_approved_date ? PASSED : OPEN
  const g2Open = outstanding(bc, 'Gateway 2')

  // Gateway 3 is everything that has to be true before occupation, and the
  // golden thread findings are part of it rather than a separate concern.
  const g3Open = outstanding(bc, 'Gateway 3')
  const handoverOpen = outstanding(handover).filter((r) => r.heading === 'Statutory')
  const g3 = g3Open.length === 0 && handoverOpen.length === 0 && never.length === 0
    ? PASSED : OPEN

  const stopped = changes.filter((c) => c.bsa_verdict === 'stop')

  if (hrb && !hrb.hrb) {
    return (
      <RequireModule module="gateways">
        <PageHead
          eyebrow="Handover"
          title="Gateways"
          meta="This building is not higher-risk."
        />
        <Panel title="No gateways apply">
          <p className="text-graphite max-w-prose text-sm">
            The gateway regime applies to higher-risk buildings. This project is not
            recorded as one, so there is no gateway 2 approval to obtain and no gateway 3
            application to make. Building control still applies and is tracked on its own
            page.
          </p>
          <p className="text-graphite mt-3 max-w-prose text-sm">
            If that is wrong, the higher-risk determination is set in{' '}
            <Link to={`/project/${id}/bsa`} className="underline underline-offset-2">
              building safety
            </Link>
            . It is a determination about the building, not a setting, so it is recorded
            with the reason behind it.
          </p>
        </Panel>
      </RequireModule>
    )
  }

  return (
    <RequireModule module="gateways">
      <PageHead
        eyebrow="Handover"
        title="Gateways"
        meta={hrb?.hrb_reason ?? 'Higher-risk building.'}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Stat
          label="Gateway 1 — planning"
          value={g1 === PASSED ? 'Passed' : `${g1Open.length} open`}
          tone={g1 === PASSED ? 'plain' : 'warn'}
          hint="Pre-commencement planning conditions"
        />
        <Stat
          label="Gateway 2 — before construction"
          value={g2 === PASSED ? 'Approved' : 'Not approved'}
          tone={g2 === PASSED ? 'plain' : 'stop'}
          hint={hrb?.g2_approved_date
            ? `${hrb.g2_reference ?? 'approved'} · ${fmtDate(hrb.g2_approved_date)}`
            : 'Construction may not begin'}
        />
        <Stat
          label="Gateway 3 — before occupation"
          value={g3 === PASSED ? 'Ready' : `${g3Open.length + handoverOpen.length + never.length} open`}
          tone={g3 === PASSED ? 'plain' : 'warn'}
          hint="Completion certificate and the golden thread"
        />
      </div>

      {/* ---- gateway 2 ---- */}
      <Panel title="Gateway 2 — before construction begins" kind="comply">
        {g2 === PASSED ? (
          <div className="mb-3 flex flex-wrap items-baseline gap-3 text-sm">
            <Pill tone="ok">Approved</Pill>
            <span>
              Reference <Code>{hrb?.g2_reference ?? '—'}</Code>, approved{' '}
              {fmtDate(hrb?.g2_approved_date ?? null)}.
            </span>
          </div>
        ) : (
          <p className="text-stop-ink mb-3 text-sm font-medium">
            Not approved. Construction of a higher-risk building may not begin.
          </p>
        )}

        <p className="text-graphite mb-3 max-w-prose text-xs">
          The revision current at approval is stamped once and cannot be changed. Everything
          issued since is a golden thread finding, below, rather than a quiet replacement.
          {hrb?.commencement_notified && (
            <> Commencement was notified on {fmtDate(hrb.commencement_notified)}.</>
          )}
        </p>

        <Outstanding rows={g2Open} empty="Every gateway 2 item is complete." />
      </Panel>

      {/* ---- change control ---- */}
      <Panel
        title="Change control after gateway 2"
        kind={stopped.length > 0 ? 'comply' : 'plain'}
      >
        {stopped.length === 0 ? (
          <p className="text-graphite text-sm">
            No change is currently stopping work. A notifiable change still inside its
            objection window is shown on the change requests page with the date the window
            closes.
          </p>
        ) : (
          <>
            <p className="text-stop-ink mb-3 text-sm font-medium">
              {stopped.length} change{stopped.length === 1 ? '' : 's'} where work must not
              proceed.
            </p>
            <TableScroll>
              <Table>
                <THead>
                  <TR>
                    <TH className="w-[90px]">Reference</TH>
                    <TH>Change</TH>
                    <TH className="w-[130px]">Class</TH>
                    <TH>Why</TH>
                  </TR>
                </THead>
                <TBody>
                  {stopped.map((c) => (
                    <TR key={c.id}>
                      <TD>
                        <Link
                          to={`/project/${id}/changes-requests`}
                          className="underline-offset-2 hover:underline"
                        >
                          <Code>{c.reference}</Code>
                        </Link>
                      </TD>
                      <TD>{c.title}</TD>
                      <TD>
                        <Pill tone="stop">{c.bsa_class ?? 'Unclassified'}</Pill>
                      </TD>
                      <TD className="text-graphite text-xs">{c.bsa_detail}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableScroll>
          </>
        )}
      </Panel>

      {/* ---- golden thread ---- */}
      <Panel title="Golden thread" kind={never.length > 0 ? 'comply' : 'evidence'}>
        <div className="mb-3 grid gap-3 sm:grid-cols-2">
          <Stat
            label="Issued again since gateway 2"
            value={moved.length}
            tone={moved.length > 0 ? 'warn' : 'plain'}
            className="mb-0"
          />
          <Stat
            label="On the thread, never issued"
            value={never.length}
            tone={never.length > 0 ? 'stop' : 'plain'}
            className="mb-0"
          />
        </div>
        <p className="text-graphite mb-3 max-w-prose text-xs">
          These are two different findings and are reported separately on purpose. A drawing
          that moved has a revision to account for; a drawing that never went out at all has
          nothing behind it.
        </p>
        {never.length > 0 && (
          <>
            <Eyebrow className="mb-1.5">Never issued</Eyebrow>
            <ul className="mb-3">
              {never.map((d) => (
                <li key={d.drawing_id} className="py-px text-sm">
                  <Code>{d.document_number}</Code>{' '}
                  <span className="text-graphite">{d.title}</span>
                </li>
              ))}
            </ul>
          </>
        )}
        <Link
          to={`/project/${id}/bsa`}
          className="text-primary text-sm underline-offset-2 hover:underline"
        >
          Open building safety
        </Link>
      </Panel>

      {/* ---- gateway 3 ---- */}
      <Panel title="Gateway 3 — before occupation">
        <p className="text-graphite mb-3 max-w-prose text-xs">
          The completion certificate application, and the information that has to be handed
          to the accountable person with it. A drawing that never went out is outstanding
          here too, which is why it appears above.
        </p>
        <Outstanding
          rows={[...g3Open, ...handoverOpen]}
          empty="Every gateway 3 and statutory handover item is complete."
        />
      </Panel>
    </RequireModule>
  )
}

/** The specific things standing in the way, never a count on its own. */
function Outstanding({ rows, empty }: { rows: TrackedItem[]; empty: string }) {
  if (rows.length === 0) {
    return <p className="text-ok-ink text-sm">{empty}</p>
  }
  return (
    <TableScroll>
      <Table>
        <THead>
          <TR>
            <TH className="w-[80px]">Ref</TH>
            <TH>Outstanding</TH>
            <TH className="w-[170px]">Who</TH>
            <TH className="w-[110px]">Due</TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((r) => (
            <TR key={r.id} gap={!r.company_name}>
              <TD>
                <Code>{r.reference}</Code>
              </TD>
              <TD>
                {r.title}
                <span className="text-graphite-light ml-2 text-xs">{r.status}</span>
              </TD>
              <TD>
                {r.company_name ?? <span className="text-hivis-ink">Nobody</span>}
              </TD>
              <TD className={r.overdue ? 'text-stop-ink' : ''}>{fmtDate(r.due)}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </TableScroll>
  )
}
