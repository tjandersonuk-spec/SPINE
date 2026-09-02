import { useCallback, useEffect, useState } from 'react'

import { ErrorNote } from '@/components/Shell'
import { Button } from '@/components/ui/button'
import { Code, Table, TableScroll, TBody, TD, TH, THead, TR } from '@/components/ui/table'
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

      <TableScroll>
        <Table>
          <THead>
            <tr>
              <TH className="w-20">Code</TH>
              <TH>Discipline</TH>
              <TH className="w-16" title="ISO 19650 role letter, used by the drawing naming convention">
                ISO
              </TH>
            </tr>
          </THead>
          <TBody>
            {rows.map((d) => (
              <TR key={d.code}>
                <TD><Code className="font-semibold">{d.code}</Code></TD>
                <TD>{d.name}</TD>
                <TD className="text-graphite-light"><Code>{d.iso_letter}</Code></TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </TableScroll>
    </div>
  )
}
