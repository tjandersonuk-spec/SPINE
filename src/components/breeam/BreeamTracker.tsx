import { useCallback, useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Panel } from '@/components/ui/panel'
import { Code, Pill, Table, TableScroll, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import {
  TRACKED_STATUSES, fetchBreeamCredits, fetchProjectCompanies, setBreeamCredit,
  updateTrackedItem, type BreeamCredit, type ProjectCompany,
} from '@/lib/queries'

/**
 * The tracker: every credit under every issue, with its state.
 *
 * A credit is a tracked item, so the owner, the status and the date are edited
 * the way every other tracked item is. The numbers are different: they are the
 * score, so they move only through set_breeam_credit(), which refuses more than
 * the credit offers and refuses a prerequisite outright.
 */
const fmt = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })
    : '—'

type View = 'all' | 'open' | 'risk'

export function BreeamTracker({
  projectId, schemeId, canEdit, onChanged,
}: {
  projectId: string
  schemeId: string
  canEdit: boolean
  onChanged?: () => void
}) {
  const [rows, setRows] = useState<BreeamCredit[]>([])
  const [companies, setCompanies] = useState<ProjectCompany[]>([])
  const [view, setView] = useState<View>('open')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    Promise.all([fetchBreeamCredits(schemeId), fetchProjectCompanies(projectId)])
      .then(([r, c]) => { setRows(r); setCompanies(c); setError(null) })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [projectId, schemeId])

  useEffect(load, [load])

  const guard = (p: Promise<unknown>) =>
    p.then(() => { load(); onChanged?.() }).catch((e: Error) => setError(e.message))

  const visible = useMemo(() => rows.filter((r) => {
    if (view === 'open') return !r.met && r.status !== 'Not targeted'
    if (view === 'risk') return r.state_kind === 'stop' || r.state_kind === 'gap'
    return true
  }), [rows, view])

  /** Grouped by issue, in the order the codes sort. */
  const issues = useMemo(() => {
    const by = new Map<string, { code: string; title: string | null; section: string | null
      rows: BreeamCredit[] }>()
    for (const r of visible) {
      const g = by.get(r.issue_id) ?? {
        code: r.issue_code, title: r.issue_title, section: r.section, rows: [] }
      g.rows.push(r)
      by.set(r.issue_id, g)
    }
    return [...by.values()].sort((a, b) =>
      a.code.localeCompare(b.code, undefined, { numeric: true }))
  }, [visible])

  const openCount = rows.filter((r) => !r.met && r.status !== 'Not targeted').length
  const riskCount = rows.filter((r) => r.state_kind === 'stop' || r.state_kind === 'gap').length

  if (loading) return <div className="text-graphite p-6 text-sm">Loading…</div>

  return (
    <>
      {error && (
        <Panel kind="comply" className="mb-4"><p className="text-stop text-sm">{error}</p></Panel>
      )}

      {rows.length === 0 ? (
        <Panel title="No credits loaded">
          <p className="text-graphite max-w-prose text-sm">
            The scheme has sections but no issues or credits yet. Import the credits template on
            Scheme setup — the assessor's own tracker, in the published columns.
          </p>
        </Panel>
      ) : (
        <Panel
          title={`${rows.filter((r) => r.met).length} of ${rows.length} verified`}
          actions={
            <div className="flex gap-1">
              {([['open', `Open (${openCount})`], ['risk', `At risk (${riskCount})`],
                 ['all', `All (${rows.length})`]] as [View, string][]).map(([k, label]) => (
                <Button
                  key={k}
                  size="sm"
                  variant={view === k ? 'secondary' : 'ghost'}
                  onClick={() => { if (view !== k) setView(k) }}
                >
                  {label}
                </Button>
              ))}
            </div>
          }
        >
          <TableScroll>
            <Table>
              <THead>
                <TR>
                  <TH className="w-[92px]">Ref</TH>
                  <TH>Requirement</TH>
                  <TH className="w-[120px]">State</TH>
                  <TH className="w-[150px]">Who</TH>
                  <TH className="w-[88px]">Due</TH>
                  <TH className="w-[150px]">Status</TH>
                  <TH className="w-[150px]">Credits</TH>
                </TR>
              </THead>
              <TBody>
                {issues.map((g) => (
                  <IssueGroup
                    key={g.code}
                    group={g}
                    companies={companies}
                    canEdit={canEdit}
                    guard={guard}
                  />
                ))}
              </TBody>
            </Table>
          </TableScroll>
          <p className="text-graphite mt-3 max-w-prose text-xs">
            A prerequisite is pass or fail: while it is anything but Verified, every credit under
            its issue is held at risk and counts for nothing. Targeted and achieved cannot exceed
            what the credit offers.
          </p>
        </Panel>
      )}
    </>
  )
}

function IssueGroup({
  group, companies, canEdit, guard,
}: {
  group: { code: string; title: string | null; section: string | null; rows: BreeamCredit[] }
  companies: ProjectCompany[]
  canEdit: boolean
  guard: (p: Promise<unknown>) => Promise<void>
}) {
  return (
    <>
      <TR muted>
        <TD colSpan={7} className="bg-surface-2 text-xs font-semibold">
          <Code className="mr-2 text-xs">{group.code}</Code>
          {group.title}
          {group.section && (
            <span className="text-graphite ml-2 font-normal">· {group.section}</span>
          )}
        </TD>
      </TR>
      {group.rows.map((r) => (
        <CreditRow
          key={`${r.id}-${r.targeted}-${r.achieved}`}
          r={r} companies={companies} canEdit={canEdit} guard={guard}
        />
      ))}
    </>
  )
}

function CreditRow({
  r, companies, canEdit, guard,
}: {
  r: BreeamCredit
  companies: ProjectCompany[]
  canEdit: boolean
  guard: (p: Promise<unknown>) => Promise<void>
}) {
  // Keyed by the saved numbers in IssueGroup, so a change from the server
  // remounts the row with fresh drafts rather than syncing them in an effect.
  const [targeted, setTargeted] = useState(String(r.targeted))
  const [achieved, setAchieved] = useState(String(r.achieved))

  const save = () => {
    const t = Number(targeted), a = Number(achieved)
    if (!Number.isFinite(t) || !Number.isFinite(a)) return
    if (t === r.targeted && a === r.achieved) return
    void guard(setBreeamCredit(r.id, t, a))
  }

  return (
    <TR>
      <TD><Code className="text-xs">{r.reference}</Code></TD>
      <TD>
        <div>
          {r.is_prerequisite && (
            <span className="text-graphite mr-1.5 text-[10px] font-bold tracking-wider uppercase">
              Prerequisite
            </span>
          )}
          {r.title}
        </div>
        {r.prompt && <div className="text-graphite-light mt-0.5 text-xs italic">{r.prompt}</div>}
      </TD>
      <TD><Pill tone={r.state_kind}>{r.state}</Pill></TD>
      <TD>
        {canEdit ? (
          <select
            value={r.company_id ?? ''}
            onChange={(e) => void guard(updateTrackedItem(r.id, { company_id: e.target.value || null }))}
            className="border-rule w-full rounded border px-1 py-1 text-xs"
            aria-label={`Who owns ${r.reference}`}
          >
            <option value="">— nobody —</option>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        ) : (
          companies.find((c) => c.id === r.company_id)?.name
            ?? <span className="text-graphite text-xs">—</span>
        )}
      </TD>
      <TD><Code className="text-graphite text-xs">{fmt(r.due)}</Code></TD>
      <TD>
        {canEdit ? (
          <select
            value={r.status}
            onChange={(e) => void guard(updateTrackedItem(r.id, { status: e.target.value }))}
            className="border-rule w-full rounded border px-1 py-1 text-xs"
            aria-label={`Status of ${r.reference}`}
          >
            {TRACKED_STATUSES.breeam.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        ) : (
          <Pill tone={r.met ? 'ok' : 'neutral'}>{r.status}</Pill>
        )}
      </TD>
      <TD>
        {r.is_prerequisite ? (
          <span className="text-graphite text-xs">pass / fail</span>
        ) : canEdit ? (
          <div className="flex items-center gap-1 text-xs">
            <input
              value={targeted}
              onChange={(e) => setTargeted(e.target.value)}
              onBlur={save}
              inputMode="numeric"
              aria-label={`Credits targeted on ${r.reference}`}
              className="border-rule w-[38px] rounded border px-1 py-0.5 text-right font-mono"
            />
            <span className="text-graphite">/</span>
            <input
              value={achieved}
              onChange={(e) => setAchieved(e.target.value)}
              onBlur={save}
              inputMode="numeric"
              aria-label={`Credits achieved on ${r.reference}`}
              className="border-rule w-[38px] rounded border px-1 py-0.5 text-right font-mono"
            />
            <Code className="text-graphite">of {r.available}</Code>
          </div>
        ) : (
          <Code className="text-xs">{r.targeted} / {r.achieved} of {r.available}</Code>
        )}
      </TD>
    </TR>
  )
}
