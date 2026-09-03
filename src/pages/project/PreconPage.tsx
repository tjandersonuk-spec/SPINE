import { useCallback, useEffect, useState } from 'react'
import { useOutletContext, useParams } from 'react-router'

import { Money } from '@/components/commercial/Money'
import { fmtDate } from '@/lib/format'
import { RequireModule } from '@/components/shell/RequireModule'
import { Button } from '@/components/ui/button'
import { Panel, PageHead } from '@/components/ui/panel'
import { Code, Pill, Table, TableScroll, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import {
  addPreconLine, addPreconQuote, addQuoteAdjustment, deleteQuoteAdjustment,
  fetchPreconBudget, fetchPreconQuotes, fetchPreconTotals, fetchProjectCompanies,
  fetchQuoteAdjustments, setPreferredQuote, updatePreconLine,
  type PreconLine, type PreconQuote, type PreconTotals, type ProjectCompany,
  type QuoteAdjustment,
} from '@/lib/queries'
import type { ProjectContext } from '@/pages/project/ProjectLayout'

/**
 * The pre-construction fee budget.
 *
 * Held apart from the appointed-fee tables because during pre-construction
 * nothing is appointed: there is no company to hang a fee on and no programme
 * to date it from. It is the contractor's own working document, invisible to
 * every consultant on the project — including the one whose quote is in it.
 *
 * The adjustments are the point. Submissions are never like for like, and the
 * adjustment records what is being levelled and why, in words, so the
 * comparison can be defended six months later.
 */
export default function PreconPage() {
  const { id = '' } = useParams()
  const ctx = useOutletContext<ProjectContext>()
  const [lines, setLines] = useState<PreconLine[]>([])
  const [quotes, setQuotes] = useState<PreconQuote[]>([])
  const [adjustments, setAdjustments] = useState<QuoteAdjustment[]>([])
  const [totals, setTotals] = useState<PreconTotals | null>(null)
  const [companies, setCompanies] = useState<ProjectCompany[]>([])
  const [open, setOpen] = useState<string | null>(null)
  const [showStruck, setShowStruck] = useState(false)
  const [adding, setAdding] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    Promise.all([
      fetchPreconBudget(id), fetchPreconQuotes(id), fetchPreconTotals(id),
      fetchProjectCompanies(id),
    ])
      .then(async ([l, q, t, co]) => {
        setLines(l); setQuotes(q); setTotals(t); setCompanies(co)
        setAdjustments(await fetchQuoteAdjustments(q.map((x) => x.id)))
        setError(null)
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [id])

  useEffect(load, [load])

  const guard = (p: Promise<unknown>) =>
    p.then(load).catch((e: Error) => setError(e.message))

  const visible = showStruck ? lines : lines.filter((l) => l.required)

  if (loading) return <div className="text-graphite p-6 text-sm">Loading…</div>

  return (
    <RequireModule module="precon">
      <PageHead
        eyebrow="Pre-construction"
        title="Fee budget"
        meta="The contractor's own working document. No consultant on this project can see it, including one whose quote is in it."
      />

      {error && (
        <Panel kind="comply" className="mb-4"><p className="text-stop text-sm">{error}</p></Panel>
      )}

      {totals && lines.length > 0 && (
        <Panel title="Position" kind="money">
          <div className="flex flex-wrap gap-6">
            <Figure label="Budget" value={totals.budget} />
            <Figure label="Forecast" value={totals.forecast} />
            <Figure label="Variance" value={totals.variance} signed />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {totals.awaiting_quotes > 0 && (
              <Pill tone="neutral">{totals.awaiting_quotes} awaiting quotes</Pill>
            )}
            {totals.undecided > 0 && (
              <Pill tone="warn">{totals.undecided} quoted, undecided</Pill>
            )}
            {totals.struck_out > 0 && (
              <Pill tone="neutral">{totals.struck_out} struck out</Pill>
            )}
          </div>
          <p className="text-graphite mt-3 max-w-prose text-xs">
            The forecast follows the quote somebody chose, not the cheapest one — picking the
            cheapest by default is a decision, and this module exists so that decision is made
            by a person and recorded.
          </p>
        </Panel>
      )}

      <Panel
        title="Budget lines"
        actions={
          <div className="flex gap-1">
            {lines.some((l) => !l.required) && (
              <Button size="sm" variant={showStruck ? 'secondary' : 'ghost'}
                onClick={() => setShowStruck((v) => !v)}>
                {showStruck ? 'Hide' : 'Show'} struck out
              </Button>
            )}
            {ctx.canEdit && (
              <Button size="sm" variant="ghost" onClick={() => setAdding(true)}>
                Add a line
              </Button>
            )}
          </div>
        }
      >
        {visible.length === 0 ? (
          <p className="text-graphite max-w-prose text-sm">
            No budget lines yet. A line is a consultant appointment, a survey or a statutory
            fee you expect to pay before anything is let.
          </p>
        ) : (
          <TableScroll>
            <Table>
              <THead>
                <TR>
                  <TH className="w-[92px]">Ref</TH>
                  <TH>Line</TH>
                  <TH className="w-[92px]">Category</TH>
                  <TH className="w-[100px]">Budget</TH>
                  <TH className="w-[64px]">Quotes</TH>
                  <TH className="w-[150px]">Chosen</TH>
                  <TH className="w-[100px]">Forecast</TH>
                  <TH className="w-[100px]">Variance</TH>
                  <TH className="w-[80px]" />
                </TR>
              </THead>
              <TBody>
                {visible.map((l) => (
                  <RowGroup
                    key={l.id}
                    projectId={id}
                    line={l}
                    quotes={quotes.filter((q) => q.budget_line_id === l.id)}
                    adjustments={adjustments}
                    companies={companies}
                    canEdit={ctx.canEdit}
                    open={open === l.id}
                    onToggle={() => setOpen(open === l.id ? null : l.id)}
                    guard={guard}
                  />
                ))}
              </TBody>
            </Table>
          </TableScroll>
        )}
        <p className="text-graphite mt-3 max-w-prose text-xs">
          A struck-out line drops from every total but stays on the page. Deleting it would
          lose the decision that it was not needed, which is precisely what gets asked about
          at the cost report.
        </p>
      </Panel>

      {adding && (
        <AddLine
          onClose={() => setAdding(false)}
          onAdd={(row) => guard(addPreconLine(id, row)).then(() => setAdding(false))}
        />
      )}
    </RequireModule>
  )
}

function Figure({
  label, value, signed,
}: { label: string; value: number; signed?: boolean }) {
  return (
    <div>
      <p className="text-graphite-light text-[10px] font-bold tracking-[0.13em] uppercase">
        {label}
      </p>
      <p className="font-mono text-2xl font-bold tracking-tight">
        <Money value={value} className="text-2xl" tone={signed ? 'signed' : 'plain'} />
      </p>
    </div>
  )
}

function RowGroup({
  projectId, line, quotes, adjustments, companies, canEdit, open, onToggle, guard,
}: {
  projectId: string
  line: PreconLine
  quotes: PreconQuote[]
  adjustments: QuoteAdjustment[]
  companies: ProjectCompany[]
  canEdit: boolean
  open: boolean
  onToggle: () => void
  guard: (p: Promise<unknown>) => Promise<void>
}) {
  const [addingQuote, setAddingQuote] = useState(false)

  return (
    <>
      <TR muted={!line.required}>
        <TD><Code className={line.required ? 'text-xs' : 'text-xs line-through'}>
          {line.reference}</Code></TD>
        <TD>
          <button type="button" onClick={onToggle}
            className={'text-left underline-offset-2 hover:underline' +
              (line.required ? '' : ' line-through')}>
            {line.title}
          </button>
          {line.discipline && (
            <Code className="text-graphite ml-1.5 text-xs">{line.discipline}</Code>
          )}
          {line.appointed_fees > 0 && (
            <div className="text-graphite mt-0.5 text-[11px]">
              Appointed: <Money value={line.appointed_approved} className="text-[11px]" />
            </div>
          )}
        </TD>
        <TD className="text-xs">{line.category}</TD>
        <TD><Money value={line.budget} /></TD>
        <TD>
          <Code className={'text-xs ' + (line.quotes === 0 ? 'text-graphite' : '')}>
            {line.quotes}
          </Code>
        </TD>
        <TD>
          {line.preferred_source
            ? <span className="text-xs">{line.preferred_source}</span>
            : line.quotes > 0
              ? <Pill tone="warn">Undecided</Pill>
              : <span className="text-graphite text-xs">—</span>}
        </TD>
        <TD><Money value={line.forecast} /></TD>
        <TD>
          {line.variance === 0
            ? <Code className="text-graphite text-xs">—</Code>
            : <Money value={line.variance} tone="signed" />}
        </TD>
        <TD>
          {canEdit && (
            <button type="button"
              onClick={() => guard(updatePreconLine(line.id, { required: !line.required }))}
              className="text-graphite text-xs underline"
              title={line.required
                ? 'Strike it out: drops from every total but stays on the page'
                : 'Put it back in the totals'}>
              {line.required ? 'Strike out' : 'Restore'}
            </button>
          )}
        </TD>
      </TR>

      {open && (
        <TR>
          <TD colSpan={9} className="bg-surface-2">
            <div className="py-1">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold">
                  Quotes against {line.reference}
                </h3>
                {canEdit && (
                  <Button size="sm" variant="ghost" onClick={() => setAddingQuote(true)}>
                    Add a quote
                  </Button>
                )}
              </div>
              {quotes.length === 0 ? (
                <p className="text-graphite text-sm">
                  Nothing received yet.
                </p>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Source</TH>
                      <TH className="w-[86px]">Received</TH>
                      <TH className="w-[100px]">Submitted</TH>
                      <TH>Levelling</TH>
                      <TH className="w-[104px]">Comparable</TH>
                      <TH className="w-[110px]">Status</TH>
                      <TH className="w-[90px]" />
                    </TR>
                  </THead>
                  <TBody>
                    {quotes.map((q) => (
                      <TR key={q.id}>
                        <TD>
                          {q.source_name}
                          {q.preferred && <Pill tone="ok" className="ml-1.5">Chosen</Pill>}
                        </TD>
                        <TD><Code className="text-graphite text-xs">
                          {fmtDate(q.date_received)}</Code></TD>
                        <TD><Money value={q.base_value} className="text-graphite" /></TD>
                        <TD>
                          {adjustments.filter((a) => a.quote_id === q.id).map((a) => (
                            <div key={a.id} className="flex items-baseline gap-1.5 text-xs">
                              <Money value={a.value} tone="signed" />
                              <span>{a.label}</span>
                              {canEdit && (
                                <button type="button"
                                  onClick={() => guard(deleteQuoteAdjustment(a.id))}
                                  className="text-graphite underline">×</button>
                              )}
                            </div>
                          ))}
                          {canEdit && (
                            <AddAdjustment
                              onAdd={(label, value) =>
                                guard(addQuoteAdjustment(q.id, label, value))}
                            />
                          )}
                        </TD>
                        <TD><Money value={q.levelled_value} className="font-bold" /></TD>
                        <TD className="text-xs">{q.status}</TD>
                        <TD>
                          {canEdit && !q.preferred && (
                            <button type="button"
                              onClick={() => guard(setPreferredQuote(line.id, q.id))}
                              className="text-graphite text-xs underline">
                              Choose
                            </button>
                          )}
                          {canEdit && q.preferred && (
                            <button type="button"
                              onClick={() => guard(setPreferredQuote(line.id, null))}
                              className="text-graphite text-xs underline">
                              Un-choose
                            </button>
                          )}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
              <p className="text-graphite mt-2 max-w-prose text-xs">
                The submitted figure is kept alongside the comparable one, because "what did
                they actually quote" is a different question from "what is comparable". Every
                adjustment needs a label: a plugged number with no explanation makes the
                comparison look considered while destroying the ability to check it.
              </p>
            </div>
          </TD>
        </TR>
      )}

      {addingQuote && (
        <AddQuote
          companies={companies}
          lineReference={line.reference}
          onClose={() => setAddingQuote(false)}
          onAdd={(row) =>
            guard(addPreconQuote(projectId, { ...row, budget_line_id: line.id }))
              .then(() => setAddingQuote(false))}
        />
      )}
    </>
  )
}

function AddAdjustment({
  onAdd,
}: { onAdd: (label: string, value: number) => void }) {
  const [label, setLabel] = useState('')
  const [value, setValue] = useState('')
  const valid = label.trim() !== '' && value.trim() !== '' && Number.isFinite(Number(value))
  return (
    <form
      className="mt-1 flex items-center gap-1"
      onSubmit={(e) => {
        e.preventDefault()
        // Refuses empty input: the label is what makes the adjustment
        // defensible six months later.
        if (!valid) return
        onAdd(label.trim(), Number(value))
        setLabel(''); setValue('')
      }}
    >
      <input
        value={label} onChange={(e) => setLabel(e.target.value)}
        placeholder="what is being levelled"
        aria-label="What is being levelled"
        className="border-rule flex-1 rounded border px-1.5 py-0.5 text-xs"
      />
      <input
        value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal"
        placeholder="±£" aria-label="Adjustment value"
        className="border-rule w-[68px] rounded border px-1.5 py-0.5 text-right font-mono text-xs"
      />
      <Button size="sm" variant="ghost" type="submit" disabled={!valid}>Add</Button>
    </form>
  )
}

function AddLine({
  onClose, onAdd,
}: {
  onClose: () => void
  onAdd: (row: {
    reference: string; category: string; discipline: string | null
    title: string; budget: number
  }) => void
}) {
  const [reference, setReference] = useState('')
  const [category, setCategory] = useState('consultant')
  const [discipline, setDiscipline] = useState('')
  const [title, setTitle] = useState('')
  const [budget, setBudget] = useState('0')
  const valid = reference.trim() !== '' && title.trim() !== ''

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
      <form
        className="bg-card border-rule w-full max-w-[520px] rounded-lg border p-5 shadow-2xl"
        onSubmit={(e) => {
          e.preventDefault()
          if (!valid) return
          onAdd({
            reference: reference.trim(), category,
            discipline: discipline.trim() || null,
            title: title.trim(), budget: Number(budget) || 0,
          })
        }}
      >
        <h2 className="mb-1 text-base font-semibold">Add a budget line</h2>
        <p className="text-graphite mb-3 text-xs">
          A survey maps to no discipline, and that is normal — leave it blank.
        </p>
        <div className="mb-3 flex gap-2">
          <label className="w-[120px]">
            <span className="mb-1 block text-xs font-medium">Reference</span>
            <input value={reference} onChange={(e) => setReference(e.target.value)}
              placeholder="PB-001"
              className="border-rule w-full rounded border px-2 py-2 font-mono text-sm" />
          </label>
          <label className="flex-1">
            <span className="mb-1 block text-xs font-medium">Category</span>
            <select value={category} onChange={(e) => setCategory(e.target.value)}
              className="border-rule w-full rounded border px-2 py-2 text-sm">
              <option value="consultant">Consultant</option>
              <option value="survey">Survey</option>
              <option value="statutory">Statutory</option>
            </select>
          </label>
          <label className="w-[86px]">
            <span className="mb-1 block text-xs font-medium">Discipline</span>
            <input value={discipline} onChange={(e) => setDiscipline(e.target.value)}
              placeholder="A"
              className="border-rule w-full rounded border px-2 py-2 font-mono text-sm" />
          </label>
        </div>
        <label className="mb-3 block">
          <span className="mb-1 block text-xs font-medium">Line</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)}
            className="border-rule w-full rounded border px-3 py-2 text-sm" />
        </label>
        <label className="mb-4 block">
          <span className="mb-1 block text-xs font-medium">Budget (£, ex VAT)</span>
          <input value={budget} onChange={(e) => setBudget(e.target.value)} inputMode="decimal"
            className="border-rule w-full rounded border px-3 py-2 text-right font-mono text-sm" />
        </label>
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" type="button" onClick={onClose}>Cancel</Button>
          <Button size="sm" type="submit" disabled={!valid}>Add</Button>
        </div>
      </form>
    </div>
  )
}

function AddQuote({
  companies, lineReference, onClose, onAdd,
}: {
  companies: ProjectCompany[]
  lineReference: string
  onClose: () => void
  onAdd: (row: {
    company_id: string | null; supplier: string | null; reference: string | null
    date_received: string | null; base_value: number
  }) => void
}) {
  const [companyId, setCompanyId] = useState('')
  const [supplier, setSupplier] = useState('')
  const [reference, setReference] = useState('')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [value, setValue] = useState('')
  // Either a firm in the directory or a name typed in. Both are normal at this
  // stage; one of the two must be there, because a quote from nobody is not a
  // quote.
  const valid = (companyId !== '' || supplier.trim() !== '') && Number(value) > 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
      <form
        className="bg-card border-rule w-full max-w-[520px] rounded-lg border p-5 shadow-2xl"
        onSubmit={(e) => {
          e.preventDefault()
          if (!valid) return
          onAdd({
            company_id: companyId || null,
            supplier: companyId ? null : supplier.trim() || null,
            reference: reference.trim() || null,
            date_received: date, base_value: Number(value),
          })
        }}
      >
        <h2 className="mb-1 text-base font-semibold">Add a quote</h2>
        <p className="text-graphite mb-3 text-xs">
          Against <Code className="text-xs">{lineReference}</Code>. A firm already in the
          directory, or a name typed in because they are not.
        </p>
        <label className="mb-3 block">
          <span className="mb-1 block text-xs font-medium">From the directory</span>
          <select value={companyId} onChange={(e) => setCompanyId(e.target.value)}
            className="border-rule w-full rounded border px-2 py-2 text-sm">
            <option value="">— not in the directory —</option>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        {!companyId && (
          <label className="mb-3 block">
            <span className="mb-1 block text-xs font-medium">Supplier</span>
            <input value={supplier} onChange={(e) => setSupplier(e.target.value)}
              className="border-rule w-full rounded border px-3 py-2 text-sm" />
          </label>
        )}
        <div className="mb-4 flex gap-2">
          <label className="flex-1">
            <span className="mb-1 block text-xs font-medium">Their reference</span>
            <input value={reference} onChange={(e) => setReference(e.target.value)}
              className="border-rule w-full rounded border px-2 py-2 font-mono text-sm" />
          </label>
          <label className="w-[130px]">
            <span className="mb-1 block text-xs font-medium">Received</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
              className="border-rule w-full rounded border px-2 py-2 text-sm" />
          </label>
          <label className="w-[120px]">
            <span className="mb-1 block text-xs font-medium">Submitted (£)</span>
            <input value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal"
              className="border-rule w-full rounded border px-2 py-2 text-right font-mono text-sm" />
          </label>
        </div>
        <p className="text-graphite mb-3 max-w-prose text-xs">
          Enter what they actually quoted. Levelling it against the others is the next step,
          and it happens as named adjustments so the comparison can be defended later.
        </p>
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" type="button" onClick={onClose}>Cancel</Button>
          <Button size="sm" type="submit" disabled={!valid}>Add</Button>
        </div>
      </form>
    </div>
  )
}
