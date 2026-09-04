import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useOutletContext, useParams } from 'react-router'

import { Money } from '@/components/commercial/Money'
import { fmtDate } from '@/lib/format'
import { useDeepLink } from '@/lib/deep-link'
import { RequireModule } from '@/components/shell/RequireModule'
import { Button } from '@/components/ui/button'
import { Panel, PageHead } from '@/components/ui/panel'
import { Code, Pill, Table, TableScroll, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { CommentThread } from '@/components/issues/CommentThread'
import {
  LIKELIHOODS, RISK_CATEGORIES, RISK_STATUSES, addRisk, fetchRiskMatrix, fetchRiskTotals,
  fetchRisks, loadRiskLibrary, realiseRisk, updateRisk,
  type Risk, type RiskMatrixCell, type RiskTotals,
} from '@/lib/queries'
import type { ProjectContext } from '@/pages/project/ProjectLayout'

/**
 * The risk and opportunity register.
 *
 * Two things on this page are deliberate departures from the rest of the
 * product. Ownership is a person, not a discipline — a risk owned by
 * "structures" is a risk nobody is holding. And an item is visible to nobody
 * but its raiser, its owner and whoever is named: the inverse of the task
 * list, because a costed risk is a commercial position long before it is a
 * shared one.
 *
 * Every figure shown is expected value. The gross total appears once, labelled
 * as what it is, and never as exposure.
 */
type Kind = 'risk' | 'opportunity'

export default function RiskPage() {
  const { id = '' } = useParams()
  const ctx = useOutletContext<ProjectContext>()
  const [kind, setKind] = useState<Kind>('risk')
  const [rows, setRows] = useState<Risk[]>([])
  // A link from the dashboard names a reference; light its row.
  const [talking, setTalking] = useState<string | null>(null)
  const link = useDeepLink(rows, (r, ref) => r.reference === ref,
    (r) => setTalking(r.id))
  const [totals, setTotals] = useState<RiskTotals | null>(null)
  const [matrix, setMatrix] = useState<RiskMatrixCell[]>([])
  const [showDone, setShowDone] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  const load = useCallback(() => {
    Promise.all([fetchRisks(id, kind), fetchRiskTotals(id, kind), fetchRiskMatrix(id, kind)])
      .then(([r, t, m]) => { setRows(r); setTotals(t); setMatrix(m); setError(null) })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [id, kind])

  useEffect(load, [load])

  const guard = (p: Promise<unknown>) =>
    p.then(load).catch((e: Error) => setError(e.message))

  const visible = useMemo(
    () => (showDone ? rows : rows.filter((r) => !r.done)), [rows, showDone])
  const people = ctx.members ?? []

  if (loading) return <div className="text-graphite p-6 text-sm">Loading…</div>

  const label = kind === 'risk' ? 'Risk' : 'Opportunity'

  return (
    <RequireModule module="risk">
      <PageHead
        eyebrow="Commercial"
        title="Risk and opportunity"
        meta="Owned by a person, not a discipline. Closed to everyone but the raiser, the owner and whoever is named."
        actions={
          <div className="flex gap-1">
            {([['risk', 'Risks'], ['opportunity', 'Opportunities']] as [Kind, string][])
              .map(([k, t]) => (
                <Button
                  key={k} size="sm"
                  variant={kind === k ? 'secondary' : 'ghost'}
                  onClick={() => { if (kind !== k) { setKind(k); setLoading(true) } }}
                >
                  {t}
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

      {totals && (
        <div className="mb-4 grid gap-4 sm:grid-cols-2">
          <Panel title="Exposure" kind="money" className="mb-0">
            <div className="flex items-baseline gap-3">
              <span className="font-mono text-3xl font-bold tracking-tight">
                <Money value={totals.expected} className="text-3xl" />
              </span>
              <span className="text-graphite text-xs">
                expected value across {totals.live} live item{totals.live === 1 ? '' : 's'}
              </span>
            </div>
            <p className="text-graphite mt-2 max-w-prose text-xs">
              Cost × likelihood, item by item. If everything happened it would be{' '}
              <Money value={totals.gross} className="text-graphite" /> — which is not
              exposure and is never reported as a total.
            </p>
          </Panel>
          <Panel title="What needs attention" className="mb-0">
            <div className="flex flex-wrap gap-2">
              {totals.unowned > 0 && (
                <Pill tone="gap">{totals.unowned} unowned</Pill>
              )}
              {totals.review_overdue > 0 && (
                <Pill tone="stop">{totals.review_overdue} review overdue</Pill>
              )}
              {kind === 'risk' && totals.realised > 0 && (
                <Pill tone="stop">{totals.realised} realised</Pill>
              )}
              {totals.finished > 0 && (
                <Pill tone="ok">{totals.finished} closed</Pill>
              )}
              {totals.unowned === 0 && totals.review_overdue === 0 && (
                <span className="text-graphite text-sm">
                  Everything live is owned and in date.
                </span>
              )}
            </div>
          </Panel>
        </div>
      )}

      {matrix.length > 0 && rows.some((r) => !r.done) && (
        <Panel title={`${label} matrix — live items`}>
          <RiskMatrix cells={matrix} />
          <p className="text-graphite mt-2 max-w-prose text-xs">
            The impact band is derived from the cost, never chosen — which removes the
            commonest argument in a risk workshop, where two people score the same £80k item
            differently and the register loses its ordering. A cluster in the top right that
            nobody owns is the report.
          </p>
        </Panel>
      )}

      <Panel
        title={`${visible.length} ${kind === 'risk' ? 'risk' : 'opportunit'}${
          kind === 'risk' ? (visible.length === 1 ? '' : 's') : (visible.length === 1 ? 'y' : 'ies')}`}
        actions={
          <div className="flex gap-1">
            {rows.some((r) => r.done) && (
              <Button size="sm" variant={showDone ? 'secondary' : 'ghost'}
                onClick={() => setShowDone((v) => !v)}>
                {showDone ? 'Hide' : 'Show'} closed
              </Button>
            )}
            {ctx.canEdit && (
              <>
                <Button size="sm" variant="ghost"
                  onClick={() => guard(loadRiskLibrary(id, kind).then((o) =>
                    setNote(`${o.added} loaded, ${o.skipped} already here. Nothing was ` +
                      'given an owner or a review date — those are judgements somebody has ' +
                      'to be accountable for.')))}>
                  Load the library
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setAdding(true)}>
                  Add {kind === 'risk' ? 'a risk' : 'an opportunity'}
                </Button>
              </>
            )}
          </div>
        }
      >
        {visible.length === 0 ? (
          <p className="text-graphite max-w-prose text-sm">
            Nothing here yet. The library is a starting point for recognisable items; it
            never assigns an owner or a date.
          </p>
        ) : (
          <TableScroll>
            <Table>
              <THead>
                <TR>
                  <TH className="w-[86px]">Ref</TH>
                  <TH>Item</TH>
                  <TH className="w-[150px]">Owner</TH>
                  <TH className="w-[128px]">Likelihood</TH>
                  <TH className="w-[104px]">Impact</TH>
                  <TH className="w-[104px]">Expected</TH>
                  <TH className="w-[60px]">Score</TH>
                  <TH className="w-[140px]">State</TH>
                  <TH className="w-[150px]">Status</TH>
                </TR>
              </THead>
              <TBody>
                {visible.map((r) => (
                  <TR key={r.id} data-ref={r.reference}
                    gap={r.state_kind === 'gap' || link.isTarget(r.reference)}
                    muted={r.done}>
                    <TD><Code className="text-xs">{r.reference}</Code></TD>
                    <TD>
                      <div className={r.done ? 'line-through' : undefined}>{r.title}</div>
                      {r.category && (
                        <span className="text-graphite text-xs">{r.category}</span>
                      )}
                      {r.mitigation && (
                        <div className="text-graphite-light mt-0.5 text-xs italic">
                          {r.mitigation}
                        </div>
                      )}
                      {r.issue_reference && (
                        <div className="mt-1 text-xs">
                          {/* Every reference to another record is a working
                              link, never printed text. */}
                          <Link to="../issues" className="underline">
                            Realised as <Code className="text-xs">{r.issue_reference}</Code>
                          </Link>
                        </div>
                      )}
                    </TD>
                    <TD>
                      {ctx.canEdit ? (
                        <select
                          value={r.person_id ?? ''}
                          onChange={(e) =>
                            guard(updateRisk(r.id, { person_id: e.target.value || null }))}
                          className="border-rule w-full rounded border px-1 py-1 text-xs"
                          aria-label={`Who owns ${r.reference}`}
                        >
                          <option value="">— nobody —</option>
                          {people.map((m) => (
                            <option key={m.profile_id} value={m.profile_id}>
                              {m.profiles?.name ?? m.profile_id}
                            </option>
                          ))}
                        </select>
                      ) : (
                        r.owner_name ?? <span className="text-graphite text-xs">—</span>
                      )}
                    </TD>
                    <TD>
                      {ctx.canEdit ? (
                        <select
                          value={r.likelihood}
                          onChange={(e) =>
                            guard(updateRisk(r.id, { likelihood: Number(e.target.value) }))}
                          className="border-rule w-full rounded border px-1 py-1 text-xs"
                          aria-label={`Likelihood of ${r.reference}`}
                        >
                          {LIKELIHOODS.map((l) => (
                            <option key={l.value} value={l.value}>
                              {l.label} ({Math.round(l.pct * 100)}%)
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-xs">
                          {r.likelihood_name}
                          <Code className="text-graphite ml-1 text-xs">
                            {Math.round(r.likelihood_pct * 100)}%
                          </Code>
                        </span>
                      )}
                    </TD>
                    <TD>
                      <Money value={r.impact_cost} />
                      {/* Derived from the cost, not chosen. */}
                      <div className="text-graphite mt-0.5 text-[11px]">{r.band_name}</div>
                    </TD>
                    <TD><Money value={r.expected_value} className="font-bold" /></TD>
                    <TD>
                      <Code className={'text-xs ' + (r.score >= 15 ? 'text-stop'
                        : r.score >= 8 ? 'text-warn' : 'text-graphite')}>
                        {r.score}
                      </Code>
                    </TD>
                    <TD>
                      <Pill tone={r.state_kind}>{r.state}</Pill>
                      {r.review_due && !r.done && (
                        <div className="text-graphite mt-0.5 text-[11px]">
                          {fmtDate(r.review_due)}
                        </div>
                      )}
                    </TD>
                    <TD>
                      {ctx.canEdit ? (
                        <div className="flex flex-col gap-1">
                          <select
                            value={r.status}
                            onChange={(e) => {
                              // Realised is not a status you type: it creates
                              // the task that carries it.
                              if (e.target.value === 'Realised') {
                                guard(realiseRisk(r.id).then(() =>
                                  setNote('Realised. It is now one task in Tasks and RFIs, ' +
                                    'with this register pointing at it — a realised risk ' +
                                    'does not get an action list of its own.')))
                              } else {
                                guard(updateRisk(r.id, { status: e.target.value }))
                              }
                            }}
                            className="border-rule w-full rounded border px-1 py-1 text-xs"
                            aria-label={`Status of ${r.reference}`}
                          >
                            {RISK_STATUSES[r.kind].map((s) => (
                              <option key={s} value={s}
                                disabled={s === 'Realised' && r.issue_id !== null}>
                                {s}
                              </option>
                            ))}
                          </select>
                        </div>
                      ) : (
                        <Pill tone={r.done ? 'ok' : 'neutral'}>{r.status}</Pill>
                      )}
                      {/* A live risk is somebody personally chasing something
                          down, and the chasing is a conversation. A remark here
                          becomes a task without leaving the register. */}
                      <button
                        type="button"
                        onClick={() => setTalking((t) => (t === r.id ? null : r.id))}
                        className="text-graphite mt-1 block text-xs underline"
                      >
                        {talking === r.id ? 'Hide' : 'Discuss'}
                      </button>
                    </TD>
                  </TR>
                ))}
                {visible.map((r) => talking === r.id && (
                  <TR key={`talk-${r.id}`}>
                    <TD colSpan={8} className="bg-surface-2/40">
                      <div className="px-1 py-2">
                        <CommentThread projectId={id} entityType="risk" entityId={r.id} />
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableScroll>
        )}
        <p className="text-graphite mt-3 max-w-prose text-xs">
          An item with no owner is a gap and is marked as one: it is the only thing on this
          page hi-vis is used for, and it means the same as an unallocated cell on the
          responsibility matrix — nobody is holding it.
        </p>
      </Panel>

      {adding && (
        <AddRisk
          kind={kind}
          onClose={() => setAdding(false)}
          onAdd={(row) => guard(addRisk(id, row)).then(() => setAdding(false))}
        />
      )}
    </RequireModule>
  )
}

/** The five-by-five grid. Every cell is drawn, because a grid with holes in it
 *  cannot be read as a grid. */
function RiskMatrix({ cells }: { cells: RiskMatrixCell[] }) {
  const at = (l: number, b: number) =>
    cells.find((c) => c.likelihood === l && c.band === b)
  const bands = ['Minor', 'Moderate', 'Significant', 'Major', 'Severe']
  return (
    <div className="overflow-x-auto">
      <table className="border-separate border-spacing-[2px] text-xs">
        <tbody>
          {[5, 4, 3, 2, 1].map((l) => (
            <tr key={l}>
              <th className="text-graphite w-[104px] pr-2 text-right font-normal">
                {LIKELIHOODS.find((x) => x.value === l)?.label}
              </th>
              {[1, 2, 3, 4, 5].map((b) => {
                const c = at(l, b)
                const score = l * b
                const tone = score >= 15 ? 'bg-stop-bg text-stop'
                  : score >= 8 ? 'bg-warn-bg text-warn' : 'bg-ok-bg text-ok'
                return (
                  <td
                    key={b}
                    className={`h-[46px] w-[80px] rounded border text-center align-middle ${
                      c && c.unowned > 0 ? 'border-hivis border-2' : 'border-rule'} ${tone}`}
                    title={`${LIKELIHOODS.find((x) => x.value === l)?.label} · ${
                      bands[b - 1]} · score ${score}`}
                  >
                    {c && c.items > 0 ? (
                      <>
                        <div className="font-mono text-sm font-bold">{c.items}</div>
                        {c.unowned > 0 && (
                          <div className="text-[10px] font-bold">{c.unowned} unowned</div>
                        )}
                      </>
                    ) : (
                      <span className="text-graphite-light">·</span>
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
          <tr>
            <th />
            {bands.map((b) => (
              <th key={b} className="text-graphite pt-1 font-normal">{b}</th>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  )
}

function AddRisk({
  kind, onClose, onAdd,
}: {
  kind: Kind
  onClose: () => void
  onAdd: (row: {
    kind: Kind; reference: string; title: string; description: string | null
    category: string | null; likelihood: number; impact_cost: number; status: string
  }) => void
}) {
  const [reference, setReference] = useState('')
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('')
  const [likelihood, setLikelihood] = useState(3)
  const [cost, setCost] = useState('0')
  const valid = reference.trim() !== '' && title.trim() !== ''

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6 backdrop-blur-sm">
      <form
        className="glass-popover w-full max-w-[540px] rounded-lg p-5"
        onSubmit={(e) => {
          e.preventDefault()
          if (!valid) return
          onAdd({
            kind, reference: reference.trim(), title: title.trim(), description: null,
            category: category || null, likelihood, impact_cost: Number(cost) || 0,
            status: kind === 'opportunity' ? 'Identified' : 'Open',
          })
        }}
      >
        <h2 className="mb-1 text-base font-semibold">
          Add {kind === 'risk' ? 'a risk' : 'an opportunity'}
        </h2>
        <p className="text-graphite mb-3 text-xs">
          It arrives visible to you alone until you name somebody. The impact band and the
          expected value are derived from the cost — there is nothing to score by hand.
        </p>
        <div className="mb-3 flex gap-2">
          <label className="w-[120px]">
            <span className="mb-1 block text-xs font-medium">Reference</span>
            <input value={reference} onChange={(e) => setReference(e.target.value)}
              placeholder={kind === 'risk' ? 'RSK-01' : 'OPP-01'}
              className="border-rule w-full rounded border px-2 py-2 font-mono text-sm" />
          </label>
          <label className="flex-1">
            <span className="mb-1 block text-xs font-medium">Category</span>
            <select value={category} onChange={(e) => setCategory(e.target.value)}
              className="border-rule w-full rounded border px-2 py-2 text-sm">
              <option value="">— none —</option>
              {RISK_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
        </div>
        <label className="mb-3 block">
          <span className="mb-1 block text-xs font-medium">
            {kind === 'risk' ? 'Risk' : 'Opportunity'}
          </span>
          <input value={title} onChange={(e) => setTitle(e.target.value)}
            className="border-rule w-full rounded border px-3 py-2 text-sm" />
        </label>
        <div className="mb-4 flex gap-2">
          <label className="flex-1">
            <span className="mb-1 block text-xs font-medium">Likelihood</span>
            <select value={likelihood} onChange={(e) => setLikelihood(Number(e.target.value))}
              className="border-rule w-full rounded border px-2 py-2 text-sm">
              {LIKELIHOODS.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label} ({Math.round(l.pct * 100)}%)
                </option>
              ))}
            </select>
          </label>
          <label className="w-[150px]">
            <span className="mb-1 block text-xs font-medium">
              {kind === 'risk' ? 'Cost' : 'Saving'} (£)
            </span>
            <input value={cost} onChange={(e) => setCost(e.target.value)} inputMode="decimal"
              className="border-rule w-full rounded border px-2 py-2 text-right font-mono text-sm" />
          </label>
        </div>
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" type="button" onClick={onClose}>Cancel</Button>
          <Button size="sm" type="submit" disabled={!valid}>Add</Button>
        </div>
      </form>
    </div>
  )
}
