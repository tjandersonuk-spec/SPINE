import { useState } from 'react'
import { useOutletContext, useParams } from 'react-router'

import { Button } from '@/components/ui/button'
import { ErrorNote } from '@/components/ui/notes'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ModuleSettings } from '@/components/shell/ModuleSettings'
import { Panel, PageHead } from '@/components/ui/panel'
import { seedSampleProject, updateProject } from '@/lib/queries'
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

      {ctx.isAccountAdmin && ctx.shell && (
        <ModuleSettings projectId={id} shell={ctx.shell} onChanged={ctx.reload} />
      )}

      {ctx.isAccountAdmin && <SampleData projectId={id} />}
    </>
  )
}

/**
 * Sample data, where somebody can find it.
 *
 * It used to live only on an empty directory page, which meant it vanished the
 * moment it had done half its job -- a project seeded before the rest of the
 * sample data existed had a directory and no way to ask for the other eleven
 * modules. It is idempotent end to end now, so it fills what is missing and
 * leaves everything else alone, and it belongs somewhere you can go back to.
 */
function SampleData({ projectId }: { projectId: string }) {
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  return (
    <Panel title="Sample data">
      <p className="text-graphite mb-3 max-w-prose text-sm">
        Fills this project with one worked example across every module — sixteen firms and
        their people, a programme, the responsibility matrix, a drawing register, the
        checklists, the fees and invoices, the risk register, material samples and the change
        requests. Everything is anchored to the programme, so re-importing a revision moves it
        all, and the deliberate gaps are there on purpose: unallocated duties, overdue
        drawings, a rejected sample, a change the regulator objected to.
      </p>
      <p className="text-graphite mb-3 max-w-prose text-xs">
        Safe to run more than once: it adds what is missing and leaves everything already
        there exactly as it is. For trying the application out — not for a live job.
      </p>

      {said && <p className="text-ok-ink mb-3 max-w-prose text-sm">{said}</p>}
      <ErrorNote message={error} />

      <Button
        variant="outline"
        disabled={busy}
        onClick={() => {
          setBusy(true); setError(null); setSaid(null)
          seedSampleProject(projectId)
            .then(setSaid)
            .catch((e: Error) => setError(e.message))
            .finally(() => setBusy(false))
        }}
      >
        {busy ? 'Filling…' : 'Fill with sample data'}
      </Button>
    </Panel>
  )
}
