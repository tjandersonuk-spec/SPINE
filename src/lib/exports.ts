import Papa from 'papaparse'

import {
  fetchChangeLog, fetchIssues, fetchMeetings, fetchPacks, fetchProgramme, fetchProjectCompanies,
  fetchProjectPeople, fetchRegister, fetchTransmittals, fetchDrmItems, fetchDrmLeads,
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
