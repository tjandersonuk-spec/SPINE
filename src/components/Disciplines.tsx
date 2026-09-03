import { useCallback, useEffect, useState } from 'react'

import { ErrorNote } from '@/components/Shell'
import { Button } from '@/components/ui/button'
import { Code, Table, TableScroll, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import {
  addDiscipline, fetchAccountDisciplines, forkDisciplines, refreshDisciplineFork,
  removeDiscipline, updateDiscipline, type Discipline,
} from '@/lib/queries'

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
  const [note, setNote] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [letter, setLetter] = useState('')

  const load = useCallback(() => {
    fetchAccountDisciplines(organisationId)
      .then(setRows)
      .catch((e: Error) => setError(e.message))
  }, [organisationId])

  useEffect(load, [load])

  const forked = rows.some((r) => r.forked)
  const guard = (p: Promise<unknown>) =>
    p.then(load).catch((e: Error) => setError(e.message))

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
        {canEdit && forked && (
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => {
              setBusy(true); setError(null)
              refreshDisciplineFork(organisationId)
                .then((n) => {
                  setNote(n === 0
                    ? 'Nothing new — your list already holds every published discipline.'
                    : `Added ${n} discipline${n === 1 ? '' : 's'} the published set has gained.`)
                  load()
                })
                .catch((e: Error) => setError(e.message))
                .finally(() => setBusy(false))
            }}
          >
            Pull in new ones
          </Button>
        )}
      </div>

      {note && <p className="text-muted-foreground text-sm">{note}</p>}

      <TableScroll>
        <Table>
          <THead>
            <tr>
              <TH className="w-20">Code</TH>
              <TH>Discipline</TH>
              <TH className="w-16" title="ISO 19650 role letter, used by the drawing naming convention">
                ISO
              </TH>
              {canEdit && forked && <TH className="w-20" />}
            </tr>
          </THead>
          <TBody>
            {rows.map((d) => (
              <TR key={d.code}>
                <TD><Code className="font-semibold">{d.code}</Code></TD>
                <TD>
                  {canEdit && forked ? (
                    <input
                      defaultValue={d.name}
                      onBlur={(e) => {
                        const v = e.target.value.trim()
                        if (v && v !== d.name) guard(updateDiscipline(organisationId, d.code, { name: v }))
                      }}
                      className="w-full rounded border px-2 py-1 text-sm"
                      aria-label={`Name for ${d.code}`}
                    />
                  ) : d.name}
                </TD>
                <TD className="text-graphite-light">
                  {canEdit && forked ? (
                    <input
                      defaultValue={d.iso_letter ?? ''}
                      maxLength={2}
                      onBlur={(e) => {
                        const v = e.target.value.trim().toUpperCase()
                        if (v !== (d.iso_letter ?? '')) {
                          guard(updateDiscipline(organisationId, d.code, { iso_letter: v || null }))
                        }
                      }}
                      className="w-14 rounded border px-2 py-1 font-mono text-sm"
                      aria-label={`ISO letter for ${d.code}`}
                    />
                  ) : <Code>{d.iso_letter}</Code>}
                </TD>
                {canEdit && forked && (
                  <TD>
                    <Button
                      variant="ghost"
                      onClick={() => guard(removeDiscipline(organisationId, d.code))}
                    >
                      Remove
                    </Button>
                  </TD>
                )}
              </TR>
            ))}
          </TBody>
        </Table>
      </TableScroll>

      {canEdit && forked && (
        <form
          className="flex flex-wrap items-end gap-2 rounded-lg border p-4"
          onSubmit={(e) => {
            e.preventDefault()
            // Refuses empty input rather than creating a blank row.
            if (!code.trim() || !name.trim()) return
            guard(addDiscipline(organisationId, {
              code: code.trim().toUpperCase(),
              name: name.trim(),
              iso_letter: letter.trim().toUpperCase() || null,
              sort_order: (rows.at(-1)?.sort_order ?? 0) + 10,
            })).then(() => { setCode(''); setName(''); setLetter('') })
          }}
        >
          <label>
            <span className="mb-1 block text-xs font-medium">Code</span>
            <input value={code} onChange={(e) => setCode(e.target.value)}
              className="w-20 rounded border px-2 py-1.5 font-mono text-sm" />
          </label>
          <label className="min-w-56 flex-1">
            <span className="mb-1 block text-xs font-medium">Discipline</span>
            <input value={name} onChange={(e) => setName(e.target.value)}
              className="w-full rounded border px-2 py-1.5 text-sm" />
          </label>
          <label>
            <span className="mb-1 block text-xs font-medium">ISO letter</span>
            <input value={letter} onChange={(e) => setLetter(e.target.value)} maxLength={2}
              className="w-16 rounded border px-2 py-1.5 font-mono text-sm" />
          </label>
          <Button type="submit" disabled={!code.trim() || !name.trim()}>Add</Button>
        </form>
      )}
    </div>
  )
}
