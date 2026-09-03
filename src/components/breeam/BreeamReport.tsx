import { useEffect, useState } from 'react'

import { Panel } from '@/components/ui/panel'
import { Code, Pill, Table, TableScroll, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import {
  fetchAdvisoryStandards, fetchBreeamIssues, fetchBreeamSections, fetchBreeamTotals,
  fetchMinStandardFails, type BreeamIssue, type BreeamScheme, type BreeamSection,
  type BreeamTotals, type MinStandardFail,
} from '@/lib/queries'

/**
 * The score report.
 *
 * Two ratings, side by side: what the score alone would give, and what stands
 * after minimum standards. "82%, capped at Very Good by Ene 01" is a different
 * conversation from "Very Good", and the page exists to have the first one.
 * Every figure is read from the derived views; nothing is added up here.
 */
const pct = (x: number) => `${(x * 100).toFixed(1)}%`
const n = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1))

type Fails = Record<string, { targeted: MinStandardFail[]; achieved: MinStandardFail[]
  advisory: { code: string; title: string | null; note: string }[] }>

export function BreeamReport({
  projectId, scheme,
}: {
  projectId: string
  scheme: BreeamScheme
}) {
  const [totals, setTotals] = useState<BreeamTotals | null>(null)
  const [sections, setSections] = useState<BreeamSection[]>([])
  const [issues, setIssues] = useState<BreeamIssue[]>([])
  const [fails, setFails] = useState<Fails>({})
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // Best first, so the first rating a project clears is the one it gets.
  const ratings = [...scheme.ratings].sort((a, b) => b.min - a.min)

  useEffect(() => {
    let live = true
    Promise.all([
      fetchBreeamTotals(projectId, scheme.id),
      fetchBreeamSections(scheme.id),
      fetchBreeamIssues(scheme.id),
      Promise.all(ratings.map(async (r) => [r.name, {
        targeted: await fetchMinStandardFails(scheme.id, r.name, 'targeted'),
        achieved: await fetchMinStandardFails(scheme.id, r.name, 'achieved'),
        advisory: await fetchAdvisoryStandards(scheme.id, r.name),
      }] as const)),
    ])
      .then(([t, s, i, f]) => {
        if (!live) return
        setTotals(t); setSections(s); setIssues(i)
        setFails(Object.fromEntries(f))
        setError(null)
      })
      .catch((e: Error) => { if (live) setError(e.message) })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
    // ratings derives from scheme, which is the dependency that matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, scheme])

  if (loading) return <div className="text-graphite p-6 text-sm">Loading…</div>
  if (error) {
    return <Panel kind="comply"><p className="text-stop text-sm">{error}</p></Panel>
  }
  if (!totals) return <Panel title="Nothing to score yet" />

  const blocked = issues.filter((i) => i.blocking > 0)
  const disagreeing = sections.filter((s) => s.stated_gap !== null && s.stated_gap !== 0)
  const weightWarn = Math.abs(totals.weighting_total - 1) > 0.0005

  return (
    <>
      {/* ------------------------------------------------------ headline */}
      <div className="mb-4 grid gap-4 sm:grid-cols-2">
        <Headline
          label="Targeted"
          score={totals.score_targeted}
          onScore={totals.rating_targeted_on_score}
          after={totals.rating_targeted}
          capped={totals.capped_targeted}
          credits={`${n(totals.targeted)} of ${n(totals.available)} credits`}
        />
        <Headline
          label="Achieved"
          score={totals.score_achieved}
          onScore={totals.rating_achieved_on_score}
          after={totals.rating_achieved}
          capped={totals.capped_achieved}
          credits={`${n(totals.achieved)} of ${n(totals.available)} credits verified` +
            (totals.at_risk > 0 ? `, ${n(totals.at_risk)} held at risk` : '')}
        />
      </div>

      {(weightWarn || !totals.building_type) && (
        <Panel kind="comply" className="mb-4">
          <p className="text-sm">
            {!totals.building_type
              ? 'No building type is set, so nothing is weighted and the scheme scores zero. Choose one on Scheme setup.'
              : `The weightings for ${totals.building_type} sum to ${pct(totals.weighting_total)}, not 100%. The score is computed against what was loaded.`}
          </p>
        </Panel>
      )}

      {/* ------------------------------------------------------ sections */}
      <Panel title={`Sections — ${totals.building_type ?? 'unweighted'}`}>
        <TableScroll>
          <Table>
            <THead>
              <TR>
                <TH className="w-[64px]">Code</TH>
                <TH>Section</TH>
                <TH className="w-[72px]">Weight</TH>
                <TH className="w-[80px]">Available</TH>
                <TH className="w-[80px]">Stated</TH>
                <TH className="w-[80px]">Targeted</TH>
                <TH className="w-[80px]">Achieved</TH>
                <TH className="w-[72px]">At risk</TH>
                <TH className="w-[88px]">Score T</TH>
                <TH className="w-[88px]">Score A</TH>
              </TR>
            </THead>
            <TBody>
              {sections.map((s) => (
                <TR key={s.code}>
                  <TD><Code className="text-xs">{s.code}</Code></TD>
                  <TD>{s.name ?? <span className="text-graphite">—</span>}</TD>
                  <TD><Code className="text-xs">{pct(s.weighting)}</Code></TD>
                  <TD><Code className="text-xs">{n(s.available)}</Code></TD>
                  <TD>
                    {s.stated === null
                      ? <span className="text-graphite text-xs">—</span>
                      : s.stated_gap
                        ? <Pill tone="warn" title={`The rows sum to ${n(s.available)}; the tracker states ${n(s.stated)}`}>
                            {n(s.stated)} ≠
                          </Pill>
                        : <Code className="text-xs">{n(s.stated)}</Code>}
                  </TD>
                  <TD><Code className="text-xs">{n(s.targeted)}</Code></TD>
                  <TD><Code className="text-xs">{n(s.achieved)}</Code></TD>
                  <TD>
                    {s.at_risk > 0
                      ? <Pill tone="stop">{n(s.at_risk)}</Pill>
                      : <Code className="text-graphite text-xs">0</Code>}
                  </TD>
                  <TD><Code className="text-xs">{pct(s.score_targeted)}</Code></TD>
                  <TD><Code className="text-xs">{pct(s.score_achieved)}</Code></TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableScroll>
        {disagreeing.length > 0 && (
          <p className="text-warn mt-3 max-w-prose text-xs">
            {disagreeing.length === 1 ? 'One section' : `${disagreeing.length} sections`} state a
            credit total that disagrees with the rows loaded. The score is computed from the rows;
            the stated figure is a cross-check and is only reported.
          </p>
        )}
      </Panel>

      {/* ------------------------------------------------ blocked issues */}
      {blocked.length > 0 && (
        <Panel title="Held at risk by an outstanding prerequisite" kind="comply">
          <TableScroll>
            <Table>
              <THead>
                <TR>
                  <TH className="w-[80px]">Issue</TH>
                  <TH>Title</TH>
                  <TH>Blocked by</TH>
                  <TH className="w-[110px]">Credits held</TH>
                </TR>
              </THead>
              <TBody>
                {blocked.map((i) => (
                  <TR key={i.id}>
                    <TD><Code className="text-xs">{i.code}</Code></TD>
                    <TD>{i.title}</TD>
                    <TD>{i.blocked_by.join('; ')}</TD>
                    <TD><Pill tone="stop">{n(i.at_risk)} of {n(i.raw_achieved)}</Pill></TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableScroll>
        </Panel>
      )}

      {/* --------------------------------------------- minimum standards */}
      <Panel title="Minimum standards">
        {ratings.length === 0 ? (
          <p className="text-graphite text-sm">
            No rating thresholds loaded. They come with the sections template.
          </p>
        ) : (
          <TableScroll>
            <Table>
              <THead>
                <TR>
                  <TH className="w-[110px]">Rating</TH>
                  <TH className="w-[72px]">Needs</TH>
                  <TH>Against the target</TH>
                  <TH>Against what is verified</TH>
                </TR>
              </THead>
              <TBody>
                {ratings.map((r) => {
                  const f = fails[r.name]
                  return (
                    <TR key={r.name}>
                      <TD>
                        <div className="font-semibold">{r.name}</div>
                        {f?.advisory.length ? (
                          <div className="text-graphite mt-0.5 text-[11px]">
                            {f.advisory.length} advisory criteri{f.advisory.length === 1 ? 'on' : 'a'}
                          </div>
                        ) : null}
                      </TD>
                      <TD><Code className="text-xs">{pct(r.min)}</Code></TD>
                      <FailCell fails={f?.targeted ?? []} clears={totals.score_targeted >= r.min} />
                      <FailCell fails={f?.achieved ?? []} clears={totals.score_achieved >= r.min} />
                    </TR>
                  )
                })}
              </TBody>
            </Table>
          </TableScroll>
        )}
        <p className="text-graphite mt-3 max-w-prose text-xs">
          A minimum standard names how many credits an issue must hold for a rating. Where the
          score clears a rating but an issue falls short, the rating is capped and the issue is
          named. A zero-credit standard is a criterion the data cannot decide; it is listed as
          advisory and caps only when a prerequisite under that issue is outstanding.
        </p>
      </Panel>
    </>
  )
}

function Headline({
  label, score, onScore, after, capped, credits,
}: {
  label: string; score: number; onScore: string | null; after: string | null
  capped: boolean; credits: string
}) {
  return (
    <Panel title={label} kind={capped ? 'comply' : 'plain'} className="mb-0">
      <div className="flex items-baseline gap-3">
        <span className="font-mono text-3xl font-bold tracking-tight">{pct(score)}</span>
        <span className="text-graphite text-xs">{credits}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-graphite text-xs">On score</span>
        <Pill tone={onScore ? 'neutral' : 'warn'}>{onScore ?? 'Unclassified'}</Pill>
        <span className="text-graphite text-xs">After minimum standards</span>
        <Pill tone={after ? (capped ? 'warn' : 'ok') : 'stop'}>{after ?? 'Unclassified'}</Pill>
      </div>
      {capped && (
        <p className="text-warn mt-2 text-xs">
          Capped: the score clears {onScore}, but a minimum standard is not met. See below.
        </p>
      )}
    </Panel>
  )
}

function FailCell({ fails, clears }: { fails: MinStandardFail[]; clears: boolean }) {
  if (!clears) {
    return <TD className="text-graphite text-xs">Score does not reach it</TD>
  }
  if (fails.length === 0) return <TD><Pill tone="ok">Met</Pill></TD>
  return (
    <TD>
      {fails.map((f) => (
        <div key={f.issue_id} className="text-xs">
          <Code className="text-xs">{f.code}</Code>{' '}
          {f.needed > 0
            ? <>needs {n(f.needed)}, has {n(f.have)}</>
            : <>blocked by a prerequisite</>}
          {f.note && <span className="text-graphite"> — {f.note}</span>}
        </div>
      ))}
    </TD>
  )
}
