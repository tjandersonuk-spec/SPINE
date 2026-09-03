/**
 * The lifecycle navigation, taken from the prototype.
 *
 * It is deliberately the whole map rather than only what is built. A design
 * manager reading this sidebar should see the shape of the job — pre-
 * construction through handover — not just the two pages that happen to exist
 * today. Items whose phase has not been built yet are shown dimmed and inert,
 * which is also how a module that a tenant has not paid for will read once
 * entitlements arrive in phase 7.
 *
 * `to` is a path under /project/:id. A null `to` means not built yet.
 */
export type NavItem = { key: string; label: string; to: string | null }
export type NavGroup = { title: string; pinned?: boolean; items: NavItem[] }

export const PROJECT_NAV: NavGroup[] = [
  {
    title: 'My work',
    pinned: true,
    items: [
      { key: 'dashboard', label: 'Home', to: null },
      { key: 'issues', label: 'Tasks and RFIs', to: null },
      { key: 'meetings', label: 'Meetings', to: null },
      { key: 'summary', label: 'Monday summary', to: null },
    ],
  },
  {
    title: 'Pre-construction',
    items: [
      { key: 'preassessment', label: 'Pre-assessment', to: null },
      { key: 'precon', label: 'Fee budget', to: null },
      { key: 'client', label: 'Client requirements', to: null },
    ],
  },
  {
    title: 'Set up',
    items: [
      { key: 'directory', label: 'Directory', to: 'directory' },
      { key: 'drm', label: 'Responsibility matrix', to: 'matrix' },
      { key: 'scope', label: 'Scope of service', to: null },
      { key: 'bep', label: 'BEP', to: 'bep' },
      { key: 'programme', label: 'Programme', to: 'programme' },
    ],
  },
  {
    title: 'Design',
    items: [
      { key: 'docs', label: 'Drawing register', to: 'register' },
      { key: 'tx', label: 'Packs and transmittals', to: 'transmittals' },
      { key: 'materials', label: 'Material samples', to: null },
      { key: 'crs', label: 'Change requests', to: null },
    ],
  },
  {
    title: 'Compliance',
    items: [
      { key: 'planning', label: 'Planning conditions', to: null },
      { key: 'bc', label: 'Building control', to: null },
      { key: 'bsa', label: 'Building safety', to: null },
      { key: 'breeam', label: 'BREEAM', to: null },
      { key: 'highways', label: 'Highways', to: null },
      { key: 'utilities', label: 'Utilities', to: null },
    ],
  },
  {
    title: 'Commercial',
    items: [
      { key: 'fees', label: 'Fees and cashflow', to: null },
      { key: 'risk', label: 'Risk and opportunity', to: null },
    ],
  },
  {
    title: 'Handover',
    items: [
      { key: 'handover', label: 'Handover checklist', to: null },
      { key: 'gateways', label: 'Gateways', to: null },
      { key: 'warranties', label: 'Warranties', to: null },
    ],
  },
  {
    // Admin last, always.
    title: 'Admin',
    items: [
      { key: 'access', label: 'Project access', to: 'access' },
      { key: 'settings', label: 'Project settings', to: 'settings' },
      { key: 'changes', label: 'Change log', to: null },
      { key: 'exports', label: 'Exports', to: null },
    ],
  },
]
