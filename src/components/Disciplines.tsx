import { useCallback, useEffect, useState } from 'react'

import { ErrorNote } from '@/components/Shell'
import { Button } from '@/components/ui/button'
import { fetchAccountDisciplines, forkDisciplines, type Discipline } from '@/lib/queries'

/**
 * The disciplines this account works to. Until it takes a copy it is reading the
 * published default; taking the copy is what makes the list editable, and from
 * then on a change to the published set never reaches it.
 */
export function Disciplines({
  organisationId,
  canEdit,
}: {
  organisationId: string
  canEdit: boolean
}) {
  const [rows, setRows] = useState<Discipline[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    fetchAccountDisciplines(organisationId)
      .then(setRows)
      .catch((e: Error) => setError(e.message))
  }, [organisationId])

  useEffect(load, [load])

  const forked = rows.some((r) => r.forked)

  return (
    <div className="flex flex-col gap-4">
      <ErrorNote message={error} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">
          {forked
            ? 'Your own list. Editing it affects new projects only — a project keeps the list it was set up with.'
            : 'The published default. Take a copy to make it yours.'}
        </p>
        {canEdit && !forked && (
          <Button
            disabled={busy}
            onClick={() => {
              setBusy(true)
              setError(null)
              forkDisciplines(organisationId)
                .then(load)
                .catch((e: Error) => setError(e.message))
                .finally(() => setBusy(false))
            }}
          >
            Take a copy
          </Button>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-muted-foreground text-left">
            <tr>
              <th className="px-4 py-2 font-medium">Code</th>
              <th className="px-4 py-2 font-medium">Discipline</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.code} className="border-t">
                <td className="px-4 py-2 font-mono">{d.code}</td>
                <td className="px-4 py-2">{d.name}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
