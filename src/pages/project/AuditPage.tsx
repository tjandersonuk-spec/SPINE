import { useCallback, useEffect, useState } from 'react'
import { Link, useOutletContext, useParams } from 'react-router'

import { RequireModule } from '@/components/shell/RequireModule'
import { Eyebrow, Panel, PageHead } from '@/components/ui/panel'
import { Code, Pill, Table, TableScroll, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { ErrorNote } from '@/components/ui/notes'
import { fmtDate } from '@/lib/format'
import {
  fetchAppointmentStatus, fetchChangeImplementationGap, fetchDisciplineGaps, fetchDrmGaps,
  fetchFeePosition, fetchGoldenThreadMoved, fetchGoldenThreadNeverIssued, fetchInstalments,
  fetchOverdueTracked, fetchProjectCompanies, fetchRegister, fetchRiskTotals, fetchWarranties,
} from '@/lib/queries'
import type { ProjectContext } from '@/pages/project/ProjectLayout'

/**
 * The audit: every silent check on one page.
 *
 * Nothing here is new. Each row is a derivation some other page already makes,
 * and the audit's whole job is that nobody has to open eleven pages to find out
 * whether any of them has something wrong on it. The checks that matter most
 * are the ones that announce themselves nowhere else — an instalment past its
 * date with nothing claimed against it, a warranty whose lead discipline has no
 * firm behind it, a change approved months ago with its implementation list
 * still open. None of those produces an error; they just sit there.
 *
 * A check with nothing in it is shown as clear rather than hidden. "No findings"
 * and "not checked" are different claims, and a page that silently drops the
 * clean rows makes them look the same.
 */
type Check = {
  key: string
  group: string
  title: string
  /** What a non-zero count means, in one sentence. */
  meaning: string
  count: number
  tone: 'stop' | 'warn' | 'gap'
  to?: string
  /** A few examples, so the number is actionable without opening the page. */
  examples?: string[]
}

export default function AuditPage() {
  const { id = '' } = useParams()
  const ctx = useOutletContext<ProjectContext>()
  const [checks, setChecks] = useState<Check[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    const p = (to: string) => `/project/${id}/${to}`

    Promise.all([
      fetchDrmGaps(id), fetchDisciplineGaps(id), fetchRegister(id), fetchOverdueTracked(id),
      fetchGoldenThreadMoved(id), fetchGoldenThreadNeverIssued(id),
      fetchChangeImplementationGap(id), fetchRiskTotals(id, 'risk'), fetchWarranties(id),
      fetchInstalments(id), fetchFeePosition(id), fetchProjectCompanies(id),
    ])
      .then(async ([gaps, discGaps, register, overdue, moved, never, changeGap, risk,
                    warranties, instalments, fees, companies]) => {
        // The appointment check is per company, and it is the one derivation
        // that has no project-wide form. Asking each company rather than
        // rebuilding the rule here is the difference between one answer and two.
        const appointments = await Promise.all(
          companies.map(async (c) => ({
            name: c.name,
            slots: await fetchAppointmentStatus(c.id).catch(() => []),
          })))
        const incomplete = appointments.filter(
          (a) => a.slots.length > 0 && a.slots.some((s) => s.state !== 'approved'))

        const badNames = register.filter((d) => d.naming_error)
        const overdueDrawings = register.filter((d) => d.overdue)
        const unallocatedWarranties = warranties.filter((w) => w.required && w.unallocated)
        const unclaimed = instalments.filter((i) => i.due_uninvoiced)
        const scheduleGap = fees.filter((f) => Number(f.schedule_gap) !== 0)

        setChecks([
          {
            key: 'drm', group: 'Responsibility', title: 'Duties with no lead discipline',
            meaning: 'Work nobody has been given. It falls to the contractor by default.',
            count: gaps.length, tone: 'gap', to: p('matrix'),
            examples: gaps.slice(0, 3).map((g) => `${g.ref} ${g.item}`),
          },
          {
            key: 'disc', group: 'Responsibility', title: 'Disciplines with no firm',
            meaning: 'A discipline the project needs that nobody in the directory holds.',
            count: discGaps.length, tone: 'gap', to: p('directory'),
            examples: discGaps.slice(0, 4).map((d) => `${d.code} ${d.name}`),
          },
          {
            key: 'appt', group: 'Responsibility', title: 'Appointments not complete',
            meaning: 'A firm working without every appointment document approved.',
            count: incomplete.length, tone: 'warn', to: p('directory'),
            examples: incomplete.slice(0, 3).map((a) => a.name),
          },
          {
            key: 'wty', group: 'Responsibility', title: 'Warranties with no owner',
            meaning: 'The lead discipline on the duty behind the warranty has no firm, '
                   + 'so nobody is being chased for it.',
            count: unallocatedWarranties.length, tone: 'gap', to: p('warranties'),
            examples: unallocatedWarranties.slice(0, 3).map((w) => `${w.reference} ${w.title}`),
          },
          {
            key: 'names', group: 'Information', title: 'Numbers that break the convention',
            meaning: 'A document number that does not follow the BEP. It will not sort, '
                   + 'and it will not be found by whoever looks for it later.',
            count: badNames.length, tone: 'warn', to: p('register'),
            examples: badNames.slice(0, 3).map((d) => d.document_number),
          },
          {
            key: 'late', group: 'Information', title: 'Drawings past their date, never issued',
            meaning: 'On the register, due, and nothing has arrived.',
            count: overdueDrawings.length, tone: 'stop', to: p('register'),
            examples: overdueDrawings.slice(0, 3).map(
              (d) => `${d.document_number} — due ${fmtDate(d.due)}`),
          },
          {
            key: 'tracked', group: 'Information', title: 'Checklist items past their date',
            meaning: 'A condition, a compliance item or a scope duty that is late.',
            count: overdue.length, tone: 'warn',
            examples: overdue.slice(0, 3).map((t) => `${t.reference} ${t.title}`),
          },
          {
            key: 'gtm', group: 'Golden thread', title: 'Issued again after gateway 2',
            meaning: 'The drawing that was current at gateway 2 is not the current one. '
                   + 'Every one of these has to be accounted for.',
            count: moved.length, tone: 'warn', to: p('bsa'),
            examples: moved.slice(0, 3).map(
              (d) => `${d.document_number} ${d.g2_revision} → ${d.revision_now}`),
          },
          {
            key: 'gtn', group: 'Golden thread', title: 'On the thread, never issued',
            meaning: 'A different and worse finding: not that it moved, but that it has '
                   + 'never gone out at all.',
            count: never.length, tone: 'stop', to: p('bsa'),
            examples: never.slice(0, 3).map((d) => d.document_number),
          },
          {
            key: 'chg', group: 'Change', title: 'Approved, with work outstanding',
            meaning: 'Approval is not implementation. These were agreed and the list of '
                   + 'what had to follow is still open.',
            count: changeGap.length, tone: 'warn', to: p('changes-requests'),
            examples: changeGap.slice(0, 3).map((c) => `${c.reference} ${c.title}`),
          },
          {
            key: 'riskown', group: 'Commercial', title: 'Live risks with no owner',
            meaning: 'A risk owned by nobody is a risk nobody is chasing.',
            count: Number(risk?.unowned ?? 0), tone: 'gap', to: p('risk'),
          },
          {
            key: 'unclaimed', group: 'Commercial', title: 'Instalments due, nothing claimed',
            meaning: 'Past its date with no invoice against it. Nothing announces this.',
            count: unclaimed.length, tone: 'warn', to: p('fees'),
            examples: unclaimed.slice(0, 3).map(
              (i) => `${i.reference} — due ${fmtDate(i.due)}`),
          },
          {
            key: 'schedgap', group: 'Commercial', title: 'Schedule does not total the fee',
            meaning: 'The instalments for a firm add up to something other than its '
                   + 'approved fee.',
            count: scheduleGap.length, tone: 'warn', to: p('fees'),
            examples: scheduleGap.slice(0, 3).map((f) => f.company_name),
          },
        ])
        setError(null)
      })
      .catch((e: Error) => setError(e.message))
  }, [id])

  useEffect(load, [load])

  if (error) return <ErrorNote message={error} />
  if (!checks) return <div className="text-graphite p-6 text-sm">Loading…</div>

  const findings = checks.filter((c) => c.count > 0)
  const clear = checks.filter((c) => c.count === 0)
  const groups = [...new Set(findings.map((c) => c.group))]

  return (
    <RequireModule module="audit">
      <PageHead
        eyebrow="Reporting"
        title="Audit"
        meta={
          findings.length === 0
            ? 'Every check is clear.'
            : `${findings.length} of ${checks.length} checks have something in them.`
        }
      />

      {groups.map((g) => (
        <Panel key={g} title={g}>
          <TableScroll>
            <Table>
              <THead>
                <TR>
                  <TH className="w-[70px]">Count</TH>
                  <TH>Check</TH>
                  <TH>Examples</TH>
                </TR>
              </THead>
              <TBody>
                {findings.filter((c) => c.group === g).map((c) => (
                  <TR key={c.key} gap={c.tone === 'gap'}>
                    <TD>
                      <Pill tone={c.tone}>{c.count}</Pill>
                    </TD>
                    <TD>
                      {c.to ? (
                        <Link to={c.to} className="font-medium underline-offset-2 hover:underline">
                          {c.title}
                        </Link>
                      ) : (
                        <span className="font-medium">{c.title}</span>
                      )}
                      <p className="text-graphite mt-0.5 max-w-prose text-xs">{c.meaning}</p>
                    </TD>
                    <TD>
                      {c.examples && c.examples.length > 0 ? (
                        <ul className="text-graphite text-xs">
                          {c.examples.map((e, i) => (
                            <li key={i} className="py-px">
                              <Code>{e}</Code>
                            </li>
                          ))}
                          {c.count > c.examples.length && (
                            <li className="py-px opacity-70">
                              and {c.count - c.examples.length} more
                            </li>
                          )}
                        </ul>
                      ) : (
                        <span className="text-graphite-light text-xs">—</span>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableScroll>
        </Panel>
      ))}

      {clear.length > 0 && (
        <Panel title="Clear">
          <Eyebrow className="mb-2">Checked, nothing found</Eyebrow>
          <div className="flex flex-wrap gap-1.5">
            {clear.map((c) => (
              <Pill key={c.key} tone="ok">
                {c.title}
              </Pill>
            ))}
          </div>
          <p className="text-graphite mt-3 max-w-prose text-xs">
            Shown rather than hidden: “nothing found” and “not checked” are different
            claims, and a page that drops the clean rows makes them look the same.
          </p>
        </Panel>
      )}

      {!ctx.canEdit && (
        <p className="text-graphite-light max-w-prose text-xs">
          These are the same figures the pages behind them show, filtered to what you can
          see. A section you have no access to contributes nothing rather than showing zero.
        </p>
      )}
    </RequireModule>
  )
}
