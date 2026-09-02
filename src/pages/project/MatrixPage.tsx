import { useOutletContext, useParams } from 'react-router'

import { Matrix } from '@/components/Matrix'
import { PageHead } from '@/components/ui/panel'
import type { ProjectContext } from '@/pages/project/ProjectLayout'

export default function MatrixPage() {
  const { id = '' } = useParams()
  const ctx = useOutletContext<ProjectContext>()
  return (
    <>
      <PageHead
        eyebrow="Set up"
        title="Responsibility matrix"
        meta="Each item names a discipline. Who that is resolves live through the directory."
      />
      <Matrix projectId={id} canEdit={ctx.canEdit} />
    </>
  )
}
