import { useOutletContext, useParams } from 'react-router'

import { RequireModule } from '@/components/shell/RequireModule'
import { TrackedList } from '@/components/tracked/TrackedList'
import { PageHead } from '@/components/ui/panel'
import { TRACKED_LABELS } from '@/lib/queries'
import type { ProjectContext } from '@/pages/project/ProjectLayout'

/**
 * One page for every tracked-item kind.
 *
 * Planning conditions, building control, the scope of service and all five
 * checklists reach this through different routes and different nav entries,
 * because that is how people look for them — but they are one record, one
 * table and one screen underneath.
 */
const META: Record<string, { eyebrow: string; module: string; meta: string }> = {
  planning: {
    eyebrow: 'Compliance', module: 'planning',
    meta: 'Conditions to discharge. Each is dated off the programme, so they move when it does.',
  },
  bc: {
    eyebrow: 'Compliance', module: 'bc',
    meta: 'Items to submit and approve. Same engine as everything else that is tracked.',
  },
  scope: {
    eyebrow: 'Set up', module: 'scope',
    meta: 'What each appointment covers, applied per discipline rather than as one flat list.',
  },
  'checklist:precon': {
    eyebrow: 'Pre-construction', module: 'preassessment',
    meta: 'The answer matters more than the tick — this is the field a model would populate.',
  },
  'checklist:client': {
    eyebrow: 'Pre-construction', module: 'client',
    meta: 'What the client has asked for, and whether it has been confirmed.',
  },
  'checklist:handover': {
    eyebrow: 'Handover', module: 'handover',
    meta: 'What has to exist before the building changes hands.',
  },
  'checklist:highways': {
    eyebrow: 'Compliance', module: 'highways',
    meta: 'Highways approvals and agreements.',
  },
  'checklist:utilities': {
    eyebrow: 'Compliance', module: 'utilities',
    meta: 'Enquiry, quotation, acceptance — a sequence, because a lead time only becomes visible if the dates exist.',
  },
}

export default function TrackedPage({ kind }: { kind: string }) {
  const { id = '' } = useParams()
  const ctx = useOutletContext<ProjectContext>()
  const m = META[kind]
  const checklistType = kind.startsWith('checklist:') ? kind.split(':')[1] : undefined

  return (
    <RequireModule module={m.module}>
      <PageHead eyebrow={m.eyebrow} title={TRACKED_LABELS[kind] ?? kind} meta={m.meta} />
      <TrackedList
        projectId={id}
        kind={kind}
        canEdit={ctx.canEdit}
        checklistType={checklistType}
      />
    </RequireModule>
  )
}
