import { useCallback, useEffect, useState } from 'react'
import { useOutletContext, useParams } from 'react-router'

import { fmtDate } from '@/lib/format'
import { RequireModule } from '@/components/shell/RequireModule'
import { Button } from '@/components/ui/button'
import { Panel, PageHead } from '@/components/ui/panel'
import { Code, Pill, Table, TableScroll, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import {
  MATERIAL_DECISIONS, addMaterial, canDecideMaterial, decideMaterialRound,
  fetchMaterialSubmissions, fetchMaterialTotals, fetchMaterials, fetchProjectCompanies,
  submitMaterialRound, updateMaterial,
  type Material, type MaterialSubmission, type ProjectCompany,
} from '@/lib/queries'
import type { ProjectContext } from '@/pages/project/ProjectLayout'

/**
 * Material samples — a submission history, not a single decision.
 *
 * Every round is a row and no row is ever overwritten once decided, which is
 * what makes "was this rejected before?" answerable months later without
 * anybody having deliberately kept a paper trail. The trail is just what the
 * table already is.
 *
 * Deciding is the design manager's, and the database says so: a consultant
 * approving their own sample is refused by policy, not by a hidden button.
 */
export default function MaterialsPage() {
  const { id = '' } = useParams()
  const ctx = useOutletContext<ProjectContext>()
  const [rows, setRows] = useState<Material[]>([])
  const [subs, setSubs] = useState<MaterialSubmission[]>([])
  const [companies, setCompanies] = useState<ProjectCompany[]>([])
  const [totals, setTotals] = useState<{
    total: number; approved: number; awaiting: number
    overdue: number; ever_rejected: number; struck_out: number } | null>(null)
  const [mayDecide, setMayDecide] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const [showStruck, setShowStruck] = useState(false)
  const [adding, setAdding] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    Promise.all([
      fetchMaterials(id), fetchMaterialTotals(id), fetchProjectCompanies(id),
      canDecideMaterial(id),
    ])
      .then(async ([r, t, co, d]) => {
        setRows(r); setTotals(t); setCompanies(co); setMayDecide(d)
        setSubs(await fetchMaterialSubmissions(r.map((x) => x.id)))
        setError(null)
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [id])

  useEffect(load, [load])

  const guard = (p: Promise<unknown>) =>
    p.then(load).catch((e: Error) => setError(e.message))

  const visible = showStruck ? rows : rows.filter((r) => r.required)

  if (loading) return <div className="text-graphite p-6 text-sm">Loading…</div>

  return (
    <RequireModule module="materials">
      <PageHead
        eyebrow="Design"
        title="Material samples"
        meta="Every submission round is a row. A rejection stays on the record after a later approval."
      />

      {error && (
        <Panel kind="comply" className="mb-4"><p className="text-stop text-sm">{error}</p></Panel>
      )}

      <Panel
        title={totals ? `${totals.approved} of ${totals.total} approved` : 'Samples'}
        actions={
          <div className="flex gap-1">
            {totals && totals.struck_out > 0 && (
              <Button size="sm" variant={showStruck ? 'secondary' : 'ghost'}
                onClick={() => setShowStruck((v) => !v)}>
                {showStruck ? 'Hide' : 'Show'} struck out
              </Button>
            )}
            {ctx.canEdit && (
              <Button size="sm" variant="ghost" onClick={() => setAdding(true)}>
                Add a sample
              </Button>
            )}
          </div>
        }
      >
        {totals && (
          <div className="mb-3 flex flex-wrap gap-2">
            {totals.awaiting > 0 && (
              <Pill tone="warn">{totals.awaiting} awaiting a decision</Pill>
            )}
            {totals.overdue > 0 && <Pill tone="stop">{totals.overdue} overdue</Pill>}
            {totals.ever_rejected > 0 && (
              <Pill tone="neutral">{totals.ever_rejected} rejected at some point</Pill>
            )}
          </div>
        )}

        {visible.length === 0 ? (
          <p className="text-graphite max-w-prose text-sm">
            No samples yet.
          </p>
        ) : (
          <TableScroll>
            <Table>
              <THead>
                <TR>
                  <TH className="w-[92px]">Ref</TH>
                  <TH>Sample</TH>
                  <TH className="w-[150px]">Company</TH>
                  <TH className="w-[64px]">Rounds</TH>
                  <TH className="w-[88px]">Due</TH>
                  <TH className="w-[170px]">Position</TH>
                  <TH className="w-[110px]" />
                </TR>
              </THead>
              <TBody>
                {visible.map((m) => (
                  <SampleRow
                    key={m.id}
                    material={m}
                    submissions={subs.filter((s) => s.material_id === m.id)}
                    companies={companies}
                    canEdit={ctx.canEdit}
                    mayDecide={mayDecide}
                    open={open === m.id}
                    onToggle={() => setOpen(open === m.id ? null : m.id)}
                    guard={guard}
                  />
                ))}
              </TBody>
            </Table>
          </TableScroll>
        )}
        <p className="text-graphite mt-3 max-w-prose text-xs">
          A decided round is frozen: a correction is a new round, never an edit. That is what
          keeps the history worth reading — and why a round cannot be deleted either.
          {!mayDecide && ' Deciding a sample is the design manager’s; you can submit rounds.'}
        </p>
      </Panel>

      {adding && (
        <AddSample
          companies={companies}
          onClose={() => setAdding(false)}
          onAdd={(row) => guard(addMaterial(id, row)).then(() => setAdding(false))}
        />
      )}
    </RequireModule>
  )
}

function SampleRow({
  material, submissions, companies, canEdit, mayDecide, open, onToggle, guard,
}: {
  material: Material
  submissions: MaterialSubmission[]
  companies: ProjectCompany[]
  canEdit: boolean
  mayDecide: boolean
  open: boolean
  onToggle: () => void
  guard: (p: Promise<unknown>) => Promise<void>
}) {
  const [sampleRef, setSampleRef] = useState('')
  const pending = submissions.find((s) => s.decision === 'Pending')

  const tone = material.is_done ? 'ok'
    : material.awaiting_decision ? 'warn'
      : material.overdue ? 'stop' : 'neutral'

  return (
    <>
      <TR muted={!material.required}>
        <TD><Code className={material.required ? 'text-xs' : 'text-xs line-through'}>
          {material.reference}</Code></TD>
        <TD>
          <button type="button" onClick={onToggle}
            className={'text-left underline-offset-2 hover:underline' +
              (material.required ? '' : ' line-through')}>
            {material.title}
          </button>
          {material.spec && (
            <div className="text-graphite text-xs">{material.spec}</div>
          )}
          {material.location && (
            <div className="text-graphite-light text-xs italic">{material.location}</div>
          )}
        </TD>
        <TD>
          {canEdit ? (
            <select
              value={material.company_id ?? ''}
              onChange={(e) =>
                guard(updateMaterial(material.id, { company_id: e.target.value || null }))}
              className="border-rule w-full rounded border px-1 py-1 text-xs"
              aria-label={`Who submits ${material.reference}`}
            >
              <option value="">— nobody —</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          ) : (
            material.company_name ?? <span className="text-graphite text-xs">—</span>
          )}
        </TD>
        <TD><Code className="text-xs">{material.rounds}</Code></TD>
        <TD>
          <Code className="text-graphite text-xs">{fmtDate(material.due)}</Code>
          {material.overdue && <Pill tone="stop" className="mt-0.5">Overdue</Pill>}
        </TD>
        <TD>
          <Pill tone={tone}>
            {material.rounds === 0 ? 'Not submitted'
              : material.awaiting_decision ? `Round ${material.latest_round} pending`
                : `${material.decision} (round ${material.latest_round})`}
          </Pill>
          {/* A rejection stays on the record after a later approval: this is
              the whole reason the table is a history. */}
          {material.was_rejected && !material.awaiting_decision && (
            <div className="text-graphite mt-0.5 text-[11px]">
              {material.rejections} previous rejection{material.rejections === 1 ? '' : 's'}
            </div>
          )}
        </TD>
        <TD>
          {!pending && !material.is_done && (
            <form
              className="flex flex-col gap-1"
              onSubmit={(e) => {
                e.preventDefault()
                guard(submitMaterialRound(material.id, sampleRef.trim() || undefined))
                  .then(() => setSampleRef(''))
              }}
            >
              <input
                value={sampleRef} onChange={(e) => setSampleRef(e.target.value)}
                placeholder="sample ref"
                aria-label={`Sample reference for ${material.reference}`}
                className="border-rule w-full rounded border px-1 py-0.5 text-xs"
              />
              <Button size="sm" variant="ghost" type="submit">
                Submit round {material.rounds + 1}
              </Button>
            </form>
          )}
          {pending && mayDecide && (
            <select
              defaultValue=""
              onChange={(e) => {
                if (e.target.value) guard(decideMaterialRound(pending.id, e.target.value))
              }}
              className="border-rule w-full rounded border px-1 py-1 text-xs"
              aria-label={`Decide round ${pending.round} of ${material.reference}`}
            >
              <option value="">— decide —</option>
              {MATERIAL_DECISIONS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          )}
          {pending && !mayDecide && (
            <span className="text-graphite text-xs">Awaiting the design manager</span>
          )}
        </TD>
      </TR>

      {open && (
        <TR>
          <TD colSpan={7} className="bg-surface-2">
            <div className="py-1">
              <h3 className="mb-2 text-sm font-semibold">
                Submission history — {material.reference}
              </h3>
              {submissions.length === 0 ? (
                <p className="text-graphite text-sm">Nothing submitted yet.</p>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH className="w-[64px]">Round</TH>
                      <TH className="w-[92px]">Submitted</TH>
                      <TH className="w-[130px]">Sample ref</TH>
                      <TH className="w-[150px]">Decision</TH>
                      <TH className="w-[92px]">Decided</TH>
                      <TH>Comments</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {submissions.map((s) => (
                      <TR key={s.id}>
                        <TD><Code className="text-xs">{s.round}</Code></TD>
                        <TD><Code className="text-graphite text-xs">
                          {fmtDate(s.submitted_at)}</Code></TD>
                        <TD>
                          {s.sample_reference
                            ? <Code className="text-xs">{s.sample_reference}</Code>
                            : <span className="text-graphite text-xs">—</span>}
                        </TD>
                        <TD>
                          <Pill tone={
                            s.decision === 'Rejected' ? 'stop'
                              : s.decision === 'Pending' ? 'warn'
                                : s.decision === 'Withdrawn' ? 'neutral' : 'ok'}>
                            {s.decision}
                          </Pill>
                        </TD>
                        <TD><Code className="text-graphite text-xs">
                          {fmtDate(s.decided_at)}</Code></TD>
                        <TD className="text-sm">
                          {s.comments ?? <span className="text-graphite">—</span>}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
              <p className="text-graphite mt-2 max-w-prose text-xs">
                Nothing above can be edited or removed. "Has this ever come back?" is the
                question somebody asks at handover, and it is answerable here because the
                record was never tidied.
              </p>
            </div>
          </TD>
        </TR>
      )}
    </>
  )
}

function AddSample({
  companies, onClose, onAdd,
}: {
  companies: ProjectCompany[]
  onClose: () => void
  onAdd: (row: {
    reference: string; title: string; spec: string | null
    location: string | null; company_id: string | null
  }) => void
}) {
  const [reference, setReference] = useState('')
  const [title, setTitle] = useState('')
  const [spec, setSpec] = useState('')
  const [location, setLocation] = useState('')
  const [company, setCompany] = useState('')
  const valid = reference.trim() !== '' && title.trim() !== ''

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6 backdrop-blur-sm">
      <form
        className="glass-popover w-full max-w-[520px] rounded-lg p-5"
        onSubmit={(e) => {
          e.preventDefault()
          if (!valid) return
          onAdd({
            reference: reference.trim(), title: title.trim(),
            spec: spec.trim() || null, location: location.trim() || null,
            company_id: company || null,
          })
        }}
      >
        <h2 className="mb-1 text-base font-semibold">Add a sample</h2>
        <div className="mb-3 flex gap-2">
          <label className="w-[120px]">
            <span className="mb-1 block text-xs font-medium">Reference</span>
            <input value={reference} onChange={(e) => setReference(e.target.value)}
              placeholder="MAT-001"
              className="border-rule w-full rounded border px-2 py-2 font-mono text-sm" />
          </label>
          <label className="flex-1">
            <span className="mb-1 block text-xs font-medium">Sample</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)}
              className="border-rule w-full rounded border px-3 py-2 text-sm" />
          </label>
        </div>
        <div className="mb-3 flex gap-2">
          <label className="flex-1">
            <span className="mb-1 block text-xs font-medium">Specification clause</span>
            <input value={spec} onChange={(e) => setSpec(e.target.value)}
              className="border-rule w-full rounded border px-2 py-2 text-sm" />
          </label>
          <label className="flex-1">
            <span className="mb-1 block text-xs font-medium">Location</span>
            <input value={location} onChange={(e) => setLocation(e.target.value)}
              className="border-rule w-full rounded border px-2 py-2 text-sm" />
          </label>
        </div>
        <label className="mb-4 block">
          <span className="mb-1 block text-xs font-medium">Who submits it</span>
          <select value={company} onChange={(e) => setCompany(e.target.value)}
            className="border-rule w-full rounded border px-2 py-2 text-sm">
            <option value="">— nobody yet —</option>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" type="button" onClick={onClose}>Cancel</Button>
          <Button size="sm" type="submit" disabled={!valid}>Add</Button>
        </div>
      </form>
    </div>
  )
}
