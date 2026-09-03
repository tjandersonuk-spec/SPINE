import { useCallback, useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Code, Table, TableScroll, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import {
  addBepValue, fetchBepFieldCodes, removeBepValue, type BepField, type BepValue,
} from '@/lib/queries'

/**
 * The permitted codes for one field of the naming convention.
 *
 * A `directory` field is read-only here on purpose. Its codes are the project's
 * companies, resolved live — giving it an editor would create a second list of
 * the same thing, and the two would diverge the first time a firm was added.
 */
export function BepFieldValues({
  field, canEdit, onClose,
}: { field: BepField; canEdit: boolean; onClose: () => void }) {
  const [values, setValues] = useState<BepValue[]>([])
  const [code, setCode] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)
  const fromDirectory = field.source === 'directory'

  const load = useCallback(() => {
    fetchBepFieldCodes(field.id)
      .then(setValues)
      .catch((e: Error) => setError(e.message))
  }, [field.id])

  useEffect(load, [load])

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-6">
      <div
        className="bg-card border-rule w-full max-w-[560px] rounded-lg border shadow-2xl"
        role="dialog"
        aria-label={`Codes for ${field.name}`}
      >
        <header className="border-rule flex items-center justify-between border-b px-5 py-4">
          <div>
            <h2 className="text-base font-semibold">{field.name}</h2>
            <p className="text-graphite text-xs">
              Field {field.position} · {field.min_len === field.max_len
                ? `${field.min_len} characters`
                : `${field.min_len}–${field.max_len} characters`}
            </p>
          </div>
          <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close">✕</Button>
        </header>

        <div className="max-h-[62vh] overflow-y-auto px-5 py-4">
          {error && <p className="text-stop mb-3 text-sm">{error}</p>}

          {fromDirectory && (
            <p className="border-rule bg-surface-2 mb-3 rounded border-l-[3px] px-3 py-2 text-sm">
              These are the project’s companies, read live from the directory. There is nothing
              stored here to edit — add a firm to the directory and its originator code becomes
              valid immediately. Keeping a second list would let the BEP and the directory
              disagree, and then neither can be enforced.
            </p>
          )}

          {values.length === 0 ? (
            <p className="text-graphite text-sm">
              {fromDirectory
                ? 'No company on this project has an originator code yet.'
                : 'No codes yet — any value of the right length will pass until you add some.'}
            </p>
          ) : (
            <TableScroll>
              <Table>
                <THead>
                  <TR>
                    <TH className="w-[90px]">Code</TH>
                    <TH>Means</TH>
                    {canEdit && !fromDirectory && <TH className="w-[80px]" />}
                  </TR>
                </THead>
                <TBody>
                  {values.map((v) => (
                    <TR key={v.code}>
                      <TD><Code>{v.code}</Code></TD>
                      <TD>{v.description ?? <span className="text-graphite">—</span>}</TD>
                      {canEdit && !fromDirectory && (
                        <TD>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              removeBepValue(field.id, v.code)
                                .then(load)
                                .catch((e: Error) => setError(e.message))
                            }}
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
          )}

          {canEdit && !fromDirectory && (
            <form
              className="mt-3 flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                // Refuses empty input rather than creating a blank row.
                if (!code.trim()) return
                addBepValue(field.id, code.trim().toUpperCase(), description.trim() || null)
                  .then(() => { setCode(''); setDescription(''); load() })
                  .catch((err: Error) => setError(err.message))
              }}
            >
              <label>
                <span className="mb-1 block text-xs font-medium">Code</span>
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className="border-rule w-[90px] rounded border px-2 py-1.5 font-mono text-sm"
                />
              </label>
              <label className="flex-1">
                <span className="mb-1 block text-xs font-medium">Means</span>
                <input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="border-rule w-full rounded border px-2 py-1.5 text-sm"
                />
              </label>
              <Button size="sm" type="submit" disabled={!code.trim()}>Add</Button>
            </form>
          )}
        </div>

        <footer className="border-rule flex justify-end border-t px-5 py-3">
          <Button size="sm" onClick={onClose}>Done</Button>
        </footer>
      </div>
    </div>
  )
}
