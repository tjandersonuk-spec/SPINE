import Papa from 'papaparse'

import type { BreeamImportKind } from '@/lib/queries'

/** The published templates. The header is the contract; the key is what the
 *  server reads. */
export const TEMPLATES: Record<BreeamImportKind, {
  title: string
  file: string
  fields: { key: string; header: string }[]
  example: string[][]
}> = {
  sections: {
    title: 'Sections and weightings',
    file: 'breeam-sections-template.csv',
    fields: [
      { key: 'section_code', header: 'Section Code' },
      { key: 'section_name', header: 'Section Name' },
      { key: 'building_type', header: 'Building Type' },
      { key: 'weighting_percent', header: 'Weighting Percent' },
      { key: 'stated_credits_available', header: 'Stated Credits Available' },
    ],
    example: [['EXAMPLE', 'Example section — delete this row', 'Fully fitted out', '11', '21']],
  },
  credits: {
    title: 'Issues and credits',
    file: 'breeam-credits-template.csv',
    fields: [
      { key: 'section_code', header: 'Section Code' },
      { key: 'issue_code', header: 'Issue Code' },
      { key: 'issue_title', header: 'Issue Title' },
      { key: 'requirement', header: 'Requirement' },
      { key: 'advisory_note', header: 'Advisory Note' },
      { key: 'type', header: 'Type' },
      { key: 'credits_available', header: 'Credits Available' },
      { key: 'programme_task_id', header: 'Programme Task ID' },
      { key: 'offset_days', header: 'Offset Days' },
    ],
    example: [
      ['EXAMPLE', 'XX 01', 'Example issue — delete this row', 'Example requirement',
       "Your assessor's own summary of what is needed", 'Credit', '2', '1110', '0'],
      ['EXAMPLE', 'XX 01', 'Example issue — delete this row', 'Example prerequisite',
       'Pass or fail; blocks the issue if unmet', 'Prerequisite', '0', '', '0'],
    ],
  },
  minstd: {
    title: 'Minimum standards',
    file: 'breeam-minimum-standards-template.csv',
    fields: [
      { key: 'issue_code', header: 'Issue Code' },
      { key: 'rating', header: 'Rating' },
      { key: 'credits_required', header: 'Credits Required' },
      { key: 'note', header: 'Note' },
    ],
    example: [['XX 01', 'Excellent', '4', 'Your note or criterion reference']],
  },
}

export function download(filename: string, body: string) {
  const url = URL.createObjectURL(new Blob([body], { type: 'text/csv' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/** The blank template, with one example row to delete. */
export function downloadTemplate(kind: BreeamImportKind) {
  const t = TEMPLATES[kind]
  download(t.file, Papa.unparse([t.fields.map((f) => f.header), ...t.example]))
}

