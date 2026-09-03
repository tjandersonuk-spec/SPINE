/**
 * What the site says the product contains.
 *
 * Stated once, because a marketing page is the easiest place in a codebase for
 * a claim to go stale: nothing breaks when the pricing table promises a module
 * that was renamed or never built, and nobody finds out until a customer asks
 * for it. Every key below is a real `module_catalogue()` key, and
 * `src/marketing.test.ts` fails the build if one stops being.
 *
 * The tiers are the brief's three. They are a way of describing the product to
 * somebody who has not seen it -- the thing actually sold is a module, and the
 * platform owner sells them one at a time, so a tier here is a shape rather
 * than a package the database knows about.
 */
export type Tier = {
  key: string
  eyebrow: string
  name: string
  line: string
  /** Module keys, or `core` for what cannot be switched off. */
  items: { key: string | 'core'; label: string; note: string }[]
}

export const TIERS: Tier[] = [
  {
    key: 'core',
    eyebrow: 'Core · always on',
    name: 'Design control',
    line: 'Nothing works without the directory and the programme, so the core is not '
        + 'something you can be sold or lose.',
    items: [
      { key: 'core', label: 'Projects and the directory',
        note: 'Firms, the people at them, and the disciplines each firm holds.' },
      { key: 'drm', label: 'Responsibility matrix',
        note: 'Every duty, its lead discipline, and the ones nobody has been given.' },
      { key: 'programme', label: 'Programme and Gantt',
        note: 'The date spine. Re-import a revision and the whole project reschedules.' },
      { key: 'docs', label: 'Drawing register',
        note: 'What is due, what has arrived, what is late, and what has never gone out.' },
      { key: 'tx', label: 'Packs and transmittals',
        note: 'Frozen at the revision that was issued. A correction is a new transmittal.' },
      { key: 'core', label: 'Tasks, RFIs and meetings',
        note: 'With the comments and evidence that answer them.' },
      { key: 'core', label: 'Change log',
        note: 'Written by the database, editable by nobody, readable by every member.' },
      { key: 'reports', label: 'Period reports',
        note: 'A query, never a document — so there is never a stale copy to reconcile.' },
    ],
  },
  {
    key: 'compliance',
    eyebrow: 'Module',
    name: 'Compliance',
    line: 'The statutory load a contractor carries when it takes on design, in one '
        + 'engine rather than six spreadsheets.',
    items: [
      { key: 'planning', label: 'Planning conditions',
        note: 'Every condition, its trigger point, and who discharges it.' },
      { key: 'bc', label: 'Building control',
        note: 'The parts, the evidence, and what is outstanding.' },
      { key: 'bsa', label: 'Building safety',
        note: 'Higher-risk buildings: the gateways, the golden thread, change control.' },
      { key: 'gateways', label: 'Gateways',
        note: 'What is standing in the way of each one, named rather than counted.' },
      { key: 'breeam', label: 'BREEAM and sustainability',
        note: 'Scored from the credits, never from a stated total.' },
      { key: 'scope', label: 'Scope of service',
        note: 'What each appointment actually covers, and where the gaps between them are.' },
      { key: 'highways', label: 'Highways and utilities',
        note: 'Section agreements, audits, connections and their lead times.' },
      { key: 'handover', label: 'Handover checklist',
        note: 'What has to exist before anybody occupies the building.' },
    ],
  },
  {
    key: 'commercial',
    eyebrow: 'Module',
    name: 'Commercial',
    line: 'What the design is costing, what it might cost, and what has been claimed '
        + 'against it.',
    items: [
      { key: 'fees', label: 'Fees and cashflow',
        note: 'Instalments anchored to the programme, so a design delay shows as a '
            + 'cashflow consequence.' },
      { key: 'fees', label: 'Invoices',
        note: 'Certified, paid, disputed — and the instalment nobody has claimed against.' },
      { key: 'budget', label: 'Pre-construction budget',
        note: 'Quotes against budget lines, with the preferred one recorded.' },
      { key: 'risk', label: 'Risk and opportunity',
        note: 'Exposure derived from cost and likelihood, never a figure somebody typed.' },
      { key: 'crs', label: 'Change requests',
        note: 'Twelve states answering one question: may this work proceed?' },
      { key: 'warranties', label: 'Warranties',
        note: 'Owner resolved live through the matrix, so the gap is the same gap.' },
      { key: 'materials', label: 'Material samples',
        note: 'A decided round is frozen. A correction is a new round.' },
    ],
  },
]

/** The pricing table's shape. Figures are deliberately absent: they are a
 *  commercial decision, and a placeholder number on a public page is a number
 *  somebody will quote back at you. */
export const PRICING = [
  {
    name: 'Core',
    line: 'Design control. Everything the job cannot run without.',
    per: 'per account, per month',
    includes: ['Unlimited projects', 'Unlimited consultants and client users',
               'The whole core, always on', 'Period reports and exports'],
    cta: 'Start a trial',
  },
  {
    name: 'Core + Compliance',
    line: 'For a contractor carrying the statutory load: higher-risk buildings, '
        + 'planning conditions, BREEAM.',
    per: 'per account, per month',
    includes: ['Everything in Core', 'The compliance modules',
               'Gateways and the golden thread', 'The checklist engine and its templates'],
    cta: 'Start a trial',
    featured: true,
  },
  {
    name: 'Everything',
    line: 'The commercial tier as well: fees, cashflow, risk, change control.',
    per: 'per account, per month',
    includes: ['Everything in Core and Compliance', 'The commercial modules',
               'Portfolio dashboards across every job', 'Priority support'],
    cta: 'Talk to us',
  },
]
