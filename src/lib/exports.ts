import Papa from 'papaparse'

import {
  fetchActiveBreeamScheme, fetchBreeamCredits, fetchChangeLog, fetchChangeRequests,
  fetchFeePosition, fetchFees, fetchInstalments, fetchInvoices, fetchIssues, fetchMaterials,
  fetchMeetings, fetchPacks, fetchProgramme, fetchProjectCompanies, fetchProjectPeople,
  fetchPreconBudget, fetchRegister, fetchRisks, fetchTransmittals, fetchWarranties,
  canSeePrecon, fetchDrmItems, fetchDrmLeads,
} from '@/lib/queries'

/**
 * Exports.
 *
 * Everything here goes through the same query layer the pages use, which means
 * it goes through RLS. There is no privileged path and no service key: an
 * export contains exactly the rows the person exporting could already see on
 * screen, because the alternative — a wide query filtered afterwards in the
 * browser — is the easiest way in the whole product to leak a restricted RFI.
 */

export type ModuleExport = {
  key: string
  label: string
  /** The entitlement this belongs to, or null if it is always available. */
  module: string | null
  fetch: (projectId: string) => Promise<Record<string, unknown>[]>
  /**
   * An explicit visibility question, for a module where RLS filters rows
   * rather than refusing the query. Without it a consultant's export of the
   * pre-construction budget would come back as `[]`, which reads as "there is
   * no budget" — a different and worse claim than "you cannot see it".
   */
  visible?: (projectId: string) => Promise<boolean>
}

export const EXPORTS: ModuleExport[] = [
  {
    key: 'companies', label: 'Directory — companies', module: 'directory',
    fetch: (p) => fetchProjectCompanies(p) as Promise<Record<string, unknown>[]>,
  },
  {
    key: 'people', label: 'Directory — people', module: 'directory',
    fetch: (p) => fetchProjectPeople(p) as unknown as Promise<Record<string, unknown>[]>,
  },
  {
    key: 'matrix', label: 'Responsibility matrix', module: 'drm',
    fetch: async (p) => {
      // The lead company is a live lookup, so the export resolves it at the
      // moment of export rather than carrying a stored id nobody can read.
      const [items, leads] = await Promise.all([fetchDrmItems(p), fetchDrmLeads(p)])
      const by = new Map(leads.map((l) => [l.drm_item_id, l]))
      return items.map((i) => ({
        ref: i.ref,
        category: i.category_code,
        item: i.item,
        lead_discipline: i.lead_discipline,
        held_by: by.get(i.id)?.company_name ?? '',
        applicable: i.applicable,
        transfers_at_stage: i.transfers_at_stage,
        cdp_package: i.cdp_package,
        level_of_information: i.level_of_information,
      }))
    },
  },
  {
    key: 'programme', label: 'Programme', module: 'programme',
    fetch: (p) => fetchProgramme(p) as unknown as Promise<Record<string, unknown>[]>,
  },
  {
    key: 'register', label: 'Drawing register', module: 'docs',
    fetch: (p) => fetchRegister(p) as unknown as Promise<Record<string, unknown>[]>,
  },
  {
    key: 'packs', label: 'Drawing packs', module: 'tx',
    fetch: (p) => fetchPacks(p) as unknown as Promise<Record<string, unknown>[]>,
  },
  {
    key: 'transmittals', label: 'Transmittals', module: 'tx',
    fetch: (p) => fetchTransmittals(p) as unknown as Promise<Record<string, unknown>[]>,
  },
  {
    key: 'breeam', label: 'BREEAM tracker', module: 'breeam',
    fetch: async (p) => {
      // The live scheme's credits, with the state the tracker shows. Same view
      // the page reads, so the export carries exactly what the exporter sees.
      const scheme = await fetchActiveBreeamScheme(p)
      if (!scheme) return []
      return (await fetchBreeamCredits(scheme)).map((c) => ({
        reference: c.reference, issue: c.issue_code, issue_title: c.issue_title ?? '',
        section: c.section ?? '', requirement: c.title,
        type: c.is_prerequisite ? 'Prerequisite' : 'Credit',
        available: c.available, targeted: c.targeted, achieved: c.achieved,
        status: c.status, state: c.state, due: c.due ?? '',
        programme_task_uid: c.programme_task_uid ?? '', offset_days: c.offset_days,
      }))
    },
  },
  {
    key: 'issues', label: 'Tasks and RFIs', module: null,
    fetch: (p) => fetchIssues(p) as unknown as Promise<Record<string, unknown>[]>,
  },
  {
    key: 'meetings', label: 'Meetings', module: null,
    fetch: (p) => fetchMeetings(p) as unknown as Promise<Record<string, unknown>[]>,
  },
  {
    key: 'changes', label: 'Change log', module: null,
    fetch: (p) => fetchChangeLog(p, 5000) as unknown as Promise<Record<string, unknown>[]>,
  },
  // The commercial tier. Every one of these goes through the same RLS the
  // pages do, which on these tables is the difference between an export and a
  // leak: a consultant's CSV carries their own company tree and no other.
  {
    key: 'fees', label: 'Fees and variations', module: 'fees',
    fetch: (p) => fetchFees(p) as unknown as Promise<Record<string, unknown>[]>,
  },
  {
    key: 'fee-position', label: 'Fee position by company', module: 'fees',
    fetch: (p) => fetchFeePosition(p) as unknown as Promise<Record<string, unknown>[]>,
  },
  {
    key: 'schedule', label: 'Payment schedule', module: 'fees',
    fetch: async (p) => (await fetchInstalments(p)).map((s) => ({
      reference: s.reference, company: s.company_name ?? '', description: s.description ?? '',
      value: s.value, due: s.due ?? '', status: s.status,
      agreed_at: s.agreed_at ?? '', invoiced: s.invoiced,
      due_uninvoiced: s.due_uninvoiced,
      programme_task_uid: s.programme_task_uid ?? '', offset_days: s.offset_days,
    })),
  },
  {
    key: 'invoices', label: 'Invoices', module: 'fees',
    fetch: async (p) => (await fetchInvoices(p)).map((v) => ({
      reference: v.reference, company: v.company_name ?? '',
      against: v.schedule_reference ?? '', value: v.value,
      date_submitted: v.date_submitted, date_paid: v.date_paid ?? '',
      status: v.status, document_held: v.has_document,
    })),
  },
  {
    key: 'risks', label: 'Risk register', module: 'risk',
    fetch: async (p) => [
      ...await fetchRisks(p, 'risk'), ...await fetchRisks(p, 'opportunity'),
    ].map((r) => ({
      reference: r.reference, kind: r.kind, title: r.title,
      category: r.category ?? '', owner: r.owner_name ?? '',
      likelihood: r.likelihood_name, likelihood_pct: r.likelihood_pct,
      impact_cost: r.impact_cost, band: r.band_name, score: r.score,
      // Expected value, never the raw total. An export that carried only the
      // gross figure would invite exactly the sum the register avoids.
      expected_value: r.expected_value,
      status: r.status, state: r.state, review_due: r.review_due ?? '',
      realised_as: r.issue_reference ?? '',
    })),
  },
  {
    key: 'change-requests', label: 'Change requests', module: 'crs',
    fetch: async (p) => (await fetchChangeRequests(p)).map((c) => ({
      reference: c.reference, title: c.title, status: c.status,
      decision_due: c.decision_due ?? '', effective: c.effective_date ?? '',
      impact_cost_expected: c.impact_cost ?? '',
      variation: c.variation_reference ?? '', variation_value: c.variation_value ?? '',
      amendments: c.amendments, outstanding: c.amendments_outstanding,
      approved_with_nothing_listed: c.approved_with_nothing_listed,
      bsa_state: c.bsa_controlled ? c.bsa_state : '',
    })),
  },
  {
    key: 'warranties', label: 'Warranties', module: 'warranties',
    fetch: async (p) => (await fetchWarranties(p)).map((x) => ({
      reference: x.reference, title: x.title, drm_ref: x.drm_ref ?? '',
      lead_discipline: x.lead_discipline ?? '',
      // Resolved live through the matrix at the moment of export, rather than
      // carrying a stored id nobody can read.
      owner: x.owners.join('; '), holders: x.holders,
      provided_by: x.provided_by ?? '', period_years: x.period_years ?? '',
      beneficiary: x.beneficiary ?? '', status: x.status,
      due: x.due ?? '', unallocated: x.unallocated,
    })),
  },
  {
    key: 'precon-budget', label: 'Pre-construction fee budget', module: 'precon',
    visible: canSeePrecon,
    fetch: async (p) => (await fetchPreconBudget(p)).map((l) => ({
      reference: l.reference, category: l.category, discipline: l.discipline ?? '',
      title: l.title, required: l.required, budget: l.budget,
      quotes: l.quotes, chosen: l.preferred_source ?? '',
      forecast: l.forecast, variance: l.variance,
      appointed_fees: l.appointed_fees, appointed_approved: l.appointed_approved,
    })),
  },
  {
    key: 'materials', label: 'Material samples', module: 'materials',
    fetch: async (p) => (await fetchMaterials(p)).map((m) => ({
      reference: m.reference, title: m.title, spec: m.spec ?? '',
      location: m.location ?? '', company: m.company_name ?? '',
      rounds: m.rounds, latest_round: m.latest_round ?? '',
      decision: m.decision ?? '', awaiting_decision: m.awaiting_decision,
      // A rejection stays on the record after a later approval, and it stays
      // in the export too.
      ever_rejected: m.was_rejected, rejections: m.rejections,
      due: m.due ?? '',
    })),
  },
]

/** Trigger a download in the browser. */
function download(filename: string, body: string, mime: string) {
  const url = URL.createObjectURL(new Blob([body], { type: mime }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

const stamp = () => new Date().toISOString().slice(0, 10)

export async function exportModuleCsv(
  projectId: string, projectCode: string, m: ModuleExport,
) {
  const rows = await m.fetch(projectId)
  download(`${projectCode}-${m.key}-${stamp()}.csv`,
    Papa.unparse(rows.length ? rows : [{}]), 'text/csv')
  return rows.length
}

/**
 * The whole project as one JSON file.
 *
 * Assembled from the same fetchers, one per module, so a module the exporter
 * cannot see contributes an empty array rather than being silently absent —
 * an export that quietly omits a section reads as "there is none of that",
 * which is a different and worse claim than "you cannot see it".
 */
export async function exportProjectJson(
  projectId: string, projectCode: string, moduleOn: (key: string) => boolean,
) {
  const out: Record<string, unknown> = {
    exported_at: new Date().toISOString(),
    project_code: projectCode,
    note:
      'Contains only what the person who exported it can see. Sections that are ' +
      'switched off for this project are marked, not omitted.',
  }
  for (const m of EXPORTS) {
    if (m.module && !moduleOn(m.module)) {
      out[m.key] = { withheld: 'this module is not switched on for this project' }
      continue
    }
    // Asked before the fetch, for the modules where RLS filters rows instead
    // of refusing: an empty array would assert there is nothing there.
    if (m.visible && !(await m.visible(projectId))) {
      out[m.key] = { withheld: 'not visible to you' }
      continue
    }
    try {
      out[m.key] = await m.fetch(projectId)
    } catch {
      out[m.key] = { withheld: 'not visible to you' }
    }
  }
  download(`${projectCode}-project-${stamp()}.json`,
    JSON.stringify(out, null, 2), 'application/json')
  return out
}
