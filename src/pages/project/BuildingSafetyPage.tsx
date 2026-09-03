import { useCallback, useEffect, useState } from 'react'
import { useOutletContext, useParams } from 'react-router'

import { Classify } from '@/components/bsa/Classify'
import { RequireModule } from '@/components/shell/RequireModule'
import { Button } from '@/components/ui/button'
import { Panel, PageHead } from '@/components/ui/panel'
import { Code, Pill, Table, TableScroll, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import {
  canClassify, fetchChangeRequests, fetchGoldenThreadMoved, fetchGoldenThreadNeverIssued,
  fetchHrbSettings, fetchOccurrences, stampG2Baseline, updateHrbSettings,
  type ChangeRequest, type GoldenThreadRow, type HrbSettings, type Occurrence,
} from '@/lib/queries'
import type { ProjectContext } from '@/pages/project/ProjectLayout'

const fmt = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })
    : '—'

/** The regulator's answer, in the one place it is allowed to be a colour. */
function Verdict({ v }: { v: ChangeRequest['bsa_verdict'] }) {
  return v === 'proceed' ? <Pill tone="ok">May proceed</Pill>
    : v === 'warn' ? <Pill tone="warn">In the window</Pill>
    : <Pill tone="stop">Work must stop</Pill>
}

export default function BuildingSafetyPage() {
  const { id = '' } = useParams()
  const ctx = useOutletContext<ProjectContext>()
  const [hrb, setHrb] = useState<HrbSettings | null>(null)
  const [changes, setChanges] = useState<ChangeRequest[]>([])
  const [moved, setMoved] = useState<GoldenThreadRow[]>([])
  const [never, setNever] = useState<GoldenThreadRow[]>([])
  const [occurrences, setOccurrences] = useState<Occurrence[]>([])
  const [mayClassify, setMayClassify] = useState(false)
  const [classifying, setClassifying] = useState<ChangeRequest | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const load = useCallback(() => {
    Promise.all([
      fetchHrbSettings(id), fetchChangeRequests(id), fetchGoldenThreadMoved(id),
      fetchGoldenThreadNeverIssued(id), fetchOccurrences(id), canClassify(id),
    ])
      .then(([h, c, m, n, o, cc]) => {
        setHrb(h); setChanges(c); setMoved(m); setNever(n); setOccurrences(o); setMayClassify(cc)
        setError(null)
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [id])

  useEffect(load, [load])

  const guard = (p: Promise<unknown>) =>
    p.then(load).catch((e: Error) => setError(e.message))

  if (loading) return <div className="text-graphite p-6 text-sm">Loading…</div>

  return (
    <RequireModule module="bsa">
      <PageHead
        eyebrow="Compliance"
        title="Building safety"
        meta="Higher-risk building change control, the golden thread, and occurrence reporting."
      />

      {error && (
        <Panel kind="comply" className="mb-4">
          <p className="text-stop text-sm">{error}</p>
        </Panel>
      )}
      {note && <Panel kind="evidence" className="mb-4"><p className="text-sm">{note}</p></Panel>}

      {!hrb?.hrb ? (
        <Panel title="This project is not a higher-risk building">
          <p className="text-graphite mb-3 max-w-prose text-sm">
            Everything on this page is inert until the project is marked as one. An ordinary
            scheme never sees change classification, the golden thread or occurrence reporting —
            and a change on it cannot be classified even by someone who holds the duty.
          </p>
          {ctx.isAccountAdmin && (
            <Button
              size="sm"
              onClick={() => guard(updateHrbSettings(id, { hrb: true }))}
            >
              Mark this project a higher-risk building
            </Button>
          )}
        </Panel>
      ) : (
        <>
          <Panel kind="comply" title="Change control">
            <p className="text-graphite mb-3 max-w-prose text-sm">
              Recordable, notifiable or major is a duty-holder judgement made by the client, the
              principal designer and the principal contractor together. The app never suggests
              one. {mayClassify
                ? 'You hold the duty on this project.'
                : 'You do not hold the duty here, so the classification is read-only — and the database refuses it, not just this page.'}
            </p>

            {changes.length === 0 ? (
              <p className="text-graphite text-sm">No change requests raised yet.</p>
            ) : (
              <TableScroll>
                <Table>
                  <THead>
                    <TR>
                      <TH className="w-[86px]">Ref</TH>
                      <TH>Change</TH>
                      <TH className="w-[110px]">Class</TH>
                      <TH className="w-[130px]">May work proceed</TH>
                      <TH className="w-[110px]">Commercial</TH>
                      <TH className="w-[92px]" />
                    </TR>
                  </THead>
                  <TBody>
                    {changes.map((c) => (
                      <TR key={c.id}>
                        <TD><Code className="text-xs">{c.reference}</Code></TD>
                        <TD>
                          {c.title}
                          <div className="text-graphite mt-0.5 text-xs">{c.bsa_detail}</div>
                          {c.approved_with_nothing_listed && (
                            <div className="text-warn mt-0.5 text-xs">
                              Approved with nothing listed to amend.
                            </div>
                          )}
                        </TD>
                        <TD>
                          {c.bsa_class
                            ? <Pill tone="neutral">{c.bsa_class}</Pill>
                            : <span className="text-graphite text-xs">unclassified</span>}
                        </TD>
                        <TD><Verdict v={c.bsa_verdict} /></TD>
                        <TD className="text-graphite text-xs">
                          {/* The regulator outranks the commercial state: an
                              approved change awaiting determination reads as
                              work must stop, because that is what it means. */}
                          {c.headline_status === 'Work must stop'
                            ? <span className="text-stop">{c.status} — overridden</span>
                            : c.status}
                        </TD>
                        <TD>
                          {mayClassify && (
                            <Button size="sm" variant="ghost" onClick={() => setClassifying(c)}>
                              Classify
                            </Button>
                          )}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableScroll>
            )}
          </Panel>

          <Panel title="Golden thread">
            <p className="text-graphite mb-3 max-w-prose text-sm">
              A designation plus a baseline, not a document store. The baseline is stamped once
              at Gateway 2 approval and never moves — the two reports that matter are what has
              changed since, and what was designated and never issued at all.
            </p>
            {ctx.isAccountAdmin && (
              <Button
                size="sm"
                className="mb-3"
                onClick={() => guard(stampG2Baseline(id).then((o) => {
                  setNote(o.baselined === 0
                    ? 'Nothing new to baseline — every designated drawing that has a revision already has one, and a baseline never moves once stamped.'
                    : `${o.baselined} designated drawings baselined at their current revision.`)
                }))}
              >
                Stamp the Gateway 2 baseline
              </Button>
            )}

            <h4 className="mb-1 text-sm font-semibold">
              Moved since the baseline ({moved.length})
            </h4>
            {moved.length === 0 ? (
              <p className="text-graphite mb-3 text-sm">Nothing designated has changed.</p>
            ) : (
              <TableScroll>
                <Table>
                  <THead>
                    <TR>
                      <TH className="w-[210px]">Number</TH>
                      <TH>Title</TH>
                      <TH className="w-[86px]">At G2</TH>
                      <TH className="w-[86px]">Now</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {moved.map((r) => (
                      <TR key={r.drawing_id}>
                        <TD><Code className="text-xs">{r.document_number}</Code></TD>
                        <TD>{r.title}</TD>
                        <TD><Code className="text-graphite text-xs">{r.g2_revision}</Code></TD>
                        <TD><Code className="text-xs">{r.revision_now}</Code></TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableScroll>
            )}

            <h4 className="mt-4 mb-1 text-sm font-semibold">
              Designated and never issued ({never.length})
            </h4>
            <p className="text-graphite mb-2 max-w-prose text-xs">
              The quieter of the two reports, and usually the more serious: a drawing nobody ever
              produced does not appear on a list of things that changed.
            </p>
            {never.length === 0 ? (
              <p className="text-graphite text-sm">Everything designated has been issued.</p>
            ) : (
              <TableScroll>
                <Table>
                  <THead>
                    <TR>
                      <TH className="w-[210px]">Number</TH>
                      <TH>Title</TH>
                      <TH className="w-[96px]">Due</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {never.map((r) => (
                      <TR key={r.drawing_id}>
                        <TD><Code className="text-xs">{r.document_number}</Code></TD>
                        <TD>{r.title}</TD>
                        <TD><Code className="text-graphite text-xs">{fmt(r.due)}</Code></TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableScroll>
            )}
          </Panel>

          <Panel title={`Occurrence reports (${occurrences.length})`}>
            <p className="text-graphite mb-3 max-w-prose text-sm">
              Their own record, not risks. A risk is prospective; an occurrence has happened, and
              they have different clocks and different audiences. One assessed as not reportable
              still keeps its reasoning — that is the record somebody asks for afterwards.
            </p>
            {occurrences.length === 0 ? (
              <p className="text-graphite text-sm">None recorded.</p>
            ) : (
              <TableScroll>
                <Table>
                  <THead>
                    <TR>
                      <TH className="w-[92px]">Ref</TH>
                      <TH>Occurrence</TH>
                      <TH className="w-[110px]">Occurred</TH>
                      <TH className="w-[130px]">Status</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {occurrences.map((o) => (
                      <TR key={o.id}>
                        <TD><Code className="text-xs">{o.reference}</Code></TD>
                        <TD>
                          {o.title}
                          {o.assessment && (
                            <div className="text-graphite mt-0.5 text-xs">{o.assessment}</div>
                          )}
                        </TD>
                        <TD><Code className="text-graphite text-xs">{fmt(o.occurred_at)}</Code></TD>
                        <TD>
                          {o.status === 'Reportable' || o.status === 'Reported'
                            ? <Pill tone="stop">{o.status}</Pill>
                            : <Pill tone="neutral">{o.status}</Pill>}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableScroll>
            )}
          </Panel>

          {ctx.isAccountAdmin && hrb && (
            <Panel title="Periods">
              <p className="text-graphite mb-3 max-w-prose text-sm">
                Settings, not constants. The notifiable objection window is quoted as both ten
                working days and fourteen days across published sources, and a major
                determination as four to six weeks, extendable by agreement. Hardcoding either
                would make the app confidently wrong on somebody’s scheme.
              </p>
              <div className="flex flex-wrap gap-3">
                <label>
                  <span className="mb-1 block text-sm font-medium">Objection window (days)</span>
                  <input
                    type="number"
                    min={1}
                    defaultValue={hrb.hrb_notify_days}
                    onBlur={(e) => {
                      const v = parseInt(e.target.value, 10)
                      if (v && v !== hrb.hrb_notify_days) {
                        guard(updateHrbSettings(id, { hrb_notify_days: v }))
                      }
                    }}
                    className="border-rule w-[110px] rounded border px-3 py-2 font-mono text-sm"
                  />
                </label>
                <label>
                  <span className="mb-1 block text-sm font-medium">Determination (weeks)</span>
                  <input
                    type="number"
                    min={1}
                    defaultValue={hrb.hrb_major_weeks}
                    onBlur={(e) => {
                      const v = parseInt(e.target.value, 10)
                      if (v && v !== hrb.hrb_major_weeks) {
                        guard(updateHrbSettings(id, { hrb_major_weeks: v }))
                      }
                    }}
                    className="border-rule w-[110px] rounded border px-3 py-2 font-mono text-sm"
                  />
                </label>
              </div>
            </Panel>
          )}
        </>
      )}

      {classifying && (
        <Classify
          change={classifying}
          onClose={() => setClassifying(null)}
          onDone={() => { setClassifying(null); load() }}
        />
      )}
    </RequireModule>
  )
}
