import { useState } from 'react'
import { useOutletContext, useParams } from 'react-router'

import { ErrorNote } from '@/components/Shell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Panel, PageHead } from '@/components/ui/panel'
import { updateProject } from '@/lib/queries'
import type { ProjectContext } from '@/pages/project/ProjectLayout'

export default function SettingsPage() {
  const { id = '' } = useParams()
  const ctx = useOutletContext<ProjectContext>()
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  if (!ctx.canEdit) {
    return (
      <>
        <PageHead eyebrow="Admin" title="Project settings" />
        <p className="text-graphite text-sm">
          Only an account admin or this project&apos;s admin can change these.
        </p>
      </>
    )
  }

  return (
    <>
      <PageHead eyebrow="Admin" title="Project settings" />
      <ErrorNote message={error} />
      {saved && <p className="text-ok mb-3 text-sm">Saved.</p>}
      <Panel title="Identity">
        {/* Uncontrolled, and keyed on the loaded project so it remounts with
            the real values once they arrive. Mirroring props into state and
            syncing them in an effect is the same thing done worse. */}
        <form
          key={ctx.project?.code ?? 'loading'}
          className="flex max-w-md flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            setError(null)
            setSaved(false)
            const form = new FormData(e.currentTarget)
            updateProject(id, {
              name: String(form.get('name') ?? ''),
              code: String(form.get('code') ?? ''),
            })
              .then(() => {
                setSaved(true)
                ctx.reload()
              })
              .catch((err: Error) => setError(err.message))
          }}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="proj-name">Project name</Label>
            <Input id="proj-name" name="name" required defaultValue={ctx.project?.name ?? ''} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="proj-code">Code</Label>
            <Input id="proj-code" name="code" required className="font-mono"
              defaultValue={ctx.project?.code ?? ''} />
          </div>
          <Button type="submit" className="self-start">Save</Button>
        </form>
      </Panel>
    </>
  )
}
