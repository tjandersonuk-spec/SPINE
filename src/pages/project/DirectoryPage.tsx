import { useOutletContext, useParams } from 'react-router'

import { Directory } from '@/components/Directory'
import { PageHead } from '@/components/ui/panel'
import type { ProjectContext } from '@/pages/project/ProjectLayout'

export default function DirectoryPage() {
  const { id = '' } = useParams()
  const ctx = useOutletContext<ProjectContext>()
  if (!ctx.project) return null
  return (
    <>
      <PageHead
        eyebrow="Set up"
        title="Directory"
        meta="Who is appointed on this job, and which disciplines they hold."
      />
      <Directory
        projectId={id}
        organisationId={ctx.project.organisation_id}
        canEdit={ctx.canEdit}
      />
    </>
  )
}
