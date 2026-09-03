import { useCallback, useEffect, useState } from 'react'
import { useOutletContext, useParams } from 'react-router'

import { CashflowCurve } from '@/components/commercial/CashflowCurve'
import { Money } from '@/components/commercial/Money'
import { fmtDate, gbp } from '@/lib/format'
import { RequireModule } from '@/components/shell/RequireModule'
import { Button } from '@/components/ui/button'
import { Panel, PageHead } from '@/components/ui/panel'
import { Code, Pill, Table, TableScroll, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import {
  addFee, addInstalment, addInvoice, agreePaymentSchedule, approveFee, certifyInvoice,
  fetchCashflow, fetchFeePosition, fetchFees, fetchInstalments, fetchInvoices,
  fetchProgramme, fetchProjectCompanies,
  type CashflowPoint, type Fee, type FeePosition, type Instalment, type Invoice,
  type ProgrammeTask, type ProjectCompany,
} from '@/lib/queries'
import type { ProjectContext } from '@/pages/project/ProjectLayout'

/**
 * Fees and cashflow.
 *
 * Proposed and approved are never one figure anywhere on this page. A fee
 * report that mixes them looks overspent and stops being believed, so the
 * position table carries them in separate columns and the only total that
 * calls itself a total is the approved one.
 */
type Tab = 'position' | 'fees' | 'schedule' | 'invoices' | 'cashflow'

export default function FeesPage() {
  const { id = '' } = useParams()
  const ctx = useOutletContext<ProjectContext>()
  const [tab, setTab] = useState<Tab>('position')
  const [position, setPosition] = useState<FeePosition[]>([])
  const [fees, setFees] = useState<Fee[]>([])
  const [schedule, setSchedule] = useState<Instalment[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [curve, setCurve] = useState<CashflowPoint[]>([])
  const [companies, setCompanies] = useState<ProjectCompany[]>([])
  const [programme, setProgramme] = useState<ProgrammeTask[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const load = useCallback(() => {
    Promise.all([
      fetchFeePosition(id), fetchFees(id), fetchInstalments(id), fetchInvoices(id),
      fetchCashflow(id), fetchProjectCompanies(id), fetchProgramme(id),
    ])
      .then(([p, f, s, v, c, co, pr]) => {
        setPosition(p); setFees(f); setSchedule(s); setInvoices(v)
        setCurve(c); setCompanies(co); setProgramme(pr); setError(null)
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [id])

  useEffect(load, [load])

  const guard = (p: Promise<unknown>) =>
    p.then(load).catch((e: Error) => setError(e.message))

  const coName = (cid: string | null) =>
    companies.find((c) => c.id === cid)?.name ?? '—'

  if (loading) return <div className="text-graphite p-6 text-sm">Loading…</div>

  return (
    <RequireModule module="fees">
      <PageHead
        eyebrow="Commercial"
        title="Fees and cashflow"
        meta="Every figure excludes VAT. Proposed and approved are never added together."
        actions={
          <div className="flex flex-wrap gap-1">
            {([['position', 'Position'], ['fees', `Fees (${fees.length})`],
               ['schedule', `Schedule (${schedule.length})`],
               ['invoices', `Invoices (${invoices.length})`],
               ['cashflow', 'Cashflow']] as [Tab, string][]).map(([k, label]) => (
              <Button
                key={k} size="sm"
                variant={tab === k ? 'secondary' : 'ghost'}
                onClick={() => { if (tab !== k) setTab(k) }}
              >
                {label}
              </Button>
            ))}
          </div>
        }
      />

      {error && (
        <Panel kind="comply" className="mb-4"><p className="text-stop text-sm">{error}</p></Panel>
      )}
      {note && (
        <Panel kind="money" className="mb-4"><p className="text-sm">{note}</p></Panel>
      )}

      {tab === 'position' && (
        <Panel title="Position by company" kind="money">
          {position.length === 0 ? (
            <p className="text-graphite text-sm">
              Nothing commercial on this project yet.
            </p>
          ) : (
            <>
              <TableScroll>
                <Table>
                  <THead>
                    <TR>
                      <TH>Company</TH>
                      <TH className="w-[96px]">Fee (appr.)</TH>
                      <TH className="w-[96px]">Vars (appr.)</TH>
                      <TH className="w-[104px]">Approved total</TH>
                      <TH className="w-[96px]">Proposed</TH>
                      <TH className="w-[96px]">Scheduled</TH>
                      <TH className="w-[96px]">Gap</TH>
                      <TH className="w-[96px]">Invoiced</TH>
                      <TH className="w-[96px]">Paid</TH>
                      <TH className="w-[130px]">Watch</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {position.map((p) => (
                      <TR key={p.company_id}>
                        <TD>{p.company_name}</TD>
                        <TD><Money value={p.fee_approved} /></TD>
                        <TD><Money value={p.variations_approved} /></TD>
                        <TD><Money value={p.approved_total} className="font-bold" /></TD>
                        <TD>
                          {/* Deliberately in its own column and never summed
                              into the approved total beside it. */}
                          <Money
                            value={p.fee_proposed + p.variations_proposed}
                            className="text-graphite"
                          />
                        </TD>
                        <TD><Money value={p.scheduled} /></TD>
                        <TD>
                          {p.schedule_gap === 0
                            ? <Code className="text-graphite text-xs">—</Code>
                            : <Money value={p.schedule_gap} tone="signed" />}
                        </TD>
                        <TD><Money value={p.invoiced} /></TD>
                        <TD><Money value={p.paid} /></TD>
                        <TD>
                          <div className="flex flex-col gap-0.5">
                            {p.schedule_gap !== 0 && (
                              <Pill tone="warn">Schedule ≠ approved</Pill>
                            )}
                            {p.due_uninvoiced > 0 && (
                              <Pill tone="warn">{p.due_uninvoiced} due, unclaimed</Pill>
                            )}
                            {p.instalments_unagreed > 0 && (
                              <Pill tone="neutral">{p.instalments_unagreed} un-agreed</Pill>
                            )}
                          </div>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableScroll>
              <p className="text-graphite mt-3 max-w-prose text-xs">
                <strong>Gap</strong> is the payment schedule against the approved fee. It is
                almost always an approved variation nobody added to the schedule.
                <strong> Proposed</strong> sits in its own column and is never part of the
                approved total: a report that mixed them would read as committed money that
                nobody has committed.
              </p>
            </>
          )}
        </Panel>
      )}

      {tab === 'fees' && (
        <>
          <Panel
            title="Fees and variations"
            kind="money"
            actions={ctx.canEdit && companies.length > 0 && (
              <AddFee
                companies={companies}
                onAdd={(row) => guard(addFee(id, row))}
              />
            )}
          >
            {fees.length === 0 ? (
              <p className="text-graphite text-sm">No fees recorded yet.</p>
            ) : (
              <TableScroll>
                <Table>
                  <THead>
                    <TR>
                      <TH className="w-[100px]">Ref</TH>
                      <TH className="w-[86px]">Kind</TH>
                      <TH>Description</TH>
                      <TH className="w-[150px]">Company</TH>
                      <TH className="w-[100px]">Value</TH>
                      <TH className="w-[88px]">Submitted</TH>
                      <TH className="w-[130px]">Status</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {fees.map((f) => (
                      <TR key={f.id}>
                        <TD><Code className="text-xs">{f.reference}</Code></TD>
                        <TD className="text-xs">
                          {f.kind === 'variation' ? 'Variation' : 'Fee'}
                        </TD>
                        <TD>{f.description ?? <span className="text-graphite">—</span>}</TD>
                        <TD>{coName(f.company_id)}</TD>
                        <TD><Money value={f.value} /></TD>
                        <TD><Code className="text-graphite text-xs">
                          {fmtDate(f.date_submitted)}</Code></TD>
                        <TD>
                          {f.status === 'Approved' ? (
                            <div>
                              <Pill tone="ok">Approved</Pill>
                              <div className="text-graphite mt-0.5 text-[11px]">
                                {fmtDate(f.date_approved)}
                              </div>
                            </div>
                          ) : f.status === 'Rejected' ? (
                            <Pill tone="neutral">Rejected</Pill>
                          ) : ctx.canEdit ? (
                            <div className="flex gap-1">
                              <Button size="sm" onClick={() => guard(approveFee(f.id, true))}>
                                Approve
                              </Button>
                              <Button size="sm" variant="ghost"
                                onClick={() => guard(approveFee(f.id, false))}>
                                Reject
                              </Button>
                            </div>
                          ) : (
                            <Pill tone="neutral">Proposed</Pill>
                          )}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableScroll>
            )}
            <p className="text-graphite mt-3 max-w-prose text-xs">
              Approving a fee is the host's decision, and the status is written only by the
              database function that performs it — a consultant posting straight to the API
              cannot approve their own.
            </p>
          </Panel>
        </>
      )}

      {tab === 'schedule' && (
        <Panel
          title="Payment schedule"
          kind="money"
          actions={ctx.canEdit && companies.length > 0 && (
            <AddInstalment
              companies={companies}
              programme={programme}
              onAdd={(row) => guard(addInstalment(id, row))}
            />
          )}
        >
          {schedule.length === 0 ? (
            <p className="text-graphite max-w-prose text-sm">
              No instalments yet. A schedule is a negotiated document: type one, or agree what
              the consultant proposed. Every instalment is dated off the programme, so
              re-importing a revision moves the whole curve with no writes here.
            </p>
          ) : (
            <>
              <TableScroll>
                <Table>
                  <THead>
                    <TR>
                      <TH className="w-[100px]">Ref</TH>
                      <TH>Description</TH>
                      <TH className="w-[150px]">Company</TH>
                      <TH className="w-[100px]">Value</TH>
                      <TH className="w-[88px]">Due</TH>
                      <TH className="w-[100px]">Invoiced</TH>
                      <TH className="w-[140px]">Status</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {schedule.map((s) => (
                      <TR key={s.id} gap={s.due_uninvoiced}>
                        <TD><Code className="text-xs">{s.reference}</Code></TD>
                        <TD>{s.description ?? <span className="text-graphite">—</span>}</TD>
                        <TD>{s.company_name ?? coName(s.company_id)}</TD>
                        <TD><Money value={s.value} /></TD>
                        <TD>
                          <Code className="text-graphite text-xs">{fmtDate(s.due)}</Code>
                          {s.anchor_state === 'removed' && (
                            <Pill tone="warn" className="mt-0.5">Line removed</Pill>
                          )}
                        </TD>
                        <TD>
                          <Money value={s.invoiced} />
                          {s.due_uninvoiced && (
                            <Pill tone="warn" className="mt-0.5">Due, unclaimed</Pill>
                          )}
                        </TD>
                        <TD>
                          {s.status === 'Agreed' ? (
                            <div>
                              <Pill tone="ok">Agreed</Pill>
                              <div className="text-graphite mt-0.5 text-[11px]">
                                {fmtDate(s.agreed_at)}
                              </div>
                            </div>
                          ) : (
                            <Pill tone="neutral">Proposed</Pill>
                          )}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableScroll>
              {ctx.canEdit && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {[...new Set(schedule.filter((s) => s.status === 'Proposed')
                    .map((s) => s.company_id))].map((cid) => (
                    <Button
                      key={cid} size="sm" variant="secondary"
                      onClick={() => guard(agreePaymentSchedule(id, cid).then((n) =>
                        setNote(`${n} instalment${n === 1 ? '' : 's'} agreed for ` +
                          `${coName(cid)}. Who agreed it and when is now on the record.`)))}
                    >
                      Agree {coName(cid)}'s schedule
                    </Button>
                  ))}
                </div>
              )}
              <p className="text-graphite mt-3 max-w-prose text-xs">
                A proposed instalment still counts in the planned curve — it is the
                consultant's stated expectation, and leaving it out would make the curve
                optimistic. Agreement is a stored fact with a name and a date against it;
                everything else on this page is computed.
              </p>
            </>
          )}
        </Panel>
      )}

      {tab === 'invoices' && (
        <Panel
          title="Invoices"
          kind="money"
          actions={ctx.canEdit && companies.length > 0 && (
            <AddInvoice
              companies={companies}
              schedule={schedule}
              onAdd={(row) => guard(addInvoice(id, row))}
            />
          )}
        >
          {invoices.length === 0 ? (
            <p className="text-graphite text-sm">No invoices submitted yet.</p>
          ) : (
            <>
              <TableScroll>
                <Table>
                  <THead>
                    <TR>
                      <TH className="w-[100px]">Ref</TH>
                      <TH className="w-[150px]">Company</TH>
                      <TH className="w-[100px]">Against</TH>
                      <TH className="w-[100px]">Value</TH>
                      <TH className="w-[88px]">Submitted</TH>
                      <TH className="w-[150px]">Status</TH>
                      <TH className="w-[110px]">Document</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {invoices.map((v) => (
                      <TR key={v.id}>
                        <TD><Code className="text-xs">{v.reference}</Code></TD>
                        <TD>{v.company_name ?? coName(v.company_id)}</TD>
                        <TD>
                          {v.schedule_reference
                            ? <Code className="text-xs">{v.schedule_reference}</Code>
                            : <Pill tone="warn">No instalment</Pill>}
                        </TD>
                        <TD><Money value={v.value} /></TD>
                        <TD><Code className="text-graphite text-xs">
                          {fmtDate(v.date_submitted)}</Code></TD>
                        <TD>
                          {ctx.canEdit ? (
                            <select
                              value={v.status}
                              onChange={(e) => guard(certifyInvoice(
                                v.id, e.target.value as Invoice['status']))}
                              className="border-rule w-full rounded border px-1 py-1 text-xs"
                              aria-label={`Status of ${v.reference}`}
                            >
                              {['Submitted', 'Certified', 'Paid', 'Disputed'].map((s) => (
                                <option key={s} value={s}>{s}</option>
                              ))}
                            </select>
                          ) : (
                            <Pill tone={v.status === 'Paid' ? 'ok'
                              : v.status === 'Disputed' ? 'stop' : 'neutral'}>
                              {v.status}
                            </Pill>
                          )}
                          {v.outstanding_30d && (
                            <Pill tone="warn" className="mt-0.5">
                              {v.days_submitted}d outstanding
                            </Pill>
                          )}
                        </TD>
                        <TD>
                          {v.has_document
                            ? <Pill tone="ok">Held</Pill>
                            : <Pill tone="warn">None held</Pill>}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableScroll>
              <p className="text-graphite mt-3 max-w-prose text-xs">
                An invoice with no document held is flagged rather than merely lacking one:
                certifying against an application nobody can produce later is how payment
                disputes are lost. A claimant cannot certify their own invoice — the status is
                written only by the function that checks who is asking.
              </p>
            </>
          )}
        </Panel>
      )}

      {tab === 'cashflow' && (
        <Panel title="Cashflow" kind="money">
          <CashflowCurve points={curve} />
          <p className="text-graphite mt-3 max-w-prose text-xs">
            The planned curve is the payment schedule resolved through the programme. No
            instalment date is stored anywhere, so re-importing a revision redraws this
            without a single write — a consultant's cashflow that does not move when the job
            moves is worse than no cashflow at all.
          </p>
        </Panel>
      )}
    </RequireModule>
  )
}

/* --------------------------------------------------------------- forms */

function AddFee({
  companies, onAdd,
}: {
  companies: ProjectCompany[]
  onAdd: (row: {
    company_id: string; reference: string; kind: 'fee' | 'variation'
    description: string | null; value: number; date_submitted: string | null
  }) => void
}) {
  const [open, setOpen] = useState(false)
  const [company, setCompany] = useState(companies[0]?.id ?? '')
  const [reference, setReference] = useState('')
  const [kind, setKind] = useState<'fee' | 'variation'>('fee')
  const [description, setDescription] = useState('')
  const [value, setValue] = useState('')

  if (!open) {
    return <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>Add a fee</Button>
  }
  const valid = reference.trim() !== '' && company !== '' && Number(value) > 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6 backdrop-blur-sm">
      <form
        className="glass-popover w-full max-w-[520px] rounded-lg p-5"
        onSubmit={(e) => {
          e.preventDefault()
          // Refuses empty input rather than creating a blank row.
          if (!valid) return
          onAdd({
            company_id: company, reference: reference.trim(), kind,
            description: description.trim() || null, value: Number(value),
            date_submitted: new Date().toISOString().slice(0, 10),
          })
          setOpen(false)
        }}
      >
        <h2 className="mb-1 text-base font-semibold">Add a fee or variation</h2>
        <p className="text-graphite mb-3 text-xs">
          Excluding VAT. It arrives as proposed; approving it is a separate act.
        </p>
        <div className="mb-3 flex gap-2">
          <label className="w-[130px]">
            <span className="mb-1 block text-xs font-medium">Reference</span>
            <input value={reference} onChange={(e) => setReference(e.target.value)}
              placeholder="FEE-001"
              className="border-rule w-full rounded border px-2 py-2 font-mono text-sm" />
          </label>
          <label className="w-[110px]">
            <span className="mb-1 block text-xs font-medium">Kind</span>
            <select value={kind} onChange={(e) => setKind(e.target.value as 'fee' | 'variation')}
              className="border-rule w-full rounded border px-2 py-2 text-sm">
              <option value="fee">Fee</option>
              <option value="variation">Variation</option>
            </select>
          </label>
          <label className="flex-1">
            <span className="mb-1 block text-xs font-medium">Value (£, ex VAT)</span>
            <input value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal"
              className="border-rule w-full rounded border px-2 py-2 text-right font-mono text-sm" />
          </label>
        </div>
        <label className="mb-3 block">
          <span className="mb-1 block text-xs font-medium">Company</span>
          <select value={company} onChange={(e) => setCompany(e.target.value)}
            className="border-rule w-full rounded border px-2 py-2 text-sm">
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className="mb-4 block">
          <span className="mb-1 block text-xs font-medium">Description</span>
          <input value={description} onChange={(e) => setDescription(e.target.value)}
            className="border-rule w-full rounded border px-3 py-2 text-sm" />
        </label>
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" type="button" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button size="sm" type="submit" disabled={!valid}>Add</Button>
        </div>
      </form>
    </div>
  )
}

function AddInstalment({
  companies, programme, onAdd,
}: {
  companies: ProjectCompany[]
  programme: ProgrammeTask[]
  onAdd: (row: {
    company_id: string; reference: string; description: string | null; value: number
    programme_task_uid: string | null; offset_days: number; anchor: 'start' | 'finish'
  }) => void
}) {
  const [open, setOpen] = useState(false)
  const [company, setCompany] = useState(companies[0]?.id ?? '')
  const [reference, setReference] = useState('')
  const [description, setDescription] = useState('')
  const [value, setValue] = useState('')
  const [uid, setUid] = useState('')
  const [offset, setOffset] = useState('0')
  const [anchor, setAnchor] = useState<'start' | 'finish'>('finish')

  if (!open) {
    return (
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>Add an instalment</Button>
    )
  }
  const valid = reference.trim() !== '' && company !== '' && Number(value) > 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6 backdrop-blur-sm">
      <form
        className="glass-popover w-full max-w-[560px] rounded-lg p-5"
        onSubmit={(e) => {
          e.preventDefault()
          if (!valid) return
          onAdd({
            company_id: company, reference: reference.trim(),
            description: description.trim() || null, value: Number(value),
            programme_task_uid: uid || null,
            offset_days: Number(offset) || 0, anchor,
          })
          setOpen(false)
        }}
      >
        <h2 className="mb-1 text-base font-semibold">Add an instalment</h2>
        <p className="text-graphite mb-3 text-xs">
          No date is typed. Pick the programme line it falls against and an offset in days.
        </p>
        <div className="mb-3 flex gap-2">
          <label className="w-[130px]">
            <span className="mb-1 block text-xs font-medium">Reference</span>
            <input value={reference} onChange={(e) => setReference(e.target.value)}
              placeholder="PS-001"
              className="border-rule w-full rounded border px-2 py-2 font-mono text-sm" />
          </label>
          <label className="flex-1">
            <span className="mb-1 block text-xs font-medium">Value (£, ex VAT)</span>
            <input value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal"
              className="border-rule w-full rounded border px-2 py-2 text-right font-mono text-sm" />
          </label>
        </div>
        <label className="mb-3 block">
          <span className="mb-1 block text-xs font-medium">Company</span>
          <select value={company} onChange={(e) => setCompany(e.target.value)}
            className="border-rule w-full rounded border px-2 py-2 text-sm">
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className="mb-3 block">
          <span className="mb-1 block text-xs font-medium">Description</span>
          <input value={description} onChange={(e) => setDescription(e.target.value)}
            className="border-rule w-full rounded border px-3 py-2 text-sm" />
        </label>
        <div className="mb-4 flex gap-2">
          <label className="flex-1">
            <span className="mb-1 block text-xs font-medium">Programme line</span>
            <select value={uid} onChange={(e) => setUid(e.target.value)}
              className="border-rule w-full rounded border px-2 py-2 text-sm">
              <option value="">— none yet —</option>
              {programme.map((t) => (
                <option key={t.task_uid} value={t.task_uid}>
                  {t.task_uid} · {t.description}
                </option>
              ))}
            </select>
          </label>
          <label className="w-[92px]">
            <span className="mb-1 block text-xs font-medium">Anchor</span>
            <select value={anchor}
              onChange={(e) => setAnchor(e.target.value as 'start' | 'finish')}
              className="border-rule w-full rounded border px-2 py-2 text-sm">
              <option value="finish">Finish</option>
              <option value="start">Start</option>
            </select>
          </label>
          <label className="w-[80px]">
            <span className="mb-1 block text-xs font-medium">Offset</span>
            <input value={offset} onChange={(e) => setOffset(e.target.value)} inputMode="numeric"
              className="border-rule w-full rounded border px-2 py-2 text-right font-mono text-sm" />
          </label>
        </div>
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" type="button" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button size="sm" type="submit" disabled={!valid}>Add</Button>
        </div>
      </form>
    </div>
  )
}

function AddInvoice({
  companies, schedule, onAdd,
}: {
  companies: ProjectCompany[]
  schedule: Instalment[]
  onAdd: (row: {
    company_id: string; schedule_id: string | null; reference: string
    value: number; date_submitted: string
  }) => void
}) {
  const [open, setOpen] = useState(false)
  const [company, setCompany] = useState(companies[0]?.id ?? '')
  const [scheduleId, setScheduleId] = useState('')
  const [reference, setReference] = useState('')
  const [value, setValue] = useState('')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))

  if (!open) {
    return <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>Add an invoice</Button>
  }
  const mine = schedule.filter((s) => s.company_id === company)
  const valid = reference.trim() !== '' && company !== '' && Number(value) > 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6 backdrop-blur-sm">
      <form
        className="glass-popover w-full max-w-[520px] rounded-lg p-5"
        onSubmit={(e) => {
          e.preventDefault()
          if (!valid) return
          onAdd({
            company_id: company, schedule_id: scheduleId || null,
            reference: reference.trim(), value: Number(value), date_submitted: date,
          })
          setOpen(false)
        }}
      >
        <h2 className="mb-1 text-base font-semibold">Add an invoice</h2>
        <p className="text-graphite mb-3 text-xs">
          It arrives as submitted. Certifying it is a separate act, and it must be an
          instalment of the same company's.
        </p>
        <div className="mb-3 flex gap-2">
          <label className="w-[130px]">
            <span className="mb-1 block text-xs font-medium">Reference</span>
            <input value={reference} onChange={(e) => setReference(e.target.value)}
              placeholder="INV-001"
              className="border-rule w-full rounded border px-2 py-2 font-mono text-sm" />
          </label>
          <label className="flex-1">
            <span className="mb-1 block text-xs font-medium">Value (£, ex VAT)</span>
            <input value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal"
              className="border-rule w-full rounded border px-2 py-2 text-right font-mono text-sm" />
          </label>
          <label className="w-[130px]">
            <span className="mb-1 block text-xs font-medium">Submitted</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
              className="border-rule w-full rounded border px-2 py-2 text-sm" />
          </label>
        </div>
        <label className="mb-3 block">
          <span className="mb-1 block text-xs font-medium">Company</span>
          <select value={company}
            onChange={(e) => { setCompany(e.target.value); setScheduleId('') }}
            className="border-rule w-full rounded border px-2 py-2 text-sm">
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className="mb-4 block">
          <span className="mb-1 block text-xs font-medium">Against which instalment</span>
          <select value={scheduleId} onChange={(e) => setScheduleId(e.target.value)}
            className="border-rule w-full rounded border px-2 py-2 text-sm">
            <option value="">— none —</option>
            {mine.map((s) => (
              <option key={s.id} value={s.id}>
                {s.reference} · {gbp(s.value)} · {fmtDate(s.due)}
              </option>
            ))}
          </select>
        </label>
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" type="button" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button size="sm" type="submit" disabled={!valid}>Add</Button>
        </div>
      </form>
    </div>
  )
}
